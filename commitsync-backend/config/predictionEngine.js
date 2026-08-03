/**
 * Prediction Engine Configuration
 * Centralized config for prediction engine API
 */

const config = {
  predictionEngineUrl: process.env.PREDICTION_ENGINE_URL || 'http://localhost:5000',
  apiTimeout: 10000, // 10 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
};

module.exports = config;