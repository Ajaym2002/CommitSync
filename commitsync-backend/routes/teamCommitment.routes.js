/**
 * Team Commitment Routes
 */
const express = require('express');
const { body } = require('express-validator');
const teamCommitmentController = require('../controllers/teamCommitmentController');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router({ mergeParams: true }); // To access teamId from parent route

// Validation rules
const createTeamCommitmentValidation = [
  body('title').notEmpty().withMessage('Title is required'),
  body('deadline').isISO8601().withMessage('Valid deadline is required'),
  body('subTasks').isArray({ min: 1 }).withMessage('At least one sub-task is required')
];

// All routes require authentication
router.use(protect);

// Routes
router.post('/', createTeamCommitmentValidation, validate, teamCommitmentController.createTeamCommitment);
router.get('/', teamCommitmentController.getTeamCommitments);
router.get('/history', teamCommitmentController.getHistoricalTeamCommitments);
router.get('/:id', teamCommitmentController.getTeamCommitment);
router.post('/:id/recalculate-risk', teamCommitmentController.recalculateTeamRisk);
router.put('/:id/subtasks/:subtaskId/progress', teamCommitmentController.updateSubtaskStatus);
router.put('/:id/subtasks/:subtaskId/approve', teamCommitmentController.approveProof);
router.put('/:id/subtasks/:subtaskId/reject', teamCommitmentController.rejectProof);
router.put('/:id/subtasks/:subtaskId/reschedule', teamCommitmentController.rescheduleSubtask);
router.put('/:id/subtasks/:subtaskId/assign', teamCommitmentController.assignSubtask);

module.exports = router;