const nodemailer = require('nodemailer');

// Define email transport configuration based on environment variables
// Note: User can configure standard SMTP settings in .env
let transporter;
try {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: process.env.SMTP_PORT || 587,
    auth: {
      user: process.env.SMTP_USER || 'ethereal.user@ethereal.email',
      pass: process.env.SMTP_PASS || 'ethereal.pass'
    }
  });
} catch (error) {
  console.error("Email service initialization failed. Emails won't be sent.", error);
}

const sendEmail = async ({ to, subject, html }) => {
  if (!transporter) {
    console.warn(`[Mock Email] Would have sent email to ${to} with subject: ${subject}`);
    return false;
  }
  
  try {
    const info = await transporter.sendMail({
      from: `"CommitSync Notifications" <${process.env.SMTP_FROM || 'noreply@commitsync.app'}>`,
      to,
      subject,
      html
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

module.exports = {
  sendEmail,
  
  // Specific alert templates
  sendFriendRequestEmail: async (toEmail, fromName) => {
    return await sendEmail({
      to: toEmail,
      subject: 'New Friend Request on CommitSync',
      html: `
        <h2>Friend Request</h2>
        <p>${fromName || 'Someone'} has invited you to connect on CommitSync!</p>
        <p>Log in to view and accept the request, and start holding each other accountable.</p>
      `
    });
  },
  
  sendRiskAlertEmail: async (toEmail, commitmentTitle, ownerName) => {
    return await sendEmail({
      to: toEmail,
      subject: `High Risk Alert: ${commitmentTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
          <h2 style="color: #D35400;">⚠️ High Risk Alert</h2>
          <p>Your commitment <strong>"${commitmentTitle}"</strong> is currently at <strong style="color:#D35400;">high risk</strong> of missing its deadline.</p>
          <p>Log in to CommitSync to review your progress, connect with your accountability partners, and get back on track.</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/syncs" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#D35400;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">View Commitment</a>
          <p style="margin-top:20px;font-size:0.8rem;color:#94A3B8;">You received this because you have notifications enabled on CommitSync.</p>
        </div>
      `
    });
  },

  sendPartnerRiskAlertEmail: async (toEmail, commitmentTitle, ownerName) => {
    return await sendEmail({
      to: toEmail,
      subject: `Partner Alert: "${commitmentTitle}" is at high risk`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb; border-radius: 12px;">
          <h2 style="color: #D35400;">🤝 Accountability Partner Alert</h2>
          <p><strong>${ownerName || 'Your accountability partner'}</strong>'s commitment <strong>"${commitmentTitle}"</strong> is currently at <strong style="color:#D35400;">high risk</strong> of missing its deadline.</p>
          <p>As their accountability partner, now is a great time to reach out and offer support. A quick check-in can make a real difference.</p>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/circles" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#D35400;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Go to Circles</a>
          <p style="margin-top:20px;font-size:0.8rem;color:#94A3B8;">You received this because you are an accountability partner on CommitSync.</p>
        </div>
      `
    });
  },
  
  sendCompletionEmail: async (toEmail, commitmentTitle) => {
    return await sendEmail({
      to: toEmail,
      subject: `Commitment Completed: ${commitmentTitle}`,
      html: `
        <h2>Success!</h2>
        <p>The commitment <strong>"${commitmentTitle}"</strong> has been officially marked as completed.</p>
        <p>All associated chat logs and session data have been securely scheduled for auto-deletion.</p>
      `
    });
  }
};
