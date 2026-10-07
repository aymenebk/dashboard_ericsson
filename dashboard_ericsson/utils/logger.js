// Structured logging: one JSON object per line on stdout (stderr for errors), easy to ship to any log tool.
// Silent while running under Jest unless LOG_LEVEL is set. Never pass secrets, tokens, passwords or file
// contents to it: only identifiers, counts and sizes.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const threshold = () => {
  const wanted = (process.env.LOG_LEVEL || '').toLowerCase();
  if (wanted in LEVELS) return LEVELS[wanted];
  return process.env.NODE_ENV === 'test' ? LEVELS.silent : LEVELS.info;
};

// Keys whose value must never be written to a log line, whatever the caller passes
const REDACTED = /pass(word)?|secret|token|authorization|cookie|jwt/i;

function clean(fields) {
  const out = {};
  Object.entries(fields || {}).forEach(([k, v]) => {
    out[k] = REDACTED.test(k) ? '[redacted]' : v;
  });
  return out;
}

// An Error becomes { name, message, stack }: the stack goes to the server log only, never to a client
function describeError(err) {
  if (!(err instanceof Error)) return { message: String(err) };
  return { name: err.name, message: err.message, code: err.code, stack: err.stack };
}

function write(level, message, fields) {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...clean(fields) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

module.exports = {
  debug: (message, fields) => write('debug', message, fields),
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
  describeError,
};
