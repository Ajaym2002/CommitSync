const express = require('express');
const {
  getConversations,
  getOrCreateDirectChat,
  getMessages,
  sendMessage,
  togglePinMessage,
  addReaction,
  postSystemMessage,
  pinNotification // legacy
} = require('../controllers/chatController');

const { protect } = require('../middleware/auth.middleware');
const router = express.Router();
router.use(protect);

router.route('/conversations').get(getConversations);
router.route('/direct').post(getOrCreateDirectChat);

router.route('/conversations/:id/messages')
  .get(getMessages)
  .post(sendMessage);

// Right-click context menu actions on specific messages
router.route('/conversations/:id/messages/:msgId/pin').patch(togglePinMessage);
router.route('/conversations/:id/messages/:msgId/react').post(addReaction);

// "Share to Chat" from notification panel
router.route('/conversations/:id/system-message').post(postSystemMessage);

// Legacy (deprecated)
router.route('/conversations/:id/pin-notification').post(pinNotification);

module.exports = router;
