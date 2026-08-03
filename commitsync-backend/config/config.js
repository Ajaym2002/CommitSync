/**
 * Application Configuration
 */
module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 8000,
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/commitsync'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expire: process.env.JWT_EXPIRE || '30d'
  },
  
  predictionEngine: {
    url: process.env.PREDICTION_ENGINE_URL || 'http://localhost:5000/api/predict/',
    timeout: 10000 // 10 seconds
  },
  
  cors: {
    origin: function(origin, callback) {
      // Allow requests with no origin (mobile apps, curl, Postman, Render health checks)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        // Production frontend
        process.env.CORS_ORIGIN,
        // Common local dev ports
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:4173',
      ].filter(Boolean); // remove undefined/null entries

      // Also allow any http://localhost:<port> pattern for flexibility in dev
      if (
        origin.match(/^http:\/\/localhost:\d+$/) ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      callback(new Error(`CORS: Origin '${origin}' not allowed`));
    },
    credentials: true
  },
  
  risk: {
    recalculationInterval: process.env.RISK_RECALCULATION_INTERVAL || '*/30 * * * *', // Every 30 minutes
    highRiskThreshold: 70,
    criticalRiskThreshold: 85
  },
  
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI
  }
};