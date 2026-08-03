/**
 * Template Routes
 */
const express = require('express');
const {
  getTemplates,
  getSuggestedTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate
} = require('../controllers/templateController');

const router = express.Router();

const { protect } = require('../middleware/auth.middleware');

// Apply protection to all template routes
router.use(protect);

router
  .route('/')
  .get(getTemplates)
  .post(createTemplate);

router
  .route('/suggest')
  .get(getSuggestedTemplates);

router
  .route('/:id')
  .put(updateTemplate)
  .delete(deleteTemplate);

module.exports = router;
