const path = require('path');
const multer = require('multer');
const AppError = require('./appError');

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, as in the "Import data" window
const ALLOWED = { '.xlsx': 'xlsx', '.csv': 'csv' };
const MALFORMED = /malformed|unexpected end of form|boundary not found|multipart/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[path.extname(file.originalname).toLowerCase()]) {
      return cb(new AppError('Only .xlsx and .csv files are accepted', 415, 'UNSUPPORTED_FILE_TYPE'));
    }
    cb(null, true);
  },
});

// Expects ONE file in the form-data field "file". Multer errors become clean API errors.
exports.uploadSingleFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.isOperational) return next(err); // already an AppError (e.g. wrong extension)
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError('File too large (maximum 10 MB)', 413, 'FILE_TOO_LARGE'));
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Send exactly one file, in a form-data field named "file"', 400, 'UPLOAD_INVALID'));
    }
    // Broken multipart body (e.g. a line break typed inside the key name): the client's fault, not a 500
    if (!(err instanceof multer.MulterError) && MALFORMED.test(err.message)) {
      return next(new AppError(
        'The upload request is malformed. In Postman, the form-data key must be exactly "file" (no space, no line break) and its type must be File',
        400,
        'UPLOAD_MALFORMED',
      ));
    }
    return next(err);
  });
};

exports.fileTypeOf = (fileName) => ALLOWED[path.extname(fileName).toLowerCase()];
exports.MAX_BYTES = MAX_BYTES;