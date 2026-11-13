// Generation jobs, checkpoints and media generation tasks.
// Methods of Database, merged into its prototype (see database/db.js).
const jobsRepository = {
  async createGenerationJob(input = {}) {
    const id = this.generateId('job');
    const details = {
      strategyContext: input.strategyContext || {},
      resumeCount: 0,
      reusedStages: []
    };
    await this.executeQuery(
      `INSERT INTO generation_jobs (
        id, topic, style, length, source, status, stage, progress, details
      ) VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 0, ?)`,
      [id, input.topic || null, input.style || null, input.length || 'medium', input.source || 'manual', JSON.stringify(details)]
    );
    return this.getGenerationJob(id);
  },

  async getGenerationJob(id) {
    const row = await this.getRow('SELECT * FROM generation_jobs WHERE id = ?', [id]);
    return row ? { ...row, details: JSON.parse(row.details || '{}'), cancelRequested: Boolean(row.cancel_requested) } : null;
  },

  async updateGenerationJob(id, changes = {}) {
    const current = await this.getGenerationJob(id);
    if (!current) return null;
    const details = { ...(current.details || {}), ...(changes.details || {}) };
    await this.executeQuery(
      `UPDATE generation_jobs SET status = ?, stage = ?, progress = ?, production_id = ?,
        title = ?, error = ?, details = ?, cancel_requested = ?, updated_at = datetime('now'),
        completed_at = ? WHERE id = ?`,
      [
        changes.status ?? current.status,
        changes.stage ?? current.stage,
        changes.progress ?? current.progress,
        changes.productionId ?? current.production_id,
        changes.title ?? current.title,
        changes.error === undefined ? current.error : changes.error,
        JSON.stringify(details),
        changes.cancelRequested === undefined ? current.cancel_requested : Number(changes.cancelRequested),
        changes.completedAt === undefined ? current.completed_at : changes.completedAt,
        id
      ]
    );
    return this.getGenerationJob(id);
  },

  async listGenerationJobs(limit = 30) {
    const rows = await this.getAllRows('SELECT * FROM generation_jobs ORDER BY created_at DESC LIMIT ?', [limit]);
    return Promise.all(rows.map(async row => {
      const job = { ...row, details: JSON.parse(row.details || '{}'), cancelRequested: Boolean(row.cancel_requested) };
      job.checkpoints = await this.listGenerationCheckpoints(job.id);
      job.mediaTasks = await this.listMediaGenerationTasks(job.id);
      return job;
    }));
  },

  async saveGenerationCheckpoint(jobId, stage, changes = {}) {
    const current = await this.getGenerationCheckpoint(jobId, stage);
    const artifact = changes.artifact === undefined ? current?.artifact : changes.artifact;
    const attemptCount = changes.incrementAttempt
      ? Number(current?.attempt_count || 0) + 1
      : changes.attemptCount ?? current?.attempt_count ?? 0;
    await this.executeQuery(
      `INSERT INTO generation_checkpoints (
        job_id, stage, status, artifact, attempt_count, error, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(job_id, stage) DO UPDATE SET
        status = excluded.status, artifact = excluded.artifact,
        attempt_count = excluded.attempt_count, error = excluded.error,
        started_at = excluded.started_at, completed_at = excluded.completed_at,
        updated_at = datetime('now')`,
      [
        jobId,
        stage,
        changes.status ?? current?.status ?? 'pending',
        artifact === undefined ? null : JSON.stringify(artifact),
        attemptCount,
        changes.error === undefined ? current?.error ?? null : changes.error,
        changes.startedAt === undefined ? current?.started_at ?? null : changes.startedAt,
        changes.completedAt === undefined ? current?.completed_at ?? null : changes.completedAt
      ]
    );
    return this.getGenerationCheckpoint(jobId, stage);
  },

  async getGenerationCheckpoint(jobId, stage) {
    const row = await this.getRow(
      'SELECT * FROM generation_checkpoints WHERE job_id = ? AND stage = ?',
      [jobId, stage]
    );
    return row ? { ...row, artifact: JSON.parse(row.artifact || 'null') } : null;
  },

  async listGenerationCheckpoints(jobId) {
    const rows = await this.getAllRows(
      'SELECT * FROM generation_checkpoints WHERE job_id = ? ORDER BY updated_at, stage',
      [jobId]
    );
    return rows.map(row => ({ ...row, artifact: JSON.parse(row.artifact || 'null') }));
  },

  async deleteGenerationCheckpoints(jobId, stages = []) {
    if (!stages.length) return;
    const placeholders = stages.map(() => '?').join(', ');
    await this.executeQuery(
      `DELETE FROM generation_checkpoints WHERE job_id = ? AND stage IN (${placeholders})`,
      [jobId, ...stages]
    );
  },

  async createMediaGenerationTask(input = {}) {
    const id = this.generateId('media');
    await this.executeQuery(
      `INSERT INTO media_generation_tasks (
        id, job_id, production_id, scene_index, provider, model, status, request, provider_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
      ON CONFLICT(job_id, scene_index, provider) DO UPDATE SET
        production_id = excluded.production_id, request = excluded.request, updated_at = datetime('now')`,
      [id, input.jobId || null, input.productionId || null, input.sceneIndex, input.provider, input.model, input.status || 'submitting', JSON.stringify(input.request || {})]
    );
    return this.findMediaGenerationTask(input.jobId, input.sceneIndex, input.provider);
  },

  async findMediaGenerationTask(jobId, sceneIndex, provider) {
    const row = await this.getRow(
      'SELECT * FROM media_generation_tasks WHERE job_id IS ? AND scene_index = ? AND provider = ?',
      [jobId || null, sceneIndex, provider]
    );
    return this.parseMediaGenerationTask(row);
  },

  async updateMediaGenerationTask(id, changes = {}) {
    const current = this.parseMediaGenerationTask(await this.getRow('SELECT * FROM media_generation_tasks WHERE id = ?', [id]));
    if (!current) return null;
    await this.executeQuery(
      `UPDATE media_generation_tasks SET model = ?, external_task_id = ?, status = ?, provider_data = ?,
       output_path = ?, error = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        changes.model ?? current.model,
        changes.externalTaskId ?? current.external_task_id,
        changes.status ?? current.status,
        JSON.stringify(changes.providerData ?? current.providerData ?? {}),
        changes.outputPath ?? current.output_path,
        changes.error === undefined ? current.error : changes.error,
        changes.completedAt === undefined ? current.completed_at : changes.completedAt,
        id
      ]
    );
    return this.parseMediaGenerationTask(await this.getRow('SELECT * FROM media_generation_tasks WHERE id = ?', [id]));
  },

  async listMediaGenerationTasks(jobId) {
    const rows = await this.getAllRows('SELECT * FROM media_generation_tasks WHERE job_id = ? ORDER BY scene_index, created_at', [jobId]);
    return rows.map(row => this.parseMediaGenerationTask(row));
  },

  parseMediaGenerationTask(row) {
    return row ? {
      ...row,
      request: JSON.parse(row.request || '{}'),
      providerData: JSON.parse(row.provider_data || '{}')
    } : null;
  },

  async markInterruptedJobs() {
    await this.executeQuery(
      `UPDATE generation_jobs SET status = 'interrupted',
       error = 'The application restarted before this job finished', updated_at = datetime('now'),
       completed_at = datetime('now') WHERE status IN ('queued', 'running')`
    );
    await this.executeQuery(
      `UPDATE operator_runs SET status = 'interrupted', stage = 'interrupted',
       error = 'The application restarted before this operator run finished', updated_at = datetime('now'),
       completed_at = datetime('now') WHERE status IN ('queued', 'running', 'cancelling')`
    );
  }
};

module.exports = { jobsRepository };
