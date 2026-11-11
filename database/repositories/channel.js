// Channel profile and strategy, ideas, operator runs, notifications, events and readiness runs.
// Methods of Database, merged into its prototype (see database/db.js).
const channelRepository = {
  async getChannelProfile() {
    const row = await this.getRow("SELECT * FROM channel_profiles WHERE id = 'default'");
    return row ? { ...row, bannedTopics: JSON.parse(row.banned_topics || '[]') } : null;
  },

  async saveChannelProfile(profile) {
    const current = await this.getChannelProfile() || {};
    await this.executeQuery(
      `INSERT OR REPLACE INTO channel_profiles (
        id, channel_name, goal, target_audience, brand_voice, default_style,
        call_to_action, banned_topics, visual_style, timezone, content_language, created_at, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))`,
      [
        profile.channelName ?? current.channel_name ?? '',
        profile.goal ?? current.goal ?? '',
        profile.targetAudience ?? current.target_audience ?? '',
        profile.brandVoice ?? current.brand_voice ?? '',
        profile.defaultStyle ?? current.default_style ?? 'explainer',
        profile.callToAction ?? current.call_to_action ?? '',
        JSON.stringify(profile.bannedTopics ?? current.bannedTopics ?? []),
        profile.visualStyle ?? current.visual_style ?? '',
        profile.timezone ?? current.timezone ?? 'America/Sao_Paulo',
        profile.contentLanguage ?? current.content_language ?? null,
        current.created_at || null
      ]
    );
    return this.getChannelProfile();
  },

  async createContentIdea(idea) {
    const id = this.generateId('idea');
    await this.executeQuery(
      `INSERT INTO content_ideas (id, topic, angle, style, status, rationale, scheduled_for)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, idea.topic, idea.angle || null, idea.style || 'explainer', idea.status || 'backlog', idea.rationale || null, idea.scheduledFor || null]
    );
    return this.getRow('SELECT * FROM content_ideas WHERE id = ?', [id]);
  },

  async listContentIdeas() {
    return this.getAllRows("SELECT * FROM content_ideas WHERE status != 'archived' ORDER BY COALESCE(scheduled_for, '9999-12-31'), created_at DESC");
  },

  async updateContentIdea(id, changes) {
    const current = await this.getRow('SELECT * FROM content_ideas WHERE id = ?', [id]);
    if (!current) return null;
    await this.executeQuery(
      `UPDATE content_ideas SET topic = ?, angle = ?, style = ?, status = ?,
       rationale = ?, scheduled_for = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        changes.topic ?? current.topic,
        changes.angle ?? current.angle,
        changes.style ?? current.style,
        changes.status ?? current.status,
        changes.rationale ?? current.rationale,
        changes.scheduledFor === undefined ? current.scheduled_for : changes.scheduledFor,
        id
      ]
    );
    return this.getRow('SELECT * FROM content_ideas WHERE id = ?', [id]);
  },

  async getChannelStrategy() {
    const row = await this.getRow("SELECT * FROM channel_strategies WHERE id = 'default'");
    return row ? this.deserializeChannelStrategy(row) : null;
  },

  async saveChannelStrategy(strategy) {
    const current = await this.getChannelStrategy() || {};
    await this.executeQuery(
      `INSERT INTO channel_strategies (
        id, objective, audience, value_proposition, content_pillars, cadence_per_week,
        videos_per_run, default_format, default_length, success_metric, primary_kpi,
        target_value, target_window_days, monthly_budget, outcome_currency, constraints,
        status, created_at, updated_at
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        objective = excluded.objective, audience = excluded.audience,
        value_proposition = excluded.value_proposition, content_pillars = excluded.content_pillars,
        cadence_per_week = excluded.cadence_per_week, videos_per_run = excluded.videos_per_run,
        default_format = excluded.default_format, default_length = excluded.default_length,
        success_metric = excluded.success_metric, primary_kpi = excluded.primary_kpi,
        target_value = excluded.target_value, target_window_days = excluded.target_window_days,
        monthly_budget = excluded.monthly_budget, outcome_currency = excluded.outcome_currency,
        constraints = excluded.constraints,
        status = excluded.status, updated_at = datetime('now')`,
      [
        strategy.objective ?? current.objective ?? '',
        strategy.audience ?? current.audience ?? '',
        strategy.valueProposition ?? current.value_proposition ?? '',
        JSON.stringify(strategy.contentPillars ?? current.contentPillars ?? []),
        strategy.cadencePerWeek ?? current.cadence_per_week ?? 1,
        strategy.videosPerRun ?? current.videos_per_run ?? 1,
        strategy.defaultFormat ?? current.default_format ?? 'explainer',
        strategy.defaultLength ?? current.default_length ?? 'medium',
        strategy.successMetric ?? current.success_metric ?? '',
        strategy.primaryKpi ?? current.primary_kpi ?? 'views',
        strategy.targetValue ?? current.target_value ?? null,
        strategy.targetWindowDays ?? current.target_window_days ?? 28,
        strategy.monthlyBudget ?? current.monthly_budget ?? null,
        strategy.outcomeCurrency ?? current.outcome_currency ?? 'USD',
        strategy.constraints ?? current.constraints ?? '',
        strategy.status ?? current.status ?? 'draft',
        current.created_at || null
      ]
    );
    return this.getChannelStrategy();
  },

  deserializeChannelStrategy(row) {
    return {
      ...row,
      contentPillars: JSON.parse(row.content_pillars || '[]')
    };
  },

  async createOperatorRun(strategyId = 'default') {
    const id = this.generateId('operator');
    await this.executeQuery(
      `INSERT INTO operator_runs (id, strategy_id, research, plan, generated_jobs, summary)
       VALUES (?, ?, '{}', '[]', '[]', '{}')`,
      [id, strategyId]
    );
    return this.getOperatorRun(id);
  },

  async getOperatorRun(id) {
    const row = await this.getRow('SELECT * FROM operator_runs WHERE id = ?', [id]);
    return row ? this.deserializeOperatorRun(row) : null;
  },

  async getActiveOperatorRun() {
    const row = await this.getRow(
      "SELECT * FROM operator_runs WHERE status IN ('queued', 'running', 'cancelling') ORDER BY created_at DESC LIMIT 1"
    );
    return row ? this.deserializeOperatorRun(row) : null;
  },

  async listOperatorRuns(limit = 10) {
    const rows = await this.getAllRows('SELECT * FROM operator_runs ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(row => this.deserializeOperatorRun(row));
  },

  async updateOperatorRun(id, changes = {}) {
    const current = await this.getOperatorRun(id);
    if (!current) return null;
    await this.executeQuery(
      `UPDATE operator_runs SET status = ?, stage = ?, progress = ?, research = ?, plan = ?,
       generated_jobs = ?, summary = ?, error = ?, cancel_requested = ?,
       updated_at = datetime('now'), completed_at = ? WHERE id = ?`,
      [
        changes.status ?? current.status,
        changes.stage ?? current.stage,
        changes.progress ?? current.progress,
        JSON.stringify(changes.research ?? current.research ?? {}),
        JSON.stringify(changes.plan ?? current.plan ?? []),
        JSON.stringify(changes.generatedJobs ?? current.generatedJobs ?? []),
        JSON.stringify(changes.summary ?? current.summary ?? {}),
        changes.error === undefined ? current.error : changes.error,
        changes.cancelRequested === undefined ? current.cancel_requested : Number(changes.cancelRequested),
        changes.completedAt === undefined ? current.completed_at : changes.completedAt,
        id
      ]
    );
    return this.getOperatorRun(id);
  },

  deserializeOperatorRun(row) {
    return {
      ...row,
      research: JSON.parse(row.research || '{}'),
      plan: JSON.parse(row.plan || '[]'),
      generatedJobs: JSON.parse(row.generated_jobs || '[]'),
      summary: JSON.parse(row.summary || '{}'),
      cancelRequested: Boolean(row.cancel_requested)
    };
  },

  async createNotification(notification) {
    const id = this.generateId('notice');
    await this.executeQuery(
      `INSERT INTO notifications (id, type, level, title, message, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, notification.type || 'system', notification.level || 'info', notification.title, notification.message, JSON.stringify(notification.data || {})]
    );
    return id;
  },

  async listNotifications(limit = 20) {
    const rows = await this.getAllRows('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(row => ({ ...row, data: JSON.parse(row.data || '{}') }));
  },

  async markNotificationRead(id) {
    await this.executeQuery("UPDATE notifications SET status = 'read' WHERE id = ?", [id]);
  },

  async getRecentAutomationEvents(limit = 30) {
    const rows = await this.getAllRows('SELECT * FROM automation_events ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(row => ({ ...row, data: JSON.parse(row.data || '{}') }));
  },

  // Production readiness
  async saveReadinessRun(run) {
    await this.executeQuery(
      `INSERT OR REPLACE INTO readiness_runs (
        id, status, checks, summary, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.status,
        JSON.stringify(run.checks || []),
        JSON.stringify(run.summary || {}),
        run.startedAt,
        run.completedAt
      ]
    );
    return this.getReadinessRun(run.id);
  },

  async getReadinessRun(id) {
    const row = await this.getRow('SELECT * FROM readiness_runs WHERE id = ?', [id]);
    return this.parseReadinessRun(row);
  },

  async getLatestReadinessRun() {
    const row = await this.getRow('SELECT * FROM readiness_runs ORDER BY completed_at DESC LIMIT 1');
    return this.parseReadinessRun(row);
  },

  parseReadinessRun(row) {
    if (!row) return null;
    return {
      ...row,
      checks: JSON.parse(row.checks || '[]'),
      summary: JSON.parse(row.summary || '{}')
    };
  }
};

module.exports = { channelRepository };
