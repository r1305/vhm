const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class AuthService {
  /**
   * Generate a JWT token
   * @param {Object} payload - Data to encode in token
   * @param {string} secret - Secret key for signing
   * @param {string|number} expiresIn - Expiration time
   * @returns {string} Signed JWT token
   */
  static generateToken(payload, secret, expiresIn) {
    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Verify a JWT token
   * @param {string} token - JWT token to verify
   * @param {string} secret - Secret key for verification
   * @returns {Object} Decoded payload
   * @throws {Error} If token is invalid
   */
  static verifyToken(token, secret) {
    return jwt.verify(token, secret);
  }

  /**
   * Hash a password using bcrypt
   * @param {string} password - Plain text password
   * @param {number} saltRounds - Number of salt rounds (default: 12)
   * @returns {Promise<string>} Hashed password
   */
  static hashPassword(password, saltRounds = 12) {
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Compare a password with its hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} True if password matches hash
   */
  static comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a CSRF token
   * @param {string} secret - Secret for HMAC signing
   * @returns {string} CSRF token in format "token.signature"
   */
  static generateCsrfToken(secret) {
    const token = crypto.randomBytes(32).toString('hex');
    const sig = crypto.createHmac('sha256', secret).update(token).digest('hex').slice(0, 16);
    return `${token}.${sig}`;
  }

  /**
   * Validate a CSRF token
   * @param {string} token - CSRF token to validate
   * @param {string} secret - Secret used for HMAC signing
   * @returns {boolean} True if token is valid
   */
  static validateCsrfToken(token, secret) {
    if (!token || typeof token !== 'string') return false;
    const [val, sig] = token.split('.');
    if (!val || !sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(val).digest('hex').slice(0, 16);
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  }
}

module.exports = AuthService;