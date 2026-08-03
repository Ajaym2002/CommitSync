/**
 * Risk Snapshot Model - Historical risk tracking
 */
const mongoose = require('mongoose');

const riskSnapshotSchema = new mongoose.Schema({
  commitmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Commitment',
    required: true,
    index: true
  },
  
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  snapshotDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  riskScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  
  riskLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    required: true
  },
  
  // Risk breakdown
  riskBreakdown: {
    timePressure: Number,
    historicalReliability: Number,
    workloadDensity: Number,
    recommitFrequency: Number
  },
  
  // Context at time of snapshot
  context: {
    progress: Number,
    daysUntilDeadline: Number,
    concurrentTasks: Number,
    rescheduledCount: Number
  },
  
  // Prediction accuracy (filled after commitment resolves)
  actualOutcome: {
    type: String,
    enum: ['COMPLETED_ON_TIME', 'COMPLETED_LATE', 'MISSED', 'PENDING']
  },
  
  predictionAccuracy: {
    type: Number,
    min: 0,
    max: 100
  }
}, {
  timestamps: false
});

// Compound indexes for queries
riskSnapshotSchema.index({ commitmentId: 1, snapshotDate: -1 });
riskSnapshotSchema.index({ userId: 1, snapshotDate: -1 });

// Static: Get risk trend for commitment
riskSnapshotSchema.statics.getRiskTrend = function(commitmentId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({
    commitmentId,
    snapshotDate: { $gte: startDate }
  }).sort({ snapshotDate: 1 });
};

module.exports = mongoose.model('RiskSnapshot', riskSnapshotSchema);