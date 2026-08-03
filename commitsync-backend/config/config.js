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
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      // Allow any localhost port in development
      if (origin.match(/^http:\/\/localhost:\d+$/) || origin === (process.env.CORS_ORIGIN || 'http://localhost:5173')) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
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