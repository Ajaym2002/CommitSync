/**
 * Team Routes
 */
const express = require('express');
const { body } = require('express-validator');
const teamController = require('../controllers/teamController');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = express.Router();

// Validation rules
const createTeamValidation = [
  body('name').notEmpty().withMessage('Team name is required')
];

const addMemberValidation = [
  body('email').isEmail().withMessage('Valid email is required')
];

// All routes require authentication
router.use(protect);

// Routes
router.post('/', createTeamValidation, validate, teamController.createTeam);
router.get('/', teamController.getTeams);
router.get('/:id', teamController.getTeam);
router.put('/:id', teamController.updateTeam);
router.delete('/:id', teamController.deleteTeam);
router.get('/:id/members', teamController.getTeamMembers);
router.post('/:id/members', addMemberValidation, validate, teamController.addMember);
router.delete('/:id/members/:userId', teamController.removeMember);
router.post('/:id/invite-code', teamController.createInviteCode);
router.post('/join/:code', teamController.joinTeamWithCode);
router.put('/:id/members/:userId/role', teamController.updateMemberRole);
router.put('/:id/toggle-entry', teamController.toggleEntry);
router.post('/:id/invite', teamController.inviteMembers);
router.post('/:id/nudge/:userId', teamController.nudgeMember);
router.post('/accept-invite/:notificationId', teamController.acceptInvite);
router.post('/reject-invite/:notificationId', teamController.rejectInvite);

module.exports = router;