const dotenv = require('dotenv');
const mongoose = require('mongoose');
const logger = require('./utils/logger');

process.on('uncaughtException', (err) => {
  logger.error('uncaught exception, shutting down', { error: logger.describeError(err) });
  process.exit(1);
});

dotenv.config({ path: './config.env', quiet: true });
const { checkEnv } = require('./utils/checkEnv');

try {
  checkEnv(); // stop right away, with a clear message, if config.env is incomplete
} catch (err) {
  logger.error('invalid configuration', { message: err.message });
  process.exit(1);
}
const app = require('./app');

let server;

mongoose
  .connect(process.env.DATABASE_LOCAL)
  .then(() => {
    logger.info('database connected');
    const port = process.env.PORT || 3000;
    server = app.listen(port, () => {
      logger.info('server started', { port: Number(port), env: process.env.NODE_ENV || 'production', node: process.version });
    });
  })
  .catch((err) => {
    logger.error('could not connect to the database', { error: logger.describeError(err) });
    process.exit(1);
  });

// Finish the requests in progress, close the database, then exit (Ctrl+C, docker stop, process managers)
function shutdown(signal) {
  logger.info('shutting down', { signal });
  const finish = () => mongoose.connection.close().finally(() => process.exit(0));
  if (server) server.close(finish);
  else finish();
  setTimeout(() => process.exit(1), 10000).unref();
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (err) => {
  logger.error('unhandled rejection, shutting down', { error: logger.describeError(err) });
  if (server) server.close(() => process.exit(1));
  else process.exit(1);
});
