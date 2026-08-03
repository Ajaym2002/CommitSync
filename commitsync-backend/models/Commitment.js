/**
 * Commitment Model
 */
const mongoose = require('mongoose');

function arrayLimit(val) {
  return val.length <= 3;
}

const commitmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Basic information
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  category: {
    type: String,
    default: 'other'
  },
  
  // Time tracking
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  deadline: {
    type: Date,
    required: [true, 'Deadline is required'],
    index: true
  },
  
  estimatedHours: {
    type: Number,
    min: 0
  },
  
  actualHours: {
    type: Number,
    min: 0
  },
  
  completedAt: {
    type: Date
  },
  
  risk: {
    type: String,
    maxlength: [1000, 'Risk cannot exceed 1000 characters']
  },
  
  // Google Calendar integration fields
  calendarFreeHours: {
    type: Number,
    default: null  // null = calendar not queried or user not connected
  },
  calendarEventCount: {
    type: Number,
    default: null  // number of calendar events during this commitment's lifespan
  },
  ignoreCalendar: {
    type: Boolean,
    default: false // user can opt-out of calendar-influenced risk scoring
  },
  
  reward: {
    type: String,
    maxlength: [1000, 'Reward/End Goal cannot exceed 1000 characters']
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['DRAFT', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED_LATE', 'MISSED', 'RESCHEDULED'],
    default: 'PENDING',
    index: true
  },
  
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  // Risk management
  currentRiskScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  riskLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'LOW'
  },
  
  riskHistory: [{
    score: Number,
    level: String,
    calculatedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Behavioral tracking
  rescheduledCount: {
    type: Number,
    default: 0
  },
  
  rescheduledHistory: [{
    oldDeadline: Date,
    newDeadline: Date,
    reason: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Sub-tasks definition
  subTasks: [{
    title: { type: String, required: true },
    estimatedHours: { type: Number, min: 0 },
    actualHours: { type: Number, min: 0, default: 0 },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    priority: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' }
  }],
  
  // Team context
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team'
  },
  
  isTeamCommitment: {
    type: Boolean,
    default: false
  },
  
  accountabilityPartners: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    validate: [arrayLimit, '{PATH} exceeds the limit of 3']
  },
  
  pendingAccountabilityPartners: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Commitment'
  }],
  
  // Interventions
  interventions: [{
    type: {
      type: String,
      enum: ['WARNING', 'CRITICAL_ALERT', 'SUGGESTION', 'REMINDER']
    },
    message: String,
    calendarHint: {
      type: String,
      default: null // e.g. "📅 Next free slot: Sat, Jun 13 at 09:00 AM"
    },
    triggeredAt: {
      type: Date,
      default: Date.now
    },
    acknowledged: {
      type: Boolean,
      default: false
    },
    riskScore: {
      type: Number,
      default: 0
    }
  }],
  
  _focusSlot: {
    start: Date,
    end: Date
  },

  // AI-generated retrospective (generated async after COMPLETED or MISSED)
  retrospective: {
    reflection: { type: String, default: null },
    nextTimeAdvice: { type: String, default: null },
    generatedAt: { type: Date, default: null }
  }
}, {
  timestamps: true
});

// Indexes for performance
commitmentSchema.index({ userId: 1, status: 1 });
commitmentSchema.index({ userId: 1, deadline: 1 });
commitmentSchema.index({ teamId: 1 });
commitmentSchema.index({ currentRiskScore: -1 });
commitmentSchema.index({ title: 'text', description: 'text' });

// Virtual: Check if overdue
commitmentSchema.virtual('isOverdue').get(function() {
  if (this.status === 'COMPLETED') return false;
  return new Date() > this.deadline;
});

// Virtual: Days until deadline
commitmentSchema.virtual('daysUntilDeadline').get(function() {
  const now = new Date();
  const diffTime = this.deadline - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Method: Update progress
commitmentSchema.methods.updateProgress = async function(newProgress) {
  this.progress = Math.max(0, Math.min(100, newProgress));
  return await this.save();
};

// Method: Reschedule
commitmentSchema.methods.reschedule = async function(newDeadline, reason) {
  this.rescheduledHistory.push({
    oldDeadline: this.deadline,
    newDeadline: newDeadline,
    reason: reason || 'No reason provided',
    timestamp: new Date()
  });
  
  this.deadline = newDeadline;
  this.rescheduledCount += 1;
  this.status = 'RESCHEDULED';
  
  return await this.save();
};

// Method: Add intervention
commitmentSchema.methods.addIntervention = async function(type, message, calendarHint = null, riskScore = 0) {
  this.interventions.push({
    type,
    message,
    calendarHint: calendarHint || null,
    triggeredAt: new Date(),
    acknowledged: false,
    riskScore
  });
  
  return await this.save();
};

// Static: Get active commitments for user
commitmentSchema.statics.getActiveCommitments = function(userId) {
  return this.find({
    userId,
    status: { $in: ['DRAFT', 'PENDING', 'IN_PROGRESS', 'RESCHEDULED'] }
  })
  .populate('accountabilityPartners', 'name profilePicture behavioralProfile.reliabilityScore behavioralProfile.behavioralPattern')
  .sort({ deadline: 1 });
};

// Static: Get high-risk commitments for user
commitmentSchema.statics.getHighRiskCommitments = function(userId, threshold = 70) {
  return this.find({
    userId,
    status: { $in: ['PENDING', 'IN_PROGRESS'] },
    currentRiskScore: { $gte: threshold }
  }).sort({ currentRiskScore: -1 });
};

module.exports = mongoose.model('Commitment', commitmentSchema);