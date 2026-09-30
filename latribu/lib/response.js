/**
 * Send a standardized error response
 * @param {Object} res - Express response object
 * @param {number} status - HTTP status code
 * @param {string|Object} error - Error message or object
 * @returns {void}
 */
function sendError(res, status, error) {
  const errorMessage = typeof error === 'string' ? error : 
                      error.message || 'Error desconocido';
  res.status(status).json({ 
    error: errorMessage,
    success: false 
  });
}

/**
 * Send a standardized success response
 * @param {Object} res - Express response object
 * @param {Object} data - Data to send in response
 * @param {number} status - HTTP status code (default: 200)
 * @returns {void}
 */
function sendSuccess(res, data, status = 200) {
  res.status(status).json({ 
    success: true,
    data 
  });
}

/**
 * Send a validation error response
 * @param {Object} res - Express response object
 * @param {Array|Object} errors - Validation errors
 * @returns {void}
 */
function sendValidationError(res, errors) {
  res.status(400).json({ 
    success: false,
    error: 'Error de validación',
    details: errors 
  });
}

module.exports = { sendError, sendSuccess, sendValidationError };