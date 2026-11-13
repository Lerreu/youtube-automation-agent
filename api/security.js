// API key check and cross-site write protection for the HTTP API.
// Methods of YouTubeAutomationAgent, merged into its prototype (see index.js).
const crypto = require('crypto');

const securityMethods = {
  requireAPIKey() {
    return (req, res, next) => {
      const expected = process.env.API_KEY;
      if (!expected) {
        // Fail closed: routes that generate, approve or publish are never open.
        return res.status(503).json({
          success: false,
          code: 'API_KEY_NOT_CONFIGURED',
          error: 'Set API_KEY in .env to enable generation, approval, and publishing routes'
        });
      }

      const provided = Buffer.from(String(req.get('x-api-key') || ''));
      const wanted = Buffer.from(expected);
      if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      return next();
    };
  },

  rejectCrossSiteWrites() {
    const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
    return (req, res, next) => {
      if (safeMethods.has(req.method)) return next();
      const fetchSite = req.get('sec-fetch-site');
      if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
        return res.status(403).json({ success: false, code: 'CROSS_SITE_REQUEST', error: 'Cross-site requests are not allowed' });
      }
      const origin = req.get('origin');
      if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
        return res.status(403).json({ success: false, code: 'CROSS_SITE_REQUEST', error: 'Cross-site requests are not allowed' });
      }
      return next();
    };
  }
};

module.exports = { securityMethods };
