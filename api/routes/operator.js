// Autonomous operator, learning recommendations and content ideas.
// Extracted from index.js; `agent` is the YouTubeAutomationAgent instance.
function register(agent, { app, protect }) {
  app.put('/api/operator/strategy', protect, async (req, res) => {
    try {
      const current = await agent.db.getChannelStrategy() || {};
      const strategy = agent.validateChannelStrategy(req.body || {}, current);
      return res.json({ success: true, result: await agent.db.saveChannelStrategy(strategy) });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/operator/start', protect, async (req, res) => {
    try {
      if (agent.setupRequired || !agent.agents.strategy) {
        return res.status(503).json({ success: false, error: 'Finish setup with npm run walkthrough before activating the autonomous operator' });
      }
      if (agent.activeJobs.size) {
        return res.status(409).json({ success: false, error: 'Wait for the current generation job to finish before starting an autonomous run' });
      }
      await agent.readiness?.assertReady('Autonomous production');
      const current = await agent.db.getChannelStrategy() || {};
      const strategy = agent.validateChannelStrategy({ ...(req.body || {}), status: 'active' }, current);
      const saved = await agent.db.saveChannelStrategy(strategy);
      const run = await agent.autonomous.start(saved);
      return res.status(202).json({ success: true, result: run });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/operator/pause', protect, async (_req, res) => {
    const strategy = await agent.db.getChannelStrategy();
    if (!strategy) return res.status(404).json({ error: 'Channel strategy not found' });
    const active = await agent.db.getActiveOperatorRun();
    if (active) await agent.autonomous.cancel(active.id);
    const saved = await agent.db.saveChannelStrategy({ ...strategy, status: 'paused' });
    return res.json({ success: true, result: saved });
  });

  app.post('/api/operator/runs/:runId/cancel', protect, async (req, res) => {
    const run = await agent.autonomous.cancel(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Operator run not found' });
    return res.json({ success: true, result: run });
  });

  app.post('/api/operator/runs/:runId/resume', protect, async (req, res) => {
    try {
      if (agent.setupRequired || !agent.agents.strategy) {
        return res.status(503).json({ success: false, error: 'Finish setup before resuming the autonomous operator' });
      }
      await agent.readiness?.assertReady('Autonomous production recovery');
      const strategy = await agent.db.getChannelStrategy();
      const run = await agent.autonomous.resume(req.params.runId, strategy);
      return res.status(202).json({ success: true, result: run });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/learning/recommendations/:recommendationId/:action', protect, async (req, res) => {
    const { recommendationId, action } = req.params;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or reject' });
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    const recommendation = await agent.db.reviewLearningRecommendation(recommendationId, status);
    if (!recommendation) return res.status(404).json({ error: 'Learning recommendation not found' });
    await agent.operator.notify({
      type: 'learning_recommendation_reviewed',
      level: action === 'approve' ? 'success' : 'info',
      title: action === 'approve' ? 'Channel learning approved' : 'Channel learning rejected',
      message: recommendation.title,
      data: { recommendationId, status }
    });
    return res.json({ success: true, result: recommendation });
  });

  app.post('/api/ideas', protect, async (req, res) => {
    const topic = String(req.body?.topic || '').trim();
    if (!topic || topic.length > 200) return res.status(400).json({ error: 'A topic of 200 characters or less is required' });
    const idea = await agent.db.createContentIdea({ ...req.body, topic });
    return res.status(201).json({ success: true, result: idea });
  });

  app.patch('/api/ideas/:ideaId', protect, async (req, res) => {
    const idea = await agent.db.updateContentIdea(req.params.ideaId, req.body || {});
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    return res.json({ success: true, result: idea });
  });

  app.post('/api/ideas/:ideaId/generate', protect, async (req, res) => {
    const idea = await agent.db.updateContentIdea(req.params.ideaId, { status: 'generating' });
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    const job = await agent.startGenerationJob({ topic: idea.topic, style: idea.style, length: req.body?.length || 'medium', source: 'idea' });
    await agent.db.updateContentIdea(idea.id, { status: 'generated' });
    return res.status(202).json({ success: true, result: job });
  });
}

module.exports = { register };
