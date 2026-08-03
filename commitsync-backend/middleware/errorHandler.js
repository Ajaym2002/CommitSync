/**
 * Global Error Handler
 */
exports.errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message || 'Server Error';
  error.statusCode = err.statusCode || 500;
  let code = err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  let field = null;

  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  if (err.name === 'CastError') {
    error.message = 'Resource not found';
    error.statusCode = 404;
    code = 'NOT_FOUND';
    field = err.path;
  }

  if (err.code === 11000) {
    if (err.keyValue) {
       field = Object.keys(err.keyValue)[0];
       error.message = `${field} already exists`;
    }
    error.statusCode = 409;
    code = 'DUPLICATE_KEY';
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    error.message = messages.join(', ');
    error.statusCode = 400;
    code = 'VALIDATION_ERROR';
    field = Object.keys(err.errors)[0];
  }

  res.status(error.statusCode).json({
    success: false,
    error: {
      code,
      message: error.message,
      field,
      statusCode: error.statusCode
    }
  });
};