const Template = require('../models/Template');

const DEFAULT_TEMPLATES = [
  {
    name: 'Plan a Vacation',
    category: 'Personal',
    risk: 'Overspending or disorganized travel plans',
    reward: 'A relaxing and well-organized trip',
    subTasks: [
      { title: 'Research destinations and book flights', estimatedHours: 3, priority: 'HIGH' },
      { title: 'Book accommodation', estimatedHours: 2, priority: 'HIGH' },
      { title: 'Plan daily itinerary and activities', estimatedHours: 4, priority: 'MEDIUM' },
      { title: 'Pack luggage and prepare travel documents', estimatedHours: 2, priority: 'LOW' }
    ]
  },
  {
    name: 'Launch a New Project',
    category: 'Work',
    risk: 'Missing deadlines and poor execution',
    reward: 'Successful project delivery and team recognition',
    subTasks: [
      { title: 'Define project scope and requirements', estimatedHours: 4, priority: 'HIGH' },
      { title: 'Create project timeline and allocate resources', estimatedHours: 3, priority: 'HIGH' },
      { title: 'Kick-off meeting with stakeholders', estimatedHours: 1, priority: 'MEDIUM' },
      { title: 'Execute first sprint phase', estimatedHours: 8, priority: 'HIGH' }
    ]
  },
  {
    name: 'Trek to Everest Base Camp',
    category: 'Adventure',
    risk: 'Altitude sickness and physical exhaustion',
    reward: 'Reaching the base of the highest mountain in the world',
    subTasks: [
      { title: 'Start physical training and cardio', estimatedHours: 40, priority: 'HIGH' },
      { title: 'Purchase trekking gear and equipment', estimatedHours: 5, priority: 'HIGH' },
      { title: 'Book flights and secure permits', estimatedHours: 2, priority: 'MEDIUM' },
      { title: 'Research altitude sickness prevention', estimatedHours: 2, priority: 'LOW' }
    ]
  },
  {
    name: 'Prepare for Final Exams',
    category: 'Study',
    risk: 'Failing the exams or getting a low grade',
    reward: 'Passing with high marks and securing the degree',
    subTasks: [
      { title: 'Create a study schedule for all subjects', estimatedHours: 2, priority: 'HIGH' },
      { title: 'Review lecture notes and textbooks', estimatedHours: 20, priority: 'HIGH' },
      { title: 'Complete past exam papers', estimatedHours: 10, priority: 'MEDIUM' },
      { title: 'Group study sessions and revisions', estimatedHours: 5, priority: 'LOW' }
    ]
  },
  {
    name: 'Learn a New Language',
    category: 'Self Improvement',
    risk: 'Losing motivation and forgetting vocabulary',
    reward: 'Fluency and the ability to converse with native speakers',
    subTasks: [
      { title: 'Enroll in an online language course', estimatedHours: 1, priority: 'HIGH' },
      { title: 'Practice daily vocabulary for 30 minutes', estimatedHours: 15, priority: 'HIGH' },
      { title: 'Watch foreign movies with subtitles', estimatedHours: 10, priority: 'MEDIUM' },
      { title: 'Practice speaking with a language partner', estimatedHours: 5, priority: 'MEDIUM' }
    ]
  },
  {
    name: 'Marathon Training',
    category: 'Health',
    risk: 'Running injuries and fatigue',
    reward: 'Completing a 42km marathon',
    subTasks: [
      { title: 'Create a 12-week running plan', estimatedHours: 1, priority: 'HIGH' },
      { title: 'Purchase proper running shoes', estimatedHours: 2, priority: 'HIGH' },
      { title: 'Run 3 times a week (short distances)', estimatedHours: 20, priority: 'HIGH' },
      { title: 'Complete a weekly long run', estimatedHours: 24, priority: 'MEDIUM' }
    ]
  },
  {
    name: 'Save for a House Deposit',
    category: 'Finance',
    risk: 'Overspending and delaying home ownership',
    reward: 'Securing a mortgage and buying a home',
    subTasks: [
      { title: 'Create a monthly budget and track expenses', estimatedHours: 3, priority: 'HIGH' },
      { title: 'Set up an automatic savings transfer', estimatedHours: 1, priority: 'HIGH' },
      { title: 'Review and cut unnecessary subscriptions', estimatedHours: 2, priority: 'MEDIUM' },
      { title: 'Research mortgage rates and options', estimatedHours: 4, priority: 'LOW' }
    ]
  },
  {
    name: 'My Custom Template',
    category: 'My Templates',
    risk: 'Failing to reach the custom goal',
    reward: 'Achieving exactly what I set out to do',
    subTasks: [
      { title: 'Define the first step', estimatedHours: 1, priority: 'HIGH' },
      { title: 'Define the second step', estimatedHours: 1, priority: 'MEDIUM' },
      { title: 'Define the final step', estimatedHours: 1, priority: 'LOW' }
    ]
  }
];

/**
 * Seeds the default templates for a newly registered user
 * @param {ObjectId} userId - The ID of the newly created user
 */
const seedInitialTemplates = async (userId) => {
  try {
    const templatesToInsert = DEFAULT_TEMPLATES.map(template => ({
      ...template,
      userId
    }));

    await Template.insertMany(templatesToInsert);
    console.log(`Seeded default templates for user ${userId}`);
  } catch (error) {
    console.error(`Failed to seed templates for user ${userId}:`, error);
    // We don't throw here to prevent blocking the user registration flow if seeding fails
  }
};

module.exports = {
  seedInitialTemplates
};
