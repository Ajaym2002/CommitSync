const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['DIRECT', 'TEAM'],
    required: true
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team'
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Ensure a user doesn't have duplicate direct conversations with the same user
// This index is tricky for arrays, so we usually sort the participants array before saving
// For now, we'll handle this logic in the controller.

module.exports = mongoose.model('Conversation', conversationSchema);
