/**
 * Health Check Routes
 */
const express = require('express');
const router = express.Router();

// GET /api/health - Health check
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'CommitSync API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = router;