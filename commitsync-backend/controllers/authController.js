/**
 * Authentication Controller
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config/config');
const { successResponse, errorResponse } = require('../utils/responses');
const googleAuthUtil = require('../utils/googleAuth');
const { seedInitialTemplates } = require('../utils/templateSeeder');
const { sendEmail } = require('../utils/emailService');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, config.jwt.secret, {
    expiresIn: config.jwt.expire
  });
};

/**
 * @route   POST /api/auth/register
 * @desc    Register new user
 * @access  Public
 */
exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Check if user exists
    let existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.isVerified) {
        return errorResponse(res, 'User already exists', 400);
      }
      
      // Update existing unverified user
      existingUser.name = name;
      existingUser.password = password; // password will be hashed by pre-save hook
      existingUser.otp = otp;
      existingUser.otpExpiry = otpExpiry;
      await existingUser.save();
    } else {
      // Create user
      await User.create({
        email,
        password,
        name,
        isVerified: false,
        otp,
        otpExpiry
      });
    }

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'CommitSync - Your OTP Verification Code',
      text: `Hello ${name},\n\nYour OTP for registration is: ${otp}\nIt is valid for 10 minutes.\n\nThanks,\nCommitSync Team`
    });

    return successResponse(res, { awaitingOtp: true, email }, 'OTP sent to your email', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP for registration
 * @access  Public
 */
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select('+otp +otpExpiry');
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    if (user.isVerified) {
      return errorResponse(res, 'User is already verified', 400);
    }

    if (user.otp !== otp) {
      return errorResponse(res, 'Invalid OTP', 400);
    }

    if (user.otpExpiry < new Date()) {
      return errorResponse(res, 'OTP has expired', 400);
    }

    // Mark as verified and clear OTP
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    // Seed default templates for the new user
    await seedInitialTemplates(user._id);

    // Generate token
    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        behavioralProfile: user.behavioralProfile,
        preferences: user.preferences
      }
    }, 'Email verified and registered successfully', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend OTP
 * @access  Public
 */
exports.resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.isVerified) {
      return errorResponse(res, 'User is already verified', 400);
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'CommitSync - Your New OTP Verification Code',
      text: `Hello ${user.name},\n\nYour new OTP for registration is: ${otp}\nIt is valid for 10 minutes.\n\nThanks,\nCommitSync Team`
    });

    return successResponse(res, null, 'New OTP sent to your email', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send OTP for forgot password
 * @access  Public
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return errorResponse(res, 'User not found with this email', 404);
    }

    if (!user.password && user.googleId) {
       return errorResponse(res, 'This account uses Google login. Please sign in with Google.', 400);
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    // Send OTP email
    await sendEmail({
      to: email,
      subject: 'CommitSync - Password Reset OTP',
      text: `Hello ${user.name},\n\nYour OTP for resetting your password is: ${otp}\nIt is valid for 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\nThanks,\nCommitSync Team`
    });

    return successResponse(res, null, 'Password reset OTP sent to your email', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/auth/verify-reset-otp
 * @desc    Verify OTP before showing reset password input
 * @access  Public
 */
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select('+otp +otpExpiry');
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.otp !== otp) {
      return errorResponse(res, 'Invalid OTP', 400);
    }

    if (user.otpExpiry < new Date()) {
      return errorResponse(res, 'OTP has expired', 400);
    }

    return successResponse(res, null, 'OTP verified successfully', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/auth/reset-password
 * @desc    Verify OTP and reset password
 * @access  Public
 */
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({ email }).select('+otp +otpExpiry +password');
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (user.otp !== otp) {
      return errorResponse(res, 'Invalid OTP', 400);
    }

    if (user.otpExpiry < new Date()) {
      return errorResponse(res, 'OTP has expired', 400);
    }

    // Update password
    user.password = newPassword;
    // Clear OTP
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    // Generate token for auto-login
    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        behavioralProfile: user.behavioralProfile,
        preferences: user.preferences
      }
    }, 'Password reset successfully', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return errorResponse(res, 'Please provide email and password', 400);
    }

    // Get user with password
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    // Check password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    // Check if verified - Removed per user request to bypass verification on login
    // if (!user.isVerified) {
    //   return res.status(403).json({
    //     success: false,
    //     error: { message: 'Please verify your email to continue', needsVerification: true, email: user.email }
    //   });
    // }

    // Generate token
    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        behavioralProfile: user.behavioralProfile,
        preferences: user.preferences
      }
    }, 'Login successful');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   GET /api/auth/google
 * @desc    Initiate Google OAuth2
 * @access  Public
 */
exports.googleAuth = (req, res) => {
  const token = req.query.token;
  const url = googleAuthUtil.getAuthUrl(token);
  res.redirect(url);
};

/**
 * @route   GET /api/auth/google/callback
 * @desc    Google OAuth2 Callback
 * @access  Public
 */
exports.googleCallback = async (req, res) => {
  let origin = process.env.CORS_ORIGIN || 'https://commit-sync-one.vercel.app';

  try {
    const { code, state } = req.query;
    if (!code) {
      return res.redirect(`${origin}/auth/google/error?message=No_authorization_code_received`);
    }

    // Exchange code for tokens
    const tokens = await googleAuthUtil.getTokens(code);

    // Get Google profile
    const googleUser = await googleAuthUtil.getUserInfo(tokens);
    const googleEmail = (googleUser.email || '').toLowerCase().trim();

    if (!googleEmail) {
      return res.redirect(`${origin}/auth/google/error?message=Google_did_not_return_an_email`);
    }

    // Extract potential user ID from state token
    let userId = null;
    if (state) {
      try {
        const decoded = jwt.verify(state, config.jwt.secret);
        userId = decoded.id;
      } catch (err) {
        console.warn('Invalid state token during Google OAuth');
      }
    }

    // ── Find or create user ────────────────────────────────────────────────────
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }
    
    // Fallback: Case-insensitive email match
    if (!user) {
      user = await User.findOne({ email: { $regex: new RegExp(`^${googleEmail}$`, 'i') } });
    }

    if (user) {
      // Handle potential duplicate key error if an empty account already holds this Google ID
      if (user.googleId !== googleUser.id) {
        const duplicate = await User.findOne({ googleId: googleUser.id });
        if (duplicate && duplicate._id.toString() !== user._id.toString()) {
          duplicate.googleId = undefined;
          duplicate.googleAccessToken = undefined;
          duplicate.googleRefreshToken = undefined;
          duplicate.calendarConnected = false;
          await duplicate.save();
        }
      }

      // Existing account — safely update OAuth tokens & mark calendar connected.
      user.googleId = googleUser.id;
      if (tokens.access_token)  user.googleAccessToken  = tokens.access_token;
      if (tokens.refresh_token) user.googleRefreshToken = tokens.refresh_token;
      user.calendarConnected = true;
      await user.save();
    } else {
      // Truly new user signing in via Google for the first time.
      user = await User.create({
        email: googleEmail,
        name: googleUser.name || 'New User',
        googleId: googleUser.id,
        googleAccessToken:  tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        calendarConnected: true,
        isVerified: true
      });
      await seedInitialTemplates(user._id);
    }

    const jwtToken = generateToken(user._id);
    res.redirect(`${origin}/auth/google/success?token=${jwtToken}`);
  } catch (error) {
    console.error('[googleCallback] Error:', error.message || error);
    res.redirect(`${origin}/auth/google/error?message=Authentication_failed_please_try_again`);
  }
};

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+password');

    return successResponse(res, {
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        behavioralProfile: user.behavioralProfile,
        preferences: user.preferences,
        calendarConnected: user.calendarConnected || false,
        focusMode: user.focusMode,
        createdAt: user.createdAt,
        hasPassword: !!user.password,
        isGoogleUser: !!user.googleId
      }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/auth/settings
 * @desc    Update user settings (profile, brain, physics)
 * @access  Private
 */
exports.updateSettings = async (req, res) => {
  try {
    const { name, aiPersona, riskSensitivity, workingHours, maxSustainableWorkload } = req.body;

    const user = await User.findById(req.user._id);

    if (name) user.name = name;
    
    if (aiPersona) user.preferences.aiPersona = aiPersona;
    if (riskSensitivity) user.preferences.riskSensitivity = riskSensitivity;
    if (workingHours) {
      if (workingHours.start) user.preferences.workingHours.start = workingHours.start;
      if (workingHours.end) user.preferences.workingHours.end = workingHours.end;
    }
    
    if (maxSustainableWorkload) {
      user.behavioralProfile.maxSustainableWorkload = maxSustainableWorkload;
    }

    await user.save();

    return successResponse(res, {
      user: {
        id: user._id,
        name: user.name,
        preferences: user.preferences,
        behavioralProfile: user.behavioralProfile
      }
    }, 'Settings updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/auth/password
 * @desc    Change user password
 * @access  Private
 */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return errorResponse(res, 'Please provide both current and new passwords', 400);
    }
    
    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    
    if (!user.password) {
      return errorResponse(res, 'Account was created with Google. Password cannot be changed.', 400);
    }

    const isMatch = await user.comparePassword(currentPassword);
    
    if (!isMatch) {
      return errorResponse(res, 'Incorrect current password', 400);
    }
    
    user.password = newPassword;
    await user.save();
    
    return successResponse(res, null, 'Password updated successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   DELETE /api/auth/account
 * @desc    Delete user account and all associated data
 * @access  Private
 */
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    // Delete associated data
    const mongoose = require('mongoose');
    await mongoose.model('Commitment').deleteMany({ userId });
    await mongoose.model('RiskSnapshot').deleteMany({ userId });
    await mongoose.model('Notification').deleteMany({ 
      $or: [{ userId }, { senderId: userId }] 
    });
    
    // Delete user
    await User.findByIdAndDelete(userId);

    return successResponse(res, null, 'Account deleted successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
