/**
 * CommitSync Backend Server
 * Main entry point
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cron = require('node-cron');
const connectDB = require('./config/db');
const config = require('./config/config');
const { errorHandler } = require('./middleware/errorHandler');
const riskCalculator = require('./services/riskCalculator');
const predictionService = require('./services/predictionService');

const ioStore = require('./utils/ioStore');

// Initialize Express app
const app = express();
const httpServer = http.createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: config.cors
});

// Store io in shared module so services can emit events without circular deps
ioStore.setIO(io);

// Socket.IO auth middleware + user room
const jwt = require('jsonwebtoken');
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || config.jwt?.secret);
    socket.userId = decoded.id || decoded._id;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  if (socket.userId) {
    socket.join(socket.userId.toString());
    console.log(`[Socket.IO] User ${socket.userId} connected and joined room.`);
  }
  socket.on('disconnect', () => {
    console.log(`[Socket.IO] User ${socket.userId} disconnected.`);
  });
});


// Connect to MongoDB
connectDB();


// Middleware
app.use(cors(config.cors));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (development only)
if (config.env === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const predictionEngineHealth = await predictionService.healthCheck();
  
  res.json({
    status: 'healthy',
    service: 'CommitSync Backend API',
    version: '1.0.0',
    environment: config.env,
    mongodb: 'connected',
    predictionEngine: predictionEngineHealth.available ? 'connected' : 'unavailable'
  });
});

// API Routes
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/commitments', require('./routes/commitment.routes'));
app.use('/api/teams', require('./routes/team.routes'));
app.use('/api/teams/:teamId/commitments', require('./routes/teamCommitment.routes'));
app.use('/api/teams/:teamId/risk-dashboard', 
  require('./controllers/teamCommitmentController').getTeamRiskDashboard
);
app.use('/api/analytics', require('./routes/analytics.routes'));
app.use('/api/templates', require('./routes/template.routes.js'));
app.use('/api/friends', require('./routes/friends.routes'));
app.use('/api/chat', require('./routes/chat.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handler
app.use(errorHandler);

// ── Scheduled Tasks ──────────────────────────────────────────────────────────

/**
 * CRON 1: Auto-escalate overdue commitments to MISSED.
 * Runs every 15 minutes. This is the fix for the "75% overdue" bug:
 * commitments that pass their deadline must be immediately marked MISSED
 * so the risk score reflects 100% and the user's reliability is accurate.
 */
cron.schedule('*/15 * * * *', async () => {
  try {
    const Commitment = require('./models/Commitment');
    const TeamCommitment = require('./models/TeamCommitment');
    const now = new Date();

    // 1. Escalate individual commitments
    const overdueCommitments = await Commitment.find({
      status: { $in: ['PENDING', 'IN_PROGRESS', 'RESCHEDULED'] },
      deadline: { $lt: now },
      progress: { $lt: 100 }
    });

    if (overdueCommitments.length > 0) {
      console.log(`[Auto-Escalate] Marking ${overdueCommitments.length} overdue individual commitment(s) as MISSED...`);
      
      for (const commitment of overdueCommitments) {
        commitment.status = 'MISSED';
        commitment.currentRiskScore = 100;
        commitment.riskLevel = 'CRITICAL';
        commitment.riskHistory.push({
          score: 100,
          level: 'CRITICAL',
          calculatedAt: new Date()
        });
        // Keep history trimmed
        if (commitment.riskHistory.length > 30) {
          commitment.riskHistory = commitment.riskHistory.slice(-30);
        }
        await commitment.save();

        // ── Feature 5: Generate retrospective for MISSED commitment ──
        setImmediate(async () => {
          try {
            const { generateRetrospectiveForId } = require('./controllers/commitmentController');
            if (generateRetrospectiveForId) {
              await generateRetrospectiveForId(commitment._id, 'MISSED');
            }
          } catch (retroErr) {
            // Non-blocking — ignore failures silently
          }
          try {
            const riskCalculator = require('./services/riskCalculator');
            await riskCalculator.updateUserBehavioralProfile(commitment.userId);
          } catch (profileErr) {
            // Non-blocking — ignore failures silently
          }
        });
      }
      console.log(`[Auto-Escalate] Done. ${overdueCommitments.length} individual commitment(s) marked MISSED.`);
    }


    // 2. Escalate team commitments
    const overdueTeamCommitments = await TeamCommitment.find({
      status: { $in: ['PENDING', 'IN_PROGRESS', 'RESCHEDULED'] },
      deadline: { $lt: now }
    });

    if (overdueTeamCommitments.length > 0) {
      // Need to filter out ones that are effectively 100% complete
      // since TeamCommitment doesn't have a top-level progress field
      let escalatedCount = 0;
      for (const teamComm of overdueTeamCommitments) {
        const isComplete = teamComm.subTasks.every(st => st.status === 'COMPLETED');
        if (!isComplete) {
           teamComm.status = 'FAILED'; // TeamCommitment enum: PENDING|IN_PROGRESS|COMPLETED|AT_RISK|FAILED
           teamComm.teamRiskScore = 100;
           await teamComm.save();
           escalatedCount++;
        }
      }
      if (escalatedCount > 0) {
        console.log(`[Auto-Escalate] Done. ${escalatedCount} team commitment(s) marked MISSED.`);
      }
    }

  } catch (error) {
    console.error('[Auto-Escalate] Error in overdue escalation:', error.message);
  }
});

/**
 * CRON 2: Recalculate risk for all active commitments.
 * Includes DRAFT and RESCHEDULED (previously excluded — bug fix).
 * Runs on the configured interval (default: every 30 minutes).
 *
 * After each recalculation, if the commitment is HIGH or CRITICAL risk:
 *   - Sends a RISK_HIGH in-app notification to the owner and each accountability partner
 *   - Sends alert emails to both owner and partners
 * Deduplication: checks for an existing RISK_HIGH notification for that commitmentId
 * within the past 24 hours to prevent notification spam on every cron run.
 */
cron.schedule(config.risk.recalculationInterval, async () => {
  try {
    console.log('[Risk Cron] Running scheduled risk recalculation...');
    
    const Commitment  = require('./models/Commitment');
    const Notification = require('./models/Notification');
    const User        = require('./models/User');
    const emailService = require('./services/emailService');
    const ioInstance  = ioStore.getIO();

    const activeCommitments = await Commitment.find({
      status: { $in: ['PENDING', 'IN_PROGRESS', 'RESCHEDULED', 'DRAFT'] }
    })
    .populate('accountabilityPartners', 'name email')
    .limit(100); // Process in batches to prevent memory spikes

    const WINDOW_24H = new Date(Date.now() - 24 * 3600000);

    let recalcCount = 0;
    for (const commitment of activeCommitments) {
      try {
        await riskCalculator.calculateCommitmentRisk(commitment._id);
        recalcCount++;

        // Re-fetch after calculation to get fresh riskLevel
        const fresh = await Commitment.findById(commitment._id)
          .populate('accountabilityPartners', 'name email');
        if (!fresh) continue;

        const isHighRisk = fresh.riskLevel === 'HIGH' || fresh.riskLevel === 'CRITICAL';
        if (!isHighRisk) continue;

        // ── Dedup check: was a RISK_HIGH already sent for this commitment in the last 24h? ──
        const alreadySent = await Notification.findOne({
          type: 'RISK_HIGH',
          relatedId: fresh._id,
          createdAt: { $gte: WINDOW_24H }
        });
        if (alreadySent) continue; // Skip — already alerted recently

        // Fetch the commitment owner
        const owner = await User.findById(fresh.userId).select('name email preferences');
        if (!owner) continue;

        const riskLabel = fresh.riskLevel === 'CRITICAL' ? '🔴 CRITICAL' : '🟠 HIGH';
        const riskScore = Math.round(fresh.currentRiskScore || 0);

        // ── 1. Notify OWNER ──────────────────────────────────────────────────
        const ownerNotif = await Notification.create({
          userId: fresh.userId,
          type: 'RISK_HIGH',
          message: `${riskLabel} Risk: Your commitment "${fresh.title}" has reached ${riskScore}% risk. Take action now to stay on track.`,
          relatedId: fresh._id,
          actionType: 'VIEW_COMMITMENT',
          actionPayload: { commitmentId: fresh._id.toString() }
        });

        // Push real-time notification to owner
        if (ioInstance) {
          ioInstance.to(fresh.userId.toString()).emit('new_notification', ownerNotif);
        }

        // Send email to owner (non-blocking)
        if (owner.preferences?.notificationsEnabled !== false) {
          emailService.sendRiskAlertEmail(owner.email, fresh.title, owner.name).catch(() => {});
        }

        // ── 2. Notify each ACCOUNTABILITY PARTNER ───────────────────────────
        const partners = fresh.accountabilityPartners || [];
        for (const partner of partners) {
          if (!partner || !partner._id) continue;

          const partnerNotif = await Notification.create({
            userId: partner._id,
            type: 'RISK_HIGH',
            message: `🤝 Partner Alert: ${owner.name}'s commitment "${fresh.title}" is at ${fresh.riskLevel} risk (${riskScore}%). Consider reaching out to support them.`,
            relatedId: fresh._id,        // the commitment ID
            relatedUserId: fresh.userId, // the owner (so frontend can find their direct chat)
            actionType: 'VIEW_COMMITMENT',
            actionPayload: { commitmentId: fresh._id.toString() }
          });

          // Push real-time notification to partner
          if (ioInstance) {
            ioInstance.to(partner._id.toString()).emit('new_notification', partnerNotif);
          }

          // Send partner email (non-blocking)
          emailService.sendPartnerRiskAlertEmail(partner.email, fresh.title, owner.name).catch(() => {});
        }

        console.log(`[Risk Cron] Fired RISK_HIGH alert for "${fresh.title}" (owner + ${partners.length} partner(s)).`);
      } catch (error) {
        console.error(`[Risk Cron] Failed to recalculate risk for ${commitment._id}:`, error.message);
      }
    }

    console.log(`[Risk Cron] Recalculated risk for ${recalcCount} commitments.`);
  } catch (error) {
    console.error('[Risk Cron] Error in scheduled risk recalculation:', error.message);
  }
});

/**
 * CRON 4: Team Risk Alert Cron.
 * Runs on the same interval as the individual risk cron.
 * For each active TeamCommitment:
 *   - If teamRiskScore >= 70 (HIGH) OR any CRITICAL/HIGH bottleneck exists:
 *     - Fires TEAM_RISK_HIGH notification to EVERY team member
 *     - Emits real-time socket event to each member's room
 * Deduplication: 24h window per teamCommitmentId (same pattern as individual cron).
 */
cron.schedule(config.risk.recalculationInterval, async () => {
  try {
    console.log('[Team Risk Cron] Running scheduled team risk alert check...');

    const TeamCommitment = require('./models/TeamCommitment');
    const Team           = require('./models/Team');
    const Notification   = require('./models/Notification');
    const predictionService = require('./services/predictionService');
    const ioInstance     = ioStore.getIO();

    const TEAM_RISK_THRESHOLD = 70; // Same threshold as individual RISK_HIGH
    const WINDOW_24H = new Date(Date.now() - 24 * 3600000);

    const activeTeamCommitments = await TeamCommitment.find({
      status: { $in: ['PENDING', 'IN_PROGRESS', 'AT_RISK'] }
    }).populate('subTasks.assignedTo', 'name email').limit(100);

    let alertsFired = 0;

    for (const tc of activeTeamCommitments) {
      try {
        // Recalculate live risk so scores are fresh
        const liveRisk = await predictionService.calculateTeamRisk(tc);
        if (liveRisk.success) {
          tc.teamRiskScore   = liveRisk.data.teamRiskScore   ?? tc.teamRiskScore;
          tc.bottleneckTasks = liveRisk.data.bottleneckTasks ?? tc.bottleneckTasks;
          tc.riskFactors     = liveRisk.data.riskFactors     ?? tc.riskFactors;
          tc.criticalPath    = liveRisk.data.criticalPath    ?? tc.criticalPath;
        }

        const hasCriticalBottleneck = (tc.bottleneckTasks || []).some(
          bt => bt.impact === 'CRITICAL' || bt.impact === 'HIGH'
        );
        const isHighRisk = (tc.teamRiskScore || 0) >= TEAM_RISK_THRESHOLD;

        if (!isHighRisk && !hasCriticalBottleneck) continue;

        // Dedup: was a TEAM_RISK_HIGH already sent for this teamCommitment in the last 24h?
        const alreadySent = await Notification.findOne({
          type: 'TEAM_RISK_HIGH',
          relatedId: tc._id,
          createdAt: { $gte: WINDOW_24H }
        });
        if (alreadySent) continue;

        const team = await Team.findById(tc.teamId).lean();
        if (!team) continue;

        const riskScore   = Math.round(tc.teamRiskScore || 0);
        const riskLabel   = riskScore >= 85 ? '🔴 CRITICAL' : '🟠 HIGH';
        const bottlenecks = (tc.bottleneckTasks || []).length;
        const bottleneckNote = bottlenecks > 0
          ? ` ${bottlenecks} bottleneck${bottlenecks > 1 ? 's' : ''} detected.`
          : '';

        const msgText = `${riskLabel} Team Risk: "${tc.title}" in ${team.name} has reached ${riskScore}% risk.${bottleneckNote} Immediate attention required.`;

        // Notify EVERY team member
        const memberIds = team.members.map(m =>
          m.userId ? m.userId.toString() : m.toString()
        );

        for (const memberId of memberIds) {
          const notif = await Notification.create({
            userId:        memberId,
            type:          'TEAM_RISK_HIGH',
            message:       msgText,
            relatedId:     tc._id,       // TeamCommitment ID — for stats lookup
            relatedTeamId: team._id      // Team ID — for conversation resolution
          });

          if (ioInstance) {
            ioInstance.to(memberId).emit('new_notification', notif);
          }
        }

        alertsFired++;
        console.log(`[Team Risk Cron] Fired TEAM_RISK_HIGH for "${tc.title}" → ${memberIds.length} member(s).`);
      } catch (tcErr) {
        console.error(`[Team Risk Cron] Failed for commitment ${tc._id}:`, tcErr.message);
      }
    }

    console.log(`[Team Risk Cron] Done. Fired ${alertsFired} team alert(s).`);
  } catch (error) {
    console.error('[Team Risk Cron] Fatal error:', error.message);
  }
});

/**
 * CRON 3: Daily proactive nudge delivery.
 * Runs every morning at 8 AM. Scans all users with active commitments and
 * delivers up to 2 server-side nudge notifications per user via the Notification
 * system. Rules mirror the frontend nudgeEngine but run server-side so users
 * receive nudges even when they haven't opened the app.
 *
 * Deduplication: each rule checks for a recent identical notification before
 * firing to prevent notification spam.
 */
cron.schedule('0 8 * * *', async () => {
  try {
    console.log('[Nudge Cron] Running daily proactive nudge delivery...');
    const Commitment  = require('./models/Commitment');
    const User        = require('./models/User');
    const Notification = require('./models/Notification');

    const now      = new Date();
    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const todayEnum = DAY_NAMES[now.getDay()]; // Matches User model enum

    // Aggregate all active commitments grouped by user
    const userGroups = await Commitment.aggregate([
      { $match: { status: { $in: ['PENDING', 'IN_PROGRESS', 'RESCHEDULED', 'DRAFT'] } } },
      { $group: { _id: '$userId', commitments: { $push: '$$ROOT' } } },
      { $limit: 500 } // Safety guard for large user bases
    ]);

    let nudgesDelivered = 0;

    for (const group of userGroups) {
      try {
        const userId = group._id;
        const active = group.commitments;
        const user   = await User.findById(userId);
        if (!user) continue;

        const maxWorkload = user.behavioralProfile?.maxSustainableWorkload || 4;
        const worstDay    = user.behavioralProfile?.worstPerformanceDayOfWeek;
        const nudgesToFire = [];
        const WINDOW_48H  = new Date(Date.now() - 48 * 3600000);
        const WINDOW_7D   = new Date(Date.now() - 7 * 24 * 3600000);

        // ── NUDGE A: Overload warning ─────────────────────────────────────────
        if (active.length > maxWorkload) {
          const alreadySent = await Notification.findOne({
            userId,
            type: 'SYSTEM_INFO',
            message: { $regex: 'sustainable limit' },
            createdAt: { $gte: WINDOW_48H }
          });
          if (!alreadySent) {
            nudgesToFire.push({
              userId,
              type: 'SYSTEM_INFO',
              message: `🔥 You have ${active.length} active syncs — above your sustainable limit of ${maxWorkload}. Consider deferring one to protect your reliability score.`
            });
          }
        }

        // ── NUDGE B: Stagnation alert ─────────────────────────────────────────
        const stagnant = active.filter(c => {
          const staleMs = now - new Date(c.updatedAt);
          return staleMs > 48 * 3600000 && (c.progress || 0) < 80 && (c.currentRiskScore || 0) > 30;
        }).sort((a, b) => (b.currentRiskScore || 0) - (a.currentRiskScore || 0));

        if (stagnant.length > 0) {
          const c = stagnant[0];
          const alreadySent = await Notification.findOne({
            userId,
            type: 'SYSTEM_INFO',
            relatedId: c._id,
            createdAt: { $gte: WINDOW_48H }
          });
          if (!alreadySent) {
            nudgesToFire.push({
              userId,
              type: 'SYSTEM_INFO',
              message: `⏳ "${c.title}" hasn't been updated in 2+ days and is at ${c.progress || 0}% progress. A quick 25-minute session could get it moving.`,
              relatedId: c._id,
              actionType: 'VIEW_COMMITMENT',
              actionPayload: { commitmentId: c._id.toString() }
            });
          }
        }

        // ── NUDGE C: Worst day warning ────────────────────────────────────────
        if (worstDay && worstDay === todayEnum) {
          const highRisk = active.filter(c => (c.currentRiskScore || 0) >= 65);
          if (highRisk.length > 0) {
            const alreadySent = await Notification.findOne({
              userId,
              type: 'SYSTEM_INFO',
              message: { $regex: 'weakest day' },
              createdAt: { $gte: WINDOW_7D } // Only once per week for this one
            });
            if (!alreadySent) {
              nudgesToFire.push({
                userId,
                type: 'SYSTEM_INFO',
                message: `📅 Today is historically your weakest day for commitments. You have ${highRisk.length} high-risk sync${highRisk.length > 1 ? 's' : ''} — stay extra focused today.`
              });
            }
          }
        }

        // Deliver max 2 per user per day
        for (const nudge of nudgesToFire.slice(0, 2)) {
          await Notification.create(nudge);
          nudgesDelivered++;
        }
      } catch (userErr) {
        console.error(`[Nudge Cron] Error processing user ${group._id}:`, userErr.message);
      }
    }

    console.log(`[Nudge Cron] Done. Delivered ${nudgesDelivered} nudge notification(s) across ${userGroups.length} user(s).`);
  } catch (error) {
    console.error('[Nudge Cron] Fatal error:', error.message);
  }
});

const PORT = config.port;

httpServer.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('  CommitSync Backend API');
  console.log('  Human-Aware Commitment & Deadline Reliability System');
  console.log('='.repeat(60));
  console.log(`\n  Environment: ${config.env}`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Server: http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`\n  Prediction Engine: ${config.predictionEngine.url}`);
  console.log(`  Risk Recalculation: ${config.risk.recalculationInterval}`);
  console.log(`  Socket.IO: enabled`);
  console.log('\n' + '='.repeat(60) + '\n');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
  // Close server & exit
  process.exit(1);
});

// Triggering restart 1