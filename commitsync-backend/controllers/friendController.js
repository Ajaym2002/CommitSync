const User = require('../models/User');
const Notification = require('../models/Notification');
const emailService = require('../services/emailService');

// Send a friend request (Accountability Partner Invitation)
exports.sendFriendRequest = async (req, res, next) => {
  try {
    const { email } = req.body;
    const senderId = req.user.id;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const targetUser = await User.findOne({ email: email.toLowerCase() });
    
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found in CommitSync' });
    }

    if (targetUser._id.toString() === senderId.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot send request to yourself' });
    }

    // Check if already friends — must compare by string value, NOT by ObjectId reference
    // (Array.includes() uses === which always fails for different ObjectId instances)
    const sender = await User.findById(senderId);
    const targetIdStr = targetUser._id.toString();
    if (sender.friends && sender.friends.some(f => f.toString() === targetIdStr)) {
      return res.status(400).json({ success: false, error: 'User is already your friend' });
    }

    // Check if request already exists
    const existingNotification = await Notification.findOne({
      userId: targetUser._id,
      type: 'FRIEND_REQUEST',
      relatedId: senderId,
      isRead: false
    });

    if (existingNotification) {
      return res.status(400).json({ success: false, error: 'Friend request already sent' });
    }

    // Create Notification for Target User
    const notification = await Notification.create({
      userId: targetUser._id,
      type: 'FRIEND_REQUEST',
      message: `${sender.name} sent you a friend request to be accountability partners!`,
      relatedId: senderId
    });

    // Send email alert
    await emailService.sendFriendRequestEmail(targetUser.email, sender.name);

    res.status(200).json({
      success: true,
      data: notification,
      message: 'Friend request sent successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Accept a friend request
exports.acceptFriendRequest = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOne({
      _id: notificationId,
      userId: userId,
      type: 'FRIEND_REQUEST'
    });

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    const senderId = notification.relatedId;

    // Add to each other's friends list
    await User.findByIdAndUpdate(userId, { $addToSet: { friends: senderId } });
    await User.findByIdAndUpdate(senderId, { $addToSet: { friends: userId } });

    // Mark as read and ACCEPTED
    notification.isRead = true;
    notification.actionStatus = 'ACCEPTED';
    await notification.save();

    // Optionally notify the sender that it was accepted
    await Notification.create({
      userId: senderId,
      type: 'SYSTEM_INFO',
      message: 'Your friend request was accepted!'
    });

    res.status(200).json({
      success: true,
      message: 'Friend request accepted and partner added to friends list'
    });
  } catch (error) {
    next(error);
  }
};

// Get Friends List
exports.getFriends = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate(
      'friends',
      'name email focusMode behavioralProfile'
    );

    // Deduplicate in-memory by _id (safety net for any pre-existing duplicates in DB)
    const seenIds = new Set();
    const uniqueFriends = (user.friends || []).filter(f => {
      const idStr = f._id.toString();
      if (seenIds.has(idStr)) return false;
      seenIds.add(idStr);
      return true;
    });

    // Also repair the DB record if duplicates were found, so they don't persist
    if (uniqueFriends.length < (user.friends || []).length) {
      await User.findByIdAndUpdate(req.user.id, {
        $set: { friends: uniqueFriends.map(f => f._id) }
      });
    }
    
    const friendsWithScores = uniqueFriends.map(f => ({
      _id: f._id,
      name: f.name,
      email: f.email,
      focusMode: f.focusMode,
      reliabilityScore: f.behavioralProfile?.reliabilityScore ?? null,
      behavioralPattern: f.behavioralProfile?.behavioralPattern ?? null,
      totalCommitments: f.behavioralProfile?.totalCommitments ?? 0,
      completedCommitments: f.behavioralProfile?.completedCommitments ?? 0
    }));

    res.status(200).json({
      success: true,
      count: friendsWithScores.length,
      data: friendsWithScores
    });
  } catch (error) {
    next(error);
  }
};

// Search user by email (Exact match)
exports.searchUserByEmail = async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email query parameter is required' });
    }
    
    const targetUser = await User.findOne({ email: email.toLowerCase() }).select('name email profilePicture');
    
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'No user found with that email' });
    }
    
    if (targetUser._id.toString() === req.user.id.toString()) {
      return res.status(400).json({ success: false, error: 'You cannot add yourself' });
    }
    
    const sender = await User.findById(req.user.id);
    const targetIdStr = targetUser._id.toString();
    if (sender.friends && sender.friends.some(f => f.toString() === targetIdStr)) {
       return res.status(400).json({ success: false, error: 'User is already your friend' });
    }

    res.status(200).json({ success: true, data: targetUser });
  } catch (error) {
    next(error);
  }
};

// Reject a friend request
exports.rejectFriendRequest = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOne({
      _id: notificationId,
      userId: userId,
      type: 'FRIEND_REQUEST'
    });

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    notification.isRead = true;
    notification.actionStatus = 'DECLINED';
    await notification.save();

    res.status(200).json({ success: true, message: 'Friend request rejected' });
  } catch (error) {
    next(error);
  }
};

// Remove a friend
exports.removeFriend = async (req, res, next) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.id;

    if (!friendId) {
      return res.status(400).json({ success: false, error: 'Friend ID is required' });
    }

    const currentUser = await User.findById(userId);
    const friendUser = await User.findById(friendId);

    if (!currentUser || !friendUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Remove from each other's lists
    await User.findByIdAndUpdate(userId, { $pull: { friends: friendId } });
    await User.findByIdAndUpdate(friendId, { $pull: { friends: userId } });

    // Send a soft notification to the removed friend
    await Notification.create({
      userId: friendId,
      type: 'SYSTEM_INFO',
      message: `Your connection with ${currentUser.name} has been respectfully closed to maintain focus on your current commitments.`
    });

    // Also remove them from each other's accountability partner lists in commitments
    const Commitment = require('../models/Commitment');
    await Commitment.updateMany(
      { userId: userId, accountabilityPartners: friendId },
      { $pull: { accountabilityPartners: friendId } }
    );
    await Commitment.updateMany(
      { userId: friendId, accountabilityPartners: userId },
      { $pull: { accountabilityPartners: userId } }
    );

    // Delete direct conversation and its messages
    const Conversation = require('../models/Conversation');
    const ChatMessage = require('../models/ChatMessage');

    const directConv = await Conversation.findOne({
      type: 'DIRECT',
      participants: { $all: [userId, friendId], $size: 2 }
    });

    if (directConv) {
      await ChatMessage.deleteMany({ conversationId: directConv._id });
      await directConv.deleteOne();
    }

    res.status(200).json({ success: true, message: 'Friend removed successfully' });
  } catch (error) {
    next(error);
  }
};
