const os = require('os');

// Jest cannot run the dynamic import('os') that MongoDB driver 7.x uses by default.
// Without this adapter the driver sends an empty client metadata document and
// MongoDB 8 refuses the connection ("Missing required sub-document 'driver'").
exports.testConnectOptions = {
  serverSelectionTimeoutMS: 8000,
  runtimeAdapters: { os },
};
