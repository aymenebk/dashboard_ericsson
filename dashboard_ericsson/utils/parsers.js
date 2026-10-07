// Small, pure parsing helpers for the import pipeline.

// "10/02/2026 00:00:00" (dd/mm/yyyy hh:mm:ss, day first) -> Date in UTC, or null.
// A real Date object (when the cell is a true Excel date) is accepted as is.
exports.parseEndTime = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi, s] = [Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, h, mi, s));
  // reject overflow such as 31/02/2026 or 10/13/2026
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return d;
};

// "1/11/106 'To_2238',PacketLinks=1/17/1,1/18/1"
//   -> { raw, portRef: "1/11/106", label: "To_2238", notInUse: false }
// The raw string is always kept untouched (the exporter may truncate labels).
exports.parseMeasurePoint = (value) => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === '') return null;
  const port = /^(\d+(?:\/\d+)+)/.exec(raw);
  const label = /'([^']*)'/.exec(raw);
  return {
    raw,
    portRef: port ? port[1] : null,
    label: label ? label[1] : null,
    notInUse: /not in-use/i.test(raw),
  };
};

// Integer from a number or a numeric string (CSV gives strings). Otherwise null.
exports.toInt = (value) => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

// Empty cell -> null, otherwise trimmed text.
exports.toText = (value) => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
};