/**
 * Prediction Engine Service
 * Perfected Risk Calculation — v2
 */
const axios = require('axios');

class PredictionService {
  constructor() {
    this.aiAvailable = false;
    
    if (process.env.GROQ_API_KEY) {
      this.apiKey = process.env.GROQ_API_KEY;
      this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
      this.aiAvailable = true;
    } else {
      console.warn('GROQ_API_KEY is missing. PredictionService will run in deterministic mode.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CORE DETERMINISTIC ENGINE — Single source of truth for all paths
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Compute all raw risk factors from commitment + context data.
   * This is the ONLY place math happens. Both LLM and fallback paths use this.
   */
  _computeRiskFactors(commitmentData, userHistory, currentWorkload, user, calendarFreeHours = null) {
    const now = new Date();
    const deadline = new Date(commitmentData.deadline || now);
    
    // Use last reschedule time as the start of the current time window if rescheduled
    let created = new Date(commitmentData.createdAt || now);
    if (commitmentData.rescheduledHistory && commitmentData.rescheduledHistory.length > 0) {
      const lastReschedule = commitmentData.rescheduledHistory[commitmentData.rescheduledHistory.length - 1];
      if (lastReschedule && lastReschedule.timestamp) {
        created = new Date(lastReschedule.timestamp);
      }
    }

    const hoursLeft    = (deadline - now) / (1000 * 60 * 60);
    const totalTimeMs  = Math.max(1, deadline - created);
    const elapsedMs    = Math.max(0, now - created);
    const timeRatio    = Math.min(1, Math.max(0, elapsedMs / totalTimeMs));
    const progressRatio = (commitmentData.progress || 0) / 100;

    // ── 1. TIME PRESSURE (0–100) ──────────────────────────────────────────────
    // Smooth multi-zone curve — no abrupt jumps
    let timePressure;
    if (hoursLeft <= 0) {
      timePressure = 100;
    } else if (hoursLeft <= 24) {
      // Critical zone: [80, 100] as hours drop from 24 → 0
      timePressure = 80 + (1 - hoursLeft / 24) * 20;
    } else if (hoursLeft <= 72) {
      // High zone: [55, 80] as hours drop from 72 → 24
      timePressure = 55 + (1 - (hoursLeft - 24) / 48) * 25;
    } else if (hoursLeft <= 168) {
      // Medium zone: [25, 55] as hours drop from 168 → 72
      timePressure = 25 + (1 - (hoursLeft - 72) / 96) * 30;
    } else {
      // Low zone: starts at 25, slowly descends as deadline is far away
      timePressure = Math.max(5, 25 - (hoursLeft - 168) * 0.03);
    }
    timePressure = Math.max(0, Math.min(100, timePressure));

    // ── 2. PROGRESS GAP (0–100) ───────────────────────────────────────────────
    // How far behind schedule: expressed as a linear percentage (not ×150 which over-inflates)
    const gap = Math.max(0, timeRatio - progressRatio);
    const progressGap = Math.min(100, gap * 100);

    // Ahead-of-schedule bonus (subtracted from FINAL score, max 15 points)
    const progressBonus = progressRatio > timeRatio
      ? Math.min(15, (progressRatio - timeRatio) * 50)
      : 0;

    // ── 3. WORKLOAD STRAIN (0–100) ────────────────────────────────────────────
    // User-relative: uses their behavioral maxSustainableWorkload profile
    const activeTasks  = currentWorkload?.activeConcurrentTasks || 0;
    const maxWorkload  = user?.behavioralProfile?.maxSustainableWorkload || 4;
    const workloadRatio = activeTasks / Math.max(1, maxWorkload);
    // Below 50% of max → 0 strain; at max → 100 strain; smooth linear
    const workloadStrain = workloadRatio > 0.5
      ? Math.min(100, (workloadRatio - 0.5) * 200)
      : 0;

    // ── 4. RELIABILITY RISK (0–100) ────────────────────────────────────────────
    // Priority: category-specific rate → overall rate → safe default (30% risk = 70% reliable)
    let reliabilityRisk = 30;
    if (userHistory) {
      const category = commitmentData.category;
      const catRate  = (userHistory.categoryReliability || {})[category];

      if (typeof catRate === 'number') {
        // Category-specific data takes highest priority
        reliabilityRisk = (1 - catRate) * 100;
      } else {
        // Fall back to overall history (only trust if ≥ 3 resolved commitments)
        const totalFinished = (userHistory.completedOnTime || 0) +
                              (userHistory.completedLate   || 0) +
                              (userHistory.missed          || 0);
        if (totalFinished >= 3) {
          const onTimeRate = (userHistory.completedOnTime || 0) / totalFinished;
          reliabilityRisk  = (1 - onTimeRate) * 100;
        }
        // < 3 resolved → stay at default 30
      }
    }
    reliabilityRisk = Math.max(0, Math.min(100, reliabilityRisk));

    // ── 5. RECOMMIT PENALTY (0–100) ────────────────────────────────────────────
    const rescheduled = commitmentData.rescheduledCount || 0;
    let recommitPenalty = 0;
    if      (rescheduled >= 3) recommitPenalty = 85;
    else if (rescheduled === 2) recommitPenalty = 55;
    else if (rescheduled === 1) recommitPenalty = 25;

    // ── 6. CALENDAR AVAILABILITY MODIFIER (0–20) ─────────────────────────────
    // Only applied if calendar data is available AND user hasn't opted out.
    // Pure math: if remaining work > available calendar hours → boost risk.
    let calendarModifier = 0;
    if (calendarFreeHours !== null && calendarFreeHours >= 0) {
      const estimatedHours = commitmentData.estimatedHours || 0;
      if (estimatedHours > 0) {
        const remainingWork = estimatedHours * (1 - progressRatio);
        if (remainingWork > calendarFreeHours) {
          // Scale: 0 spare hours → +20, small deficit → smaller boost
          const overflowRatio = (remainingWork - calendarFreeHours) / Math.max(1, remainingWork);
          calendarModifier = Math.min(20, Math.round(overflowRatio * 20));
        }
      }
    }

    return {
      timePressure,
      progressGap,
      progressBonus,
      workloadStrain,
      reliabilityRisk,
      recommitPenalty,
      calendarModifier,
      hoursLeft,
      progressRatio,
      timeRatio
    };
  }

  /**
   * Apply weighted formula + hard overrides + sensitivity to get the final score.
   */
  _computeFinalScore(factors, commitmentData, user) {
    const {
      timePressure, progressGap, progressBonus,
      workloadStrain, reliabilityRisk, recommitPenalty,
      calendarModifier,
      hoursLeft, progressRatio
    } = factors;

    // Perfected weighted composite (weights sum to 1.00)
    let score = Math.round(
      (timePressure    * 0.45) +
      (progressGap     * 0.25) +
      (workloadStrain  * 0.15) +
      (reliabilityRisk * 0.10) +
      (recommitPenalty * 0.05)
    );

    // Apply ahead-of-schedule bonus (reward early workers)
    score = Math.max(0, score - Math.round(progressBonus));

    // Apply calendar availability modifier (additive, capped at +20)
    score = Math.min(99, score + (calendarModifier || 0));

    // ── HARD OVERRIDES (cannot be undone by sensitivity) ─────────────────────

    // 1. OVERDUE + INCOMPLETE → always 100
    if (hoursLeft <= 0 && progressRatio < 1) {
      return 100;
    }

    // 2. MATHEMATICAL IMPOSSIBILITY CHECK
    const estimatedHours = commitmentData.estimatedHours || 0;
    if (estimatedHours > 0 && hoursLeft > 0) {
      const remainingWork = estimatedHours * (1 - progressRatio);
      if (remainingWork >= hoursLeft) {
        score = 100; // Literally impossible — more work than time exists
      } else if (remainingWork >= hoursLeft * 0.60) {
        score = Math.max(score, 88); // Functionally impossible (>60% of remaining time is work)
      } else if (remainingWork >= hoursLeft * 0.35) {
        score = Math.max(score, 72); // High danger: >35% of time is needed work
      }
    }

    // ── RISK SENSITIVITY (only applies when not at 100) ──────────────────────
    if (score < 100) {
      const sensitivity = user?.preferences?.riskSensitivity || 'Realistic';
      if (sensitivity === 'Optimistic') {
        score = Math.round(score * 0.85);
      } else if (sensitivity === 'Pessimistic') {
        score = Math.min(99, Math.round(score * 1.15));
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Derive risk level from score using consistent thresholds
   */
  _getRiskLevel(score) {
    if (score >= 75) return 'CRITICAL';
    if (score >= 55) return 'HIGH';
    if (score >= 35) return 'MEDIUM';
    return 'LOW';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Calculate individual commitment risk.
   * Score is always deterministic. LLM is used ONLY for recommendations text.
   */
  async calculateIndividualRisk(commitmentData, userHistory, currentWorkload, user, calendarFreeHours = null) {
    // Step 1: Compute factors and final score deterministically
    // calendarFreeHours is null if: calendar not connected, user opted out, or calendar API failed
    const factors = this._computeRiskFactors(commitmentData, userHistory, currentWorkload, user, calendarFreeHours);
    const calculatedRiskScore = this._computeFinalScore(factors, commitmentData, user);

    const breakdown = {
      timePressure:          Math.round(factors.timePressure),
      progressGap:           Math.round(factors.progressGap),
      workloadStrain:        Math.round(factors.workloadStrain),
      historicalReliability: Math.round(factors.reliabilityRisk),
      recommitFrequency:     Math.round(factors.recommitPenalty),
      calendarPressure:      Math.round(factors.calendarModifier || 0)
    };

    // Step 2: Attempt LLM for recommendations only (non-blocking)
    let recommendations = this._generateRecommendations(factors);

    if (this.aiAvailable) {
      try {
        const aiPersona = user?.preferences?.aiPersona || 'Supportive';
        let personaDesc = 'Be supportive and encouraging, like a helpful friend.';
        if (aiPersona === 'Strict')      personaDesc = 'Be direct and demanding, like a drill sergeant.';
        else if (aiPersona === 'Analytical') personaDesc = 'Be data-driven and clinical, like an analyst.';

        const prompt = `
You are the CommitSync AI assistant. The system has already calculated a risk score of ${calculatedRiskScore}% for this commitment. Your job is ONLY to generate 1-2 short, specific, actionable recommendations based on the context below. ${personaDesc}

[COMMITMENT]: "${commitmentData.title}" (Category: ${commitmentData.category})
[DEADLINE]: ${new Date(commitmentData.deadline).toLocaleDateString()}
[PROGRESS]: ${commitmentData.progress || 0}%
[TIME PRESSURE]: ${Math.round(factors.timePressure)}/100
[PROGRESS GAP]: ${Math.round(factors.progressGap)}/100
[RESCHEDULED]: ${commitmentData.rescheduledCount || 0} times
[HOURS LEFT]: ${factors.hoursLeft.toFixed(1)}h

Return ONLY valid JSON: { "recommendations": ["action 1", "action 2"] }
        `;

        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 8000
          }
        );

        const aiData = JSON.parse(response.data?.choices?.[0]?.message?.content || '{}');
        if (Array.isArray(aiData.recommendations) && aiData.recommendations.length > 0) {
          recommendations = aiData.recommendations;
        }
      } catch (error) {
        console.error('LLM recommendation error (using deterministic fallback):', error.message);
      }
    }

    return {
      success: true,
      data: {
        riskScore:        calculatedRiskScore,
        riskLevel:        this._getRiskLevel(calculatedRiskScore),
        breakdown,
        recommendations,
        predictedOutcome: calculatedRiskScore >= 70 ? 'AT_RISK' : 'LIKELY_ON_TIME',
        confidence:       0.95
      }
    };
  }

  /**
   * Analyze behavioral pattern
   */
  async analyzeBehavioralPattern(userId, commitmentHistory) {
    if (this.aiAvailable) {
      try {
        const historyJson = JSON.stringify(commitmentHistory.map(c => ({
          category: c.category,
          estimatedHours: c.estimatedHours,
          status: c.status
        })));

        const prompt = `
Analyze the following task completion history and classify the user's behavioral pattern.
History: ${historyJson}

Return JSON: {
  "primaryPattern": one of ["PROCRASTINATOR", "OVERCOMMITTER", "CONSISTENT", "BURNOUT_RISK", "LAST_MINUTE_SPRINTER", "OPTIMISTIC_SCHEDULER", "SCOPE_CREEPER", "MIXED"],
  "message": "A short 1-sentence explanation."
}
        `;

        const response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const data = JSON.parse(response.data?.choices?.[0]?.message?.content || '{}');
        return {
          success: true,
          data: { primaryPattern: data.primaryPattern, message: data.message, confidence: 0.9 }
        };
      } catch (error) {
        console.error('LLM Behavioral Error:', error.message);
      }
    }

    // ── Deterministic fallback — runs entirely on in-memory history, no API needed ──
    return {
      success: true,
      data: this._deterministicPatternClassifier(commitmentHistory)
    };
  }

  /**
   * Rule-based behavioral pattern classifier.
   * Runs when Groq is unavailable. Analyses commitment history using 6 signals
   * in priority order. Returns confidence 0.7 (honest — lower than LLM but non-zero).
   */
  _deterministicPatternClassifier(commitmentHistory) {
    const resolved = commitmentHistory.filter(c =>
      ['COMPLETED', 'COMPLETED_LATE', 'MISSED'].includes(c.status)
    );

    if (resolved.length < 3) {
      return { primaryPattern: 'MIXED', confidence: 0.5, message: 'Not enough resolved commitments to classify yet.' };
    }

    const total          = resolved.length;
    const missed         = resolved.filter(c => c.status === 'MISSED').length;
    const late           = resolved.filter(c => c.status === 'COMPLETED_LATE').length;
    const onTime         = resolved.filter(c => c.status === 'COMPLETED').length;
    const rescheduled    = commitmentHistory.filter(c => (c.rescheduledCount || 0) > 0).length;

    const missedRate     = missed / total;
    const rescheduleRate = rescheduled / Math.max(1, commitmentHistory.length);
    const completionRate = (onTime + late) / total;

    // Last-minute detection: was work completed in the final 20% of the deadline window?
    const completedItems = resolved.filter(c => ['COMPLETED', 'COMPLETED_LATE'].includes(c.status));
    let lastMinuteCount = 0;
    completedItems.forEach(c => {
      const deadline   = new Date(c.deadline);
      const created    = new Date(c.createdAt || c.updatedAt);
      const doneAt     = new Date(c.completedAt || c.updatedAt);
      const windowMs   = Math.max(1, deadline - created);
      const fractionUsed = (doneAt - created) / windowMs;
      if (fractionUsed >= 0.8) lastMinuteCount++;
    });
    const lastMinuteRate = completedItems.length > 0 ? lastMinuteCount / completedItems.length : 0;

    // ── Rules in priority order (most specific → most general) ───────────────
    if (rescheduleRate > 0.4) {
      return {
        primaryPattern: 'SCOPE_CREEPER',
        confidence: 0.75,
        message: `You reschedule ${Math.round(rescheduleRate * 100)}% of commitments — a sign of chronic scope underestimation.`
      };
    }
    if (missedRate > 0.4) {
      return {
        primaryPattern: 'BURNOUT_RISK',
        confidence: 0.75,
        message: `You've missed ${Math.round(missedRate * 100)}% of commitments — this may indicate overload or burnout.`
      };
    }
    if (missedRate > 0.25 && late >= missed) {
      return {
        primaryPattern: 'PROCRASTINATOR',
        confidence: 0.7,
        message: 'You often delay and deliver late. Breaking work into smaller steps earlier may help.'
      };
    }
    if (lastMinuteRate > 0.6 && completionRate > 0.6) {
      return {
        primaryPattern: 'LAST_MINUTE_SPRINTER',
        confidence: 0.75,
        message: 'You deliver most work in the final stretch — effective under pressure, but high risk.'
      };
    }
    if (completionRate > 0.8 && (late / Math.max(1, onTime + late)) < 0.2) {
      return {
        primaryPattern: 'CONSISTENT',
        confidence: 0.8,
        message: 'Strong reliability — you consistently complete commitments close to their original deadline.'
      };
    }
    if (missedRate < 0.2 && rescheduleRate < 0.15 && late > onTime) {
      return {
        primaryPattern: 'OPTIMISTIC_SCHEDULER',
        confidence: 0.7,
        message: 'You consistently underestimate how long tasks take. Build in more buffer when creating commitments.'
      };
    }
    return {
      primaryPattern: 'MIXED',
      confidence: 0.6,
      message: 'Your patterns are varied — consistent tracking will reveal clearer trends over time.'
    };
  }


  /**
   * Calculate team commitment risk — Perfected model
   */
  async calculateTeamRisk(teamCommitment) {
    return {
      success: true,
      data: this._computeTeamRisk(teamCommitment)
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEAM RISK ENGINE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Perfected team risk calculation using weighted subtask progress + critical path analysis.
   */
  _computeTeamRisk(teamCommitment) {
    const subTasks = teamCommitment.subTasks || [];
    const now      = new Date();
    const deadline = new Date(teamCommitment.deadline || now);
    const created  = new Date(teamCommitment.createdAt || now);

    const hoursLeft   = (deadline - now) / (1000 * 60 * 60);
    const totalTimeMs = Math.max(1, deadline - created);
    const elapsedMs   = Math.max(0, now - created);
    const timeRatio   = Math.min(1, elapsedMs / totalTimeMs);

    // ── 1. TIMELINE RISK (same smooth curve as individual) ────────────────────
    let timelineRisk;
    if      (hoursLeft <= 0)   timelineRisk = 100;
    else if (hoursLeft <= 24)  timelineRisk = 80 + (1 - hoursLeft / 24)          * 20;
    else if (hoursLeft <= 72)  timelineRisk = 55 + (1 - (hoursLeft - 24) / 48)   * 25;
    else if (hoursLeft <= 168) timelineRisk = 25 + (1 - (hoursLeft - 72) / 96)   * 30;
    else                       timelineRisk = Math.max(5, 25 - (hoursLeft - 168) * 0.03);
    timelineRisk = Math.max(0, Math.min(100, timelineRisk));

    // ── 2. WEIGHTED SUBTASK PROGRESS (fixes the binary bug) ──────────────────
    // Count partial credit: IN_PROGRESS = 50%, NEEDS_REVIEW = 90%, COMPLETED = 100%
    let totalWeight = 0;
    let completedWeight = 0;

    subTasks.forEach(st => {
      const w = st.estimatedDays || 1;
      totalWeight += w;
      if (st.status === 'COMPLETED') {
        completedWeight += w;
      } else if (st.status === 'NEEDS_REVIEW') {
        completedWeight += w * 0.90;
      } else if (st.status === 'IN_PROGRESS') {
        completedWeight += w * 0.50;
      }
      // PENDING = 0 credit
    });

    const progressRatio = totalWeight > 0 ? completedWeight / totalWeight : 0;
    const gap = Math.max(0, timeRatio - progressRatio);
    const progressGapRisk = Math.min(100, gap * 100);

    // ── 3. CRITICAL PATH RISK ─────────────────────────────────────────────────
    // Critical path = sequential incomplete tasks (they MUST be done in order)
    const sequentialIncomplete = subTasks.filter(st =>
      !st.isParallel && st.status !== 'COMPLETED'
    );
    const criticalPathHours = sequentialIncomplete.reduce(
      (sum, st) => sum + ((st.estimatedDays || 1) * 8), 0
    );

    let criticalPathRisk = 0;
    if (hoursLeft <= 0) {
      criticalPathRisk = sequentialIncomplete.length > 0 ? 100 : 0;
    } else if (criticalPathHours > 0) {
      if      (criticalPathHours >= hoursLeft)        criticalPathRisk = 100;
      else if (criticalPathHours >= hoursLeft * 0.75) criticalPathRisk = 88;
      else if (criticalPathHours >= hoursLeft * 0.50) criticalPathRisk = 65;
      else criticalPathRisk = Math.min(55, (criticalPathHours / hoursLeft) * 100);
    }

    // ── 4. TEAM COMPOSITE SCORE ───────────────────────────────────────────────
    let teamRiskScore = Math.round(
      (criticalPathRisk * 0.50) +
      (progressGapRisk  * 0.30) +
      (timelineRisk     * 0.20)
    );

    // Overdue and not complete override
    if (hoursLeft <= 0 && progressRatio < 1) {
      teamRiskScore = 100;
    }

    teamRiskScore = Math.max(0, Math.min(100, teamRiskScore));

    // ── 5. BOTTLENECK DETECTION ───────────────────────────────────────────────
    const bottlenecks = [];
    const criticalPath = [];

    subTasks.forEach(st => {
      if (st.status === 'COMPLETED') return;

      let stRisk = teamRiskScore;

      if (!st.isParallel) {
        // Sequential tasks get +15 for being a serial blocker
        stRisk = Math.min(100, stRisk + 15);
        criticalPath.push(st._id);

        if (stRisk >= 55) {
          bottlenecks.push({
            taskId:     st._id,
            title:      st.title,
            assignedTo: st.assignedTo?.length > 0 ? st.assignedTo[0] : null,
            riskScore:  Math.round(stRisk),
            impact:     stRisk >= 80 ? 'CRITICAL' : stRisk >= 60 ? 'HIGH' : 'MEDIUM'
          });
        }
      }

      st.individualRiskScore = Math.round(stRisk);
    });

    bottlenecks.sort((a, b) => b.riskScore - a.riskScore);

    // Build recommendations
    const recommendations = [];
    if (criticalPathRisk >= 70) {
      recommendations.push('Focus on sequential blocking tasks immediately to prevent team-wide delay.');
    } else if (progressGapRisk >= 50) {
      recommendations.push('The team is behind schedule. Hold a sync to reallocate effort.');
    } else if (teamRiskScore < 35) {
      recommendations.push('Team is on track. Maintain current pace.');
    }

    return {
      teamRiskScore,
      riskLevel:      this._getRiskLevel(teamRiskScore),
      criticalPath,
      bottleneckTasks: bottlenecks,
      riskFactors:    [],
      teamInsights:   [
        `Weighted progress: ${Math.round(progressRatio * 100)}%. Critical path remaining: ${criticalPathHours.toFixed(1)}h. Hours left: ${Math.max(0, hoursLeft).toFixed(1)}h.`
      ],
      recommendations
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DETERMINISTIC RECOMMENDATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  _generateRecommendations(factors) {
    const { timePressure, progressGap, workloadStrain, recommitPenalty, hoursLeft } = factors;
    const recs = [];

    if (hoursLeft <= 0) {
      recs.push('This commitment is overdue. Mark it complete or missed to keep your reliability score accurate.');
      return recs;
    }
    if (progressGap >= 60) {
      recs.push('You are significantly behind schedule. Block out immediate focused time — today, not tomorrow.');
    } else if (progressGap >= 30) {
      recs.push("You're falling behind. A 2-hour focused session today will get you back on track.");
    }
    if (workloadStrain >= 70) {
      recs.push('Your active workload exceeds your sustainable limit. Complete or defer another task before adding focus here.');
    }
    if (recommitPenalty >= 55) {
      recs.push('You\'ve rescheduled this multiple times. Break it into 30-minute micro-tasks to overcome the inertia.');
    }
    if (timePressure >= 80 && progressGap < 30) {
      recs.push("Deadline is very close but you're on track. Block distractions and push through the final stretch.");
    }
    if (recs.length === 0) {
      recs.push("You're on a healthy trajectory. Maintain your current pace and you'll deliver on time.");
    }
    return recs;
  }

  async healthCheck() {
    return {
      available: this.aiAvailable,
      status: this.aiAvailable ? 'LLM Connected (recommendations only)' : 'Deterministic Engine Active'
    };
  }
}

module.exports = new PredictionService();