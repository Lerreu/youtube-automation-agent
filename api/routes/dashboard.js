// Dashboard data, jobs, readiness, quota, settings, profile, automation and notifications.
// Extracted from index.js; `agent` is the YouTubeAutomationAgent instance.
const { sharedTracker } = require('../../utils/youtube-api-guard');
const { version } = require('../../package.json');

function register(agent, { app, protect }) {
  app.get('/api/dashboard', async (_req, res) => {
    try {
      const [stats, jobs, pipeline, schedule, events, notifications, profile, settings, ideas, analytics, learning, activation, channelStrategy, operatorRuns, readiness, engagement, experiments] = await Promise.all([
        agent.db.getStats(),
        agent.db.listGenerationJobs(20),
        agent.db.getPipelineOverview(50),
        agent.db.getUpcomingSchedule(30),
        agent.db.getRecentAutomationEvents(20),
        agent.db.listNotifications(20),
        agent.db.getChannelProfile(),
        agent.db.getAllSettings(),
        agent.db.listContentIdeas(),
        agent.agents.analytics
          ? agent.agents.analytics.getRecentAnalytics(30)
          : Promise.resolve({ totalVideos: 0, averagePerformanceScore: 0, topPerformers: [], insights: [] }),
        agent.agents.analytics?.getLearningSummary
          ? agent.agents.analytics.getLearningSummary()
          : Promise.resolve({ measuredVideos: 0, snapshotCount: 0, baseline: {}, recommendations: [], approvedCount: 0, pendingCount: 0 }),
        agent.activation
          ? agent.activation.getSummary()
          : Promise.resolve({ privacy: 'local-only', counts: {}, milestones: {} }),
        agent.db.getChannelStrategy(),
        agent.db.listOperatorRuns(10),
        agent.readiness
          ? agent.readiness.getSummary()
          : Promise.resolve({ status: 'unverified', stale: false, blockingFailures: [], checks: [] }),
        agent.engagement
          ? agent.engagement.getSummary()
          : Promise.resolve({
              videosTracked: 0, pendingDrafts: 0, postedToday: 0, needsAttentionCount: 0,
              pendingAudienceIdeas: 0, postingEnabled: false, postingDisabledReason: 'setup_required',
              insights: [], recentThemes: [],
              evidencePolicy: 'Comments are fetched read-only from YouTube. Replies post only after operator approval, and fallback analysis never proposes drafts or ideas.'
            }),
        agent.experiments
          ? agent.experiments.getSummary()
          : Promise.resolve({ experiments: [], candidates: [], activeCount: 0, awaitingDecisionCount: 0, evidencePolicy: 'Finish setup to create a controlled growth experiment.' })
      ]);
      if (agent.telemetry) void agent.telemetry.sync(activation);
      res.json({
        stats, jobs, pipeline, schedule, events, notifications, profile, settings, ideas, analytics, learning, activation,
        channelStrategy, operatorRuns, readiness, engagement, experiments,
        system: {
          version,
          initialized: agent.isInitialized,
          setupRequired: agent.setupRequired,
          uptime: process.uptime(),
          activeJobs: agent.activeJobs.size,
          automationPaused: agent.scheduler ? !agent.scheduler.isEnabled : true,
          agents: Object.keys(agent.agents),
          autonomousRunning: Boolean(await agent.db.getActiveOperatorRun()),
          videoProviders: agent.agents.production?.aiVideoGenerator?.mediaGeneration?.listProviders() || []
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/jobs/:jobId', async (req, res) => {
    const job = await agent.db.getGenerationJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    job.checkpoints = await agent.db.listGenerationCheckpoints(job.id);
    job.mediaTasks = await agent.db.listMediaGenerationTasks(job.id);
    job.resumeFrom = agent.recovery?.resumePoint(job.checkpoints);
    return res.json(job);
  });

  app.post('/api/jobs/:jobId/resume', protect, async (req, res) => {
    try {
      const result = await agent.resumeGenerationJob(req.params.jobId, { stage: req.body?.stage });
      return res.status(202).json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });

  app.get('/api/youtube/quota', (_req, res) => {
    res.json({ success: true, quota: sharedTracker.snapshot() });
  });

  app.get('/api/readiness', async (_req, res) => {
    if (!agent.readiness) return res.status(503).json({ error: 'Readiness service is not initialized' });
    return res.json(await agent.readiness.getSummary());
  });

  app.post('/api/readiness/run', protect, async (req, res) => {
    try {
      if (!agent.readiness) return res.status(503).json({ error: 'Readiness service is not initialized' });
      const result = await agent.readiness.run({
        includePaidMedia: req.body?.includePaidMedia === true,
        includePaidVideo: req.body?.includePaidVideo === true
      });
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/jobs/:jobId/cancel', protect, async (req, res) => {
    const job = await agent.db.getGenerationJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['queued', 'running'].includes(job.status)) {
      return res.status(409).json({ error: 'Only queued or running jobs can be cancelled' });
    }
    const updated = await agent.db.updateGenerationJob(job.id, { cancelRequested: true, details: { cancelReason: req.body?.reason || 'Cancelled by operator' } });
    return res.json({ success: true, result: updated });
  });

  app.put('/api/profile', protect, async (req, res) => {
    try {
      const profile = agent.validateProfile(req.body || {});
      return res.json({ success: true, result: await agent.db.saveChannelProfile(profile) });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/automation/:action', protect, async (req, res) => {
    if (!agent.scheduler) return res.status(409).json({ error: 'Finish setup before controlling automation' });
    const { action } = req.params;
    if (action === 'pause') {
      await agent.scheduler.pauseAutomation();
      await agent.db.setSetting('automation_paused', 'true');
    } else if (action === 'resume') {
      await agent.scheduler.resumeAutomation();
      await agent.db.setSetting('automation_paused', 'false');
    } else {
      return res.status(400).json({ error: 'Action must be pause or resume' });
    }
    return res.json({ success: true, paused: !agent.scheduler.isEnabled });
  });

  app.put('/api/settings', protect, async (req, res) => {
    const allowed = ['notification_enabled', 'channel_timezone', 'max_daily_posts', 'content_buffer_days'];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) await agent.db.setSetting(key, String(req.body[key]));
    }
    const provider = req.body?.video_provider;
    if (provider !== undefined) {
      const supported = ['slideshow', 'auto', 'seedance', 'minimax_h3', 'google_omni', 'kling', 'wan'];
      if (!supported.includes(provider)) return res.status(400).json({ error: 'Unsupported video provider' });
      await agent.db.setSetting('video_provider', provider);
    }
    const mode = req.body?.video_generation_mode;
    if (mode !== undefined) {
      if (!['hybrid', 'slideshow'].includes(mode)) return res.status(400).json({ error: 'Unsupported video generation mode' });
      await agent.db.setSetting('video_generation_mode', mode);
    }
    if (req.body?.video_clip_duration !== undefined) {
      const value = Number(req.body.video_clip_duration);
      if (!Number.isInteger(value) || value < 3 || value > 30) return res.status(400).json({ error: 'Clip duration must be between 3 and 30 seconds' });
      await agent.db.setSetting('video_clip_duration', String(value));
    }
    if (req.body?.video_max_generated_seconds !== undefined) {
      const value = Number(req.body.video_max_generated_seconds);
      if (!Number.isInteger(value) || value < 0 || value > 600) return res.status(400).json({ error: 'Generated seconds cap must be between 0 and 600' });
      await agent.db.setSetting('video_max_generated_seconds', String(value));
    }
    return res.json({ success: true, result: await agent.db.getAllSettings() });
  });

  app.post('/api/notifications/:notificationId/read', protect, async (req, res) => {
    await agent.db.markNotificationRead(req.params.notificationId);
    return res.json({ success: true });
  });
}

module.exports = { register };
