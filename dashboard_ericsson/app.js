const express = require('express');

const { protect } = require('./controllers/authController');


const authRouter = require('./routes/authRoutes');
const importRouter = require('./routes/importRoutes');
const dashboardRouter = require('./routes/dashboardRoutes');
const wilayaRouter = require('./routes/wilayaRoutes');
const siteRouter = require('./routes/siteRoutes');
const mongoose = require('mongoose');
const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');
const security = require('./utils/security');

const app = express();

// Behind a reverse proxy, TRUST_PROXY = number of proxies, so that the rate limiter sees the real client IP
if (/^\d+$/.test(process.env.TRUST_PROXY || '')) app.set('trust proxy', Number(process.env.TRUST_PROXY));

app.use(security.requestId);
app.use(security.requestLogger);
app.use(security.securityHeaders());
app.use(security.corsPolicy());
app.use('/api/v1', security.apiLimiter());
app.use(express.json({ limit: '10kb' }));

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API is running',
    uptime: Math.round(process.uptime()),
    database: DB_STATES[mongoose.connection.readyState] || 'unknown',
  });
});

app.use('/api/v1/auth/login', security.loginLimiter());
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/imports', protect, importRouter);
app.use('/api/v1/dashboard', protect, dashboardRouter);
app.use('/api/v1/wilayas', protect, wilayaRouter);
app.use('/api/v1/sites', protect, siteRouter);
// Unknown routes
app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

app.use(globalErrorHandler);

module.exports = app;