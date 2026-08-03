/**
 * Team Commitment Controller
 */
const TeamCommitment = require('../models/TeamCommitment');
const Commitment = require('../models/Commitment');
const Team = require('../models/Team');
const predictionService = require('../services/predictionService');
const riskCalculator = require('../services/riskCalculator');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * @route   POST /api/teams/:teamId/commitments
 * @desc    Create team commitment
 * @access  Private (Team member)
 */
exports.createTeamCommitment = async (req, res) => {
  try {
    const { teamId } = req.params;
    const { title, description, deadline, subTasks } = req.body;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return errorResponse(res, 'Invalid team ID', 400);
    }

    const team = await Team.findById(teamId);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is team member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not a team member', 403);
    }

    // Validate sub-tasks
    if (!subTasks || subTasks.length === 0) {
      return errorResponse(res, 'At least one sub-task is required', 400);
    }

    // Validate assigned users are team members
    for (const subTask of subTasks) {
      const assignedIds = Array.isArray(subTask.assignedTo) ? subTask.assignedTo : [subTask.assignedTo];
      for (const userId of assignedIds) {
        if (!userId) continue;
        const isMember = team.members.some(m => m.userId.toString() === userId.toString());
        if (!isMember) {
          return errorResponse(res, `User ${userId} is not a team member`, 400);
        }
      }
    }

    // Create team commitment with embedded subtasks
    const teamCommitment = await TeamCommitment.create({
      teamId,
      title,
      description,
      deadline,
      status: 'PENDING',
      subTasks: subTasks.map(st => ({
        title: st.title,
        assignedTo: Array.isArray(st.assignedTo) ? st.assignedTo : [st.assignedTo].filter(Boolean),
        estimatedDays: st.estimatedDays || 1,
        isParallel: st.isParallel || false,
        requireProof: st.requireProof || false,
        status: 'PENDING',
        deadline: st.deadline || deadline,
        dependsOn: st.dependsOn || [],
        individualRiskScore: 0,
        isCriticalPath: false
      }))
    });

    // Calculate team risk
    // Note: If predictionService depends on Commitment.findById, we may need to adapt it,
    // but for now we call it and let fallback handle it if it fails.
    try {
      await exports._calculateTeamRisk(teamCommitment._id);
    } catch (e) {
      console.error('Initial risk calculation failed:', e);
    }

    const populatedCommitment = await TeamCommitment.findById(teamCommitment._id)
      .populate('subTasks.assignedTo', 'name email');

    return successResponse(res, { 
      teamCommitment: populatedCommitment 
    }, 'Team commitment created successfully', 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams/:teamId/commitments
 * @desc    Get team commitments
 * @access  Private
 */
exports.getTeamCommitments = async (req, res) => {
  try {
    const { teamId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return errorResponse(res, 'Invalid team ID', 400);
    }

    const team = await Team.findById(teamId);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is team member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not a team member', 403);
    }

    const commitments = await TeamCommitment.find({ teamId })
      .populate('subTasks.assignedTo', 'name email')
      .sort('-createdAt');

    return successResponse(res, {
      count: commitments.length,
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams/:teamId/commitments/history
 * @desc    Get historical team commitments
 * @access  Private
 */
exports.getHistoricalTeamCommitments = async (req, res) => {
  try {
    const { teamId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return errorResponse(res, 'Invalid team ID', 400);
    }

    const team = await Team.findById(teamId);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is team member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not a team member', 403);
    }

    const commitments = await TeamCommitment.find({
      teamId,
      status: { $in: ['COMPLETED', 'FAILED'] }
    })
      .populate('subTasks.assignedTo', 'name email behavioralProfile')
      .sort('-updatedAt')
      .limit(20);

    return successResponse(res, {
      count: commitments.length,
      commitments
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams/:teamId/commitments/:id
 * @desc    Get single team commitment
 * @access  Private
 */
exports.getTeamCommitment = async (req, res) => {
  try {
    const { teamId, id } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return errorResponse(res, 'Invalid team ID', 400);
    }

    const team = await Team.findById(teamId);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is team member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not a team member', 403);
    }

    const commitment = await TeamCommitment.findById(id)
      .populate('subTasks.assignedTo', 'name email behavioralProfile')
      .populate('subTasks.reviewedBy', 'name');

    if (!commitment) {
      return errorResponse(res, 'Team commitment not found', 404);
    }

    return successResponse(res, { commitment });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/:teamId/commitments/:id/recalculate-risk
 * @desc    Recalculate team risk
 * @access  Private
 */
exports.recalculateTeamRisk = async (req, res) => {
  try {
    const { teamId, id } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return errorResponse(res, 'Invalid team ID', 400);
    }

    const team = await Team.findById(teamId);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is team member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not a team member', 403);
    }

    const riskData = await this._calculateTeamRisk(id);

    const commitment = await TeamCommitment.findById(id)
      .populate('subTasks.assignedTo', 'name email');

    return successResponse(res, { 
      commitment,
      riskAnalysis: riskData
    }, 'Team risk recalculated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams/:teamId/risk-dashboard
 * @desc    Get team risk dashboard
 * @access  Private
 */
exports.getTeamRiskDashboard = async (req, res) => {
  try {
    const { teamId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(teamId)) {
      return errorResponse(res, 'Invalid team ID', 400);
    }

    const team = await Team.findById(teamId);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is team member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not a team member', 403);
    }

    // Get all team commitments
    const teamCommitments = await TeamCommitment.find({ 
      teamId,
      status: { $in: ['PENDING', 'IN_PROGRESS', 'AT_RISK'] }
    }).populate('subTasks.assignedTo', 'name email')
      .lean();

    // Recalculate live risk for accuracy on the dashboard without saving
    for (let tc of teamCommitments) {
      const liveRisk = await predictionService.calculateTeamRisk(tc);
      if (liveRisk.success) {
        tc.teamRiskScore = liveRisk.data.teamRiskScore;
        tc.bottleneckTasks = liveRisk.data.bottleneckTasks;
        tc.criticalPath = liveRisk.data.criticalPath;
        // Apply individual risks to subtasks so member risks are accurate
        if (tc.subTasks && tc.subTasks.length) {
          tc.subTasks.forEach(st => {
            // we have st.individualRiskScore set by the fallbackTeamRisk internally but it's not mapped back automatically in lean objects unless we do it
            // Actually _fallbackTeamRisk mutates the array elements if we passed references, which we did!
          });
        }
      }
    }

    // Calculate overall team metrics
    const totalCommitments = teamCommitments.length;
    const highRiskCommitments = teamCommitments.filter(tc => tc.teamRiskScore >= 70).length;
    const criticalCommitments = teamCommitments.filter(tc => tc.teamRiskScore >= 85).length;

    const avgTeamRisk = totalCommitments > 0
      ? teamCommitments.reduce((sum, tc) => sum + tc.teamRiskScore, 0) / totalCommitments
      : 0;

    // Get all bottlenecks
    const allBottlenecks = [];
    teamCommitments.forEach(tc => {
      if (tc.bottleneckTasks && Array.isArray(tc.bottleneckTasks)) {
        tc.bottleneckTasks.forEach(bt => {
          allBottlenecks.push({
            teamCommitmentId: tc._id,
            teamCommitmentTitle: tc.title,
            ...bt
          });
        });
      }
    });

    // Sort bottlenecks by risk
    allBottlenecks.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));

    // Member risk summary
    const memberRisks = {};
    teamCommitments.forEach(tc => {
      if (tc.subTasks && Array.isArray(tc.subTasks)) {
        tc.subTasks.forEach(st => {
          if (!st.assignedTo) return;
          const assignedArray = Array.isArray(st.assignedTo) ? st.assignedTo : [st.assignedTo];
          
          assignedArray.forEach(user => {
            if (!user || !user._id) return;
            const userId = user._id.toString();
            if (!memberRisks[userId]) {
              memberRisks[userId] = {
                userId,
                name: user.name,
                email: user.email,
                tasks: 0,
                avgRisk: 0,
                highRiskTasks: 0
              };
            }
            memberRisks[userId].tasks += 1;
            memberRisks[userId].avgRisk += (st.individualRiskScore || 0);
            if ((st.individualRiskScore || 0) >= 70) {
              memberRisks[userId].highRiskTasks += 1;
            }
          });
        });
      }
    });

    // Calculate averages
    Object.values(memberRisks).forEach(mr => {
      mr.avgRisk = mr.tasks > 0 ? mr.avgRisk / mr.tasks : 0;
    });

    return successResponse(res, {
      overview: {
        totalActiveCommitments: totalCommitments,
        highRiskCommitments,
        criticalCommitments,
        averageTeamRisk: Math.round(avgTeamRisk)
      },
      commitments: teamCommitments,
      bottlenecks: allBottlenecks.slice(0, 5), // Top 5
      memberRisks: Object.values(memberRisks)
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:teamId/commitments/:id/subtasks/:subtaskId/progress
 * @desc    Submit proof or mark subtask in progress/completed
 * @access  Private (Assigned member)
 */
exports.updateSubtaskStatus = async (req, res) => {
  try {
    const { teamId, id, subtaskId } = req.params;
    const { status, proofUrl, proofType } = req.body;

    const tc = await TeamCommitment.findById(id);
    if (!tc || tc.teamId.toString() !== teamId) return errorResponse(res, 'Commitment not found', 404);

    const subTask = tc.subTasks.id(subtaskId);
    if (!subTask) return errorResponse(res, 'Subtask not found', 404);

    const isAssigned = subTask.assignedTo.some(uId => uId.toString() === req.user._id.toString());
    if (!isAssigned) return errorResponse(res, 'Not assigned to this subtask', 403);

    if (status) {
      if (status === 'COMPLETED' && subTask.requireProof) {
        if (!proofUrl) return errorResponse(res, 'Proof is required to complete this task', 400);
        subTask.status = 'NEEDS_REVIEW';
        subTask.proof = { url: proofUrl, proofType: proofType || 'LINK' };
      } else {
        subTask.status = status;
      }
    }
    await tc.save();
    return successResponse(res, { subTask }, 'Subtask updated');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:teamId/commitments/:id/subtasks/:subtaskId/approve
 * @desc    Approve proof and complete subtask
 * @access  Private (Admin only)
 */
exports.approveProof = async (req, res) => {
  try {
    const { teamId, id, subtaskId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can approve proofs', 403);

    const tc = await TeamCommitment.findById(id);
    if (!tc) return errorResponse(res, 'Commitment not found', 404);

    const subTask = tc.subTasks.id(subtaskId);
    if (!subTask) return errorResponse(res, 'Subtask not found', 404);

    subTask.status = 'COMPLETED';
    subTask.reviewedBy = req.user._id;
    await tc.save();

    // Trigger Notification to assignees
    const Notification = require('../models/Notification');
    for (const assignee of subTask.assignedTo) {
      await Notification.create({
        userId: assignee,
        type: 'PROOF_APPROVED',
        message: `Your proof for '${subTask.title}' was approved!`,
        relatedId: tc._id
      });
    }

    return successResponse(res, { subTask }, 'Proof approved');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:teamId/commitments/:id/subtasks/:subtaskId/reject
 * @desc    Reject proof and ask for resubmission
 * @access  Private (Admin only)
 */
exports.rejectProof = async (req, res) => {
  try {
    const { teamId, id, subtaskId } = req.params;
    const team = await Team.findById(teamId);
    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can reject proofs', 403);

    const tc = await TeamCommitment.findById(id);
    if (!tc) return errorResponse(res, 'Commitment not found', 404);

    const subTask = tc.subTasks.id(subtaskId);
    if (!subTask) return errorResponse(res, 'Subtask not found', 404);

    subTask.status = 'IN_PROGRESS';
    // Clear the rejected proof so they can submit a new one
    subTask.proof = { url: '', proofType: 'LINK' };
    await tc.save();

    // Trigger Notification to assignees
    const Notification = require('../models/Notification');
    for (const assignee of subTask.assignedTo) {
      await Notification.create({
        userId: assignee,
        type: 'PROOF_REJECTED',
        message: `Your proof for '${subTask.title}' was rejected. Please resubmit.`,
        relatedId: tc._id
      });
    }

    return successResponse(res, { subTask }, 'Proof rejected, resubmission requested');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:teamId/commitments/:id/subtasks/:subtaskId/reschedule
 * @desc    Admin reschedules a subtask
 * @access  Private (Admin only)
 */
exports.rescheduleSubtask = async (req, res) => {
  try {
    const { teamId, id, subtaskId } = req.params;
    const { newDeadline } = req.body;

    const team = await Team.findById(teamId);
    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can reschedule team tasks', 403);

    const tc = await TeamCommitment.findById(id);
    if (!tc) return errorResponse(res, 'Commitment not found', 404);

    const subTask = tc.subTasks.id(subtaskId);
    if (!subTask) return errorResponse(res, 'Subtask not found', 404);

    subTask.deadline = newDeadline;
    await tc.save();

    return successResponse(res, { subTask }, 'Subtask rescheduled');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:teamId/commitments/:id/subtasks/:subtaskId/assign
 * @desc    Assign subtask to team members
 * @access  Private (Admin only)
 */
exports.assignSubtask = async (req, res) => {
  try {
    const { teamId, id, subtaskId } = req.params;
    const { assignedTo } = req.body; // array of user IDs

    const team = await Team.findById(teamId);
    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Only admins and owners can assign subtasks', 403);

    const tc = await TeamCommitment.findById(id);
    if (!tc) return errorResponse(res, 'Commitment not found', 404);

    const subTask = tc.subTasks.id(subtaskId);
    if (!subTask) return errorResponse(res, 'Subtask not found', 404);

    // Validate that all assigned users are team members
    const assignedIds = Array.isArray(assignedTo) ? assignedTo : [assignedTo].filter(Boolean);
    for (const userId of assignedIds) {
      if (!team.isMember(userId)) {
        return errorResponse(res, `User ${userId} is not a team member`, 400);
      }
    }

    subTask.assignedTo = assignedIds;
    await tc.save();

    return successResponse(res, { subTask }, 'Subtask assigned successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Helper: Calculate team risk using prediction service
 */
exports._calculateTeamRisk = async function(teamCommitmentId) {
  try {
    const teamCommitment = await TeamCommitment.findById(teamCommitmentId);

    if (!teamCommitment) {
      throw new Error('Team commitment not found');
    }

    // Using embedded subtasks
    const subTasksWithRisk = (teamCommitment.subTasks || []).map(st => ({
      commitmentId: st._id ? st._id.toString() : '',
      assignedTo: (st.assignedTo && st.assignedTo.length) ? st.assignedTo[0].toString() : null, // Pick first for now
      title: st.title,
      individualRiskScore: st.individualRiskScore || 0,
      dependsOn: (st.dependsOn || []).map(d => d ? d.toString() : '')
    }));

    // Call prediction service for team risk
    const result = await predictionService.calculateTeamRisk(teamCommitment);

    if (result.success) {
      await teamCommitment.updateTeamRisk(result.data);
      return result.data;
    } else {
      const fallbackData = result.fallback || { teamRiskScore: 0, criticalPath: [], bottleneckTasks: [] };
      await teamCommitment.updateTeamRisk(fallbackData);
      return fallbackData;
    }
  } catch (error) {
    console.error('Error calculating team risk:', error.message);
    throw error;
  }
};