/**
 * Template Model
 */
const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  name: {
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
    maxlength: [200, 'Name cannot exceed 200 characters']
  },
  category: {
    type: String,
    required: true,
    enum: ['Personal', 'Work', 'Adventure', 'Study', 'Self Improvement', 'Health', 'Finance', 'My Templates'],
    default: 'Personal'
  },
  risk: {
    type: String,
    maxlength: [1000, 'Risk cannot exceed 1000 characters']
  },
  reward: {
    type: String,
    maxlength: [1000, 'Reward/End Goal cannot exceed 1000 characters']
  },
  subTasks: [{
    title: { type: String, required: true },
    estimatedHours: { type: Number, min: 0 },
    priority: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' }
  }],
  averageCompletionTime: {
    type: Number,
    default: 0
  },
  useCount: {
    type: Number,
    default: 0
  },
  successRate: {
    type: Number,
    min: 0,
    max: 1,
    default: 0
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

templateSchema.index({ userId: 1, category: 1 });
templateSchema.index({ name: 'text' });

module.exports = mongoose.model('Template', templateSchema);
