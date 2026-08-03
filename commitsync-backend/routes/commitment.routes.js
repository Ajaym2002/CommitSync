/**
 * Commitment Routes
 */
const express = require('express');
const { body } = require('express-validator');
const commitmentController = require('../controllers/commitmentController');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { suggestSubtasks } = require('../controllers/suggestionController');

const router = express.Router();

// Validation rules
const createCommitmentValidation = [
  body('title').notEmpty().withMessage('Title is required'),
  body('deadline').isISO8601().withMessage('Valid deadline date is required')
];

// All routes require authentication
router.use(protect);

// Routes
router.post('/suggest-subtasks', suggestSubtasks);
router.post('/', createCommitmentValidation, validate, commitmentController.createCommitment);
router.get('/', commitmentController.getCommitments);
router.get('/active', commitmentController.getActiveCommitments);
router.get('/history', commitmentController.getHistoricalCommitments);
router.get('/high-risk', commitmentController.getHighRiskCommitments);
router.get('/accountable-to', commitmentController.getCommitmentsWherePartner);
router.get('/calendar-events', commitmentController.getCalendarEvents);
router.get('/:id', commitmentController.getCommitment);
router.put('/:id', commitmentController.updateCommitment);
router.delete('/:id', commitmentController.deleteCommitment);
router.put('/:id/progress', commitmentController.updateProgress);
router.post('/:id/focus-session', commitmentController.createFocusSession);
router.post('/:id/start-focus', commitmentController.startFocus);
router.post('/:id/end-focus', commitmentController.endFocus);
router.post('/:id/complete', commitmentController.markComplete);
router.post('/:id/reschedule', commitmentController.rescheduleCommitment);
router.post('/:id/calendar-sync', commitmentController.syncToCalendar);
router.patch('/:id/partner', commitmentController.addAccountabilityPartner);
router.post('/:id/partner/accept/:notificationId', commitmentController.acceptAccountabilityRequest);
router.post('/:id/partner/reject/:notificationId', commitmentController.rejectAccountabilityRequest);
router.post('/:id/coach-tip', commitmentController.getCoachTip);

module.exports = router;