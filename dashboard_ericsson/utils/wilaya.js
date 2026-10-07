// Wilaya code rule given by the client:
// 5-digit NeId -> first two digits, 4-digit NeId -> first digit.
// This is exactly floor(neId / 1000).
exports.wilayaCodeFromNeId = (neId) => {
  if (!Number.isInteger(neId) || neId < 1000) return null; // fewer than 4 digits: invalid
  return Math.floor(neId / 1000);
};