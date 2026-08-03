require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const User = require('../models/User');
const Template = require('../models/Template');
const { seedInitialTemplates } = require('./templateSeeder');

const migrate = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/commitsync', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB Connected');

    // 1. Delete all existing templates
    const result = await Template.deleteMany({});
    console.log(`Deleted ${result.deletedCount} old templates.`);

    // 2. Fetch all users
    const users = await User.find({});
    console.log(`Found ${users.length} users. Seeding new templates...`);

    // 3. Seed templates for each user
    for (const user of users) {
      await seedInitialTemplates(user._id);
    }
    console.log('Migration complete!');

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit();
  }
};

migrate();
