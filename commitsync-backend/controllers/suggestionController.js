/**
 * Suggestion Controller
 */
const templateMatcher = require('../services/templateMatcher');

// @desc    Suggest sub-tasks for a commitment
// @route   POST /api/commitments/suggest-subtasks
// @access  Private
exports.suggestSubtasks = async (req, res, next) => {
  try {
    const { title, isTeam } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TITLE', message: 'Title is required for suggestions', field: 'title' }
      });
    }

    const suggestions = await templateMatcher.generateSuggestions(req.user._id, title, null, isTeam);

    res.status(200).json({
      success: true,
      subtasks: suggestions
    });
  } catch (error) {
    next(error);
  }
};
