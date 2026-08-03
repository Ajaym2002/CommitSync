/**
 * Template Controller
 */
const Template = require('../models/Template');
const Commitment = require('../models/Commitment');

// @desc    Get all user templates
// @route   GET /api/templates
// @access  Private
exports.getTemplates = async (req, res, next) => {
  try {
    const templates = await Template.find({ userId: req.user._id })
      .sort({ lastUsed: -1, useCount: -1 });

    res.status(200).json({
      success: true,
      count: templates.length,
      data: templates
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new template
// @route   POST /api/templates
// @access  Private
exports.createTemplate = async (req, res, next) => {
  try {
    // Add user to req.body
    req.body.userId = req.user._id;

    const template = await Template.create(req.body);

    res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a template
// @route   PUT /api/templates/:id
// @access  Private
exports.updateTemplate = async (req, res, next) => {
  try {
    let template = await Template.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
    }

    if (template.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authorized to update this template' } });
    }

    const { name, category, risk, reward, subTasks } = req.body;
    template = await Template.findByIdAndUpdate(
      req.params.id,
      { name, category, risk, reward, subTasks },
      { new: true, runValidators: true }
    );

    res.status(200).json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

// @desc    Get suggested templates (from history or manual templates)
// @route   GET /api/templates/suggest
// @access  Private
exports.getSuggestedTemplates = async (req, res, next) => {
  try {
    const { category, title } = req.query;
    
    // First, try to find existing user-created templates
    let query = { userId: req.user._id };
    if (category) {
      query.category = category;
    }
    
    // If we have a title, could do a basic text search if we added an index, 
    // but for now let's just use category if provided
    let templates = await Template.find(query)
      .sort({ successRate: -1, useCount: -1, lastUsed: -1 })
      .limit(5);

    // If we want to enrich this by dynamically suggesting from past commitments, 
    // we can search user's past commitments with similar titles
    if (title && templates.length < 5) {
      const pastCommitments = await Commitment.find({
        userId: req.user._id,
        $text: { $search: title },
        'subTasks.0': { $exists: true }
      })
      .sort({ score: { $meta: 'textScore' } })
      .limit(3);

      // Convert past commitments into 'template-like' suggestions
      const dynamicSuggestions = pastCommitments.map(c => ({
        _id: c._id, // use commitment id
        name: `From past: ${c.title}`,
        category: c.category,
        subTasks: c.subTasks,
        isDynamic: true
      }));

      templates = [...templates, ...dynamicSuggestions].slice(0, 5);
    }

    res.status(200).json({
      success: true,
      count: templates.length,
      data: templates
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a template
// @route   DELETE /api/templates/:id
// @access  Private
exports.deleteTemplate = async (req, res, next) => {
  try {
    const template = await Template.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Template not found' }
      });
    }

    // Make sure user owns template
    if (template.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authorized to delete this template' }
      });
    }

    await template.deleteOne();

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    next(error);
  }
};
