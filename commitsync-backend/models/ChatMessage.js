const mongoose = require('mongoose');
const crypto = require('crypto');

// AES-256-CBC configuration
const algorithm = 'aes-256-cbc';
const secretKey = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012'; // 32 characters fallback
const ivLength = 16;

const chatMessageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  commitmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Commitment',
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'senderModel'
  },
  senderModel: {
    type: String,
    enum: ['User', 'System'],
    default: 'User'
  },
  text: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['chat', 'notification'],
    default: 'chat'
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  notificationSnapshot: new mongoose.Schema({
    title: String,
    message: String,
    type: String,
    relatedId: mongoose.Schema.Types.ObjectId,
    stats: new mongoose.Schema({
      commitmentTitle: String,
      progress: Number,
      daysLeft: Number,
      hoursCompleted: Number,
      hoursLeft: Number,
      totalHours: Number,
      riskScore: Number,
      riskBreakdown: {
        timePressure: Number,
        workloadDensity: Number,
        historicalReliability: Number,
        recommitFrequency: Number
      },
      deadline: Date,
      // ── Team-specific stats ──────────────────────────────────────────────
      teamName: String,
      teamRiskScore: Number,
      bottleneckCount: Number,
      criticalPathCount: Number,
      highRiskMemberCount: Number,
      memberCount: Number,
      riskFactors: [{
        factor: String,
        severity: String,
        explanation: String,
        _id: false
      }]
    }, { _id: false })
  }, { _id: false }),
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: String
  }],
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
    senderName: String,
    textPreview: String
  },
  iv: {
    type: String // Store initialization vector here so we don't have to parse it out of text
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Encrypt text before saving
chatMessageSchema.pre('save', function(next) {
  if (!this.isModified('text') || !this.text) {
    return next();
  }

  // Generate a random initialization vector
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv);
  
  let encrypted = cipher.update(this.text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  this.iv = iv.toString('hex');
  this.text = encrypted.toString('hex');
  
  next();
});

// Decrypt method or hook
function decryptText(textHex, ivHex) {
  if (!textHex || !ivHex) return textHex;
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(textHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv);
    
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString();
  } catch (err) {
    console.error('Error decrypting message:', err);
    return textHex; // return encrypted string if error occurs
  }
}

// Hook to decrypt after finding documents
chatMessageSchema.post(['find', 'findOne', 'findOneAndUpdate'], function(docs, next) {
  if (!docs) return next();
  
  const processDoc = (doc) => {
    if (doc && doc.text && doc.iv) {
      doc.text = decryptText(doc.text, doc.iv);
    }
  };

  if (Array.isArray(docs)) {
    docs.forEach(processDoc);
  } else {
    processDoc(docs);
  }
  
  next();
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
