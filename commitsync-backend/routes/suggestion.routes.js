/**
 * Suggestion Routes
 */
const express = require('express');
const { suggestSubtasks } = require('../controllers/suggestionController');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/suggest-subtasks', protect, suggestSubtasks);

module.exports = router;
