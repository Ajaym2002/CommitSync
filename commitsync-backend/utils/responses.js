/**
 * Standard API Response Utilities
 */
exports.successResponse = (res, data, message = null, statusCode = 200) => {
  const response = {
    success: true,
    data
  };

  if (message) {
    response.message = message;
  }

  return res.status(statusCode).json(response);
};

exports.errorResponse = (res, message, statusCode = 400, code = 'ERROR', field = null) => {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      field,
      statusCode
    }
  });
};

exports.paginatedResponse = (res, data, page, limit, total) => {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
};