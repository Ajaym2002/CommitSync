const Notification = require('../models/Notification');
const { successResponse, errorResponse } = require('../utils/responses');

/**
 * @route   GET /api/notifications
 * @desc    Get user notifications
 * @access  Private
 */
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort('-createdAt')
      .limit(50);

    return successResponse(res, {
      count: notifications.length,
      notifications
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return errorResponse(res, 'Notification not found', 404);
    }

    return successResponse(res, { notification });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all user notifications as read
 * @access  Private
 */
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, isRead: false },
      { isRead: true }
    );

    return successResponse(res, {}, 'All notifications marked as read');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete notification manually
 * @access  Private
 */
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!notification) {
      return errorResponse(res, 'Notification not found', 404);
    }

    return successResponse(res, {}, 'Notification deleted successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
