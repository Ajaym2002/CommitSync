/**
 * Authentication Middleware
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config/config');

exports.protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Get user from token
    try {
      req.user = await User.findById(decoded.id);
    } catch (dbError) {
      console.error('Database error in auth middleware:', dbError.message);
      return res.status(500).json({
        success: false,
        error: 'Database connection error'
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized to access this route'
    });
  }
};

// Check if user is team admin
exports.requireTeamAdmin = async (req, res, next) => {
  const Team = require('../models/Team');
  const teamId = req.params.teamId || req.body.teamId;

  if (!teamId) {
    return res.status(400).json({
      success: false,
      error: 'Team ID is required'
    });
  }

  try {
    const team = await Team.findById(teamId);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found'
      });
    }

    if (!team.isAdmin(req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Only team admins can perform this action'
      });
    }

    req.team = team;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};