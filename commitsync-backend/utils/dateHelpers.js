/**
 * Date Helper Utilities
 */

/**
 * Calculate days between two dates
 */
const daysBetween = (date1, date2) => {
  const oneDay = 24 * 60 * 60 * 1000;
  const firstDate = new Date(date1);
  const secondDate = new Date(date2);
  return Math.round(Math.abs((firstDate - secondDate) / oneDay));
};

/**
 * Check if date is in the past
 */
const isPast = (date) => {
  return new Date(date) < new Date();
};

/**
 * Check if date is in the future
 */
const isFuture = (date) => {
  return new Date(date) > new Date();
};

/**
 * Format date to ISO string
 */
const toISOString = (date) => {
  return new Date(date).toISOString();
};

/**
 * Get days until deadline
 */
const daysUntilDeadline = (deadline) => {
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const diffTime = deadlineDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Check if deadline is within X days
 */
const isDeadlineNear = (deadline, days = 7) => {
  const daysUntil = daysUntilDeadline(deadline);
  return daysUntil >= 0 && daysUntil <= days;
};

module.exports = {
  daysBetween,
  isPast,
  isFuture,
  toISOString,
  daysUntilDeadline,
  isDeadlineNear
};