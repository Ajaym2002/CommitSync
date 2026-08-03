/**
 * User Model
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  
  password: {
    type: String,
    required: [function() { return !this.googleId; }, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't return password by default
  },
  
  googleId: {
    type: String,
    sparse: true,
    unique: true,
  },
  googleAccessToken: {
    type: String,
    select: false
  },
  googleRefreshToken: {
    type: String,
    select: false
  },
  
  // Whether the user has granted Calendar access (in addition to basic OAuth)
  calendarConnected: {
    type: Boolean,
    default: false
  },

  // Focus / Do-Not-Disturb Mode
  focusMode: {
    active: { type: Boolean, default: false },
    endsAt: { type: Date, default: null },
    commitmentId: { type: String, default: null }, // which commitment triggered the focus session
    calendarEventId: { type: String, default: null } // event ID of the Google Calendar focus block
  },
  
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  
  isVerified: {
    type: Boolean,
    default: false
  },
  
  otp: {
    type: String,
    select: false
  },
  
  otpExpiry: {
    type: Date,
    select: false
  },
  
  // Calculated behavioral profile
  behavioralProfile: {
    reliabilityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    behavioralPattern: {
      type: String,
      enum: [
        'OPTIMISTIC_SCHEDULER',
        'LAST_MINUTE_SPRINTER',
        'STEADY_PERFORMER',
        'SCOPE_CREEPER',
        'PROCRASTINATOR',
        'OVERCOMMITTER',
        'BURNOUT_RISK',
        'CONSISTENT',
        'MIXED',
        'INSUFFICIENT_DATA'
      ],
      default: 'INSUFFICIENT_DATA'
    },
    averageCompletionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1
    },
    averageDelayDays: {
      type: Number,
      default: 0
    },
    totalCommitments: {
      type: Number,
      default: 0
    },
    completedCommitments: {
      type: Number,
      default: 0
    },
    missedCommitments: {
      type: Number,
      default: 0
    },
    bestPerformanceTimeOfDay: {
      type: String,
      enum: ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'],
      default: 'MORNING'
    },
    worstPerformanceDayOfWeek: {
      type: String,
      enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
      default: 'MONDAY'
    },
    maxSustainableWorkload: {
      type: Number,
      default: 4 // Default: 4 concurrent tasks
    },
    burnoutRecoveryDays: {
      type: Number,
      default: 3
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  
  // User preferences
  preferences: {
    riskThreshold: {
      type: Number,
      default: 70,
      min: 0,
      max: 100
    },
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    aiPersona: {
      type: String,
      enum: ['Supportive', 'Strict', 'Analytical'],
      default: 'Supportive'
    },
    riskSensitivity: {
      type: String,
      enum: ['Optimistic', 'Realistic', 'Pessimistic'],
      default: 'Realistic'
    },
    workingHours: {
      start: {
        type: String,
        default: '09:00'
      },
      end: {
        type: String,
        default: '17:00'
      }
    }
  },
  
  // Friends list
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Get user statistics
userSchema.methods.getUserStats = async function() {
  const Commitment = mongoose.model('Commitment');
  
  const commitments = await Commitment.find({ userId: this._id });
  
  const total = commitments.length;
  const completed = commitments.filter(c => c.status === 'COMPLETED').length;
  const missed = commitments.filter(c => c.status === 'MISSED').length;
  
  return {
    totalCommitments: total,
    completedCommitments: completed,
    missedCommitments: missed,
    completionRate: total > 0 ? (completed / total) : 0
  };
};

module.exports = mongoose.model('User', userSchema);
