export const securityConfig = {
  jsonBodyLimit: '1mb',
  urlEncodedLimit: '1mb',
  rateLimitWindowMs: 15 * 60 * 1000,
  rateLimitMaxRequests: 300,
  chatbotRateLimitWindowMs: 60 * 1000,
  chatbotRateLimitMaxRequests: 20,
};
