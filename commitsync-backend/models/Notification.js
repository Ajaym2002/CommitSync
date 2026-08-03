const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['FRIEND_REQUEST', 'ACCOUNTABILITY_REQUEST', 'COMMITMENT_ALERT', 'COMMITMENT_COMPLETED', 'SYSTEM_INFO', 'TEAM_INVITE', 'TEAM_JOINED', 'DEADLINE_NEAR', 'RISK_HIGH', 'TEAM_RISK_HIGH', 'PROOF_SUBMITTED', 'PROOF_APPROVED', 'BOTTLENECK_ALERT', 'FRIEND_MILESTONE', 'MESSAGE_RECEIVED']
  },
  message: {
    type: String,
    required: true
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId, // Could be Commitment ID or User ID (for friend request)
    index: true
  },
  // For partner-side RISK_HIGH notifications: who owns the at-risk commitment
  relatedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // For team-level alerts: which team fired this notification
  relatedTeamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null
  },
  isRead: {
    type: Boolean,
    default: false
  },
  actionStatus: {
    type: String,
    enum: ['PENDING', 'ACCEPTED', 'DECLINED'],
    default: 'PENDING'
  },
  // Actionable notification fields (Feature 7)
  actionType: {
    type: String,
    enum: ['NONE', 'RESCHEDULE', 'MARK_DONE', 'VIEW_COMMITMENT', 'BLOCK_FOCUS'],
    default: 'NONE'
  },
  actionPayload: {
    commitmentId: { type: String, default: null },
    suggestedDeadline: { type: Date, default: null }
  },
  // Focus slot suggestion (Calendar Idea 2)
  suggestedFocusSlot: {
    start: { type: Date, default: null },
    end: { type: Date, default: null }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 604800 // 7 days TTL (auto delete after 7 days)
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);
