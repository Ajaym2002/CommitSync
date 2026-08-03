const { google } = require('googleapis');
const config = require('../config/config');

const oauth2Client = new google.auth.OAuth2(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

// Scopes for Google Login + Calendar integration
const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar'
];

exports.getAuthUrl = (stateToken) => {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Required to receive a refresh token
    scope: SCOPES,
    prompt: 'consent', // Force to get refresh token
    ...(stateToken ? { state: stateToken } : {})
  });
};

exports.getTokens = async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
};

exports.getUserInfo = async (tokens) => {
  oauth2Client.setCredentials(tokens);
  
  const oauth2 = google.oauth2({
    auth: oauth2Client,
    version: 'v2'
  });
  
  const res = await oauth2.userinfo.get();
  return res.data;
};

exports.getOAuth2Client = (tokens) => {
  const client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  if (tokens) {
    client.setCredentials(tokens);
  }
  return client;
};
