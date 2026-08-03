/**
 * Team Controller
 */
const Team = require('../models/Team');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * @route   POST /api/teams
 * @desc    Create new team
 * @access  Private
 */
exports.createTeam = async (req, res) => {
  try {
    const { name, description, inviteCode, expireDays } = req.body;

    const teamData = {
      name,
      description,
      adminId: req.user._id,
      members: [{
        userId: req.user._id,
        role: 'ADMIN',
        isOwner: true,
        joinedAt: new Date()
      }]
    };

    if (inviteCode && expireDays) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expireDays));
      teamData.inviteCode = { code: inviteCode, expiresAt };
    }

    const team = await Team.create(teamData);

    return successResponse(res, { team }, 'Team created successfully', 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams
 * @desc    Get user's teams
 * @access  Private
 */
exports.getTeams = async (req, res) => {
  try {
    const teams = await Team.find({
      'members.userId': req.user._id
    }).populate('members.userId', 'name email').populate('pendingInvites', 'name email');

    return successResponse(res, {
      count: teams.length,
      teams
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams/:id
 * @desc    Get team details
 * @access  Private
 */
exports.getTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('members.userId', 'name email behavioralProfile')
      .populate('pendingInvites', 'name email')
      .populate('adminId', 'name email');

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    return successResponse(res, { team });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:id
 * @desc    Update team
 * @access  Private (Admin only)
 */
exports.updateTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is admin
    if (!team.isAdmin(req.user._id)) {
      return errorResponse(res, 'Only admins can update team', 403);
    }

    const { name, description } = req.body;

    if (name) team.name = name;
    if (description) team.description = description;

    await team.save();

    return successResponse(res, { team }, 'Team updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   DELETE /api/teams/:id
 * @desc    Delete team
 * @access  Private (Admin only)
 */
exports.deleteTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Only team creator (adminId) can delete
    if (team.adminId.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'Only team creator can delete team', 403);
    }

    const Conversation = require('../models/Conversation');
    const ChatMessage = require('../models/ChatMessage');

    // Delete TEAM conversations and their messages
    const teamConvs = await Conversation.find({ type: 'TEAM', teamId: team._id });
    for (const conv of teamConvs) {
      await ChatMessage.deleteMany({ conversationId: conv._id });
      await conv.deleteOne();
    }

    // Delete DIRECT conversations between the admin and team members
    const adminId = team.adminId;
    for (const member of team.members) {
      if (member.userId.toString() !== adminId.toString()) {
        const directConv = await Conversation.findOne({
          type: 'DIRECT',
          participants: { $all: [adminId, member.userId], $size: 2 }
        });
        if (directConv) {
          await ChatMessage.deleteMany({ conversationId: directConv._id });
          await directConv.deleteOne();
        }
      }
    }

    await team.deleteOne();

    return successResponse(res, {}, 'Team deleted successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/:id/members
 * @desc    Add member to team
 * @access  Private (Admin only)
 */
exports.addMember = async (req, res) => {
  try {
    const { email, role } = req.body;

    const team = await Team.findById(req.params.id);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is admin
    if (!team.isAdmin(req.user._id)) {
      return errorResponse(res, 'Only admins can add members', 403);
    }

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Add member
    await team.addMember(user._id, role || 'MEMBER');

    const updatedTeam = await Team.findById(team._id)
      .populate('members.userId', 'name email');

    return successResponse(res, { team: updatedTeam }, 'Member added successfully');
  } catch (error) {
    if (error.message === 'User is already a team member') {
      return errorResponse(res, error.message, 400);
    }
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   DELETE /api/teams/:id/members/:userId
 * @desc    Remove member from team
 * @access  Private (Admin only)
 */
exports.removeMember = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is admin
    if (!team.isAdmin(req.user._id)) {
      return errorResponse(res, 'Only admins can remove members', 403);
    }

    // Cannot remove team creator
    if (team.adminId.toString() === req.params.userId) {
      return errorResponse(res, 'Cannot remove team creator', 400);
    }

    await team.removeMember(req.params.userId);

    // Remove user from any TEAM conversations
    const Conversation = require('../models/Conversation');
    const ChatMessage = require('../models/ChatMessage');
    
    await Conversation.updateMany(
      { type: 'TEAM', teamId: team._id },
      { $pull: { participants: req.params.userId } }
    );

    // Delete DIRECT conversation between team admin and the removed user
    const adminId = team.adminId;
    const directConv = await Conversation.findOne({
      type: 'DIRECT',
      participants: { $all: [adminId, req.params.userId], $size: 2 }
    });
    
    if (directConv) {
      await ChatMessage.deleteMany({ conversationId: directConv._id });
      await directConv.deleteOne();
    }

    return successResponse(res, { team }, 'Member removed successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/teams/:id/members
 * @desc    Get team members with their stats
 * @access  Private
 */
exports.getTeamMembers = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id)
      .populate('members.userId', 'name email behavioralProfile');

    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    // Check if user is member
    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'Not authorized', 403);
    }

    return successResponse(res, {
      count: team.members.length,
      members: team.members
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/:id/invite-code
 * @desc    Create invite code
 * @access  Private (Admin only)
 */
exports.createInviteCode = async (req, res) => {
  try {
    const { expirationDays } = req.body;
    const team = await Team.findById(req.params.id);

    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Not authorized', 403);

    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const days = parseInt(expirationDays) || 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    team.inviteCode = { code, expiresAt };
    await team.save();

    return successResponse(res, { inviteCode: team.inviteCode }, 'Invite code created');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/join/:code
 * @desc    Join team using invite code
 * @access  Private
 */
exports.joinTeamWithCode = async (req, res) => {
  try {
    const { code } = req.params;
    const team = await Team.findOne({ 'inviteCode.code': code });

    if (!team) return errorResponse(res, 'Invalid invite code', 404);
    if (team.isEntryClosed) return errorResponse(res, 'Team entry is closed', 403);
    
    if (team.inviteCode.expiresAt < new Date()) {
      return errorResponse(res, 'Invite code has expired', 403);
    }

    try {
      await team.addMember(req.user._id, 'MEMBER', false);
      
      const Notification = require('../models/Notification');
      await Notification.create({
        userId: req.user._id,
        type: 'TEAM_JOINED',
        message: `You successfully joined ${team.name}`,
        relatedId: team._id
      });
      
      return successResponse(res, { teamId: team._id }, 'Joined team successfully');
    } catch (e) {
      if (e.message === 'User is already a team member') {
        return errorResponse(res, e.message, 400);
      }
      throw e;
    }
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:id/members/:userId/role
 * @desc    Update member role
 * @access  Private (Owner/Admin)
 */
exports.updateMemberRole = async (req, res) => {
  try {
    const { role } = req.body;
    const team = await Team.findById(req.params.id);

    if (!team) return errorResponse(res, 'Team not found', 404);

    const callerMember = team.members.find(m => m.userId.toString() === req.user._id.toString());
    const targetMember = team.members.find(m => m.userId.toString() === req.params.userId.toString());

    if (!callerMember) return errorResponse(res, 'Not authorized', 403);
    if (!targetMember) return errorResponse(res, 'Target user not found in team', 404);

    if (!callerMember.isOwner && !team.isAdmin(req.user._id)) {
      return errorResponse(res, 'Only admins or owner can change roles', 403);
    }

    // Only owner can demote admins or make admins
    if (targetMember.role === 'ADMIN' && !callerMember.isOwner && callerMember.userId.toString() !== targetMember.userId.toString()) {
      return errorResponse(res, 'Only the owner can demote an admin', 403);
    }

    targetMember.role = role;
    await team.save();

    return successResponse(res, {}, 'Role updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/teams/:id/toggle-entry
 * @desc    Toggle team entry closed/open
 * @access  Private (Admin only)
 */
exports.toggleEntry = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Not authorized', 403);

    team.isEntryClosed = !team.isEntryClosed;
    await team.save();

    return successResponse(res, { isEntryClosed: team.isEntryClosed }, 'Team entry updated');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/:id/invite
 * @desc    Invite friends to team
 * @access  Private (Owner/Admin)
 */
exports.inviteMembers = async (req, res) => {
  try {
    const { friends } = req.body;
    const team = await Team.findById(req.params.id);

    if (!team) return errorResponse(res, 'Team not found', 404);
    if (!team.isAdmin(req.user._id)) return errorResponse(res, 'Only admins can invite members', 403);

    const Notification = require('../models/Notification');
    
    if (friends && friends.length > 0) {
      for (const friendId of friends) {
        // Check if already a member
        if (team.isMember(friendId)) continue;
        
        // Check if invite already exists
        const existing = await Notification.findOne({
          userId: friendId,
          type: 'TEAM_INVITE',
          relatedId: team._id,
          isRead: false
        });
        
        if (!existing) {
          await Notification.create({
            userId: friendId,
            type: 'TEAM_INVITE',
            message: `${req.user.name} invited you to join team "${team.name}"`,
            relatedId: team._id
          });
          
          if (!team.pendingInvites.includes(friendId)) {
            team.pendingInvites.push(friendId);
          }
        }
      }
      await team.save();
    }

    return successResponse(res, {}, 'Invitations sent successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/accept-invite/:notificationId
 * @desc    Accept a team invite
 * @access  Private
 */
exports.acceptInvite = async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      userId: req.user._id,
      type: 'TEAM_INVITE'
    });

    if (!notification) {
      return errorResponse(res, 'Invite not found', 404);
    }

    const team = await Team.findById(notification.relatedId);
    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    try {
      await team.addMember(req.user._id, 'MEMBER', false);
    } catch (e) {
      // ignore if already a member
    }

    team.pendingInvites = team.pendingInvites.filter(id => id.toString() !== req.user._id.toString());
    await team.save();

    notification.isRead = true;
    notification.actionStatus = 'ACCEPTED';
    await notification.save();

    return successResponse(res, { teamId: team._id }, 'Joined team successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/reject-invite/:notificationId
 * @desc    Reject a team invite
 * @access  Private
 */
exports.rejectInvite = async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const notification = await Notification.findOne({
      _id: req.params.notificationId,
      userId: req.user._id,
      type: 'TEAM_INVITE'
    });

    if (!notification) {
      return errorResponse(res, 'Invite not found', 404);
    }

    const team = await Team.findById(notification.relatedId);
    if (team) {
      team.pendingInvites = team.pendingInvites.filter(id => id.toString() !== req.user._id.toString());
      await team.save();
    }

    notification.isRead = true;
    notification.actionStatus = 'DECLINED';
    await notification.save();

    return successResponse(res, {}, 'Team invite rejected');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/teams/:id/nudge/:userId
 * @desc    Send pulse nudge to a teammate
 * @access  Private
 */
exports.nudgeMember = async (req, res) => {
  try {
    const { id: teamId, userId: targetUserId } = req.params;
    const { commitmentId } = req.body;
    const Notification = require('../models/Notification');
    const ioStore = require('../utils/ioStore');

    const team = await Team.findById(teamId);
    if (!team) {
      return errorResponse(res, 'Team not found', 404);
    }

    if (!team.isMember(req.user._id)) {
      return errorResponse(res, 'You are not a member of this team', 403);
    }

    if (!team.isMember(targetUserId)) {
      return errorResponse(res, 'Target user is not a member of this team', 400);
    }

    const senderName = req.user.name || 'A teammate';
    const notification = await Notification.create({
      userId: targetUserId,
      type: 'COMMITMENT_ALERT',
      message: `⚡ ${senderName} sent you a pulse nudge to check and complete your tasks in "${team.name}"!`,
      relatedTeamId: team._id,
      relatedId: commitmentId || null
    });

    const io = ioStore.getIO();
    if (io) {
      io.to(targetUserId.toString()).emit('nudge_received', {
        notification,
        teamId: team._id,
        senderName
      });
      io.to(targetUserId.toString()).emit('new_notification', notification);
    }

    return successResponse(res, { notification }, 'Nudge sent successfully!');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
