/**
 * Template Matcher Service
 *
 * Strategy (in order of priority):
 *  1. Groq LLM  — dynamic, context-aware subtask generation from the title
 *  2. User history — their own past commitments with subtasks (text search)
 *  3. User templates — manually saved template library
 *  4. Static fallback — hardcoded templates keyed by inferred category
 */

const axios = require('axios');
const Commitment = require('../models/Commitment');
const Template = require('../models/Template');

// ─────────────────────────────────────────────────────────────────────────────
// GROQ CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// STATIC FALLBACK LIBRARY (used when Groq is unavailable / no key set)
// Universal life categories — not just tech/work.
// ─────────────────────────────────────────────────────────────────────────────
const STATIC_TEMPLATES = {

  travel: [
    { title: 'Research destination — attractions, weather, local customs', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Book flights / transport tickets', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Book accommodation (hotels, Airbnb, etc.)', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Plan itinerary day-by-day', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Pack bags and prepare travel essentials', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Arrange travel insurance and documents (visa, passport check)', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Inform bank and set up travel budget', estimatedHours: 1, priority: 'LOW' }
  ],

  event_planning: [
    { title: 'Finalize guest list and send invitations', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Book venue or prepare the location', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Plan menu and arrange food / catering', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Organize decorations and theme setup', estimatedHours: 3, priority: 'MEDIUM' },
    { title: 'Arrange entertainment or activities', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Shop for supplies and gifts', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Follow up on RSVPs and do a final headcount', estimatedHours: 1, priority: 'LOW' }
  ],

  fitness: [
    { title: 'Set clear fitness goals and baseline measurements', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Design weekly workout plan', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Plan a balanced diet / meal prep routine', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Schedule rest and recovery days', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Track progress — weight, reps, endurance metrics', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Review and adjust the plan at week 2 and week 4', estimatedHours: 1, priority: 'LOW' }
  ],

  exam: [
    { title: 'Gather all study materials and syllabus', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Create a structured study timetable', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Read and understand core concepts', estimatedHours: 6, priority: 'HIGH' },
    { title: 'Make concise revision notes or mind maps', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Solve past papers / practice questions', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Final revision — weak areas focus', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Prepare essentials for exam day', estimatedHours: 1, priority: 'MEDIUM' }
  ],

  assignment: [
    { title: 'Read and understand the assignment brief / rubric', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Research and gather relevant sources', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Create an outline / structure', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Write the first draft', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Review, edit and proofread', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Format references / citations', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Submit and confirm receipt', estimatedHours: 0.5, priority: 'HIGH' }
  ],

  learning: [
    { title: 'Define what success looks like — set a clear goal', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Find the best resources (courses, books, YouTube, etc.)', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Complete beginner / foundational module', estimatedHours: 5, priority: 'HIGH' },
    { title: 'Practice daily — build a consistent habit', estimatedHours: 6, priority: 'HIGH' },
    { title: 'Work on a small real project or apply the skill', estimatedHours: 4, priority: 'MEDIUM' },
    { title: 'Review weak spots and seek feedback', estimatedHours: 2, priority: 'MEDIUM' }
  ],

  language: [
    { title: 'Choose a learning method (app, tutor, classes)', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Learn essential vocabulary — 500 words', estimatedHours: 5, priority: 'HIGH' },
    { title: 'Study basic grammar and sentence structure', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Practice speaking with a native speaker or AI tutor', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Watch shows / listen to podcasts in the target language', estimatedHours: 3, priority: 'MEDIUM' },
    { title: 'Take a progress assessment or mini-test', estimatedHours: 1, priority: 'MEDIUM' }
  ],

  sports: [
    { title: 'Define performance target for the event / season', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Create a structured training schedule', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Strength and conditioning sessions', estimatedHours: 6, priority: 'HIGH' },
    { title: 'Skill-specific drills and practice', estimatedHours: 5, priority: 'HIGH' },
    { title: 'Nutrition and hydration planning', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Recovery — sleep, stretching, physiotherapy', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Mental preparation and visualization techniques', estimatedHours: 1, priority: 'LOW' }
  ],

  cultural: [
    { title: 'Learn or rehearse the performance material', estimatedHours: 6, priority: 'HIGH' },
    { title: 'Arrange costume, props or required materials', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Conduct full run-through / dress rehearsal', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Coordinate with co-performers or team', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Prepare logistics — venue, audience, sound setup', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Final mental prep and confidence boost', estimatedHours: 1, priority: 'LOW' }
  ],

  home: [
    { title: 'Define scope and desired outcome', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Research what is needed (materials, tools, budget)', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Purchase supplies and materials', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Execute the main task / renovation / cleanup', estimatedHours: 6, priority: 'HIGH' },
    { title: 'Review the result and fix any issues', estimatedHours: 2, priority: 'MEDIUM' }
  ],

  reading: [
    { title: 'Decide on the book and set a reading schedule', estimatedHours: 0.5, priority: 'MEDIUM' },
    { title: 'Read and highlight key ideas (Part 1)', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Read and highlight key ideas (Part 2)', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Write a personal summary / key takeaways', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Reflect and decide on one actionable thing to implement', estimatedHours: 0.5, priority: 'LOW' }
  ],

  family: [
    { title: 'Plan the time and ensure everyone is available', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Organize activities and agenda', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Arrange food, transport or logistics', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Prepare personalized touches (gifts, stories, memories)', estimatedHours: 2, priority: 'MEDIUM' },
    { title: 'Capture memories — photos and videos', estimatedHours: 1, priority: 'LOW' }
  ],

  shopping: [
    { title: 'Create a detailed shopping list', estimatedHours: 0.5, priority: 'HIGH' },
    { title: 'Research options and compare prices', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Set a budget', estimatedHours: 0.5, priority: 'MEDIUM' },
    { title: 'Purchase items (online or in-store)', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Verify delivery / inspect items on arrival', estimatedHours: 0.5, priority: 'LOW' }
  ],

  financial: [
    { title: 'Define the financial goal and target amount', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Audit current income and expenses', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Create a monthly savings / investment plan', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Cut unnecessary expenses', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Set up automated transfers or reminders', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Review progress at month end', estimatedHours: 1, priority: 'LOW' }
  ],

  career: [
    { title: 'Update resume / CV and LinkedIn profile', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Research target companies and roles', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Apply to positions and track applications', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Prepare for interviews — practice common questions', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Follow up on applications / network with professionals', estimatedHours: 2, priority: 'MEDIUM' }
  ],

  health: [
    { title: 'Schedule appointment with doctor / specialist', estimatedHours: 0.5, priority: 'HIGH' },
    { title: 'Gather medical history and relevant documents', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Follow prescribed treatment / medication plan', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Track symptoms and progress in a journal', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Follow-up appointment and review', estimatedHours: 1, priority: 'MEDIUM' }
  ],

  wellbeing: [
    { title: 'Identify the current challenge or stressor', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Establish a daily mindfulness or journaling routine', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Seek support — talk to a friend, counselor, or therapist', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Reduce screen time and improve sleep schedule', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Add a physical activity or outdoor time each day', estimatedHours: 2, priority: 'MEDIUM' }
  ],

  volunteering: [
    { title: 'Research volunteering opportunities and causes', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Register and complete onboarding / training', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Schedule volunteering sessions', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Participate and contribute actively', estimatedHours: 5, priority: 'HIGH' },
    { title: 'Reflect on impact and share experience', estimatedHours: 1, priority: 'LOW' }
  ],

  creative: [
    { title: 'Brainstorm and capture ideas freely', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Define scope and choose a style / direction', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Create the first draft / prototype / sketch', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Refine and improve — second iteration', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Get feedback from others', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Finalize and share / publish / display', estimatedHours: 2, priority: 'MEDIUM' }
  ],

  diet: [
    { title: 'Set a clear nutrition / weight goal', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Research a suitable diet plan', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Clear unhealthy foods and stock healthy ones', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Meal prep for the week', estimatedHours: 3, priority: 'HIGH' },
    { title: 'Track food intake daily', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Weekly weigh-in and adjust plan if needed', estimatedHours: 0.5, priority: 'LOW' }
  ],

  research: [
    { title: 'Define research question and scope', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Literature / background review', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Data gathering and sourcing', estimatedHours: 5, priority: 'HIGH' },
    { title: 'Analysis and synthesis of findings', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Write up conclusions / report', estimatedHours: 3, priority: 'MEDIUM' }
  ],

  coding: [
    { title: 'Requirements gathering and planning', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Set up development environment', estimatedHours: 1, priority: 'LOW' },
    { title: 'Design architecture and data models', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Implementation — core features', estimatedHours: 8, priority: 'HIGH' },
    { title: 'Testing and debugging', estimatedHours: 3, priority: 'MEDIUM' },
    { title: 'Documentation and deployment', estimatedHours: 2, priority: 'LOW' }
  ],

  work: [
    { title: 'Clarify objectives and success criteria', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Gather necessary information and resources', estimatedHours: 2, priority: 'HIGH' },
    { title: 'Break into milestones and assign tasks', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Execute the main deliverable', estimatedHours: 6, priority: 'HIGH' },
    { title: 'Review quality and get stakeholder sign-off', estimatedHours: 2, priority: 'HIGH' }
  ],

  other: [
    { title: 'Define the goal clearly and write it down', estimatedHours: 0.5, priority: 'HIGH' },
    { title: 'Break it down — list all steps needed', estimatedHours: 1, priority: 'HIGH' },
    { title: 'Gather everything you need before starting', estimatedHours: 1, priority: 'MEDIUM' },
    { title: 'Execute the main work', estimatedHours: 4, priority: 'HIGH' },
    { title: 'Review the result and finalize', estimatedHours: 1, priority: 'MEDIUM' }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD → CATEGORY (fallback inference when Groq is unavailable)
// ─────────────────────────────────────────────────────────────────────────────
const KEYWORD_RULES = [
  { category: 'travel',        keywords: ['trip', 'travel', 'tour', 'visit', 'vacation', 'holiday', 'journey', 'flight', 'cruise', 'backpack', 'road trip', 'abroad', 'overseas'] },
  { category: 'event_planning',keywords: ['party', 'birthday', 'wedding', 'anniversary', 'festival', 'celebration', 'gathering', 'reunion', 'farewell', 'baby shower', 'bridal', 'function', 'ceremony', 'reception', 'potluck', 'housewarming'] },
  { category: 'exam',          keywords: ['exam', 'test', 'quiz', 'study', 'revise', 'revision', 'board exam', 'finals', 'midterm', 'entrance', 'jee', 'neet', 'ielts', 'toefl', 'sat', 'gre', 'gmat', 'upsc', 'gate', 'competitive exam', 'mock test', 'certification exam'] },
  { category: 'assignment',    keywords: ['assignment', 'homework', 'project report', 'thesis', 'dissertation', 'essay', 'submit', 'submission', 'coursework', 'term paper', 'lab report'] },
  { category: 'language',      keywords: ['language', 'spanish', 'french', 'german', 'japanese', 'mandarin', 'hindi', 'arabic', 'italian', 'portuguese', 'korean', 'tamil', 'learn english', 'duolingo', 'vocabulary', 'fluent', 'grammar'] },
  { category: 'learning',      keywords: ['learn', 'master', 'improve', 'skill', 'course', 'tutorial', 'hobby', 'workshop', 'guitar', 'piano', 'drawing', 'photography', 'cooking', 'baking', 'woodwork', 'design'] },
  { category: 'fitness',       keywords: ['fitness', 'gym', 'workout', 'exercise', 'run', 'running', 'marathon', 'weight loss', 'muscle', 'strength', 'yoga', 'pilates', 'cycling', 'swim', 'swimming', 'lose weight', 'gain weight', 'cardio'] },
  { category: 'diet',          keywords: ['diet', 'nutrition', 'eat healthy', 'meal plan', 'calorie', 'keto', 'vegan', 'intermittent fasting', 'detox', 'weight management'] },
  { category: 'sports',        keywords: ['cricket', 'football', 'basketball', 'badminton', 'tennis', 'volleyball', 'chess', 'kabaddi', 'hockey', 'match', 'tournament', 'competition', 'championship', 'league', 'athlete', 'race'] },
  { category: 'cultural',      keywords: ['dance', 'drama', 'theater', 'theatre', 'performance', 'stage', 'play', 'concert', 'recital', 'audition', 'music show', 'cultural event', 'classical', 'bharatanatyam', 'singing competition', 'art exhibition'] },
  { category: 'creative',      keywords: ['write', 'writing', 'novel', 'poem', 'story', 'blog', 'podcast', 'video', 'youtube', 'film', 'short film', 'paint', 'painting', 'sketch', 'draw', 'compose', 'song', 'album', 'art'] },
  { category: 'family',        keywords: ['family', 'parents', 'grandparents', 'siblings', 'relatives', 'kids', 'children', 'spouse', 'partner', 'loved ones', 'family gathering', 'family reunion', 'visit parents', 'quality time'] },
  { category: 'shopping',      keywords: ['buy', 'purchase', 'shop', 'shopping', 'order', 'gift', 'groceries', 'online order'] },
  { category: 'financial',     keywords: ['save', 'saving', 'invest', 'investment', 'budget', 'money', 'finance', 'loan', 'debt', 'pay off', 'emergency fund', 'stock', 'mutual fund', 'sip', 'insurance', 'tax', 'financial'] },
  { category: 'career',        keywords: ['job', 'interview', 'resume', 'cv', 'career', 'promotion', 'appraisal', 'salary', 'internship', 'placement', 'apply for job', 'linkedin', 'networking', 'freelance', 'startup', 'entrepreneur'] },
  { category: 'health',        keywords: ['health', 'doctor', 'hospital', 'appointment', 'medical', 'checkup', 'medicine', 'medication', 'treatment', 'surgery', 'therapy', 'recover', 'dental', 'eye test', 'blood test', 'prescription'] },
  { category: 'wellbeing',     keywords: ['mental health', 'stress', 'anxiety', 'depression', 'meditation', 'mindfulness', 'self care', 'self-care', 'burnout', 'journal', 'gratitude', 'counseling', 'breathe', 'relax', 'calm', 'peace'] },
  { category: 'home',          keywords: ['home', 'house', 'room', 'clean', 'cleaning', 'organize', 'declutter', 'renovate', 'repair', 'paint wall', 'furniture', 'garden', 'interior', 'decor', 'fix', 'move', 'shift house', 'setup'] },
  { category: 'reading',       keywords: ['read', 'book', 'novel', 'chapter', 'finish reading', 'reading habit', 'audiobook', 'ebook', 'library', 'non-fiction', 'biography'] },
  { category: 'volunteering',  keywords: ['volunteer', 'volunteering', 'social work', 'community', 'ngo', 'charity', 'donate', 'help others', 'outreach', 'service'] },
  { category: 'research',      keywords: ['research', 'analyse', 'analyze', 'survey', 'investigate', 'literature review', 'data collection', 'findings', 'hypothesis'] },
  { category: 'coding',        keywords: ['code', 'app', 'api', 'debug', 'software', 'website', 'deploy', 'backend', 'frontend', 'database', 'script', 'program', 'develop', 'build an app', 'feature', 'bug', 'repository', 'git'] },
  { category: 'work',          keywords: ['report', 'presentation', 'meeting', 'project', 'deadline', 'client', 'deliverable', 'proposal', 'pitch', 'office', 'email', 'documentation'] }
];

// ─────────────────────────────────────────────────────────────────────────────
// GROQ LLM CALL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls the Groq LLM API and returns structured subtask suggestions.
 * Returns null if the API call fails for any reason (triggers fallback).
 */
async function callGroqAPI(title, category, isTeam) {
  if (!GROQ_API_KEY) return null;

  const systemPrompt = `You are a smart personal assistant inside a goal-tracking app called CommitSync.
Your job is to break down ANY type of goal into clear, actionable sub-tasks.

The users can be of any background: students, children, retired people, working professionals, athletes, parents, hobbyists — anyone.
Goals can be about anything: a vacation trip, exam prep, birthday party planning, fitness, cooking, learning a language, buying a house, volunteering, writing a book, and more.

Rules:
- Generate between 4 and 7 sub-tasks that are SPECIFIC to the given goal title.
- Each sub-task must be genuinely useful and practical for that specific goal.
${isTeam ? '- Since this is a team project, use `estimatedDays` (e.g. 1, 2.5, 5) instead of hours.' : '- estimatedHours should be a realistic number (0.5 to 10).'}
- priority must be one of: "HIGH", "MEDIUM", "LOW".
${isTeam ? '- isParallel must be a boolean (true if it can be done simultaneously with other tasks, false if it depends on previous tasks).' : ''}
- Do NOT generate generic or vague tasks like "Phase 1", "Preparation", "Finalization".
- Do NOT add any explanation or text outside the JSON.
- Respond ONLY with a valid JSON array in this exact format:

[
  ${isTeam ? '{ "title": "sub-task description", "estimatedDays": 2, "priority": "HIGH", "isParallel": true }' : '{ "title": "sub-task description", "estimatedHours": 2, "priority": "HIGH" }'},
  ${isTeam ? '{ "title": "sub-task description", "estimatedDays": 1, "priority": "MEDIUM", "isParallel": false }' : '{ "title": "sub-task description", "estimatedHours": 1, "priority": "MEDIUM" }'}
]`;

  const userPrompt = `Goal: "${title}"${category && category !== 'other' ? `\nCategory hint: ${category}` : ''}

Generate specific, actionable sub-tasks for this goal.`;

  try {
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    // Parse the JSON — Groq returns a JSON object, we look for an array inside it
    const parsed = JSON.parse(raw);

    // The model may wrap the array in a key like { subtasks: [...] } or { tasks: [...] }
    const subtasks = Array.isArray(parsed)
      ? parsed
      : parsed.subtasks || parsed.tasks || parsed.sub_tasks || Object.values(parsed)[0];

    if (!Array.isArray(subtasks) || subtasks.length === 0) return null;

    // Sanitize each subtask
    return subtasks
      .filter(t => t && typeof t.title === 'string' && t.title.trim())
      .map(t => {
        const baseTask = {
          title: t.title.trim(),
          priority: ['HIGH', 'MEDIUM', 'LOW'].includes(t.priority?.toUpperCase())
            ? t.priority.toUpperCase()
            : 'MEDIUM'
        };
        if (isTeam) {
          baseTask.estimatedDays = parseFloat(t.estimatedDays) || 1;
          baseTask.isParallel = t.isParallel === true || String(t.isParallel).toLowerCase() === 'true';
        } else {
          baseTask.estimatedHours = parseFloat(t.estimatedHours) || 1;
        }
        return baseTask;
      })
      .slice(0, 7); // Cap at 7 subtasks

  } catch (err) {
    // Log for debugging but don't crash — fall through to static templates
    if (err.response) {
      console.warn(`[GroqAI] API error ${err.response.status}:`, err.response.data?.error?.message || 'Unknown error');
    } else {
      console.warn('[GroqAI] Request failed:', err.message);
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: generateSuggestions
// ─────────────────────────────────────────────────────────────────────────────

exports.generateSuggestions = async (userId, title, category, isTeam = false) => {

  // ── 1. Groq LLM (primary — dynamic & context-aware) ─────────────────────
  const groqResult = await callGroqAPI(title, category, isTeam);
  if (groqResult) {
    console.log(`[GroqAI] ✓ Generated ${groqResult.length} subtasks for: "${title}"`);
    return groqResult;
  }

  // ── 2. User's own saved manual templates (high personal relevance) ────────
  if (title) {
    try {
      const manualTemplate = await Template.findOne({
        userId,
        $text: { $search: title }
      }).sort({ score: { $meta: 'textScore' }, useCount: -1 });

      if (manualTemplate?.subTasks?.length > 0) {
        console.log('[Fallback] Using user manual template');
        return exports._formatSubTasks(manualTemplate.subTasks, isTeam);
      }
    } catch (_) { /* text index may not exist — skip */ }
  }

  // ── 3. User's own past commitments with matching title ────────────────────
  if (title) {
    try {
      const results = await Commitment.find({
        userId,
        'subTasks.0': { $exists: true },
        $text: { $search: title }
      })
        .sort({ score: { $meta: 'textScore' } })
        .limit(1);

      if (results[0]?.subTasks?.length > 0) {
        console.log('[Fallback] Using user past commitment');
        return exports._formatSubTasks(results[0].subTasks, isTeam);
      }
    } catch (_) { /* skip */ }
  }

  // ── 4. Static template library (keyword-inferred category) ───────────────
  const inferred = exports._inferCategoryFromTitle(title);
  const resolvedCategory = STATIC_TEMPLATES[inferred]
    ? inferred
    : (STATIC_TEMPLATES[category] ? category : 'other');

  console.log(`[Fallback] Using static template for category: ${resolvedCategory}`);
  return exports._formatSubTasks(STATIC_TEMPLATES[resolvedCategory] || STATIC_TEMPLATES['other'], isTeam);
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

exports._formatSubTasks = (subTasks, isTeam = false) => {
  return subTasks.map(st => {
    const baseTask = {
      title: st.title,
      priority: st.priority || 'MEDIUM'
    };
    if (isTeam) {
      baseTask.estimatedDays = st.estimatedDays || (st.estimatedHours ? Math.ceil(st.estimatedHours / 8) : 1);
      baseTask.isParallel = st.isParallel !== undefined ? st.isParallel : false;
    } else {
      baseTask.estimatedHours = st.estimatedHours || 1;
    }
    return baseTask;
  });
};

exports._inferCategoryFromTitle = (title) => {
  if (!title) return 'other';
  const t = title.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (t.includes(keyword)) return rule.category;
    }
  }
  return 'other';
};
