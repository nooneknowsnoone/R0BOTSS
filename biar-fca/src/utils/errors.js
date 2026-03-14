"use strict";

/**
 * Base error class for all biar-fca errors
 */
class FCAError extends Error {
  /**
   * Creates a new FCAError
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = "FCAError";
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Converts error to JSON
   * @returns {object} JSON representation of the error
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

/**
 * Authentication-related errors
 */
class AuthenticationError extends FCAError {
  /**
   * Creates a new AuthenticationError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "AUTH_ERROR", details);
    this.name = "AuthenticationError";
  }
}

/**
 * Network-related errors
 */
class NetworkError extends FCAError {
  /**
   * Creates a new NetworkError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "NETWORK_ERROR", details);
    this.name = "NetworkError";
  }
}

/**
 * Validation-related errors
 */
class ValidationError extends FCAError {
  /**
   * Creates a new ValidationError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

/**
 * Rate limit errors
 */
class RateLimitError extends FCAError {
  /**
   * Creates a new RateLimitError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details including retryAfter
   */
  constructor(message, details = {}) {
    super(message, "RATE_LIMIT_ERROR", details);
    this.name = "RateLimitError";
    this.retryAfter = details.retryAfter || null;
  }
}

/**
 * Timeout errors
 */
class TimeoutError extends FCAError {
  /**
   * Creates a new TimeoutError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "TIMEOUT_ERROR", details);
    this.name = "TimeoutError";
  }
}

/**
 * Permission-related errors
 */
class PermissionError extends FCAError {
  /**
   * Creates a new PermissionError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "PERMISSION_ERROR", details);
    this.name = "PermissionError";
  }
}

/**
 * Resource not found errors
 */
class NotFoundError extends FCAError {
  /**
   * Creates a new NotFoundError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "NOT_FOUND_ERROR", details);
    this.name = "NotFoundError";
  }
}

/**
 * Configuration errors
 */
class ConfigurationError extends FCAError {
  /**
   * Creates a new ConfigurationError
   * @param {string} message - Error message
   * @param {object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, "CONFIGURATION_ERROR", details);
    this.name = "ConfigurationError";
  }
}

module.exports = {
  FCAError,
  AuthenticationError,
  NetworkError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  PermissionError,
  NotFoundError,
  ConfigurationError,
};

