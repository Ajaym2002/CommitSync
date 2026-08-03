/**
 * Calendar Service
 * Central service for all Google Calendar operations.
 * SAFETY: All public methods are wrapped in try/catch.
 * Failures return null and log a warning — they NEVER throw to callers.
 * The risk engine proceeds normally if calendar is unavailable.
 */
const { google } = require('googleapis');
const googleAuthUtil = require('../utils/googleAuth');

class CalendarService {
  /**
   * Build an authenticated Google Calendar client for a user.
   * Returns null if the user has no stored tokens.
   */
  _getCalendarClient(user) {
    if (!user.googleAccessToken) return null;
    const tokens = {
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken
    };
    const oauth2Client = googleAuthUtil.getOAuth2Client(tokens);
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  /**
   * Check if a user has calendar access.
   */
  isCalendarConnected(user) {
    return !!(user && user.googleAccessToken && user.calendarConnected);
  }

  /**
   * Calculate free working hours between startDate and endDate.
   * Accounts for user's working hours preference (default 09:00–17:00).
   * Returns null if calendar is not available.
   *
   * @param {Object} user - User document (must have select('+googleAccessToken +googleRefreshToken'))
   * @param {Date} startDate
   * @param {Date} endDate
   * @param {Object} workingHours - { start: '09:00', end: '17:00' }
   * @returns {number|null} Free hours available, or null on failure
   */
  async getFreeHoursBetween(user, startDate, endDate, workingHours = { start: '09:00', end: '17:00' }) {
    try {
      if (!this.isCalendarConnected(user)) return null;

      const calendar = this._getCalendarClient(user);
      if (!calendar) return null;

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250
      });

      const events = response.data.items || [];

      // Count calendar events for behavioral context mining
      const eventCount = events.length;

      // Calculate total working hours in the date range
      const [startHour, startMin] = workingHours.start.split(':').map(Number);
      const [endHour, endMin] = workingHours.end.split(':').map(Number);
      const workHoursPerDay = (endHour + endMin / 60) - (startHour + startMin / 60); // e.g. 8

      const now = new Date();
      const windowStart = startDate > now ? startDate : now;
      const diffMs = endDate - windowStart;
      if (diffMs <= 0) return 0;

      const totalDays = diffMs / (1000 * 60 * 60 * 24);
      let totalWorkingHours = totalDays * workHoursPerDay;

      // Subtract time occupied by calendar events (that fall within working hours)
      let busyHours = 0;
      events.forEach(event => {
        if (!event.start) return;
        const evStart = new Date(event.start.dateTime || event.start.date);
        const evEnd = new Date(event.end?.dateTime || event.end?.date || evStart);
        const durationHours = (evEnd - evStart) / (1000 * 60 * 60);

        // Only count if the event overlaps working hours (rough check)
        const evHour = evStart.getHours();
        if (evHour >= startHour && evHour < endHour) {
          busyHours += Math.min(durationHours, workHoursPerDay);
        }
      });

      const freeHours = Math.max(0, totalWorkingHours - busyHours);

      return { freeHours: Math.round(freeHours * 10) / 10, eventCount };
    } catch (error) {
      console.warn('[CalendarService] getFreeHoursBetween failed:', error.message);
      return null;
    }
  }

  /**
   * Find the next available free slot of minDurationHours within the next 7 days.
   * Respects user's working hours.
   * Returns null if no slot found or calendar unavailable.
   *
   * @returns {{ start: Date, end: Date }|null}
   */
  async findNextFreeSlot(user, minDurationHours = 2, workingHours = { start: '09:00', end: '17:00' }) {
    try {
      if (!this.isCalendarConnected(user)) return null;

      const calendar = this._getCalendarClient(user);
      if (!calendar) return null;

      const now = new Date();
      const searchEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: searchEnd.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100
      });

      const events = (response.data.items || []).map(e => ({
        start: new Date(e.start.dateTime || e.start.date),
        end: new Date(e.end?.dateTime || e.end?.date || e.start.dateTime || e.start.date)
      })).sort((a, b) => a.start - b.start);

      const [startHour, startMin] = workingHours.start.split(':').map(Number);
      const [endHour, endMin] = workingHours.end.split(':').map(Number);

      // Iterate day by day looking for a free slot
      for (let d = 0; d < 7; d++) {
        const dayStart = new Date(now);
        dayStart.setDate(dayStart.getDate() + d);
        dayStart.setHours(startHour, startMin, 0, 0);

        const dayEnd = new Date(dayStart);
        dayEnd.setHours(endHour, endMin, 0, 0);

        // Start looking from now (not earlier in the day)
        let slotStart = dayStart < now ? new Date(now.getTime() + 5 * 60 * 1000) : dayStart;
        if (slotStart >= dayEnd) continue;

        // Filter events for this day
        const dayEvents = events.filter(e => e.start < dayEnd && e.end > slotStart);

        for (const event of dayEvents) {
          // Check gap before this event
          if (event.start > slotStart) {
            const gapHours = (event.start - slotStart) / (1000 * 60 * 60);
            if (gapHours >= minDurationHours) {
              return { start: slotStart, end: new Date(slotStart.getTime() + minDurationHours * 60 * 60 * 1000) };
            }
          }
          // Move past this event
          if (event.end > slotStart) slotStart = new Date(event.end);
          if (slotStart >= dayEnd) break;
        }

        // Check remaining time after last event
        const remainingHours = (dayEnd - slotStart) / (1000 * 60 * 60);
        if (remainingHours >= minDurationHours && slotStart < dayEnd) {
          return { start: slotStart, end: new Date(slotStart.getTime() + minDurationHours * 60 * 60 * 1000) };
        }
      }

      return null; // No free slot found in next 7 days
    } catch (error) {
      console.warn('[CalendarService] findNextFreeSlot failed:', error.message);
      return null;
    }
  }

  /**
   * Create a "Focus Session" event in the user's primary calendar.
   * @param {Object} user
   * @param {Object} commitment - { title, _id }
   * @param {{ start: Date, end: Date }} slot
   * @param {string} timezone
   * @returns {{ eventLink: string, eventId: string }|null}
   */
  async createFocusSessionEvent(user, commitment, slot, timezone = 'UTC') {
    try {
      if (!this.isCalendarConnected(user)) return null;

      const calendar = this._getCalendarClient(user);
      if (!calendar) return null;

      const event = {
        summary: `🎯 Focus Session: ${commitment.title}`,
        description: `Focused work block created by CommitSync for commitment: "${commitment.title}".\n\nStay on task — you've got this!`,
        start: { dateTime: slot.start.toISOString(), timeZone: timezone },
        end: { dateTime: slot.end.toISOString(), timeZone: timezone },
        colorId: '2', // Sage (Light Green)
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 15 }
          ]
        }
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: event
      });

      return {
        eventLink: response.data.htmlLink,
        eventId: response.data.id
      };
    } catch (error) {
      console.warn('[CalendarService] createFocusSessionEvent failed:', error.message);
      return null;
    }
  }

  /**
   * Create a "Busy / DND" block in the user's calendar for a focus session.
   * @param {Object} user
   * @param {Object} commitment - { title }
   * @param {number} durationHours
   * @param {string} timezone
   * @returns {{ eventLink: string, endsAt: Date }|null}
   */
  async createBusyBlock(user, commitment, durationHours = 2, timezone = 'UTC') {
    try {
      if (!this.isCalendarConnected(user)) return null;

      const calendar = this._getCalendarClient(user);
      if (!calendar) return null;

      const now = new Date();
      const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

      const event = {
        summary: `⛔ Busy — Focus Mode (CommitSync)`,
        description: `${user.name || 'User'} is in focus mode working on "${commitment.title}". Please avoid interruptions.`,
        start: { dateTime: now.toISOString(), timeZone: timezone },
        end: { dateTime: endsAt.toISOString(), timeZone: timezone },
        status: 'busy',
        visibility: 'public',
        colorId: '11', // Tomato
        reminders: { useDefault: false, overrides: [] }
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: event
      });

      return {
        eventLink: response.data.htmlLink,
        eventId: response.data.id,
        endsAt
      };
    } catch (error) {
      console.warn('[CalendarService] createBusyBlock failed:', error.message);
      return null;
    }
  }
  /**
   * Get user's calendar events within a given time range.
   * @param {Object} user 
   * @param {Date} startDate 
   * @param {Date} endDate 
   * @returns {Array|null} Array of events or null on failure
   */
  async getUserEvents(user, startDate, endDate) {
    try {
      if (!this.isCalendarConnected(user)) return null;

      const calendar = this._getCalendarClient(user);
      if (!calendar) return null;

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250
      });

      return (response.data.items || []).map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end?.dateTime || e.end?.date || e.start.dateTime || e.start.date,
        colorId: e.colorId
      }));
    } catch (error) {
      console.warn('[CalendarService] getUserEvents failed:', error.message);
      return null;
    }
  }
}

module.exports = new CalendarService();
