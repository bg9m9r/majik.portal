export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:5057',
  signalRHubUrl: 'http://localhost:5057/hubs/match',
  auth0: {
    domain: 'auth.majik.tech',
    clientId: 'oVC0iZQ9aoj5ScorEHa3Ys4O9KjBSGxv',
    audience: 'https://api.majik.tech',
    redirectUri: 'http://localhost:4200/auth/callback'
  }
};
