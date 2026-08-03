/**
 * Notification Service
 * FUTURE: Will send email/SMS notifications for high-risk commitments
 * Currently: Placeholder (not implemented)
 */

class NotificationService {
  /**
   * Send high-risk alert notification
   * @param {Object} user - User object
   * @param {Object} commitment - Commitment object
   * @param {Number} riskScore - Current risk score
   */
  async sendHighRiskAlert(user, commitment, riskScore) {
    // TODO: Implement email/SMS notification
    console.log(`[NOTIFICATION] High risk alert for ${user.email}: ${commitment.title} (${riskScore}%)`);
    return { sent: false, message: 'Notifications not yet implemented' };
  }

  /**
   * Send deadline reminder
   */
  async sendDeadlineReminder(user, commitment, hoursRemaining) {
    console.log(`[NOTIFICATION] Deadline reminder for ${user.email}: ${commitment.title} (${hoursRemaining}h remaining)`);
    return { sent: false, message: 'Notifications not yet implemented' };
  }

  /**
   * Send weekly summary
   */
  async sendWeeklySummary(user, stats) {
    console.log(`[NOTIFICATION] Weekly summary for ${user.email}`);
    return { sent: false, message: 'Notifications not yet implemented' };
  }
}

module.exports = new NotificationService();