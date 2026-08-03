const express = require('express');
const {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  getFriends,
  searchUserByEmail
} = require('../controllers/friendController');

const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(protect); // Ensure all standard friend routes are authenticated

router.route('/')
  .get(getFriends)
  .post(sendFriendRequest);

router.route('/:friendId')
  .delete(require('../controllers/friendController').removeFriend);

router.get('/search', searchUserByEmail);

router.route('/accept/:notificationId')
  .post(acceptFriendRequest);

router.route('/reject/:notificationId')
  .post(rejectFriendRequest);

module.exports = router;
