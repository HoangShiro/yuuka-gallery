function emit(payload) {
  try {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (_) {
    process.stdout.write('{"event":"error","message":"Failed to serialize log payload."}\n');
  }
}

function createLogger() {
  return {
    emit,
    log(level, message) {
      emit({ event: 'log', level, message: String(message || '') });
    },
  };
}

module.exports = {
  emit,
  createLogger,
};
