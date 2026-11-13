// Growth experiments, arms and samples.
// Methods of Database, merged into its prototype (see database/db.js).
const experimentsRepository = {
  async createGrowthExperiment(experiment, arms) {
    const id = experiment.id || this.generateId('experiment');
    await this.executeQuery(
      `INSERT INTO growth_experiments (
        id, production_id, video_id, recommendation_id, title, hypothesis,
        primary_metric, status, arm_duration_hours, min_impressions, guardrails
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, experiment.productionId, experiment.videoId, experiment.recommendationId || null,
        experiment.title, experiment.hypothesis, experiment.primaryMetric || 'ctr',
        experiment.status || 'draft', experiment.armDurationHours || 48,
        experiment.minImpressions || 1000, JSON.stringify(experiment.guardrails || {})
      ]
    );
    for (const [index, arm] of arms.entries()) {
      await this.executeQuery(
        `INSERT INTO experiment_arms (
          id, experiment_id, arm_index, label, title, thumbnail_path, is_control
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          arm.id || this.generateId('arm'), id, index, arm.label,
          arm.title, arm.thumbnailPath, arm.isControl ? 1 : 0
        ]
      );
    }
    return this.getGrowthExperiment(id);
  },

  async getGrowthExperiment(id) {
    const row = await this.getRow('SELECT * FROM growth_experiments WHERE id = ?', [id]);
    if (!row) return null;
    const arms = await this.getAllRows(
      'SELECT * FROM experiment_arms WHERE experiment_id = ? ORDER BY arm_index ASC',
      [id]
    );
    return this.parseGrowthExperiment(row, arms);
  },

  async listGrowthExperiments(options = {}) {
    const conditions = [];
    const params = [];
    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (options.productionId) {
      conditions.push('production_id = ?');
      params.push(options.productionId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
    const rows = await this.getAllRows(
      `SELECT * FROM growth_experiments ${where} ORDER BY updated_at DESC LIMIT ?`,
      [...params, limit]
    );
    return Promise.all(rows.map(async row => {
      const arms = await this.getAllRows(
        'SELECT * FROM experiment_arms WHERE experiment_id = ? ORDER BY arm_index ASC',
        [row.id]
      );
      return this.parseGrowthExperiment(row, arms);
    }));
  },

  async updateGrowthExperiment(id, changes = {}) {
    const allowed = {
      status: 'status', currentArmId: 'current_arm_id', winningArmId: 'winning_arm_id',
      result: 'result', approvedAt: 'approved_at', startedAt: 'started_at',
      completedAt: 'completed_at', adoptedAt: 'adopted_at', cancelledAt: 'cancelled_at'
    };
    const assignments = [];
    const params = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (changes[key] === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(key === 'result' ? JSON.stringify(changes[key] || {}) : changes[key]);
    }
    if (!assignments.length) return this.getGrowthExperiment(id);
    assignments.push('updated_at = CURRENT_TIMESTAMP');
    await this.executeQuery(
      `UPDATE growth_experiments SET ${assignments.join(', ')} WHERE id = ?`,
      [...params, id]
    );
    return this.getGrowthExperiment(id);
  },

  async updateExperimentArm(id, changes = {}) {
    const allowed = {
      status: 'status', baselineMetrics: 'baseline_metrics', finalMetrics: 'final_metrics',
      result: 'result', startedAt: 'started_at', endedAt: 'ended_at'
    };
    const assignments = [];
    const params = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (changes[key] === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(['baselineMetrics', 'finalMetrics', 'result'].includes(key)
        ? JSON.stringify(changes[key] || {})
        : changes[key]);
    }
    if (!assignments.length) return null;
    assignments.push('updated_at = CURRENT_TIMESTAMP');
    await this.executeQuery(`UPDATE experiment_arms SET ${assignments.join(', ')} WHERE id = ?`, [...params, id]);
    const row = await this.getRow('SELECT * FROM experiment_arms WHERE id = ?', [id]);
    return this.parseExperimentArm(row);
  },

  async saveExperimentSample(sample) {
    const id = this.generateId('sample');
    await this.executeQuery(
      `INSERT INTO experiment_samples (
        id, experiment_id, arm_id, metrics, traffic_sources, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id, sample.experimentId, sample.armId, JSON.stringify(sample.metrics || {}),
        JSON.stringify(sample.trafficSources || []), sample.capturedAt || new Date().toISOString()
      ]
    );
    return id;
  },

  async listExperimentSamples(experimentId, limit = 250) {
    const rows = await this.getAllRows(
      `SELECT * FROM experiment_samples WHERE experiment_id = ?
       ORDER BY captured_at ASC LIMIT ?`,
      [experimentId, Math.max(1, Math.min(1000, Number(limit || 250)))]
    );
    return rows.map(row => ({
      ...row,
      experimentId: row.experiment_id,
      armId: row.arm_id,
      capturedAt: row.captured_at,
      metrics: JSON.parse(row.metrics || '{}'),
      trafficSources: JSON.parse(row.traffic_sources || '[]')
    }));
  },

  parseExperimentArm(row) {
    if (!row) return null;
    return {
      ...row,
      experimentId: row.experiment_id,
      index: Number(row.arm_index),
      thumbnailPath: row.thumbnail_path,
      isControl: Boolean(row.is_control),
      baselineMetrics: JSON.parse(row.baseline_metrics || '{}'),
      finalMetrics: JSON.parse(row.final_metrics || '{}'),
      result: JSON.parse(row.result || '{}'),
      startedAt: row.started_at,
      endedAt: row.ended_at
    };
  },

  parseGrowthExperiment(row, arms = []) {
    return {
      ...row,
      productionId: row.production_id,
      videoId: row.video_id,
      recommendationId: row.recommendation_id,
      primaryMetric: row.primary_metric,
      armDurationHours: Number(row.arm_duration_hours),
      minImpressions: Number(row.min_impressions),
      currentArmId: row.current_arm_id,
      winningArmId: row.winning_arm_id,
      approvedAt: row.approved_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      adoptedAt: row.adopted_at,
      cancelledAt: row.cancelled_at,
      guardrails: JSON.parse(row.guardrails || '{}'),
      result: JSON.parse(row.result || '{}'),
      arms: arms.map(arm => this.parseExperimentArm(arm))
    };
  }
};

module.exports = { experimentsRepository };
