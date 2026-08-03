/**
 * Risk Calculator Service
 * Handles risk calculation orchestration and storage
 */
const predictionService = require('./predictionService');
const calendarService = require('./calendarService');
const Commitment = require('../models/Commitment');
const User = require('../models/User');
const RiskSnapshot = require('../models/RiskSnapshot');

class RiskCalculatorService {
  /**
   * Calculate and update risk for a single commitment
   */
  async calculateCommitmentRisk(commitmentId) {
    try {
      const commitment = await Commitment.findById(commitmentId);
      
      if (!commitment) {
        throw new Error('Commitment not found');
      }

      // Don't calculate risk for completed/missed commitments
      if (['COMPLETED', 'MISSED'].includes(commitment.status)) {
        return null;
      }

      // Get user and history
      const user = await User.findById(commitment.userId).select('+googleAccessToken +googleRefreshToken');
      const userHistory = await this._getUserHistory(commitment.userId);
      
      // Get current workload
      const currentWorkload = await this._getCurrentWorkload(commitment.userId);

      // Query calendar for free hours (non-blocking: null if unavailable or opted out)
      let calendarFreeHours = null;
      if (!commitment.ignoreCalendar && calendarService.isCalendarConnected(user)) {
        const now = new Date();
        const deadline = new Date(commitment.deadline);
        const calResult = await calendarService.getFreeHoursBetween(
          user,
          now,
          deadline,
          user.preferences?.workingHours || { start: '09:00', end: '17:00' }
        );
        if (calResult !== null) {
          calendarFreeHours = calResult.freeHours;
          // Update calendarEventCount on commitment (for behavioral mining)
          if (commitment.calendarEventCount !== calResult.eventCount) {
            commitment.calendarEventCount = calResult.eventCount;
            commitment.calendarFreeHours = calResult.freeHours;
          }
        }
      }

      // Call prediction engine with optional calendar modifier
      const result = await predictionService.calculateIndividualRisk(
        commitment,
        userHistory,
        currentWorkload,
        user,
        calendarFreeHours
      );

      if (result.success) {
        // Update commitment with new risk data
        commitment.currentRiskScore = result.data.riskScore;
        commitment.riskLevel = result.data.riskLevel;
        
        // Add to risk history
        commitment.riskHistory.push({
          score: result.data.riskScore,
          level: result.data.riskLevel,
          calculatedAt: new Date()
        });

        // Keep only last 30 risk snapshots
        if (commitment.riskHistory.length > 30) {
          commitment.riskHistory = commitment.riskHistory.slice(-30);
        }

        await commitment.save();

        // Save risk snapshot for analytics
        await this._saveRiskSnapshot(commitment, result.data, currentWorkload);

        // Check if intervention needed
        await this._checkInterventionThreshold(commitment, result.data);

        return result.data;
      } else {
        // Use fallback
        const fallbackData = result.fallback;
        
        commitment.currentRiskScore = fallbackData.riskScore;
        commitment.riskLevel = fallbackData.riskLevel;
        await commitment.save();

        return fallbackData;
      }
    } catch (error) {
      console.error(`Error calculating risk for commitment ${commitmentId}:`, error.message);
      throw error;
    }
  }

  /**
   * Calculate risk for all active commitments of a user
   */
  async calculateUserRisks(userId) {
    const activeCommitments = await Commitment.getActiveCommitments(userId);
    
    const results = [];
    for (const commitment of activeCommitments) {
      try {
        const risk = await this.calculateCommitmentRisk(commitment._id);
        if (risk) {
          results.push({
            commitmentId: commitment._id,
            title: commitment.title,
            risk
          });
        }
      } catch (error) {
        console.error(`Failed to calculate risk for ${commitment._id}:`, error.message);
      }
    }

    return results;
  }

  /**
   * Recalculate behavioral profile for user
   */
  async updateUserBehavioralProfile(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get user's commitment history
      const commitments = await Commitment.find({ userId })
        .sort({ createdAt: -1 })
        .limit(100); // Last 100 commitments

      if (commitments.length < 5) {
        // Not enough data
        user.behavioralProfile.behavioralPattern = 'INSUFFICIENT_DATA';
        await user.save();
        return user.behavioralProfile;
      }

      // Call prediction engine for behavioral analysis
      const result = await predictionService.analyzeBehavioralPattern(userId, commitments);

      if (result.success) {
        // Update user profile
        user.behavioralProfile.behavioralPattern = result.data.primaryPattern;
        user.behavioralProfile.lastUpdated = new Date();
        
        // Update stats
        const stats = await this._calculateUserStats(userId);
        Object.assign(user.behavioralProfile, stats);

        // ── Mine bestPerformanceTimeOfDay from completion timestamps ──────────
        // `completedAt` is set precisely by the model's updateProgress() method
        // when progress hits 100. Fall back to updatedAt only as a safety net.
        // Enum values: MORNING | AFTERNOON | EVENING | NIGHT
        const completedItems = commitments.filter(c =>
          ['COMPLETED', 'COMPLETED_LATE'].includes(c.status)
        );
        if (completedItems.length >= 3) {
          const timeZoneCounts = { MORNING: 0, AFTERNOON: 0, EVENING: 0, NIGHT: 0 };
          completedItems.forEach(c => {
            const doneAt = new Date(c.completedAt || c.updatedAt);
            const hour = doneAt.getHours();
            if      (hour >= 5  && hour < 12) timeZoneCounts.MORNING++;
            else if (hour >= 12 && hour < 17) timeZoneCounts.AFTERNOON++;
            else if (hour >= 17 && hour < 21) timeZoneCounts.EVENING++;
            else                               timeZoneCounts.NIGHT++;
          });
          const bestZone = Object.entries(timeZoneCounts).reduce(
            (best, cur) => cur[1] > best[1] ? cur : best,
            ['MORNING', 0]
          );
          if (bestZone[1] > 0) {
            user.behavioralProfile.bestPerformanceTimeOfDay = bestZone[0];
          }
        }

        // ── Mine worstPerformanceDayOfWeek from missed deadline dates ─────────
        // Enum values: MONDAY | TUESDAY | WEDNESDAY | THURSDAY | FRIDAY | SATURDAY | SUNDAY
        const missedItems = commitments.filter(c => c.status === 'MISSED');
        if (missedItems.length >= 2) {
          const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
          const dayCounts = {};
          missedItems.forEach(c => {
            const day = dayNames[new Date(c.deadline).getDay()];
            dayCounts[day] = (dayCounts[day] || 0) + 1;
          });
          const worstDay = Object.entries(dayCounts).reduce(
            (worst, cur) => cur[1] > worst[1] ? cur : worst,
            ['MONDAY', 0]
          );
          if (worstDay[1] > 0) {
            user.behavioralProfile.worstPerformanceDayOfWeek = worstDay[0];
          }
        }

        await user.save();

        return {
          ...user.behavioralProfile.toObject(),
          analysis: result.data
        };
      } else {
        return {
          ...user.behavioralProfile.toObject(),
          error: 'Prediction engine unavailable'
        };
      }
    } catch (error) {
      console.error(`Error updating behavioral profile for user ${userId}:`, error.message);
      throw error;
    }
  }


  /**
   * Get user history for prediction — fixed version.
   *
   * Fixes applied:
   * 1. Category reliability denominator now uses only RESOLVED commitments
   *    (previously included active PENDING/IN_PROGRESS, inflating risk by up to 40pts).
   * 2. COMPLETED_LATE now counts as a partial success (0.7 weight) in category reliability
   *    (previously treated as a failure at category level, inflating risk by ~23pts).
   * 3. Exposes lastRescheduledAt so predictionService can reset the time window
   *    correctly for rescheduled commitments.
   */
  async _getUserHistory(userId) {
    const user = await User.findById(userId);
    const commitments = await Commitment.find({ userId });

    const total = commitments.length;
    const completedOnTime = commitments.filter(c => c.status === 'COMPLETED').length;
    const completedLate   = commitments.filter(c => c.status === 'COMPLETED_LATE').length;
    const missed          = commitments.filter(c => c.status === 'MISSED').length;

    // ── Category-specific reliability ─────────────────────────────────────────
    // Full taxonomy matching templateMatcher._inferCategoryFromTitle.
    // Denominator = only RESOLVED commitments (completed + late + missed).
    // COMPLETED_LATE earns 0.7 credit (partial success — delivered, just not on time).
    const categoryReliability = {};
    const categories = [
      'coding', 'work', 'research', 'travel', 'fitness', 'diet', 'health',
      'wellbeing', 'exam', 'assignment', 'learning', 'language', 'sports',
      'cultural', 'creative', 'family', 'shopping', 'financial', 'career',
      'home', 'reading', 'volunteering', 'event_planning', 'other'
    ];

    categories.forEach(cat => {
      const catCommitments = commitments.filter(c => c.category === cat);

      // Resolved = has a definitive outcome (not still active)
      const catResolved   = catCommitments.filter(c =>
        ['COMPLETED', 'COMPLETED_LATE', 'MISSED'].includes(c.status)
      );

      if (catResolved.length >= 2) {
        // Need at least 2 resolved to have meaningful signal
        const catOnTime = catResolved.filter(c => c.status === 'COMPLETED').length;
        const catLate   = catResolved.filter(c => c.status === 'COMPLETED_LATE').length;
        // Weighted score: on-time = 1.0, late = 0.7, missed = 0
        const score = (catOnTime * 1.0) + (catLate * 0.7);
        categoryReliability[cat] = score / catResolved.length;
      }
      // < 2 resolved in category → leave undefined so predictionService uses overall rate
    });

    return {
      totalCommitments: total,
      completedOnTime,
      completedLate,
      missed,
      categoryReliability,
      maxSustainableWorkload: user.behavioralProfile.maxSustainableWorkload,
      averageDelayDays: user.behavioralProfile.averageDelayDays
    };
  }

  /**
   * Get current workload for user
   */
  async _getCurrentWorkload(userId) {
    const activeCommitments = await Commitment.getActiveCommitments(userId);
    
    const now = new Date();
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const upcomingDeadlines = activeCommitments.filter(c => 
      new Date(c.deadline) <= next7Days
    );

    return {
      activeConcurrentTasks: activeCommitments.length,
      upcomingDeadlinesCount: upcomingDeadlines.length
    };
  }

  /**
   * Calculate user statistics.
   * Also computes adaptive maxSustainableWorkload based on actual behavior:
   * the average concurrent task count during periods when reliability was ≥ 80%.
   */
  async _calculateUserStats(userId) {
    const commitments = await Commitment.find({ userId });

    const total     = commitments.length;
    const completed = commitments.filter(c => c.status === 'COMPLETED').length;
    const missed    = commitments.filter(c => c.status === 'MISSED').length;
    
    let totalScore     = 0;
    let evaluatedCount = 0;
    
    commitments.forEach(c => {
      const isOverdue = ['PENDING', 'IN_PROGRESS', 'RESCHEDULED', 'DRAFT'].includes(c.status) && new Date() > new Date(c.deadline);
      
      if (c.status === 'COMPLETED') {
        totalScore += (c.rescheduledCount > 0 ? 0.8 : 1);
        evaluatedCount += 1;
      } else if (c.status === 'COMPLETED_LATE') {
        totalScore += 0.5;
        evaluatedCount += 1;
      } else if (c.status === 'MISSED') {
        evaluatedCount += 1;
      } else if (c.rescheduledCount > 0) {
        evaluatedCount += 1;
      } else if (isOverdue) {
        evaluatedCount += 1;
      }
    });

    const reliabilityScore = evaluatedCount > 0 ? Math.round((totalScore / evaluatedCount) * 100) : 0;

    // ── Adaptive maxSustainableWorkload ───────────────────────────────────────
    // Strategy: look at the 30-day windows where the user's reliability was ≥ 80%
    // and compute the average number of active concurrent commitments in those windows.
    // Proxy: count commitments whose active period overlapped a completed window.
    // Simpler deterministic approach: use resolved commitments grouped by month.
    let maxSustainableWorkload = 4; // fallback default
    if (evaluatedCount >= 5) {
      const resolved = commitments.filter(c =>
        ['COMPLETED', 'COMPLETED_LATE', 'MISSED'].includes(c.status)
      );

      // Group resolved commitments by month (YYYY-MM)
      const monthBuckets = {};
      resolved.forEach(c => {
        const key = new Date(c.updatedAt || c.createdAt).toISOString().slice(0, 7); // YYYY-MM
        if (!monthBuckets[key]) monthBuckets[key] = { total: 0, success: 0 };
        monthBuckets[key].total++;
        if (c.status === 'COMPLETED') monthBuckets[key].success++;
      });

      // Find months where the user's on-time rate was ≥ 80%
      const goodMonths = Object.entries(monthBuckets).filter(
        ([, m]) => m.total >= 2 && (m.success / m.total) >= 0.8
      );

      if (goodMonths.length >= 2) {
        // For each good month, count how many commitments were active concurrently
        const goodMonthKeys = new Set(goodMonths.map(([k]) => k));
        const concurrentCounts = [];
        goodMonthKeys.forEach(monthKey => {
          const count = resolved.filter(c => {
            const key = new Date(c.updatedAt || c.createdAt).toISOString().slice(0, 7);
            return key === monthKey;
          }).length;
          concurrentCounts.push(count);
        });
        const avgConcurrent = concurrentCounts.reduce((a, b) => a + b, 0) / concurrentCounts.length;
        // Clamp between 2 and 10 — extremes are unreliable
        maxSustainableWorkload = Math.min(10, Math.max(2, Math.round(avgConcurrent)));
      } else if (reliabilityScore >= 80) {
        // User is generally reliable but not enough good-month buckets yet:
        // use total active count as a starting estimate
        const currentActive = commitments.filter(c =>
          ['PENDING', 'IN_PROGRESS', 'RESCHEDULED', 'DRAFT'].includes(c.status)
        ).length;
        maxSustainableWorkload = Math.min(10, Math.max(2, currentActive || 4));
      } else if (reliabilityScore < 50 && missed > completed) {
        // Clearly struggling — lower the limit
        maxSustainableWorkload = Math.max(2, Math.round(completed / Math.max(1, evaluatedCount) * 5));
      }
    }

    return {
      totalCommitments: total,
      completedCommitments: completed,
      missedCommitments: missed,
      averageCompletionRate: total > 0 ? completed / total : 0,
      reliabilityScore,
      maxSustainableWorkload
    };
  }


  /**
   * Save risk snapshot for historical tracking.
   * Deduplication: only writes a new snapshot if the score changed by ≥ 3 points
   * since the last recorded snapshot, preventing unbounded DB growth.
   */
  async _saveRiskSnapshot(commitment, riskData, workload) {
    try {
      // Check last snapshot — skip write if score hasn't meaningfully changed
      // Note: the current score is already at length - 1 because we just pushed it.
      // We need to compare against the PREVIOUS score (length - 2).
      const previousSnapshot = commitment.riskHistory.length > 1
        ? commitment.riskHistory[commitment.riskHistory.length - 2]
        : null;
      
      if (previousSnapshot && Math.abs(previousSnapshot.score - riskData.riskScore) < 3) {
        return; // No meaningful change — skip DB write
      }

      const now = new Date();
      const deadline = new Date(commitment.deadline);
      const daysUntilDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

      await RiskSnapshot.create({
        commitmentId: commitment._id,
        userId: commitment.userId,
        snapshotDate: new Date(),
        riskScore: riskData.riskScore,
        riskLevel: riskData.riskLevel,
        riskBreakdown: riskData.breakdown,
        context: {
          progress: commitment.progress,
          daysUntilDeadline,
          concurrentTasks: workload.activeConcurrentTasks,
          rescheduledCount: commitment.rescheduledCount
        },
        actualOutcome: 'PENDING'
      });
    } catch (error) {
      console.error('Error saving risk snapshot:', error.message);
    }
  }

  /**
   * Check if intervention needed based on risk threshold.
   * When risk >= threshold AND calendar is connected, scans for next free slot
   * to provide an actionable Focus Injection suggestion (Idea 2).
   */
  async _checkInterventionThreshold(commitment, riskData) {
    const user = await User.findById(commitment.userId).select('+googleAccessToken +googleRefreshToken');
    const threshold = user.preferences.riskThreshold;

    if (riskData.riskScore < threshold) {
      if (commitment.interventions && commitment.interventions.length > 0) {
        commitment.interventions = [];
        await commitment.save();
      }
      return;
    }

    if (riskData.riskScore < 85) {
      if (commitment.interventions && commitment.interventions.some(i => i.type === 'CRITICAL_ALERT')) {
        commitment.interventions = commitment.interventions.filter(i => i.type !== 'CRITICAL_ALERT');
        await commitment.save();
      }
    }

    if (riskData.riskScore >= threshold) {
      const interventionType = riskData.riskScore >= 85 ? 'CRITICAL_ALERT' : 'WARNING';
      
      let message = riskData.recommendations && riskData.recommendations.length > 0
        ? riskData.recommendations[0]
        : `Risk score ${riskData.riskScore}% exceeds your threshold of ${threshold}%`;

      const recentInterventions = commitment.interventions || [];
      const lastIntervention = recentInterventions.length > 0 ? recentInterventions[recentInterventions.length - 1] : null;

      if (interventionType === 'CRITICAL_ALERT') {
        // Only ONE critical alert ever per sync
        const hasCritical = recentInterventions.some(i => i.type === 'CRITICAL_ALERT');
        if (hasCritical) return;

        const totalHours = commitment.estimatedHours || 0;
        const progress = commitment.progress || 0;
        const hoursCompleted = (progress / 100) * totalHours;
        const hoursLeft = Math.max(0, totalHours - hoursCompleted);
        const daysLeft = Math.max(0, Math.ceil((new Date(commitment.deadline) - new Date()) / (1000 * 60 * 60 * 24)));
        
        message = `🚨 CRITICAL ALERT: You have completed ${hoursCompleted.toFixed(1)}h out of ${totalHours}h. With ${hoursLeft.toFixed(1)}h of work remaining and only ${daysLeft} days until the deadline, immediate action is required. ${message}`;
      } else {
        // For WARNINGs, check the risk score delta
        if (lastIntervention && lastIntervention.type === 'WARNING') {
          const lastScore = lastIntervention.riskScore || 0;
          if (riskData.riskScore < lastScore + 15) {
            // Score hasn't meaningfully escalated -> skip sending another notification
            return;
          }
        }
      }

      // Focus Injection: scan for a free slot and store it as a separate calendarHint (Idea 2)
      let calendarHint = null;
      let focusSlot = null;
      if (!commitment.ignoreCalendar && calendarService.isCalendarConnected(user)) {
        try {
          const slot = await calendarService.findNextFreeSlot(
            user,
            2,
            user.preferences?.workingHours || { start: '09:00', end: '17:00' }
          );
          if (slot) {
            const slotDate = slot.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const slotTime = slot.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            calendarHint = `📅 Next free slot: ${slotDate} at ${slotTime}`;
            focusSlot = { start: slot.start, end: slot.end };
            // Store slot so frontend can pre-fill Block Focus Time dialog
            commitment._focusSlot = { start: slot.start.toISOString(), end: slot.end.toISOString() };
          }
        } catch (e) {
          // Slot scan failed — still fire intervention without slot suggestion
        }
      }

      await commitment.addIntervention(interventionType, message, calendarHint, riskData.riskScore);

      // Alert accountability partners if they exist
      const Notification = require('../models/Notification');
      
      if (commitment.accountabilityPartners && commitment.accountabilityPartners.length > 0) {
        const ChatMessage = require('../models/ChatMessage');
        const Conversation = require('../models/Conversation');
        const emailService = require('../services/emailService');
        
        // Notify and email each partner
        for (const partnerId of commitment.accountabilityPartners) {
          // Ensure a direct conversation exists
          let conversation = await Conversation.findOne({
            type: 'DIRECT',
            participants: { $all: [commitment.userId, partnerId], $size: 2 }
          });

          if (!conversation) {
            conversation = await Conversation.create({
              type: 'DIRECT',
              participants: [commitment.userId, partnerId]
            });
          }

          // System alerts should not be posted to personal chats.
          // They are strictly for human-to-human interaction.

          await Notification.create({
            userId: partnerId,
            type: 'COMMITMENT_ALERT',
            message: `Partner Commitment "${commitment.title}" triggered a ${interventionType}`,
            relatedId: commitment._id
          });
          
          const p = await User.findById(partnerId);
          if (p) await emailService.sendRiskAlertEmail(p.email, commitment.title);
        }
      }

      // ── Feature 7: Create actionable notification for the commitment owner ──
      if (interventionType === 'CRITICAL_ALERT') {
        const suggestedDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week from now
        
        const notifData = {
          userId: commitment.userId,
          type: 'COMMITMENT_ALERT',
          message,
          relatedId: commitment._id,
          actionType: 'RESCHEDULE',
          actionPayload: {
            commitmentId: commitment._id.toString(),
            suggestedDeadline
          }
        };

        // If we found a focus slot, attach it as BLOCK_FOCUS option too
        if (focusSlot) {
          notifData.suggestedFocusSlot = focusSlot;
        }

        const savedNotif = await Notification.create(notifData);

        // ── Feature 8: Emit real-time socket alert to the user ──
        try {
          const ioStore = require('../utils/ioStore');
          const io = ioStore.getIO();
          if (io) {
            io.to(commitment.userId.toString()).emit('critical_alert', {
              commitmentId: commitment._id,
              notificationId: savedNotif._id,
              title: commitment.title,
              riskScore: riskData.riskScore,
              message,
              actionType: 'RESCHEDULE',
              suggestedDeadline,
              suggestedFocusSlot: focusSlot || null
            });
          }
        } catch (socketErr) {
          // Socket.IO not available — non-fatal
          console.warn('[RiskCalc] Socket emit failed (non-fatal):', socketErr.message);
        }

      }
    }
  }
}

module.exports = new RiskCalculatorService();