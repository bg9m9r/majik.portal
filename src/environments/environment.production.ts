export const environment = {
  production: true,
  // Build-time version stamp. `npm run build` rewrites these via
  // scripts/stamp-version.mjs (prebuild hook). 'dev' until stamped.
  commitSha: 'dev',
  buildTime: '',
  apiBaseUrl: '',
  signalRHubUrl: '/hubs/match',
  notificationsHubUrl: '/hubs/notifications',
  auth0: {
    domain: '',
    clientId: '',
    audience: '',
    redirectUri: ''
  }
};
