const Conversation = require('../models/Conversation');
const ChatMessage = require('../models/ChatMessage');
const Notification = require('../models/Notification');
const Commitment = require('../models/Commitment');
const Team = require('../models/Team');
const TeamCommitment = require('../models/TeamCommitment');
const User = require('../models/User');
const RiskSnapshot = require('../models/RiskSnapshot');
const { successResponse, errorResponse } = require('../utils/responses');
const ioStore = require('../utils/ioStore');

/**
 * @route   GET /api/chat/conversations
 */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const allConversations = await Conversation.find({ participants: userId })
      .populate('participants', 'name email')
      .populate('teamId', 'name members adminId')
      .sort('-lastMessageAt');

    // For TEAM conversations, only include those whose team has at least one
    // active commitment (PENDING, IN_PROGRESS, or AT_RISK). Conversations
    // linked to teams that only have COMPLETED/FAILED commitments (or no
    // commitments at all) are stale and should not appear in the sidebar.
    const activeStatuses = ['PENDING', 'IN_PROGRESS', 'AT_RISK'];

    // Collect unique team IDs that need checking
    const teamIds = [...new Set(
      allConversations
        .filter(c => c.type === 'TEAM' && c.teamId)
        .map(c => c.teamId._id ? c.teamId._id.toString() : c.teamId.toString())
    )];

    // Build a set of teamIds that have at least one active commitment
    let activeTeamIds = new Set();
    if (teamIds.length > 0) {
      const activeCommitments = await TeamCommitment.find({
        teamId: { $in: teamIds },
        status: { $in: activeStatuses }
      }).select('teamId').lean();
      activeCommitments.forEach(tc => activeTeamIds.add(tc.teamId.toString()));
    }

    // Fetch current user's friends list for DIRECT conversation validation
    const currentUser = await User.findById(userId).select('friends').lean();
    const friendIdSet = new Set((currentUser.friends || []).map(f => f.toString()));

    // Filter conversations, cleaning up any orphaned ones from the DB on-the-fly
    const conversations = [];
    for (const conv of allConversations) {
      if (conv.type === 'TEAM') {
        // Drop TEAM conversations whose team has no active commitment
        if (!conv.teamId) continue;
        const tid = conv.teamId._id ? conv.teamId._id.toString() : conv.teamId.toString();
        if (!activeTeamIds.has(tid)) continue;
        conversations.push(conv);
      } else {
        // DIRECT conversation: the other participant must still be a friend.
        // If not, delete the stale conversation + its messages so it never resurfaces.
        const otherParticipant = conv.participants.find(
          p => (p._id ? p._id.toString() : p.toString()) !== userId.toString()
        );
        if (!otherParticipant) continue; // malformed — skip

        const otherId = otherParticipant._id
          ? otherParticipant._id.toString()
          : otherParticipant.toString();

        if (!friendIdSet.has(otherId)) {
          // Unfriended — clean up the orphaned conversation from the database
          await ChatMessage.deleteMany({ conversationId: conv._id });
          await conv.deleteOne();
          continue;
        }
        conversations.push(conv);
      }
    }

    return successResponse(res, { count: conversations.length, conversations });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/chat/direct
 */
exports.getOrCreateDirectChat = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    const userId = req.user._id;
    if (!targetUserId) return errorResponse(res, 'targetUserId is required', 400);
    if (targetUserId.toString() === userId.toString()) return errorResponse(res, 'Cannot chat with yourself', 400);

    let conversation = await Conversation.findOne({
      type: 'DIRECT',
      participants: { $all: [userId, targetUserId], $size: 2 }
    }).populate('participants', 'name email');

    if (!conversation) {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) return errorResponse(res, 'Target user not found', 404);
      conversation = await Conversation.create({ type: 'DIRECT', participants: [userId, targetUserId] });
      conversation = await Conversation.findById(conversation._id).populate('participants', 'name email');
    }
    return successResponse(res, { conversation });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/chat/conversations/:id/messages
 */
exports.getMessages = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user._id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const startIndex = (page - 1) * limit;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    if (!conversation.participants.includes(userId)) return errorResponse(res, 'Not authorized to view this conversation', 403);

    const messages = await ChatMessage.find({ conversationId })
      .populate('senderId', 'name email')
      .populate('reactions.userId', 'name')
      .sort('-createdAt')
      .skip(startIndex)
      .limit(limit);

    messages.sort((a, b) => a.createdAt - b.createdAt);
    return successResponse(res, { count: messages.length, messages });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/chat/conversations/:id/messages
 */
exports.sendMessage = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user._id;
    const { text, replyTo } = req.body;
    if (!text) return errorResponse(res, 'Message text is required', 400);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    if (!conversation.participants.includes(userId)) return errorResponse(res, 'Not authorized', 403);

    const messageData = {
      conversationId,
      senderId: userId,
      senderModel: 'User',
      text,
      type: 'chat'
    };

    // Attach reply reference if provided
    if (replyTo && replyTo.messageId) {
      messageData.replyTo = {
        messageId: replyTo.messageId,
        senderName: replyTo.senderName || 'Unknown',
        textPreview: replyTo.textPreview ? replyTo.textPreview.slice(0, 120) : ''
      };
    }

    const message = await ChatMessage.create(messageData);
    conversation.lastMessageAt = Date.now();
    await conversation.save();

    const populatedMessage = await ChatMessage.findById(message._id).populate('senderId', 'name email');

    // Emit real-time event to all participants in this conversation
    const io = ioStore.getIO();
    if (io) {
      conversation.participants.forEach(participantId => {
        io.to(participantId.toString()).emit('new_message', {
          conversationId,
          message: populatedMessage
        });
      });
    }

    return successResponse(res, { message: populatedMessage }, 'Message sent');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PATCH /api/chat/conversations/:id/messages/:msgId/pin
 * @desc    Toggle pin on a specific message
 */
exports.togglePinMessage = async (req, res) => {
  try {
    const { id: conversationId, msgId } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    if (!conversation.participants.map(p => p.toString()).includes(userId.toString())) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const message = await ChatMessage.findById(msgId);
    if (!message) return errorResponse(res, 'Message not found', 404);
    if (message.conversationId.toString() !== conversationId) return errorResponse(res, 'Message not in this conversation', 400);

    message.isPinned = !message.isPinned;
    await message.save();

    return successResponse(res, { isPinned: message.isPinned }, message.isPinned ? 'Message pinned' : 'Message unpinned');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/chat/conversations/:id/messages/:msgId/react
 * @desc    Add or toggle an emoji reaction on a message
 */
exports.addReaction = async (req, res) => {
  try {
    const { id: conversationId, msgId } = req.params;
    const userId = req.user._id;
    const { emoji } = req.body;
    if (!emoji) return errorResponse(res, 'Emoji is required', 400);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    if (!conversation.participants.map(p => p.toString()).includes(userId.toString())) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const message = await ChatMessage.findById(msgId);
    if (!message) return errorResponse(res, 'Message not found', 404);

    const existingIdx = message.reactions.findIndex(r => r.userId.toString() === userId.toString());

    if (existingIdx !== -1) {
      if (message.reactions[existingIdx].emoji === emoji) {
        // Same emoji → remove reaction
        message.reactions.splice(existingIdx, 1);
      } else {
        // Different emoji → update reaction
        message.reactions[existingIdx].emoji = emoji;
      }
    } else {
      // New reaction
      message.reactions.push({ userId, emoji });
    }

    await message.save();
    const updated = await ChatMessage.findById(msgId).populate('reactions.userId', 'name');

    // Emit real-time reaction update to all participants
    const io = ioStore.getIO();
    if (io) {
      conversation.participants.forEach(participantId => {
        io.to(participantId.toString()).emit('reaction_updated', {
          conversationId,
          messageId: msgId,
          reactions: updated.reactions
        });
      });
    }

    return successResponse(res, { reactions: updated.reactions }, 'Reaction updated');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/chat/conversations/:id/system-message
 * @desc    Post a rich system message from a notification (for "Share to Chat")
 */
exports.postSystemMessage = async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user._id;
    const { notificationId } = req.body;

    console.log(`[postSystemMessage] convId=${conversationId} userId=${userId} notifId=${notificationId}`);
    if (!notificationId) return errorResponse(res, 'notificationId is required', 400);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return errorResponse(res, 'Conversation not found', 404);
    if (!conversation.participants.map(p => p.toString()).includes(userId.toString())) {
      return errorResponse(res, 'Not authorized', 403);
    }

    console.log(`[postSystemMessage] conversation found, participants=${JSON.stringify(conversation.participants)}`);
    const notification = await Notification.findById(notificationId);
    if (!notification) return errorResponse(res, 'Notification not found or expired', 404);

    console.log(`[postSystemMessage] notification found type=${notification.type}`);
    // Build a rich stats block from the related commitment (if available)
    let richText = notification.message;
    let notifSnapshot = {
      title: notification.type.replace(/_/g, ' '),
      message: notification.message,
      type: notification.type,
      relatedId: notification.relatedId
    };

    if (notification.relatedId && ['COMMITMENT_ALERT', 'RISK_HIGH', 'BOTTLENECK_ALERT', 'DEADLINE_NEAR', 'FRIEND_MILESTONE'].includes(notification.type)) {
      try {
        const commitment = await Commitment.findById(notification.relatedId);
        if (commitment) {
          const now = new Date();
          const deadline = new Date(commitment.deadline);
          const daysLeft = Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));
          const totalHours = commitment.estimatedHours || 0;
          const hoursCompleted = ((commitment.progress || 0) / 100) * totalHours;
          const hoursLeft = Math.max(0, totalHours - hoursCompleted);
          const lastRisk = commitment.riskHistory && commitment.riskHistory.length > 0
            ? commitment.riskHistory[commitment.riskHistory.length - 1].score
            : null;

          // Fetch the latest risk snapshot for the breakdown
          const latestSnapshot = await RiskSnapshot.findOne({ commitmentId: commitment._id })
            .sort({ snapshotDate: -1 })
            .lean();

          richText = notification.message;
          notifSnapshot.stats = {
            commitmentTitle: commitment.title,
            progress: commitment.progress || 0,
            daysLeft,
            hoursCompleted: parseFloat(hoursCompleted.toFixed(1)),
            hoursLeft: parseFloat(hoursLeft.toFixed(1)),
            totalHours,
            riskScore: lastRisk,
            riskBreakdown: latestSnapshot?.riskBreakdown || null,
            deadline: commitment.deadline
          };
        }
      } catch (_) {
        // Commitment lookup failed — proceed without stats
        console.warn('[postSystemMessage] Commitment lookup failed:', _.message);
      }
    }

    // ── Team-level alert: build rich team analytics block ────────────────────
    if (notification.type === 'TEAM_RISK_HIGH' && notification.relatedId) {
      try {
        const teamCommitment = await TeamCommitment.findById(notification.relatedId)
          .populate('subTasks.assignedTo', 'name');
        const team = notification.relatedTeamId
          ? await Team.findById(notification.relatedTeamId).lean()
          : null;

        if (teamCommitment) {
          const now = new Date();
          const deadline = new Date(teamCommitment.deadline);
          const daysLeft = Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));

          // Collect unique members at high individual risk (>= 70)
          const highRiskMemberIds = new Set();
          (teamCommitment.subTasks || []).forEach(st => {
            if ((st.individualRiskScore || 0) >= 70) {
              (st.assignedTo || []).forEach(u => {
                if (u && u._id) highRiskMemberIds.add(u._id.toString());
              });
            }
          });

          notifSnapshot.stats = {
            commitmentTitle: teamCommitment.title,
            daysLeft,
            deadline: teamCommitment.deadline,
            // Team-specific
            teamName: team?.name || 'Team',
            teamRiskScore: Math.round(teamCommitment.teamRiskScore || 0),
            bottleneckCount: (teamCommitment.bottleneckTasks || []).length,
            criticalPathCount: (teamCommitment.criticalPath || []).length,
            highRiskMemberCount: highRiskMemberIds.size,
            memberCount: team ? team.members.length : 0,
            riskFactors: (teamCommitment.riskFactors || []).slice(0, 4).map(rf => ({
              factor: rf.factor,
              severity: rf.severity,
              explanation: rf.explanation || ''
            }))
          };
        }
      } catch (_) {
        // TeamCommitment lookup failed — proceed without stats
        console.warn('[postSystemMessage] TeamCommitment lookup failed:', _.message);
      }
    }

    console.log(`[postSystemMessage] creating ChatMessage, text preview="${richText?.substring(0,60)}"`);
    const message = await ChatMessage.create({
      conversationId,
      senderModel: 'System',
      text: richText,
      type: 'notification',
      isPinned: false,
      notificationSnapshot: notifSnapshot
    });
    console.log(`[postSystemMessage] ChatMessage created id=${message._id}`);

    conversation.lastMessageAt = Date.now();
    await conversation.save();

    const populatedMessage = await ChatMessage.findById(message._id);

    // Emit real-time event so all participants see the system message instantly
    const io = ioStore.getIO();
    if (io) {
      conversation.participants.forEach(participantId => {
        io.to(participantId.toString()).emit('new_message', {
          conversationId,
          message: populatedMessage
        });
      });
    }

    return successResponse(res, { message: populatedMessage }, 'System message posted');
  } catch (error) {
    console.error('[postSystemMessage] 500 error:', error);
    return errorResponse(res, error.message, 500);
  }
};

// Legacy - kept for backwards compat, but now superseded by postSystemMessage
exports.pinNotification = async (req, res) => {
  return errorResponse(res, 'This endpoint is deprecated. Use POST /system-message instead.', 410);
};
