const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const { Readable, PassThrough } = require('node:stream');
const prism = require('prism-media');
const { resolvePolicySetting } = require('./runtime_state.cjs');

const SAMPLE_RATE = 48000;
const NUM_CHANNELS = 2;
const FRAME_MS = 20;
const FRAME_SIZE = (SAMPLE_RATE * NUM_CHANNELS * 2 * FRAME_MS) / 1000; // 3840 bytes
const SILENCE_FRAME = Buffer.alloc(FRAME_SIZE, 0);
const DEFAULT_DUCK_RATIO = 0.2;
const MAX_BUFFER_FRAMES = 50; // ~1s output buffer cap
const MAX_BURST_FRAMES = 5;   // max frames per tick to avoid starving data events
const START_BUFFER_FRAMES = 4;

// Fade durations (in frames, 1 frame = 20ms)
const FADE_DOWN_FRAMES = 15;   // 300ms fade-down when speak starts
const FADE_UP_FRAMES = 25;     // 500ms fade-up after speak stops
const UNDUCK_DELAY_FRAMES = 50; // 1000ms hold at ducked volume after speak ends

function normalizeInputType(inputType) {
  const raw = String(inputType || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'wave') return 'wav';
  return raw;
}

function clampPlaybackSpeed(speed) {
  const raw = Number(speed);
  if (!Number.isFinite(raw)) return 1.0;
  return Math.max(0.25, Math.min(3.0, raw));
}

function buildAtempoFilters(speed) {
  let remaining = clampPlaybackSpeed(speed);
  const filters = [];
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(3)}`);
  return filters;
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------
function applyVolume(frame, vol) {
  const out = Buffer.allocUnsafe(frame.length);
  for (let i = 0; i < frame.length; i += 2) {
    let s = Math.round(frame.readInt16LE(i) * vol);
    if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
    out.writeInt16LE(s, i);
  }
  return out;
}

function measureFrameEnergy(frame) {
  if (!frame || frame.length < 2) {
    return { peak: 0, rms: 0 };
  }
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < frame.length; i += 2) {
    const sample = frame.readInt16LE(i);
    const amp = Math.abs(sample);
    if (amp > peak) peak = amp;
    sumSquares += sample * sample;
    count += 1;
  }
  return {
    peak,
    rms: count ? Math.round(Math.sqrt(sumSquares / count)) : 0,
  };
}

function mixFrames(a, b, volA, volB) {
  const out = Buffer.allocUnsafe(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i += 2) {
    let s = Math.round(a.readInt16LE(i) * volA + b.readInt16LE(i) * volB);
    if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
    out.writeInt16LE(s, i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AudioChannel – one logical channel (music or speak) with its own queue
// ---------------------------------------------------------------------------
class AudioChannel {
  constructor(name, onEvent) {
    this.name = name;
    this._onEvent = onEvent;
    this.queue = [];
    this.nowPlaying = null;
    this._decoder = null;
    /** @type {Buffer[]} Chunk queue – avoids O(n²) Buffer.concat on every data event */
    this._pcmChunks = [];
    this._pcmChunksBytes = 0;
    this._paused = false;
    this._ended = false;
    this._startedPlayback = false;
    this._idSeq = 0;
    this._playbackSpeed = 1.0;
    this._skipSilence = false;
  }

  _emit(ev, data) {
    if (typeof this._onEvent === 'function') this._onEvent(ev, { channel: this.name, ...data });
  }

  _normalizePlaybackOptions(playback = {}) {
    const hasSpeed = playback && Object.prototype.hasOwnProperty.call(playback, 'speed');
    const hasSkipSilence = playback && Object.prototype.hasOwnProperty.call(playback, 'skip_silence');
    return {
      speed: hasSpeed ? clampPlaybackSpeed(playback.speed) : this._playbackSpeed,
      skip_silence: hasSkipSilence ? Boolean(playback.skip_silence) : this._skipSilence,
    };
  }

  enqueue(source, inputType, metadata, playback) {
    const id = `${this.name}-${++this._idSeq}`;
    const playbackOptions = this._normalizePlaybackOptions(playback);
    this.queue.push({ id, source, inputType, metadata: metadata || {}, playback: playbackOptions });
    this._emit('track_enqueued', { item: { id, metadata: metadata || {} }, position: this.queue.length });
    if (!this.nowPlaying && !this._decoder) this._advance();
    return { id, position: this.queue.length, metadata: metadata || {} };
  }

  _createDecoder(source, inputType, playbackOptions = {}) {
    const baseArgs = ['-analyzeduration', '0', '-loglevel', '0'];
    const outArgs = ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(NUM_CHANNELS)];
    const normalizedInputType = normalizeInputType(inputType);
    const filters = [];
    if (Boolean(playbackOptions.skip_silence)) {
      filters.push('silenceremove=start_periods=1:start_duration=0.20:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB');
    }
    const speed = clampPlaybackSpeed(playbackOptions.speed);
    if (Math.abs(speed - 1.0) > 0.001) {
      filters.push(...buildAtempoFilters(speed));
    }
    const filterArgs = filters.length > 0 ? ['-af', filters.join(',')] : [];

    if (typeof source === 'string') {
      return new prism.FFmpeg({ args: [...baseArgs, '-i', source, ...filterArgs, ...outArgs] });
    }
    const inArgs = normalizedInputType ? ['-f', normalizedInputType, '-i', 'pipe:0'] : ['-i', 'pipe:0'];
    const decoder = new prism.FFmpeg({ args: [...baseArgs, ...inArgs, ...filterArgs, ...outArgs] });
    if (Buffer.isBuffer(source)) {
      const rs = new Readable({ read() {} });
      rs.push(source);
      rs.push(null);
      rs.pipe(decoder);
    } else if (source && typeof source.pipe === 'function') {
      source.pipe(decoder);
    } else {
      throw new Error('Unsupported audio source type.');
    }
    return decoder;
  }

  _advance() {
    this._killDecoder();
    if (!this.queue.length) {
      this.nowPlaying = null;
      this._emit('channel_empty', {});
      return false;
    }
    const entry = this.queue.shift();
    this._ended = false;
    this._pcmChunks = [];
    this._pcmChunksBytes = 0;
    this._startedPlayback = false;
    this.nowPlaying = {
      id: entry.id,
      metadata: entry.metadata,
      noDuck: Boolean(entry.metadata?.noDuck),
      playback: entry.playback || this._normalizePlaybackOptions(),
    };
    this._emit('track_start', { item: this.nowPlaying, remaining: this.queue.length });

    // Defer decoder spawn to next tick so the event loop isn't blocked
    // during FFmpeg process initialization – critical to avoid starving
    // the other channel's data events.
    setImmediate(() => {
      // Guard: if stop/skip happened before deferred spawn fires
      if (!this.nowPlaying || this.nowPlaying.id !== entry.id) return;
      try {
        this._decoder = this._createDecoder(entry.source, entry.inputType, entry.playback);
        this._decoder.on('data', (chunk) => {
          this._pcmChunks.push(chunk);
          this._pcmChunksBytes += chunk.length;
        });
        this._decoder.on('end', () => { this._ended = true; });
        this._decoder.on('close', () => { this._ended = true; });
        this._decoder.on('error', (err) => {
          this._ended = true;
          this._emit('track_error', { item: this.nowPlaying, error: err?.message || String(err) });
        });
      } catch (err) {
        this._emit('track_error', { item: { id: entry.id, metadata: entry.metadata }, error: err?.message || String(err) });
        this._advance();
      }
    });
    return true;
  }

  /** Consolidate queued chunks into a single contiguous buffer (called lazily). */
  _consolidate() {
    if (this._pcmChunks.length === 0) return;
    if (this._pcmChunks.length === 1 && this._pcmChunksBytes === this._pcmChunks[0].length) {
      // Fast path: single chunk, just adopt it
      this._flatBuf = this._pcmChunks[0];
    } else {
      this._flatBuf = Buffer.concat(this._pcmChunks, this._pcmChunksBytes);
    }
    this._pcmChunks = [this._flatBuf];
  }

  /** Read one 20 ms PCM frame. Returns Buffer(3840) or null. */
  readFrame() {
    if (this._paused || (!this._decoder && !this._ended)) return null;

    if (!this._startedPlayback) {
      if (!this._ended && this._pcmChunksBytes < FRAME_SIZE * START_BUFFER_FRAMES) {
        return null;
      }
      this._startedPlayback = true;
    }

    if (this._pcmChunksBytes >= FRAME_SIZE) {
      this._consolidate();
      const buf = this._pcmChunks[0];
      const frame = Buffer.from(buf.subarray(0, FRAME_SIZE));
      const rest = buf.subarray(FRAME_SIZE);
      this._pcmChunks = rest.length > 0 ? [rest] : [];
      this._pcmChunksBytes -= FRAME_SIZE;
      return frame;
    }

    if (this._ended) {
      // Flush partial tail frame padded with silence
      if (this._pcmChunksBytes > 0) {
        this._consolidate();
        const frame = Buffer.alloc(FRAME_SIZE, 0);
        this._pcmChunks[0].copy(frame);
        this._pcmChunks = [];
        this._pcmChunksBytes = 0;
        return frame;
      }
      const finished = this.nowPlaying;
      this._killDecoder();
      this.nowPlaying = null;
      this._emit('track_end', { item: finished, remaining: this.queue.length });
      this._advance();
      return null;
    }
    return null; // buffering
  }

  get isActive() { return this._decoder !== null && !this._ended; }

  pause()  { if (!this._decoder || this._paused) return false; this._paused = true; return true; }
  resume() { if (!this._paused) return false; this._paused = false; return true; }

  skip() {
    const skipped = this.nowPlaying;
    this._emit('track_end', { item: skipped, remaining: this.queue.length, skipped: true });
    this._advance();
    return { skipped, remaining: this.queue.length };
  }

  stop() {
    const cleared = this.queue.length;
    this.queue.length = 0;
    const stopped = this.nowPlaying;
    this._killDecoder();
    this.nowPlaying = null;
    return { stopped, cleared };
  }

  remove(itemId) {
    const idx = this.queue.findIndex((e) => e.id === itemId);
    if (idx === -1) return null;
    const [r] = this.queue.splice(idx, 1);
    return { id: r.id, metadata: r.metadata };
  }

  setPlaybackSpeed(speed) {
    this._playbackSpeed = clampPlaybackSpeed(speed);
    return this._playbackSpeed;
  }

  setSkipSilence(enabled) {
    this._skipSilence = Boolean(enabled);
    return this._skipSilence;
  }

  getPlaybackSettings() {
    return {
      speed: this._playbackSpeed,
      skip_silence: this._skipSilence,
    };
  }

  status() {
    return {
      channel: this.name,
      now_playing: this.nowPlaying,
      paused: this._paused,
      playback_settings: this.getPlaybackSettings(),
      queue_length: this.queue.length,
      queue: this.queue.map((e) => ({ id: e.id, metadata: e.metadata })),
    };
  }

  _killDecoder() {
    if (this._decoder) { try { this._decoder.destroy(); } catch (_) {} this._decoder = null; }
    this._ended = false;
    this._pcmChunks = [];
    this._pcmChunksBytes = 0;
    this._startedPlayback = false;
  }

  destroy() { this.queue.length = 0; this.nowPlaying = null; this._paused = false; this._flatBuf = null; this._killDecoder(); }
}

// ---------------------------------------------------------------------------
// GuildMixer – mixes music + speak channels into one AudioPlayer per guild
// ---------------------------------------------------------------------------
class GuildMixer {
  constructor(guildId, adapter) {
    this.guildId = guildId;
    this.adapter = adapter;
    this.duckRatio = DEFAULT_DUCK_RATIO;

    const emit = (ev, data) => this._relayEvent(ev, data);
    this.music = new AudioChannel('music', emit);
    this.speak = new AudioChannel('speak', emit);

    this._output = null;
    this._opus = null;
    this._player = null;
    this._interval = null;
    this._started = false;
    this._connection = null;
    this._subscription = null;
    this._subscribing = false;
    this._traceCounter = 0;
    this._mixStartTime = 0;
    this._framesWritten = 0;

    // Smooth fading state
    this._currentMusicVol = 1.0;
    this._currentSpeakVol = 1.0;
    this._lastBaseMusicVol = null;
    this._lastBaseSpeakVol = null;
    this._unduckDelayRemaining = 0;
  }

  /** Attach to a VoiceConnection and begin the mix loop. */
  start(connection) {
    this._connection = connection || null;
    if (!this._started) {
      this._output = new PassThrough({ highWaterMark: FRAME_SIZE * 20 });
      this._opus = new prism.opus.Encoder({
        rate: SAMPLE_RATE,
        channels: NUM_CHANNELS,
        frameSize: SAMPLE_RATE * FRAME_MS / 1000,
      });
      this._output.pipe(this._opus);
      this._player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      const resource = createAudioResource(this._opus, { inputType: StreamType.Opus });
      this._player.play(resource);
      this._mixStartTime = Date.now();
      this._framesWritten = 0;
      // Use a slightly faster interval (~10ms) so we can catch up promptly
      this._interval = setInterval(() => this._mixTick(), 10);
      this._started = true;
    }
    this._subscribeIfReady();
  }

  _subscribeIfReady() {
    if (!this._connection || !this._player) {
      return false;
    }
    if (this._subscribing) {
      return false;
    }
    if (this._connection.state?.status !== VoiceConnectionStatus.Ready) {
      return false;
    }
    if (this._subscription?.connection === this._connection && this._subscription?.player === this._player) {
      return true;
    }
    this._subscribing = true;
    try {
      this._connection.subscribe(this._player);
      this._subscription = { connection: this._connection, player: this._player };
      return true;
    } finally {
      this._subscribing = false;
    }
  }

  /** Clock-based tick: compute how many 20ms frames we owe, then burst. */
  _mixTick() {
    if (!this._output) return;
    const elapsed = Date.now() - this._mixStartTime;
    const targetFrames = Math.floor(elapsed / FRAME_MS);
    // Write as many frames as needed to catch up, but cap burst size to
    // avoid monopolising the event loop (allows data events to fire between bursts)
    const deficit = targetFrames - this._framesWritten;
    if (deficit <= 0) return;
    const count = Math.min(deficit, MAX_BURST_FRAMES);
    for (let i = 0; i < count; i++) {
      this._mixFrame();
    }
  }

  _mixFrame() {
    if (!this._subscription && this._connection?.state?.status === VoiceConnectionStatus.Ready) {
      this._subscribeIfReady();
    }
    if (!this._output || this._output.readableLength > FRAME_SIZE * MAX_BUFFER_FRAMES) {
      this._framesWritten += 1;
      return;
    }

    const mf = this.music.readFrame();
    const sf = this.speak.readFrame();
    const speakActive = sf !== null;
    const noDuck = this.speak.nowPlaying?.noDuck || false;

    // Fetch base volumes from policy (fallback values if policy is missing)
    let baseMusicVol = 0.5;
    let baseSpeakVol = 1.0;
    if (this.adapter && this.adapter.runtimeState) {
      baseMusicVol = Number(resolvePolicySetting(this.adapter.runtimeState, 'core.voice.volumes', 'music_volume', 50)) / 100;
      baseSpeakVol = Number(resolvePolicySetting(this.adapter.runtimeState, 'core.voice.volumes', 'speak_volume', 100)) / 100;
    }
    baseMusicVol = Math.max(0, Math.min(1.0, baseMusicVol));
    baseSpeakVol = Math.max(0, Math.min(1.0, baseSpeakVol));

    // Handle instant UI slider changes
    if (this._lastBaseMusicVol !== null && this._lastBaseMusicVol !== baseMusicVol) {
      // Snap current volume by the exact delta the user slid
      const delta = baseMusicVol - this._lastBaseMusicVol;
      this._currentMusicVol = Math.max(0, Math.min(1.0, this._currentMusicVol + delta));
    }
    if (this._lastBaseSpeakVol !== null && this._lastBaseSpeakVol !== baseSpeakVol) {
      this._currentSpeakVol = baseSpeakVol;
    }
    this._lastBaseMusicVol = baseMusicVol;
    this._lastBaseSpeakVol = baseSpeakVol;

    // Target tracking
    let targetMusicVol = baseMusicVol;
    const duckedMusicVol = this.duckRatio * baseMusicVol;

    // --- Duck/Unduck tracking ---
    if (speakActive && !noDuck) {
      this._unduckDelayRemaining = UNDUCK_DELAY_FRAMES;
      targetMusicVol = duckedMusicVol;
    } else if (this._unduckDelayRemaining > 0) {
      this._unduckDelayRemaining--;
      targetMusicVol = duckedMusicVol;
    }

    // --- Smooth fading ---
    // Music fading
    if (this._currentMusicVol < targetMusicVol) {
      const step = Math.max(0.01, (baseMusicVol - duckedMusicVol) / FADE_UP_FRAMES);
      this._currentMusicVol = Math.min(targetMusicVol, this._currentMusicVol + step);
    } else if (this._currentMusicVol > targetMusicVol) {
      const step = Math.max(0.01, (baseMusicVol - duckedMusicVol) / FADE_DOWN_FRAMES);
      this._currentMusicVol = Math.max(targetMusicVol, this._currentMusicVol - step);
    }

    // Speak drifting (if it got offset somehow)
    if (this._currentSpeakVol < baseSpeakVol) {
      this._currentSpeakVol = Math.min(baseSpeakVol, this._currentSpeakVol + 0.1);
    } else if (this._currentSpeakVol > baseSpeakVol) {
      this._currentSpeakVol = Math.max(baseSpeakVol, this._currentSpeakVol - 0.1);
    }
    
    const mVol = this._currentMusicVol;
    const sVol = this._currentSpeakVol;

    let outFrame = null;
    if (!mf && !sf) outFrame = SILENCE_FRAME;
    else if (mf && !sf) outFrame = mVol >= 0.999 ? mf : applyVolume(mf, mVol);
    else if (!mf && sf) outFrame = sVol >= 0.999 ? sf : applyVolume(sf, sVol);
    else outFrame = mixFrames(mf, sf, mVol, sVol);

    this._traceCounter += 1;
    if ((sf || mf) && this._traceCounter % 25 === 0 && typeof this.adapter._onEvent === 'function') {
      const energy = measureFrameEnergy(outFrame);
      this.adapter._onEvent('voice.audio_debug', {
        guild_id: this.guildId,
        player_status: this._player?.state?.status || 'idle',
        connection_status: this._connection?.state?.status || 'disconnected',
        speak_active: Boolean(sf),
        music_active: Boolean(mf),
        peak: energy.peak,
        rms: energy.rms,
      });
    }

    this._output.write(outFrame);
    this._framesWritten += 1;
  }

  _relayEvent(ev, data) {
    if (typeof this.adapter._onEvent === 'function') {
      this.adapter._onEvent(`voice.${ev}`, { guild_id: this.guildId, ...data });
    }
  }

  /** Get the channel object by name. */
  ch(name) { return name === 'speak' ? this.speak : this.music; }

  status() {
    return {
      guild_id: this.guildId,
      mixer_running: this._started,
      player_status: this._player?.state?.status || 'idle',
      connection_status: this._connection?.state?.status || 'disconnected',
      music: this.music.status(),
      speak: this.speak.status(),
    };
  }

  destroy() {
    this.music.destroy();
    this.speak.destroy();
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (this._player) { try { this._player.stop(true); } catch (_) {} this._player = null; }
    if (this._opus) { try { this._opus.destroy(); } catch (_) {} this._opus = null; }
    if (this._output) { try { this._output.destroy(); } catch (_) {} this._output = null; }
    this._started = false;
    this._connection = null;
    this._subscription = null;
    this._subscribing = false;
    this._mixStartTime = 0;
    this._framesWritten = 0;
    this._currentMusicVol = 1.0;
    this._currentSpeakVol = 1.0;
    this._lastBaseMusicVol = null;
    this._lastBaseSpeakVol = null;
    this._unduckDelayRemaining = 0;
  }
}

// ---------------------------------------------------------------------------
// TrackingVoiceAdapter – top-level API surface
// ---------------------------------------------------------------------------
class TrackingVoiceAdapter {
  constructor(runtimeState, client) {
    this.runtimeState = runtimeState;
    this.client = client;
    /** @type {Map<string, GuildMixer>} */
    this._mixers = new Map();
    this._onEvent = null;
  }

  _getMixer(guildId) {
    const key = String(guildId);
    if (!this._mixers.has(key)) this._mixers.set(key, new GuildMixer(key, this));
    return this._mixers.get(key);
  }

  async connect(guildId, channelId, metadata = {}) {
    const guild = this.client?.guilds?.cache?.get(String(guildId || ''));
    if (!guild) throw new Error(`Guild ${guildId} not found in client cache.`);

    const connection = joinVoiceChannel({
      channelId: String(channelId || ''),
      guildId: String(guildId || ''),
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    const mixer = this._getMixer(guildId);
    mixer.start(connection);

    const record = {
      guild_id: String(guildId || ''),
      voice_channel_id: String(channelId || ''),
      voice_channel_name: String(metadata.voice_channel_name || ''),
      member_count: Number(metadata.member_count || 0),
      at: new Date().toISOString(),
      mode: 'live',
      connected: true,
    };
    this.runtimeState.voiceState.joinedChannelByGuild.set(String(guildId || ''), record);
    if (typeof this.runtimeState.schedulePersist === 'function') this.runtimeState.schedulePersist();
    return record;
  }

  async disconnect(guildId) {
    const mixer = this._mixers.get(String(guildId || ''));
    if (mixer) { mixer.destroy(); this._mixers.delete(String(guildId || '')); }
    const connection = getVoiceConnection(String(guildId || ''));
    if (connection) connection.destroy();
    this.runtimeState.voiceState.joinedChannelByGuild.delete(String(guildId || ''));
    if (typeof this.runtimeState.schedulePersist === 'function') this.runtimeState.schedulePersist();
    return { guild_id: String(guildId || ''), connected: false };
  }

  getStatus(guildId) {
    return this.runtimeState.voiceState.joinedChannelByGuild.get(String(guildId || '')) || null;
  }

  // ---- Channel-aware playback API ----

  enqueue(guildId, channel, source, opts = {}) {
    return this._getMixer(guildId).ch(channel).enqueue(source, opts.inputType, opts.metadata, opts.playback);
  }
  pause(guildId, channel)   { return this._getMixer(guildId).ch(channel).pause(); }
  resume(guildId, channel)  { return this._getMixer(guildId).ch(channel).resume(); }
  skip(guildId, channel)    { return this._getMixer(guildId).ch(channel).skip(); }
  stopChannel(guildId, channel) { return this._getMixer(guildId).ch(channel).stop(); }
  removeFromQueue(guildId, channel, itemId) { return this._getMixer(guildId).ch(channel).remove(itemId); }

  stopAll(guildId) {
    const m = this._getMixer(guildId);
    return { music: m.music.stop(), speak: m.speak.stop() };
  }

  getPlayerStatus(guildId) {
    const m = this._mixers.get(String(guildId));
    if (!m) return { guild_id: String(guildId), mixer_running: false, music: { now_playing: null, queue_length: 0, queue: [] }, speak: { now_playing: null, queue_length: 0, queue: [] } };
    return m.status();
  }

  setDuckRatio(guildId, ratio) {
    this._getMixer(guildId).duckRatio = Math.max(0, Math.min(1, Number(ratio) || DEFAULT_DUCK_RATIO));
  }

  setChannelPlaybackSpeed(guildId, channel, speed) {
    return this._getMixer(guildId).ch(channel).setPlaybackSpeed(speed);
  }

  setChannelSkipSilence(guildId, channel, enabled) {
    return this._getMixer(guildId).ch(channel).setSkipSilence(enabled);
  }

  getChannelPlaybackSettings(guildId, channel) {
    return this._getMixer(guildId).ch(channel).getPlaybackSettings();
  }

  // Legacy
  async enqueueSpeech(guildId, text) {
    const current = this.getStatus(guildId) || { guild_id: String(guildId || '') };
    return { ...current, queued_text: String(text || ''), implemented: false, mode: 'live' };
  }
}

function createVoiceAdapter(runtimeState, client) {
  return new TrackingVoiceAdapter(runtimeState, client);
}

module.exports = { TrackingVoiceAdapter, createVoiceAdapter };
