export const environment = {
  production: false,
  // Build-time version stamp. Dev keeps the placeholder; `npm run build`
  // rewrites these via scripts/stamp-version.mjs (prebuild hook).
  commitSha: 'dev',
  buildTime: '',
  apiBaseUrl: 'http://localhost:5057',
  signalRHubUrl: 'http://localhost:5057/hubs/match',
  notificationsHubUrl: 'http://localhost:5057/hubs/notifications',
  auth0: {
    domain: 'auth.majik.tech',
    clientId: 'oVC0iZQ9aoj5ScorEHa3Ys4O9KjBSGxv',
    audience: 'https://api.majik.tech',
    redirectUri: 'http://localhost:4200/auth/callback'
  }
};
