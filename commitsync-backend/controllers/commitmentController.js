/**
 * Commitment Controller
 */
const Commitment = require('../models/Commitment');
const User = require('../models/User');
const riskCalculator = require('../services/riskCalculator');
const calendarService = require('../services/calendarService');
const { successResponse, errorResponse } = require('../utils/responses');
const googleAuthUtil = require('../utils/googleAuth');
const { google } = require('googleapis');
const axios = require('axios');

/**
 * Feature 5: Generate AI retrospective for a completed/missed commitment.
 * Calls Groq and saves reflection + advice back to the commitment.
 * This is async-only and should be called with setImmediate.
 */
async function generateRetrospective(commitmentId, outcome) {
  try {
    const commitment = await Commitment.findById(commitmentId);
    if (!commitment) return;

    // Skip if already generated
    if (commitment.retrospective?.reflection) return;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return; // Groq not configured

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    const rescheduledNote = commitment.rescheduledCount > 0
      ? `It was rescheduled ${commitment.rescheduledCount} time(s).`
      : 'It was not rescheduled.';
    
    const subtasksSummary = commitment.subTasks?.length > 0
      ? `Subtasks (${commitment.subTasks.filter(t => t.progress === 100).length}/${commitment.subTasks.length} completed): ${commitment.subTasks.map(t => t.title).join(', ')}.`
      : 'No subtasks defined.';

    const prompt = `You are a wise but concise productivity coach. A user just ${outcome === 'COMPLETED' ? 'completed' : 'missed'} their commitment.

Commitment: "${commitment.title}"
Category: ${commitment.category}
Estimated: ${commitment.estimatedHours}h
Outcome: ${outcome}
${rescheduledNote}
${subtasksSummary}

Write a retrospective in JSON with exactly these two keys:
- "reflection": 1-2 sentences of honest, empathetic analysis about what this data reveals about the user's planning or execution. Start with "You..." 
- "nextTimeAdvice": 1 concrete, specific action they can take next time. Start with "Next time, ..."`;

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 200
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);

    commitment.retrospective = {
      reflection: parsed.reflection || null,
      nextTimeAdvice: parsed.nextTimeAdvice || null,
      generatedAt: new Date()
    };
    await commitment.save();
    console.log(`[Retrospective] Generated for commitment ${commitmentId} (${outcome})`);
  } catch (err) {
    console.error('[Retrospective] Generation failed:', err.message);
  }
}

/**
 * Named export so the cron in server.js can call this for MISSED commitments.
 * The internal `generateRetrospective` is not exported (kept private to this module).
 */
exports.generateRetrospectiveForId = generateRetrospective;

/**
 * @route   POST /api/commitments
 * @desc    Create new commitment
 * @access  Private
 */
exports.createCommitment = async (req, res) => {
  try {
    const {
      title,
      description,
      deadline,
      subTasks,
      reward,
      risk,
      status,
      ignoreCalendar
    } = req.body;

    // Calculate estimatedHours:
    // 1. Sum from subtasks if available
    // 2. Otherwise derive from deadline using 8 working hours/day
    let finalEstimatedHours = 0;

    if (subTasks && Array.isArray(subTasks) && subTasks.length > 0) {
      const subtaskSum = subTasks.reduce((sum, task) => sum + (Number(task.estimatedHours) || 0), 0);
      if (subtaskSum > 0) {
        finalEstimatedHours = subtaskSum;
      }
    }

    if (finalEstimatedHours === 0 && deadline) {
      const now = new Date();
      const deadlineDate = new Date(deadline);
      const diffMs = deadlineDate - now;
      if (diffMs > 0) {
        const workingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        finalEstimatedHours = workingDays * 8;
      }
    }

    // Infer category from title using the same logic as AI suggestions
    const templateMatcher = require('../services/templateMatcher');
    const inferredCategory = templateMatcher._inferCategoryFromTitle(title);

    const commitment = await Commitment.create({
      userId: req.user._id,
      title,
      description,
      category: inferredCategory || 'other',
      deadline,
      estimatedHours: finalEstimatedHours,
      subTasks,
      reward,
      risk,
      ignoreCalendar: !!ignoreCalendar,
      status: status || 'PENDING',
      progress: 0
    });

    // ── Calendar Reality Check (Idea 1) ─────────────────────────────────────
    // Only run if the user has calendar connected and hasn't opted out
    let calendarWarning = null;
    if (!ignoreCalendar && finalEstimatedHours > 0 && deadline) {
      try {
        const fullUser = await User.findById(req.user._id)
          .select('+googleAccessToken +googleRefreshToken');

        if (calendarService.isCalendarConnected(fullUser)) {
          const workingHours = fullUser.preferences?.workingHours || { start: '09:00', end: '17:00' };
          const result = await calendarService.getFreeHoursBetween(
            fullUser,
            new Date(),
            new Date(deadline),
            workingHours
          );

          if (result && typeof result.freeHours === 'number') {
            // Update commitment with calendar data
            commitment.calendarFreeHours = result.freeHours;
            commitment.calendarEventCount = result.eventCount;
            await commitment.save();

            // Warn if estimated work exceeds available free hours
            if (finalEstimatedHours > result.freeHours) {
              calendarWarning = `⚠️ Your calendar shows only ${result.freeHours}h free before this deadline, but you estimated ${finalEstimatedHours}h. Consider adjusting your plan or freeing up calendar time.`;
            }
          }
        }
      } catch (calendarError) {
        // Calendar check is non-blocking — log but don't fail the request
        console.warn('[createCommitment] Calendar check failed (non-fatal):', calendarError.message);
      }
    }

    // Calculate initial risk
    try {
      await riskCalculator.calculateCommitmentRisk(commitment._id);
    } catch (error) {
      console.error('Error calculating initial risk:', error.message);
    }
    
    // Fetch fresh to include new risk
    const updatedCommitment = await Commitment.findById(commitment._id);

    return successResponse(
      res,
      { commitment: updatedCommitment, calendarWarning },
      'Commitment created successfully',
      201
    );
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments
 * @desc    Get all user commitments
 * @access  Private
 */
exports.getCommitments = async (req, res) => {
  try {
    const { status, category, riskLevel, search, sort, limit, skip } = req.query;

    const query = { userId: req.user._id };

    if (status) query.status = status;
    if (category) query.category = category;
    if (riskLevel) query.riskLevel = riskLevel;
    if (search) query.$text = { $search: search };

    let commitments = Commitment.find(query);

    if (search) {
      commitments = commitments.select({ score: { $meta: 'textScore' } });
    }

    // Sorting
    if (sort) {
      if (sort === '-risk') commitments = commitments.sort('-currentRiskScore');
      else if (sort === 'risk') commitments = commitments.sort('currentRiskScore');
      else if (sort === '-deadline') commitments = commitments.sort('-deadline');
      else if (sort === 'deadline') commitments = commitments.sort('deadline');
      else if (sort === '-created') commitments = commitments.sort('-createdAt');
      else if (sort === 'created') commitments = commitments.sort('createdAt');
      else commitments = commitments.sort(sort);
    } else if (search) {
      commitments = commitments.sort({ score: { $meta: 'textScore' } });
    } else {
      commitments = commitments.sort('deadline');
    }

    if (skip) commitments = commitments.skip(parseInt(skip));
    if (limit) commitments = commitments.limit(parseInt(limit));

    commitments = await commitments;

    return successResponse(res, {
      count: commitments.length,
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments/accountable-to
 * @desc    Get commitments where the user is an accountability partner
 * @access  Private
 */
exports.getCommitmentsWherePartner = async (req, res) => {
  try {
    const commitments = await Commitment.find({
      accountabilityPartners: req.user._id
    }).populate('userId', 'name email profilePicture');

    return successResponse(res, {
      count: commitments.length,
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments/:id
 * @desc    Get single commitment
 * @access  Private
 */
exports.getCommitment = async (req, res) => {
  try {
    const commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    // Check ownership
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    return successResponse(res, { commitment });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/commitments/:id
 * @desc    Update commitment
 * @access  Private
 */
exports.updateCommitment = async (req, res) => {
  try {
    let commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    // Check ownership
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.reward !== undefined) updates.reward = req.body.reward;
    if (req.body.risk !== undefined) updates.risk = req.body.risk;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.ignoreCalendar !== undefined) updates.ignoreCalendar = req.body.ignoreCalendar;
    if (req.body.subTasks !== undefined) {
      updates.subTasks = req.body.subTasks;
      const subtaskSum = req.body.subTasks.reduce((sum, task) => sum + (Number(task.estimatedHours) || 0), 0);
      if (subtaskSum > 0) updates.estimatedHours = subtaskSum;
    }

    commitment = await Commitment.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    // Recalculate risk and await it
    try {
      await riskCalculator.calculateCommitmentRisk(commitment._id);
      commitment = await Commitment.findById(commitment._id);
    } catch (error) {
      console.error('Error recalculating risk:', error.message);
    }

    return successResponse(res, { commitment }, 'Commitment updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   DELETE /api/commitments/:id
 * @desc    Delete commitment
 * @access  Private
 */
exports.deleteCommitment = async (req, res) => {
  try {
    const commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    // Check ownership
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    await commitment.deleteOne();

    return successResponse(res, {}, 'Commitment deleted successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/commitments/:id/progress
 * @desc    Update commitment progress
 * @access  Private
 */
exports.updateProgress = async (req, res) => {
  try {
    const { progress, subTaskIndex } = req.body;

    let commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    // Check ownership
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    if (subTaskIndex !== undefined && commitment.subTasks && commitment.subTasks[subTaskIndex]) {
      // It's a sub-task update
      if (progress === undefined || progress < 0 || progress > 100) {
        return errorResponse(res, 'Sub-task progress must be between 0 and 100', 400);
      }
      commitment.subTasks[subTaskIndex].progress = progress;
      commitment.markModified('subTasks');
      
      // Recalculate overall progress weighted by estimatedHours
      let totalHours = 0;
      let completedHours = 0;
      
      commitment.subTasks.forEach(st => {
        const hrs = st.estimatedHours || 1;
        totalHours += hrs;
        completedHours += hrs * ((st.progress || 0) / 100);
      });
      
      const overallProgress = totalHours > 0 ? Math.round((completedHours / totalHours) * 100) : 0;
      await commitment.updateProgress(overallProgress);
    } else {
      // Overall update
      if (progress === undefined || progress < 0 || progress > 100) {
        return errorResponse(res, 'Progress must be between 0 and 100', 400);
      }
      await commitment.updateProgress(progress);
    }

    // Check if status newly changed to COMPLETED
    const wasCompleted = commitment.status === 'COMPLETED';
    
    // Recalculate risk and await it
    try {
      await riskCalculator.calculateCommitmentRisk(commitment._id);
      commitment = await Commitment.findById(commitment._id);
    } catch (error) {
      console.error('Error recalculating risk:', error.message);
    }

    if (!wasCompleted && commitment.status === 'COMPLETED') {
      const ChatMessage = require('../models/ChatMessage');
      const Notification = require('../models/Notification');
      const emailService = require('../services/emailService');
      const predictionService = require('../services/predictionService');
      const aiInsightsService = require('../services/aiInsightsService');
      const calendarService = require('../services/calendarService');

      // Alert partners
      if (commitment.accountabilityPartners && commitment.accountabilityPartners.length > 0) {
        for (const partnerId of commitment.accountabilityPartners) {
          await Notification.create({
            userId: partnerId,
            type: 'COMMITMENT_COMPLETED',
            message: `Commitment "${commitment.title}" has been successfully completed! Chat logs have been purged.`,
            relatedId: commitment._id
          });
          
          const User = require('../models/User');
          const p = await User.findById(partnerId);
          if (p) await emailService.sendCompletionEmail(p.email, commitment.title);
        }
      }

      // Wipe chat
      try {
        await ChatMessage.deleteMany({ commitmentId: commitment._id });
        console.log(`Purged chat messages for completed commitment ${commitment._id}`);
      } catch (err) {
        console.error('Error purging chat:', err);
      }

      // ── Feature 5: Generate retrospective asynchronously ──
      setImmediate(async () => {
        try {
          await generateRetrospective(commitment._id, 'COMPLETED');
        } catch (retroErr) {
          console.error('[Retrospective] Failed to generate for COMPLETED commitment:', retroErr.message);
        }
        try {
          await riskCalculator.updateUserBehavioralProfile(commitment.userId);
        } catch (profileErr) {
          console.error('[updateProgress] Failed to update behavioral profile:', profileErr.message);
        }
      });
    }

    return successResponse(res, { commitment }, 'Progress updated successfully');
  } catch (error) {
    console.error('Update progress error:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

/**
 * @route   POST /api/commitments/:id/complete
 * @desc    Mark commitment as completed manually
 * @access  Private
 */
exports.markComplete = async (req, res) => {
  try {
    let commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    if (commitment.status === 'COMPLETED') {
      return errorResponse(res, 'Commitment is already completed', 400);
    }

    commitment.status = 'COMPLETED';
    commitment.completedAt = new Date();
    await commitment.save();

    const ChatMessage = require('../models/ChatMessage');
    const Notification = require('../models/Notification');
    const emailService = require('../services/emailService');

    // Alert partners
    if (commitment.accountabilityPartners && commitment.accountabilityPartners.length > 0) {
      for (const partnerId of commitment.accountabilityPartners) {
        await Notification.create({
          userId: partnerId,
          type: 'COMMITMENT_COMPLETED',
          message: `Commitment "${commitment.title}" has been successfully completed! Chat logs have been purged.`,
          relatedId: commitment._id
        });
        
        const User = require('../models/User');
        const p = await User.findById(partnerId);
        if (p) await emailService.sendCompletionEmail(p.email, commitment.title);
      }
    }

    // Wipe chat
    try {
      await ChatMessage.deleteMany({ commitmentId: commitment._id });
      console.log(`Purged chat messages for completed commitment ${commitment._id}`);
    } catch (err) {
      console.error('Error purging chat:', err);
    }

    // Generate retrospective and update behavioral profile asynchronously
    setImmediate(async () => {
      try {
        await generateRetrospective(commitment._id, 'COMPLETED');
      } catch (retroErr) {
        console.error('[Retrospective] Failed to generate for COMPLETED commitment:', retroErr.message);
      }
      try {
        await riskCalculator.updateUserBehavioralProfile(commitment.userId);
      } catch (profileErr) {
        console.error('[markComplete] Failed to update behavioral profile:', profileErr.message);
      }
    });

    return successResponse(res, { commitment }, 'Commitment marked as completed successfully');
  } catch (error) {
    console.error('Mark complete error:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};



/**
 * @desc    Block focus session in calendar (Idea 2 - Intervention response)
 * @route   POST /api/commitments/:id/focus-session
 * @access  Private
 */
exports.createFocusSession = async (req, res) => {
  try {
    const commitment = await Commitment.findById(req.params.id);
    if (!commitment) {
      return res.status(404).json({ success: false, error: 'Commitment not found' });
    }
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const { start, end } = req.body;
    if (!start || !end) {
      return res.status(400).json({ success: false, error: 'Missing start or end time' });
    }

    const user = await User.findById(req.user._id).select('+googleAccessToken +googleRefreshToken');
    const result = await calendarService.createFocusSessionEvent(
      user,
      commitment,
      { start: new Date(start), end: new Date(end) }
    );

    if (!result) {
      return res.status(500).json({ success: false, error: 'Failed to create calendar event. Make sure your Google Calendar is connected.' });
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Focus session error:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

/**
 * @desc    Start DND / Busy mode (Idea 3)
 * @route   POST /api/commitments/:id/start-focus
 * @access  Private
 */
exports.startFocus = async (req, res) => {
  try {
    const commitment = await Commitment.findById(req.params.id);
    if (!commitment) {
      return res.status(404).json({ success: false, error: 'Commitment not found' });
    }
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const durationHours = parseFloat(req.body.durationHours) || 2;
    const user = await User.findById(req.user._id).select('+googleAccessToken +googleRefreshToken +focusMode');

    const result = await calendarService.createBusyBlock(user, commitment, durationHours);
    
    const endsAt = result ? result.endsAt : new Date(Date.now() + durationHours * 60 * 60 * 1000);

    // Update user DND state for Circles social layer
    user.focusMode = {
      active: true,
      endsAt: endsAt,
      commitmentId: commitment._id.toString(),
      calendarEventId: result ? result.eventId : null
    };
    await user.save();

    res.status(200).json({ 
      success: true, 
      data: { 
        calendarBlocked: !!result,
        eventLink: result ? result.eventLink : null,
        focusMode: user.focusMode
      } 
    });
  } catch (error) {
    console.error('Start focus mode error:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

/**
 * @desc    End DND / Busy mode manually
 * @route   POST /api/commitments/:id/end-focus
 * @access  Private
 */
exports.endFocus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+googleAccessToken +googleRefreshToken +focusMode');
    
    if (user.focusMode?.calendarEventId) {
       await calendarService.deleteBusyBlock(user, user.focusMode.calendarEventId);
    }

    user.focusMode = { active: false, endsAt: null, commitmentId: null, calendarEventId: null };
    await user.save();
    res.status(200).json({ success: true, data: { focusMode: user.focusMode } });
  } catch (error) {
    console.error('End focus mode error:', error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

/**
 * @route   POST /api/commitments/:id/reschedule
 * @desc    Reschedule commitment
 * @access  Private
 */
exports.rescheduleCommitment = async (req, res) => {
  try {
    const { newDeadline, reason } = req.body;

    if (!newDeadline) {
      return errorResponse(res, 'New deadline is required', 400);
    }

    let commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    // Check ownership
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    await commitment.reschedule(newDeadline, reason);

    // Recalculate risk and await it
    try {
      await riskCalculator.calculateCommitmentRisk(commitment._id);
      commitment = await Commitment.findById(commitment._id);
    } catch (error) {
      console.error('Error recalculating risk:', error.message);
    }

    return successResponse(res, { commitment }, 'Commitment rescheduled successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments/active
 * @desc    Get active commitments
 * @access  Private
 */
exports.getActiveCommitments = async (req, res) => {
  try {
    const commitments = await Commitment.getActiveCommitments(req.user._id);

    return successResponse(res, {
      count: commitments.length,
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments/history
 * @desc    Get historical commitments
 * @access  Private
 */
exports.getHistoricalCommitments = async (req, res) => {
  try {
    const commitments = await Commitment.find({
      userId: req.user._id,
      status: { $in: ['COMPLETED', 'COMPLETED_LATE', 'MISSED', 'FAILED'] }
    })
    .sort({ updatedAt: -1 })
    .limit(20);

    const User = require('../models/User');
    const fullUser = await User.findById(req.user._id);

    return successResponse(res, {
      count: commitments.length,
      behavioralPattern: fullUser.behavioralProfile?.behavioralPattern || 'MIXED',
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments/high-risk
 * @desc    Get high-risk commitments
 * @access  Private
 */
exports.getHighRiskCommitments = async (req, res) => {
  try {
    const threshold = req.query.threshold || 70;
    const commitments = await Commitment.getHighRiskCommitments(req.user._id, threshold);

    return successResponse(res, {
      count: commitments.length,
      threshold,
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/commitments/:id/calendar-sync
 * @desc    Sync commitment to Google Calendar
 * @access  Private
 */
exports.syncToCalendar = async (req, res) => {
  try {
    const commitment = await Commitment.findById(req.params.id);

    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }

    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const User = require('../models/User');
    const fullUser = await User.findById(req.user._id).select('+googleAccessToken +googleRefreshToken');

    if (!fullUser.googleAccessToken) {
      return errorResponse(res, 'Google Calendar not connected. Please authenticate with Google first.', 400);
    }

    const tokens = {
      access_token: fullUser.googleAccessToken,
      refresh_token: fullUser.googleRefreshToken
    };

    const oauth2Client = googleAuthUtil.getOAuth2Client(tokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Try to set start time realistically: created at vs deadline.
    // Let's set the event for the deadline date, maybe a 1 hr block before deadline.
    const deadlineDate = new Date(commitment.deadline);
    const startDate = new Date(deadlineDate.getTime() - (60 * 60 * 1000)); // 1 hour before

    const event = {
      summary: `CommitSync: ${commitment.title}`,
      description: commitment.description ? `${commitment.description}\n\nGenerated by CommitSync` : 'Generated by CommitSync',
      start: {
        dateTime: startDate.toISOString(),
        timeZone: fullUser.preferences?.timezone || 'UTC',
      },
      end: {
        dateTime: deadlineDate.toISOString(),
        timeZone: fullUser.preferences?.timezone || 'UTC',
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });

    return successResponse(res, { eventLink: response.data.htmlLink }, 'Successfully synced to Google Calendar');
  } catch (error) {
    if (error.code === 401 || (error.response && error.response.status === 401)) {
       return errorResponse(res, 'Google authentication expired. Please re-authenticate.', 401);
    }
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/commitments/calendar-events
 * @desc    Get user's calendar events
 * @access  Private
 */
exports.getCalendarEvents = async (req, res) => {
  try {
    const User = require('../models/User');
    const fullUser = await User.findById(req.user._id).select('+googleAccessToken +googleRefreshToken');
    
    if (!fullUser.googleAccessToken || !fullUser.calendarConnected) {
      return successResponse(res, { events: [], calendarConnected: false }, 'Google Calendar not connected');
    }

    const days = parseInt(req.query.days) || 2;
    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const events = await calendarService.getUserEvents(fullUser, now, endDate);

    if (!events) {
      return successResponse(res, { events: [], calendarConnected: true, fetchError: true }, 'Failed to fetch events');
    }

    return successResponse(res, { events, calendarConnected: true });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PATCH /api/commitments/:id/partner
 * @desc    Add an accountability partner
 * @access  Private
 */
exports.addAccountabilityPartner = async (req, res) => {
  try {
    const { partnerId } = req.body;
    
    if (!partnerId) {
      return errorResponse(res, 'Partner ID is required', 400);
    }
    
    let commitment = await Commitment.findById(req.params.id);
    
    if (!commitment) {
      return errorResponse(res, 'Commitment not found', 404);
    }
    
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }
    
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    
    if (!user.friends || !user.friends.some(id => id.toString() === partnerId)) {
      return errorResponse(res, 'User must be your friend first', 400);
    }
    
    if (commitment.accountabilityPartners && commitment.accountabilityPartners.some(id => id.toString() === partnerId)) {
      return errorResponse(res, 'User is already an accountability partner', 400);
    }
    
    if (commitment.pendingAccountabilityPartners && commitment.pendingAccountabilityPartners.some(id => id.toString() === partnerId)) {
      return errorResponse(res, 'Accountability request already sent', 400);
    }
    
    const Notification = require('../models/Notification');
    const existingReq = await Notification.findOne({
      userId: partnerId,
      type: 'ACCOUNTABILITY_REQUEST',
      relatedId: commitment._id,
      isRead: false
    });
    
    if (existingReq) {
      return errorResponse(res, 'Accountability request already sent', 400);
    }

    await Notification.create({
      userId: partnerId,
      type: 'ACCOUNTABILITY_REQUEST',
      message: `${user.name} invited you to be their accountability partner for "${commitment.title}"`,
      relatedId: commitment._id
    });
    
    if (!commitment.pendingAccountabilityPartners) {
      commitment.pendingAccountabilityPartners = [];
    }
    commitment.pendingAccountabilityPartners.push(partnerId);
    await commitment.save();
    
    return successResponse(res, { commitment }, 'Accountability request sent successfully');
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return errorResponse(res, messages.join(', '), 400);
    }
    return errorResponse(res, error.message, 500);
  }
};

exports.acceptAccountabilityRequest = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const Notification = require('../models/Notification');
    
    const notification = await Notification.findOne({
      _id: notificationId,
      userId: req.user._id,
      type: 'ACCOUNTABILITY_REQUEST'
    });
    
    if (!notification) {
      return errorResponse(res, 'Request not found', 404);
    }
    
    const commitmentId = notification.relatedId;
    let commitment = await Commitment.findById(commitmentId);
    
    if (commitment) {
      if (!commitment.accountabilityPartners.includes(req.user._id)) {
        if (commitment.accountabilityPartners.length >= 3) {
           return errorResponse(res, 'This commitment already has the maximum of 3 partners', 400);
        }
        commitment.accountabilityPartners.push(req.user._id);
      }
      
      if (commitment.pendingAccountabilityPartners) {
        commitment.pendingAccountabilityPartners = commitment.pendingAccountabilityPartners.filter(id => id.toString() !== req.user._id.toString());
      }
      
      await commitment.save();
    }
    
    notification.isRead = true;
    notification.actionStatus = 'ACCEPTED';
    await notification.save();
    
    return successResponse(res, { commitment }, 'Accountability request accepted');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

exports.rejectAccountabilityRequest = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const Notification = require('../models/Notification');
    
    const notification = await Notification.findOne({
      _id: notificationId,
      userId: req.user._id,
      type: 'ACCOUNTABILITY_REQUEST'
    });
    
    if (!notification) {
      return errorResponse(res, 'Request not found', 404);
    }
    
    const commitmentId = notification.relatedId;
    let commitment = await Commitment.findById(commitmentId);
    
    if (commitment && commitment.pendingAccountabilityPartners) {
      commitment.pendingAccountabilityPartners = commitment.pendingAccountabilityPartners.filter(id => id.toString() !== req.user._id.toString());
      await commitment.save();
    }
    
    notification.isRead = true;
    notification.actionStatus = 'DECLINED';
    await notification.save();
    
    return successResponse(res, {}, 'Accountability request rejected');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AI COACH TIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /api/commitments/:id/coach-tip
 * @desc    Generate a personalised LLM coaching tip for a single commitment,
 *          factoring in the user's behavioral profile and risk context.
 * @access  Private
 */
exports.getCoachTip = async (req, res) => {
  try {
    const commitment = await Commitment.findById(req.params.id);
    if (!commitment) return errorResponse(res, 'Commitment not found', 404);
    if (commitment.userId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Not authorized', 403);
    }

    const user = await User.findById(req.user._id);

    const hoursLeft = Math.max(0, (new Date(commitment.deadline) - new Date()) / 3600000);
    const subTasksDone = (commitment.subTasks || []).filter(t => t.progress === 100).length;
    const subTasksTotal = (commitment.subTasks || []).length;

    // ── Build Groq prompt ────────────────────────────────────────────────────
    const personaMap = {
      Supportive: 'a warm, encouraging friend who genuinely believes in them.',
      Strict: 'a no-excuses mentor who delivers hard truths with precision.',
      Analytical: 'a data-driven analyst who quantifies everything and loves specifics.'
    };

    const patternAdvice = {
      PROCRASTINATOR:      'This person delays. Emphasise starting right now, not tomorrow. Suggest a 25-min Pomodoro session immediately.',
      OVERCOMMITTER:       'This person takes on too much. Remind them to focus on just THIS one task and protect their bandwidth.',
      BURNOUT_RISK:        'This person burns out. Suggest short focused sessions (max 90 min) with mandatory breaks. Guard their energy.',
      LAST_MINUTE_SPRINTER:'This person peaks near deadlines. Validate that, but help them pace to avoid last-minute quality drops.',
      CONSISTENT:          'This person is consistent. Reinforce their routine and suggest they share their method with teammates.',
      INSUFFICIENT_DATA:   'Not enough history yet. Give general, widely applicable productivity advice.',
      MIXED:               'Varied patterns. Give balanced advice covering both time management and energy management.'
    };

    const bp = user.behavioralProfile || {};
    const pattern = bp.behavioralPattern || 'MIXED';
    const persona = user.preferences?.aiPersona || 'Supportive';

    const prompt = `
You are a productivity coach inside CommitSync. You speak as ${personaMap[persona] || personaMap.Supportive}

COMMITMENT CONTEXT:
- Title: "${commitment.title}" (Category: ${commitment.category})
- Progress: ${commitment.progress || 0}% (${subTasksDone}/${subTasksTotal} subtasks done)
- Risk Score: ${commitment.currentRiskScore || 0}/100 (${commitment.riskLevel || 'LOW'})
- Hours Remaining Until Deadline: ${hoursLeft.toFixed(1)}h
- Times Rescheduled: ${commitment.rescheduledCount || 0}
- Estimated Total Hours: ${commitment.estimatedHours || 'unknown'}

ABOUT THIS USER (use this to personalise — do NOT ignore):
- Behavioral Pattern: ${pattern}
- Pattern Guidance: ${patternAdvice[pattern] || patternAdvice.MIXED}
- Max Sustainable Workload: ${bp.maxSustainableWorkload || 4} concurrent tasks
- Reliability Score: ${bp.reliabilityScore || 0}%
- Burnout Recovery Days Needed: ${bp.burnoutRecoveryDays || 3}

YOUR TASK:
Generate a coaching response using EXACTLY this JSON structure. Be direct, specific, and human.
Reference the actual numbers above. Do NOT be generic. Speak to the user as "you/your".

{
  "headline": "A punchy, motivating 1-sentence headline (max 12 words)",
  "tips": [
    "Tip 1: A specific, immediately actionable instruction for THIS commitment (1-2 sentences)",
    "Tip 2: Advice that directly addresses their behavioral pattern (1-2 sentences)",
    "Tip 3: An anti-burnout or energy management tip (1-2 sentences)"
  ],
  "microGoal": "One concrete action they can do in the next 30 minutes to move this commitment forward.",
  "encouragement": "A closing 1-sentence encouragement tailored to their pattern and current risk level."
}
    `.trim();

    // ── Call Groq ────────────────────────────────────────────────────────────
    if (!process.env.GROQ_API_KEY) {
      // Deterministic fallback when no API key
      return successResponse(res, {
        headline: hoursLeft <= 24 ? 'Final stretch — every hour matters now.' : 'Steady progress beats sudden sprints.',
        tips: [
          commitment.currentRiskScore >= 70
            ? `Your risk is at ${commitment.currentRiskScore}%. Block the next 2 hours for this commitment today.`
            : `At ${commitment.progress || 0}% progress, you're on a reasonable trajectory — keep it consistent.`,
          patternAdvice[pattern].split('.')[0] + '.',
          'Work in focused 50-min blocks with a 10-min break. Protect your energy, not just your clock.'
        ],
        microGoal: subTasksDone < subTasksTotal
          ? `Complete subtask ${subTasksDone + 1} of ${subTasksTotal} right now.`
          : 'Review everything done so far and identify the single biggest remaining gap.',
        encouragement: bp.reliabilityScore >= 70
          ? `Your ${bp.reliabilityScore}% reliability score shows you deliver — trust yourself.`
          : 'Every commitment you close strengthens your reliability score. This one counts.'
      }, 'Coach tip generated (deterministic fallback)');
    }

    const axios = require('axios');
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 600
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return errorResponse(res, 'Failed to parse AI response', 500);
    }

    // Validate structure
    if (!parsed.headline || !Array.isArray(parsed.tips)) {
      return errorResponse(res, 'Unexpected AI response shape', 500);
    }

    return successResponse(res, {
      headline: parsed.headline,
      tips: parsed.tips.slice(0, 3),
      microGoal: parsed.microGoal || null,
      encouragement: parsed.encouragement || null
    }, 'Coach tip generated');

  } catch (error) {
    console.error('Coach tip error:', error.message);
    return errorResponse(res, 'Could not generate coach tip right now.', 500);
  }
};

