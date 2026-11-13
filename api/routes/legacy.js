// Original top-level routes (health, generate, analytics, schedule, publish).
// Extracted from index.js; `agent` is the YouTubeAutomationAgent instance.
const path = require('path');
const { version } = require('../../package.json');
const ROOT = path.join(__dirname, '..', '..');

function register(agent, { app }) {
  // Main dashboard route
  app.get('/', (req, res) => {
    res.sendFile(path.join(ROOT, 'dashboard', 'index.html'));
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({
      status: agent.setupRequired ? 'setup_required' : 'healthy',
      version,
      initialized: agent.isInitialized,
      setupRequired: agent.setupRequired,
      agents: Object.keys(agent.agents),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Manual content generation
  app.post('/generate', agent.requireAPIKey(), async (req, res) => {
    try {
      if (agent.setupRequired) {
        return res.status(503).json({ success: false, error: 'Finish setup with npm run walkthrough before generating content' });
      }
      const validation = agent.validateGenerateRequestBody(req.body);
      if (!validation.valid) {
        return res.status(validation.status).json({ success: false, error: validation.error });
      }

      const { topic, style, length } = validation.value;
      const result = await agent.startGenerationJob({ topic, style, length, source: 'manual' });
      res.status(202).json({ success: true, result });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  // Get analytics
  app.get('/analytics', async (req, res) => {
    try {
      if (!agent.agents.analytics) return res.json({ totalVideos: 0, averagePerformanceScore: 0, topPerformers: [], insights: [], learning: null });
      const analytics = await agent.agents.analytics.getRecentAnalytics();
      const learning = await agent.agents.analytics.getLearningSummary();
      res.json({ ...analytics, learning });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/analytics/channel', async (req, res) => {
    try {
      if (!agent.agents.analytics?.getChannelSnapshot) {
        return res.json({ success: true, result: { available: false, reason: 'Connect YouTube with npm run walkthrough to see channel statistics.' } });
      }
      const result = await agent.agents.analytics.getChannelSnapshot({ refresh: req.query.refresh === '1' });
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/outcomes', async (_req, res) => {
    try {
      const learning = agent.agents.analytics?.getLearningSummary
        ? await agent.agents.analytics.getLearningSummary()
        : { outcome: null };
      return res.json({ success: true, result: learning.outcome || null });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get upcoming schedule
  app.get('/schedule', async (req, res) => {
    try {
      const schedule = await agent.db.getUpcomingSchedule();
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manual publish
  app.post('/publish/:contentId', agent.requireAPIKey(), async (req, res) => {
    try {
      if (!agent.agents.publishing) return res.status(503).json({ success: false, error: 'YouTube publishing is not configured' });
      const { contentId } = req.params;
      const bundle = await agent.db.getProductionBundle(contentId);
      const short = bundle ? null : await agent.db.getShortClip(contentId);
      if ((!bundle || bundle.review_status !== 'approved') && (!short || !['scheduled', 'uploading', 'reconciliation_required'].includes(short.status))) {
        return res.status(409).json({ success: false, error: 'Content must pass review and be approved before publishing' });
      }
      const result = await agent.agents.publishing.publishContent(contentId);
      res.json({ success: true, result });
    } catch (error) {
      res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { register };
