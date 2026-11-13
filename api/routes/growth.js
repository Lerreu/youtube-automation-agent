// Experiments, retention and audience engagement.
// Extracted from index.js; `agent` is the YouTubeAutomationAgent instance.
function register(agent, { app, protect }) {
  const ENGAGEMENT_VIDEO_ID = /^[A-Za-z0-9_-]{1,100}$/;

  app.get('/api/experiments', async (_req, res) => {
    try {
      const summary = agent.experiments
        ? await agent.experiments.getSummary()
        : { experiments: [], candidates: [], activeCount: 0, awaitingDecisionCount: 0 };
      return res.json({ success: true, result: summary });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/experiments', protect, async (req, res) => {
    try {
      if (!agent.experiments) return res.status(503).json({ error: 'Finish setup before creating experiments' });
      const experiment = await agent.experiments.create(req.body || {});
      return res.status(201).json({ success: true, result: experiment });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/experiments/:experimentId/:action', protect, async (req, res) => {
    try {
      if (!agent.experiments) return res.status(503).json({ error: 'Finish setup before controlling experiments' });
      const actions = {
        approve: () => agent.experiments.approve(req.params.experimentId, req.body),
        start: () => agent.experiments.start(req.params.experimentId, req.body),
        refresh: () => agent.experiments.refresh(req.params.experimentId),
        adopt: () => agent.experiments.adoptWinner(req.params.experimentId, req.body),
        cancel: () => agent.experiments.cancel(req.params.experimentId, req.body)
      };
      if (!actions[req.params.action]) return res.status(400).json({ error: 'Unsupported experiment action' });
      const experiment = await actions[req.params.action]();
      await agent.operator.notify({
        type: 'growth_experiment_updated',
        level: ['adopt', 'approve'].includes(req.params.action) ? 'success' : 'info',
        title: `Growth experiment ${req.params.action}`,
        message: experiment.title,
        data: { experimentId: experiment.id, status: experiment.status }
      });
      return res.json({ success: true, result: experiment });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/retention/:videoId', async (req, res) => {
    const videoId = String(req.params.videoId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(videoId)) {
      return res.status(400).json({ error: 'A valid YouTube video ID is required' });
    }
    const snapshots = await agent.db.listRetentionSnapshots({ videoId, limit: 10 });
    return res.json({ success: true, result: snapshots });
  });

  app.post('/api/retention/:videoId/refresh', protect, async (req, res) => {
    try {
      const videoId = String(req.params.videoId || '').trim();
      const measurementWindow = String(req.body?.measurementWindow || 'rolling');
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(videoId)) {
        return res.status(400).json({ error: 'A valid YouTube video ID is required' });
      }
      if (!['24h', '7d', 'rolling'].includes(measurementWindow)) {
        return res.status(400).json({ error: 'Measurement window must be 24h, 7d, or rolling' });
      }
      if (!agent.agents.analytics) {
        return res.status(503).json({ error: 'YouTube Analytics is not initialized' });
      }
      const report = await agent.agents.analytics.analyzeVideoPerformance(videoId, { measurementWindow });
      return res.json({
        success: true,
        result: report.retentionSnapshot || null,
        retention: report.retention
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
  });

  app.get('/api/engagement/:videoId', async (req, res) => {
    try {
      const videoId = String(req.params.videoId || '').trim();
      if (!ENGAGEMENT_VIDEO_ID.test(videoId)) {
        return res.status(400).json({ error: 'A valid YouTube video ID is required' });
      }
      const [insight, comments, drafts] = await Promise.all([
        agent.db.getEngagementInsight(videoId),
        agent.db.listAudienceComments({ videoId, limit: 200 }),
        agent.db.listReplyDrafts({ videoId, limit: 100 })
      ]);
      return res.json({ success: true, result: { insight, comments, drafts } });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/engagement/:videoId/sync', protect, async (req, res) => {
    try {
      if (!agent.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
      const videoId = String(req.params.videoId || '').trim();
      if (!ENGAGEMENT_VIDEO_ID.test(videoId)) {
        return res.status(400).json({ error: 'A valid YouTube video ID is required' });
      }
      const sync = await agent.engagement.syncVideoComments(videoId, req.body || {});
      const insight = sync.fetched > 0 || req.body?.analyze === true
        ? await agent.engagement.analyzeVideo(videoId)
        : sync.insight;
      return res.status(202).json({ success: true, result: { ...sync, insight } });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/engagement/:videoId/draft-replies', protect, async (req, res) => {
    try {
      if (!agent.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
      const videoId = String(req.params.videoId || '').trim();
      if (!ENGAGEMENT_VIDEO_ID.test(videoId)) {
        return res.status(400).json({ error: 'A valid YouTube video ID is required' });
      }
      const result = await agent.engagement.draftReplies(videoId, req.body || {});
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.patch('/api/engagement/replies/:draftId', protect, async (req, res) => {
    try {
      if (!agent.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
      const result = await agent.engagement.updateReplyDraft(req.params.draftId, req.body || {});
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/engagement/replies/:draftId/approve', protect, async (req, res) => {
    try {
      if (!agent.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
      const result = await agent.engagement.approveReplyDraft(req.params.draftId, req.body || {});
      // The reply is already live on YouTube; a notification failure must not report an error.
      try {
        await agent.operator.notify({
          type: 'audience_reply_posted',
          level: 'success',
          title: 'Audience reply posted',
          message: `A reply was posted on video ${result.videoId}`,
          data: { draftId: result.id, videoId: result.videoId, postedCommentId: result.postedCommentId }
        });
      } catch (notifyError) {
        agent.logger.warn(`Posted reply notification failed: ${notifyError.message}`);
      }
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });
}

module.exports = { register };
