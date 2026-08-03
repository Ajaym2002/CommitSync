/**
 * Team Model
 */
const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Team name is required'],
    trim: true,
    maxlength: [100, 'Team name cannot exceed 100 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  isEntryClosed: {
    type: Boolean,
    default: false
  },
  
  inviteCode: {
    code: String,
    expiresAt: Date
  },

  
  members: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['ADMIN', 'MEMBER'],
      default: 'MEMBER'
    },
    isOwner: {
      type: Boolean,
      default: false
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    teamReliabilityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    contributionScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  }],
  
  pendingInvites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  teamMetrics: {
    overallReliabilityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    activeCommitments: {
      type: Number,
      default: 0
    },
    completedCommitments: {
      type: Number,
      default: 0
    },
    missedDeadlines: {
      type: Number,
      default: 0
    },
    averageRiskScore: {
      type: Number,
      default: 0
    },
    criticalPathFailures: {
      type: Number,
      default: 0
    },
    dependencyBottlenecks: {
      type: Number,
      default: 0
    }
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
teamSchema.index({ adminId: 1 });
teamSchema.index({ 'members.userId': 1 });

// Method: Add member
teamSchema.methods.addMember = async function(userId, role = 'MEMBER', isOwner = false) {
  // Check if user already exists
  const exists = this.members.some(m => m.userId.toString() === userId.toString());
  if (exists) {
    throw new Error('User is already a team member');
  }
  
  this.members.push({
    userId,
    role,
    isOwner,
    joinedAt: new Date()
  });
  
  return await this.save();
};

// Method: Remove member
teamSchema.methods.removeMember = async function(userId) {
  this.members = this.members.filter(m => m.userId.toString() !== userId.toString());
  return await this.save();
};

// Method: Check if user is member
teamSchema.methods.isMember = function(userId) {
  return this.members.some(m => m.userId.toString() === userId.toString());
};

// Method: Check if user is admin
teamSchema.methods.isAdmin = function(userId) {
  return this.adminId.toString() === userId.toString() ||
         this.members.some(m => m.userId.toString() === userId.toString() && m.role === 'ADMIN');
};

// Method: Get member count
teamSchema.virtual('memberCount').get(function() {
  return this.members.length;
});

module.exports = mongoose.model('Team', teamSchema);