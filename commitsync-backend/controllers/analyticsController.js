/**
 * Analytics Controller
 */
const Commitment = require('../models/Commitment');
const RiskSnapshot = require('../models/RiskSnapshot');
const User = require('../models/User');
const riskCalculator = require('../services/riskCalculator');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * @route   GET /api/analytics/risk-overview
 * @desc    Get risk overview dashboard
 * @access  Private
 */
exports.getRiskOverview = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get all commitments
    const allCommitments = await Commitment.find({ userId });
    const activeCommitments = allCommitments.filter(c => ['DRAFT', 'PENDING', 'IN_PROGRESS', 'RESCHEDULED'].includes(c.status));
    const highRiskCommitments = activeCommitments
      .filter(c => c.currentRiskScore >= 70 && ['PENDING', 'IN_PROGRESS'].includes(c.status))
      .sort((a, b) => b.currentRiskScore - a.currentRiskScore);

    // Calculate stats
    const totalCommitments = allCommitments.length;
    const completed = allCommitments.filter(c => c.status === 'COMPLETED').length;
    const missed = allCommitments.filter(c => c.status === 'MISSED').length;
    const inProgress = activeCommitments.length;

    const completionRate = totalCommitments > 0 ? (completed / totalCommitments) : 0;

    // Average risk of active commitments
    const avgRisk = activeCommitments.length > 0
      ? activeCommitments.reduce((sum, c) => sum + c.currentRiskScore, 0) / activeCommitments.length
      : 0;

    // Risk distribution
    const riskDistribution = {
      low: activeCommitments.filter(c => c.currentRiskScore < 40).length,
      medium: activeCommitments.filter(c => c.currentRiskScore >= 40 && c.currentRiskScore < 60).length,
      high: activeCommitments.filter(c => c.currentRiskScore >= 60 && c.currentRiskScore < 75).length,
      critical: activeCommitments.filter(c => c.currentRiskScore >= 75).length
    };

    // Upcoming deadlines (next 7 days)
    const now = new Date();
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const upcomingDeadlines = activeCommitments.filter(c => {
      const deadline = new Date(c.deadline);
      return deadline >= now && deadline <= next7Days;
    }).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    return successResponse(res, {
      overview: {
        totalCommitments,
        completed,
        missed,
        inProgress,
        completionRate: Math.round(completionRate * 100),
        averageRisk: Math.round(avgRisk)
      },
      riskDistribution,
      highRiskCommitments: highRiskCommitments.slice(0, 5), // Top 5
      upcomingDeadlines: upcomingDeadlines.slice(0, 5) // Next 5
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/analytics/behavioral-profile
 * @desc    Get user's behavioral profile
 * @access  Private
 */
exports.getBehavioralProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    let user = await User.findById(userId);

    // Get all commitments for analysis
    const commitments = await Commitment.find({ userId });

    // Auto-update behavioral profile if stale (older than 5 minutes) or never updated
    const lastUpdated = user.behavioralProfile?.lastUpdated;
    const isStale = !lastUpdated || (Date.now() - new Date(lastUpdated).getTime() > 5 * 60 * 1000);
    if (isStale) {
      try {
        await riskCalculator.updateUserBehavioralProfile(userId);
        user = await User.findById(userId);
      } catch (err) {
        console.error('[getBehavioralProfile] Auto-update failed:', err.message);
      }
    }

    
    // Compute category reliability breakdown.
    // These must match the lowercase keys produced by templateMatcher._inferCategoryFromTitle
    // and stored on each Commitment document.
    const categories = [
      'coding', 'work', 'research', 'travel', 'fitness', 'diet', 'health',
      'wellbeing', 'exam', 'assignment', 'learning', 'language', 'sports',
      'cultural', 'creative', 'family', 'shopping', 'financial', 'career',
      'home', 'reading', 'volunteering', 'event_planning', 'other'
    ];
    const categoryBreakdown = {};
    categories.forEach(cat => {
      const resolved = commitments.filter(c =>
        c.category === cat && ['COMPLETED', 'MISSED', 'COMPLETED_LATE', 'FAILED'].includes(c.status)
      );
      if (resolved.length > 0) {
        const success = resolved.filter(c => c.status === 'COMPLETED').length;
        const late    = resolved.filter(c => c.status === 'COMPLETED_LATE').length;
        // Weight: on-time = 1.0, late = 0.7, missed = 0
        const weightedScore = (success * 1.0 + late * 0.7) / resolved.length;
        categoryBreakdown[cat] = {
          total: resolved.length,
          successRate: Math.round(weightedScore * 100),
          label: weightedScore >= 0.8 ? 'Strong' : weightedScore >= 0.5 ? 'Average' : 'Needs Work'
        };
      }
    });

    return successResponse(res, {
      ...user.behavioralProfile.toObject(),
      categoryBreakdown,
      totalActive: commitments.filter(c => ['PENDING', 'IN_PROGRESS'].includes(c.status)).length
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/analytics/update-behavioral-profile
 * @desc    Recalculate user's behavioral profile
 * @access  Private
 */
exports.updateBehavioralProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const profile = await riskCalculator.updateUserBehavioralProfile(userId);

    return successResponse(res, { profile }, 'Behavioral profile updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/analytics/risk-trends/:commitmentId
 * @desc    Get risk trend for a commitment
 * @access  Private
 */
exports.getRiskTrends = async (req, res) => {
  try {
    const { commitmentId } = req.params;
    const days = parseInt(req.query.days) || 30;

    const commitment = await Commitment.findById(commitmentId);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    // Check ownership
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    // Get risk snapshots
    const snapshots = await RiskSnapshot.getRiskTrend(commitmentId, days);

    // Also include risk history from commitment
    const riskHistory = commitment.riskHistory.slice(-30); // Last 30 entries

    return successResponse(res, {
      commitment: {
        id: commitment._id,
        title: commitment.title,
        currentRisk: commitment.currentRiskScore,
        status: commitment.status
      },
      snapshots,
      riskHistory
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/analytics/category-performance
 * @desc    Get performance by category
 * @access  Private
 */
exports.getCategoryPerformance = async (req, res) => {
  try {
    const userId = req.user._id;
    const commitments = await Commitment.find({ userId });

    // Use the same category taxonomy as templateMatcher._inferCategoryFromTitle
    const categories = [
      'coding', 'work', 'research', 'travel', 'fitness', 'diet', 'health',
      'wellbeing', 'exam', 'assignment', 'learning', 'language', 'sports',
      'cultural', 'creative', 'family', 'shopping', 'financial', 'career',
      'home', 'reading', 'volunteering', 'event_planning', 'other'
    ];
    const categoryStats = {};

    categories.forEach(cat => {
      const catCommitments = commitments.filter(c => c.category === cat);
      if (catCommitments.length === 0) return; // Skip empty categories
      const completed = catCommitments.filter(c => c.status === 'COMPLETED').length;
      const total = catCommitments.length;

      categoryStats[cat] = {
        total,
        completed,
        missed: catCommitments.filter(c => c.status === 'MISSED').length,
        completionRate: total > 0 ? (completed / total) : 0,
        avgRisk: catCommitments
          .filter(c => c.status === 'PENDING' || c.status === 'IN_PROGRESS')
          .reduce((sum, c) => sum + c.currentRiskScore, 0) / 
          (catCommitments.filter(c => c.status === 'PENDING' || c.status === 'IN_PROGRESS').length || 1)
      };
    });

    return successResponse(res, { categoryStats });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/analytics/recalculate-all-risks
 * @desc    Recalculate risk for all active commitments
 * @access  Private
 */
exports.recalculateAllRisks = async (req, res) => {
  try {
    const userId = req.user._id;

    const results = await riskCalculator.calculateUserRisks(userId);

    return successResponse(res, {
      recalculated: results.length,
      results
    }, 'All risks recalculated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/analytics/overview
 * @desc    Get dashboard overview metrics including reliability score and best zone
 * @access  Private
 */
exports.getOverview = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    const allCommitments = await Commitment.find({ userId });
    const activeCommitments = allCommitments.filter(c => ['DRAFT', 'PENDING', 'IN_PROGRESS', 'RESCHEDULED'].includes(c.status));
    
    const totalCommitments = allCommitments.length;
    const completed = allCommitments.filter(c => c.status === 'COMPLETED');
    const missed = allCommitments.filter(c => c.status === 'MISSED');
    
    // Compute Reliability Score
    let totalScore = 0;
    let evaluatedCount = 0;
    
    allCommitments.forEach(c => {
      const isOverdue = ['PENDING', 'IN_PROGRESS', 'RESCHEDULED', 'DRAFT'].includes(c.status) && new Date() > new Date(c.deadline);
      const isResolved = ['COMPLETED', 'COMPLETED_LATE', 'MISSED'].includes(c.status);
      
      if (c.status === 'COMPLETED') {
        totalScore += (c.rescheduledCount > 0 ? 0.8 : 1);
        evaluatedCount += 1;
      } else if (c.status === 'COMPLETED_LATE') {
        totalScore += 0.5;
        evaluatedCount += 1;
      } else if (c.status === 'MISSED') {
        evaluatedCount += 1;
      } else if (isOverdue) {
        evaluatedCount += 1;
      } else if (isResolved && c.rescheduledCount > 0) {
         // Only penalize rescheduled commitments if they are fully resolved and didn't fall into the above buckets.
         // (If it was completed, it got 0.8 above. If it's active and rescheduled, do NOT count it as a failure yet.)
         evaluatedCount += 1;
      }
    });

    let reliabilityScore = user.behavioralProfile?.reliabilityScore || 0;
    if (evaluatedCount > 0) {
      reliabilityScore = Math.round((totalScore / evaluatedCount) * 100);
    }
    
    // Calculate Best Time of Day (bestZone)
    const timeZones = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
    completed.forEach(c => {
      const time = new Date(c.completedAt || c.updatedAt);
      const hour = time.getHours();
      if (hour >= 5 && hour < 12) timeZones.Morning++;
      else if (hour >= 12 && hour < 17) timeZones.Afternoon++;
      else if (hour >= 17 && hour < 21) timeZones.Evening++;
      else timeZones.Night++;
    });

    let bestZone = 'Not enough data';
    let bestZoneCount = 0;
    for (const [zone, count] of Object.entries(timeZones)) {
      if (count > bestZoneCount) {
        bestZoneCount = count;
        bestZone = zone;
      }
    }
    
    let bestZoneContext = 'Complete more tasks to establish a pattern';
    if (bestZoneCount > 0) {
      bestZoneContext = `Based on ${bestZoneCount} task${bestZoneCount === 1 ? '' : 's'} completed during the ${bestZone.toLowerCase()}`;
    }

    // Calculate Recent Velocity (last 7 days)
    const recentVelocity = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'short' });
      
      const count = completed.filter(c => {
        const cDate = new Date(c.completedAt || c.updatedAt);
        return cDate.toDateString() === d.toDateString();
      }).length;
      
      recentVelocity.push({ name: dateStr, completed: count });
    }
    
    // Calculate risk breakdown counts based on CURRENT active commitments
    const activeCommitmentIds = activeCommitments.map(c => c._id);
    let riskBreakdowns = [];

    if (activeCommitmentIds.length > 0) {
      riskBreakdowns = await RiskSnapshot.aggregate([
        { $match: { commitmentId: { $in: activeCommitmentIds } } },
        { $sort: { snapshotDate: -1 } },
        {
          $group: {
            _id: "$commitmentId",
            timePressure: { $first: "$riskBreakdown.timePressure" },
            historicalReliability: { $first: "$riskBreakdown.historicalReliability" },
            workloadDensity: { $first: "$riskBreakdown.workloadDensity" },
            recommitFrequency: { $first: "$riskBreakdown.recommitFrequency" }
          }
        }
      ]);

      // Auto-heal missing snapshots caused by earlier bug
      if (riskBreakdowns.length === 0) {
        require('../services/riskCalculator').calculateUserRisks(userId).catch(console.error);
      }
    }

    let dominantRiskFactor = 'Insufficient Data';
    let riskBreakdownCounts = {
      timePressure: 0,
      historicalReliability: 0,
      workloadDensity: 0,
      recommitFrequency: 0
    };

    if (riskBreakdowns.length > 0) {
      for (const breakdown of riskBreakdowns) {
        const factors = [
          { name: 'timePressure', value: breakdown.timePressure || 0 },
          { name: 'historicalReliability', value: breakdown.historicalReliability || 0 },
          { name: 'workloadDensity', value: breakdown.workloadDensity || 0 },
          { name: 'recommitFrequency', value: breakdown.recommitFrequency || 0 }
        ];
        
        let maxFactor = null;
        let maxVal = -1;
        for (const f of factors) {
          if (f.value > maxVal) {
            maxVal = f.value;
            maxFactor = f.name;
          }
        }
        
        if (maxVal > 0 && maxFactor) {
          riskBreakdownCounts[maxFactor]++;
        }
      }

      const maxCount = Math.max(
        riskBreakdownCounts.timePressure,
        riskBreakdownCounts.historicalReliability,
        riskBreakdownCounts.workloadDensity,
        riskBreakdownCounts.recommitFrequency
      );

      if (maxCount > 0) {
        if (maxCount === riskBreakdownCounts.timePressure) dominantRiskFactor = 'Time Pressure';
        else if (maxCount === riskBreakdownCounts.workloadDensity) dominantRiskFactor = 'Workload Density';
        else if (maxCount === riskBreakdownCounts.recommitFrequency) dominantRiskFactor = 'Recommit Frequency';
        else dominantRiskFactor = 'Historical Reliability';
      } else {
        dominantRiskFactor = 'Low Risk Patterns';
      }
    }

    const resolvedCount = completed.length + missed.length;
    const completionRate = resolvedCount > 0 ? (completed.length / resolvedCount) : 0;
    const avgRisk = activeCommitments.length > 0
      ? activeCommitments.reduce((sum, c) => sum + c.currentRiskScore, 0) / activeCommitments.length
      : 0;

    return successResponse(res, {
      totalCommitments,
      completionRate: Math.round(completionRate * 100),
      averageRisk: Math.round(avgRisk),
      activeCommitments: activeCommitments.length,
      reliabilityScore,
      dominantRiskFactor,
      riskBreakdownCounts,
      bestZone,
      bestZoneContext,
      recentVelocity
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const predictionService = require('../services/predictionService');
const aiInsightsService = require('../services/aiInsightsService');
const calendarService = require('../services/calendarService');

// ─── AI INSIGHTS ENDPOINT ──────────────────────────────────────────────────

/**
 * @desc    Generate AI insights based on recent productivity patterns and calendar density
 * @route   GET /api/analytics/ai-insights
 * @access  Private
 */
exports.getAiInsights = async (req, res) => {
  try {
    const commitments = await Commitment.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(30) // last 30 for behavioral pattern mining
      .lean();

    if (!commitments || commitments.length === 0) {
      return successResponse(res, {
        insight: "Complete a few commitments to generate a behavioral pattern.",
        recommendation: "Start by creating a manageable sync and tracking its progress."
      });
    }

    // ── CALENDAR DENSITY CORRELATION (Idea 4: Deterministic mining) ──
    // Determine if high calendar event count correlates with lower progress/reliability
    let highDensityProgressSum = 0;
    let highDensityCount = 0;
    let lowDensityProgressSum = 0;
    let lowDensityCount = 0;

    commitments.forEach(c => {
      if (c.calendarEventCount != null) {
        if (c.calendarEventCount >= 10) { // threshold for "high density" week
          highDensityProgressSum += (c.progress || 0);
          highDensityCount++;
        } else {
          lowDensityProgressSum += (c.progress || 0);
          lowDensityCount++;
        }
      }
    });

    let calendarInsight = null;
    if (highDensityCount >= 3 && lowDensityCount >= 3) {
      const avgHigh = highDensityProgressSum / highDensityCount;
      const avgLow = lowDensityProgressSum / lowDensityCount;
      const drop = avgLow - avgHigh;

      if (drop > 15) {
        calendarInsight = `User's completion rate drops by ${Math.round(drop)}% during weeks with heavy calendar density (10+ events).`;
      } else if (avgHigh > 80 && avgLow > 80) {
        calendarInsight = `User maintains high reliability (>80%) regardless of calendar density.`;
      }
    }

    // Prepare deterministic stats for the LLM
    const completed = commitments.filter(c => c.status === 'COMPLETED').length;
    const total = commitments.length;
    const completionRate = total > 0 ? (completed / total) * 100 : 0;

    const rescheduledCount = commitments.filter(c => c.rescheduledCount > 0).length;

    const userData = {
      totalCommitments: total,
      completedCommitments: completed,
      completionRate: Math.round(completionRate),
      rescheduledCount,
      calendarCorrelation: calendarInsight
    };

    // Use existing AI service wrapper to classify and format
    const insightData = await aiInsightsService.generateInsight(userData);

    return successResponse(res, insightData);
  } catch (error) {
    console.error('Error generating AI insights:', error);
    return errorResponse(res, 'Failed to generate insights', 500);
  }
};