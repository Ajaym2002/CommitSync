/**
 * MongoDB Database Connection
 */
const mongoose = require('mongoose');
const dns = require('dns');
const Template = require('../models/Template');

// Configure Node.js to use Google DNS resolvers to bypass local router/ISP SRV query resolution failures
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (err) {
  console.warn('Failed to configure custom DNS servers:', err.message);
}


const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`✓ MongoDB Connected: ${conn.connection.host}`);
    console.log(`  Database: ${conn.connection.name}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });
    

    return conn;
  } catch (error) {
    console.error(`✗ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;