const nodemailer = require('nodemailer');

/**
 * Creates and configures the nodemailer transporter.
 * It uses environment variables for configuration.
 */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 465,
    secure: process.env.SMTP_SECURE === 'true' || true, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

/**
 * Sends an email
 * @param {Object} options - Email options
 * @param {String} options.to - Recipient email address
 * @param {String} options.subject - Email subject
 * @param {String} options.text - Plain text body
 * @param {String} options.html - HTML body (optional)
 * @returns {Promise} Resolves when email is sent
 */
const sendEmail = async (options) => {
  // If SMTP is not configured, we'll log it instead of failing (useful for development before the user configures it)
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('\n=============================================');
    console.warn('WARNING: SMTP_USER or SMTP_PASS not configured.');
    console.warn('Simulating email send. OTP will not be delivered.');
    console.warn('To: ', options.to);
    console.warn('Subject: ', options.subject);
    console.warn('Text: ', options.text);
    console.warn('=============================================\n');
    return true; // Simulate success
  }

  const transporter = createTransporter();

  const mailOptions = {
    from: `"CommitSync" <${process.env.SMTP_USER}>`,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

module.exports = {
  sendEmail,
};
