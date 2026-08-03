const axios = require('axios');

/**
 * Service to generate AI insights based on user analytics
 */
class AiInsightsService {
  constructor() {
    // Initialize Groq API if key is available
    if (process.env.GROQ_API_KEY) {
      this.apiKey = process.env.GROQ_API_KEY;
      this.model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
      this.isAvailable = true;
    } else {
      console.warn('GROQ_API_KEY is not set. AI Insights will be disabled.');
      this.isAvailable = false;
    }
  }

  /**
   * Generates a personalized insight and recommendation
   * @param {Object} userData - User's statistical data
   * @returns {Object} - Insight and recommendation
   */
  async generateInsight(userData) {
    if (!this.isAvailable) {
      return {
        insight: "Your AI productivity coach is currently offline.",
        recommendation: "Please add a Groq API key to your environment variables to enable personalized insights.",
        persona: userData.behavioralProfile?.behavioralPattern || "MIXED"
      };
    }

    try {
      const prompt = `
        You are a personal productivity coach speaking directly to the user. Use 'you' and 'your' in your response. Do NOT use third-person phrasing like 'The user'.
        Analyze the following data for the user in a task management system and provide:
        1. A brief, impactful insight (1-2 sentences) about their current habits addressing them directly.
        2. A highly actionable recommendation (1-2 sentences) to improve their on-time completion rate or reduce their risk, speaking directly to them.
        3. A persona label categorizing their behavior (one of: STEADY_PERFORMER, OPTIMISTIC_SCHEDULER, LAST_MINUTE_SPRINTER, SCOPE_CREEPER, MIXED).

        User Data:
        - Overall Completion Rate: ${userData.completionRate}%
        - Best Time of Day to Work: ${userData.bestZone || 'Unknown'}
        - Total Commitments Completed: ${userData.completedCommitments}
        - Total Commitments Missed: ${userData.missedCount || 0}
        - Active Commitments: ${userData.activeCount || 0}
        - Rescheduled Count: ${userData.rescheduledCount || 0}
        - Average Risk Score of Active Commitments: ${userData.avgRisk || 0} / 100
        - Behavioral Pattern: ${userData.behavioralProfile?.behavioralPattern || 'MIXED'}
        ${userData.calendarCorrelation ? `- Calendar Density Impact: ${userData.calendarCorrelation}` : ''}

        Format your response as a JSON object with strictly these keys:
        - "insight": The impactful insight.
        - "recommendation": The actionable recommendation.
        - "persona": The persona label from the allowed list.
      `;

      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const resultText = response.data?.choices?.[0]?.message?.content;
      try {
        const parsedResult = JSON.parse(resultText);
        return {
          insight: parsedResult.insight,
          recommendation: parsedResult.recommendation,
          persona: userData.behavioralProfile?.behavioralPattern || "MIXED"
        };
      } catch (parseError) {
        console.error('Failed to parse Groq response as JSON:', resultText);
        return {
          insight: "We noticed some interesting patterns in your recent work.",
          recommendation: "Try to maintain your current pace and re-evaluate your active commitments.",
          persona: userData.behavioralProfile?.behavioralPattern || "MIXED"
        };
      }
    } catch (error) {
      console.error('Error calling Groq API:', error?.response?.data || error.message);
      return {
        insight: "We couldn't analyze your data right now due to a network issue.",
        recommendation: "Please check back later for your personalized productivity insights.",
        persona: userData.behavioralProfile?.behavioralPattern || "MIXED"
      };
    }
  }
}

module.exports = new AiInsightsService();
