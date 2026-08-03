/**
 * Team Commitment Model
 */
const mongoose = require('mongoose');

const teamCommitmentSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
    index: true
  },
  
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
  
  deadline: {
    type: Date,
    required: [true, 'Deadline is required']
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  status: {
    type: String,
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'AT_RISK', 'FAILED'],
    default: 'PENDING'
  },
  
  subTasks: [{
    title: {
      type: String,
      required: true
    },
    assignedTo: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    estimatedDays: {
      type: Number,
      min: 0,
      default: 1
    },
    isParallel: {
      type: Boolean,
      default: false
    },
    requireProof: {
      type: Boolean,
      default: false
    },
    proof: {
      url: String,
      proofType: { type: String, enum: ['IMAGE', 'AUDIO', 'DOCUMENT', 'LINK'] }
    },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'NEEDS_REVIEW', 'COMPLETED'],
      default: 'PENDING'
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deadline: Date,
    individualRiskScore: {
      type: Number,
      default: 0
    },
    isCriticalPath: {
      type: Boolean,
      default: false
    },
    dependsOn: [{
      type: mongoose.Schema.Types.ObjectId // Reference to another subtask _id
    }]
  }],
  
  // Team-level risk analysis
  teamRiskScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  riskFactors: [{
    factor: {
      type: String,
      enum: ['CRITICAL_PATH_DELAY', 'DEPENDENCY_BOTTLENECK', 'WORKLOAD_IMBALANCE', 'HIGH_AVERAGE_INDIVIDUAL_RISK']
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    },
    explanation: String,
    affectedMembers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  }],
  
  // Critical path analysis
  criticalPath: [{
    type: mongoose.Schema.Types.ObjectId // Reference to subtask _id
  }],
  
  bottleneckTasks: [{
    taskId: {
      type: mongoose.Schema.Types.ObjectId // Reference to subtask _id
    },
    title: String,
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    blockedTasks: [{
      type: mongoose.Schema.Types.ObjectId // Reference to subtask _id
    }],
    riskScore: Number,
    impact: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    }
  }]
}, {
  timestamps: true
});

// Indexes
teamCommitmentSchema.index({ teamId: 1, status: 1 });
teamCommitmentSchema.index({ deadline: 1 });

// Method: Update team risk
teamCommitmentSchema.methods.updateTeamRisk = async function(riskData) {
  this.teamRiskScore = riskData.teamRiskScore;
  this.riskFactors = riskData.riskFactors || [];
  this.criticalPath = riskData.criticalPath || [];
  this.bottleneckTasks = riskData.bottleneckTasks || [];
  
  // Update critical path flags on sub-tasks
  this.subTasks.forEach(st => {
    st.isCriticalPath = this.criticalPath.includes(st._id);
  });
  
  return await this.save();
};

module.exports = mongoose.model('TeamCommitment', teamCommitmentSchema);