const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execFileAsync = util.promisify(execFile);

function appendYtDlpAuthArgs(args, options = {}) {
  const cookiesFile = String(options.cookies_file || '').trim();
  const cookiesFromBrowser = String(options.cookies_from_browser || '').trim();
  if (cookiesFile) {
    args.push('--cookies', cookiesFile);
  } else if (cookiesFromBrowser) {
    args.push('--cookies-from-browser', cookiesFromBrowser);
  }
}

function appendSponsorBlockArgs(args, options = {}) {
  if (!options.sponsorblock_enabled) return;
  const categoriesRaw = String(
    options.sponsorblock_categories ||
    'sponsor,selfpromo,intro,outro,interaction'
  ).trim();
  if (!categoriesRaw) return;
  args.push('--sponsorblock-remove', categoriesRaw);
}

// Helper to check if yt-dlp is available in PATH
async function checkYtDlp() {
  try {
    await execFileAsync('yt-dlp', ['--version']);
    return true;
  } catch (err) {
    return false;
  }
}

class MusicCache {
  constructor(cacheDir, maxSizeBytes = 1024 * 1024 * 1024) { // 1GB default
    this.cacheDir = cacheDir;
    this.maxSizeBytes = maxSizeBytes;
  }

  ensureDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  getCachedPath(trackId) {
    this.ensureDir();
    const filePath = path.join(this.cacheDir, `${trackId}.opus`);
    if (fs.existsSync(filePath)) {
      // Touch file to update mtime for LRU
      const time = new Date();
      try { fs.utimesSync(filePath, time, time); } catch (e) {}
      return filePath;
    }
    return null;
  }

  async evictLRU() {
    this.ensureDir();
    let files = fs.readdirSync(this.cacheDir).map(file => {
      const fullPath = path.join(this.cacheDir, file);
      const stat = fs.statSync(fullPath);
      return { path: fullPath, size: stat.size, mtime: stat.mtime.getTime() };
    });

    let totalSize = files.reduce((acc, f) => acc + f.size, 0);
    if (totalSize <= this.maxSizeBytes) return;

    files.sort((a, b) => a.mtime - b.mtime); // oldest first

    for (const file of files) {
      if (totalSize <= this.maxSizeBytes) break;
      try {
        fs.unlinkSync(file.path);
        totalSize -= file.size;
      } catch (err) {
        console.error('Failed to evict cache file:', err);
      }
    }
  }

  getStats() {
    if (!fs.existsSync(this.cacheDir)) return { total_files: 0, total_size_bytes: 0 };
    const files = fs.readdirSync(this.cacheDir);
    let size = 0;
    for (const f of files) size += fs.statSync(path.join(this.cacheDir, f)).size;
    return { total_files: files.length, total_size_bytes: size };
  }

  clear() {
    if (!fs.existsSync(this.cacheDir)) return;
    const files = fs.readdirSync(this.cacheDir);
    for (const f of files) {
      try { fs.unlinkSync(path.join(this.cacheDir, f)); } catch (e) {}
    }
  }
}

function generateTrackId(url) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(url).digest('hex');
}

/**
 * Resolves a search query or URL into TrackInfo object(s)
 */
async function resolveTrack(query, isSearch = false, maxResults = 1, options = {}) {
  const isUrl = /^https?:\/\//i.test(query);
  const searchPrefix = isSearch || !isUrl ? (query.includes('music') ? 'ytmusicsearch' : 'ytsearch') : '';
  const searchTarget = searchPrefix ? `${searchPrefix}${maxResults}:${query}` : query;

  const args = [
    '--dump-json',
    '--no-playlist',
    '--default-search', 'ytsearch',
    '--ignore-errors',
    searchTarget
  ];
  appendYtDlpAuthArgs(args, options);

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, { maxBuffer: 1024 * 1024 * 10 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const results = [];
    
    for (const line of lines) {
      try {
        const info = JSON.parse(line);
        if (!info || !info.title) continue;
        const originalUrl = info.webpage_url || info.original_url || searchTarget;
        results.push({
          id: generateTrackId(originalUrl),
          title: info.title,
          duration_sec: info.duration || 0,
          thumbnail: info.thumbnail || '',
          uploader: info.uploader || info.channel || 'Unknown',
          source_url: originalUrl,
          platform: info.extractor || 'unknown',
        });
      } catch (err) {
        // Skip bad JSON
      }
    }
    return results;
  } catch (err) {
    throw new Error(`Failed to resolve track: ${err.message}`);
  }
}

async function resolvePlaylist(url, limit = 50, options = {}) {
  const args = [
    '--flat-playlist',
    '--dump-json',
    '--playlist-end', String(limit),
    '--ignore-errors',
    url
  ];
  appendYtDlpAuthArgs(args, options);

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, { maxBuffer: 1024 * 1024 * 10 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const results = [];
    
    for (const line of lines) {
      try {
        const info = JSON.parse(line);
        if (!info || !info.title) continue;
        const originalUrl = info.url || info.webpage_url || info.original_url;
        if (!originalUrl) continue;
        
        results.push({
          id: generateTrackId(originalUrl),
          title: info.title,
          duration_sec: info.duration || 0,
          thumbnail: info.thumbnail || '',
          uploader: info.uploader || info.channel || 'Unknown',
          source_url: originalUrl,
          platform: info.extractor || 'unknown',
        });
      } catch (err) {
        // Skip bad JSON
      }
    }
    return results;
  } catch (err) {
    throw new Error(`Failed to resolve playlist: ${err.message}`);
  }
}

/**
 * Downloads the audio into cache. Returns the cached file path.
 *
 * yt-dlp with `-x --audio-format opus` manages the output extension itself.
 * If we pass `-o /path/hash.opus.part`, it creates `/path/hash.opus.part.opus`.
 * So we download to a temp base name (no extension) and let yt-dlp add `.opus`,
 * then rename to the final target path.
 */
async function getAudioStream(trackInfo, musicCache, options = {}) {
  musicCache.ensureDir();
  const cachedPath = musicCache.getCachedPath(trackInfo.id);
  if (cachedPath) {
    return cachedPath;
  }

  const targetPath = path.join(musicCache.cacheDir, `${trackInfo.id}.opus`);
  // Use a temp base name without extension — yt-dlp will append .opus
  const tempBase = path.join(musicCache.cacheDir, `${trackInfo.id}_tmp`);

  const args = [
    '-x',
    '--audio-format', 'opus',
    '--audio-quality', '0',
    '-o', tempBase + '.%(ext)s',
    '--no-playlist',
    trackInfo.source_url
  ];
  appendYtDlpAuthArgs(args, options);
  appendSponsorBlockArgs(args, options);

  try {
    await execFileAsync('yt-dlp', args, { timeout: 300000 }); // 5 min timeout

    // yt-dlp should have created tempBase.opus
    const expectedTempPath = tempBase + '.opus';

    if (fs.existsSync(expectedTempPath)) {
      fs.renameSync(expectedTempPath, targetPath);
    } else {
      // Fallback: scan for any file matching the temp base pattern
      const dir = musicCache.cacheDir;
      const prefix = `${trackInfo.id}_tmp`;
      const candidates = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
      if (candidates.length > 0) {
        const found = path.join(dir, candidates[0]);
        fs.renameSync(found, targetPath);
      } else {
        throw new Error('yt-dlp completed but no output file was found.');
      }
    }

    await musicCache.evictLRU();
    return targetPath;
  } catch (err) {
    // Clean up any leftover temp files
    try {
      const dir = musicCache.cacheDir;
      const prefix = `${trackInfo.id}_tmp`;
      for (const f of fs.readdirSync(dir).filter(fn => fn.startsWith(prefix))) {
        fs.unlinkSync(path.join(dir, f));
      }
    } catch (_) {}
    throw new Error(`Failed to download audio: ${err.message}`);
  }
}

module.exports = {
  checkYtDlp,
  MusicCache,
  resolveTrack,
  resolvePlaylist,
  getAudioStream,
  generateTrackId
};
