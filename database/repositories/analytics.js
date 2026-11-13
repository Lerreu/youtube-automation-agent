// Analytics reports, performance and retention snapshots, learning recommendations.
// Methods of Database, merged into its prototype (see database/db.js).
const analyticsRepository = {
  // Analytics methods
  async saveAnalyticsReport(report) {
    const id = this.generateId('analytics');
    
    await this.executeQuery(
      `INSERT INTO analytics_reports (
        id, video_id, youtube_id, video_details, analytics_data,
        thumbnail_metrics, seo_metrics, insights, performance_score,
        performance_grade
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        report.videoId,
        report.youtubeId || null,
        JSON.stringify(report.videoDetails),
        JSON.stringify(report.analytics),
        JSON.stringify(report.thumbnailMetrics),
        JSON.stringify(report.seoMetrics),
        JSON.stringify(report.insights),
        report.performance.score,
        report.performance.grade
      ]
    );
    
    return id;
  },

  async getAnalyticsHistory() {
    const rows = await this.getAllRows(
      'SELECT * FROM analytics_reports ORDER BY analyzed_at DESC'
    );
    
    return rows.map(row => ({
      ...row,
      videoDetails: JSON.parse(row.video_details || '{}'),
      analytics: JSON.parse(row.analytics_data || '{}'),
      thumbnailMetrics: JSON.parse(row.thumbnail_metrics || '{}'),
      seoMetrics: JSON.parse(row.seo_metrics || '{}'),
      insights: JSON.parse(row.insights || '[]')
    }));
  },

  async savePerformanceSnapshot(snapshot) {
    const existing = await this.getRow(
      'SELECT id FROM performance_snapshots WHERE video_id = ? AND measurement_window = ?',
      [snapshot.videoId, snapshot.measurementWindow]
    );
    const id = existing?.id || this.generateId('snapshot');
    await this.executeQuery(
      `INSERT INTO performance_snapshots (
        id, video_id, production_id, measurement_window, published_at, metrics,
        content_attributes, baseline, deltas, confidence, simulated, measured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, measurement_window) DO UPDATE SET
        production_id = excluded.production_id,
        published_at = excluded.published_at,
        metrics = excluded.metrics,
        content_attributes = excluded.content_attributes,
        baseline = excluded.baseline,
        deltas = excluded.deltas,
        confidence = excluded.confidence,
        simulated = excluded.simulated,
        measured_at = excluded.measured_at`,
      [
        id,
        snapshot.videoId,
        snapshot.productionId || null,
        snapshot.measurementWindow,
        snapshot.publishedAt || null,
        JSON.stringify(snapshot.metrics || {}),
        JSON.stringify(snapshot.contentAttributes || {}),
        JSON.stringify(snapshot.baseline || {}),
        JSON.stringify(snapshot.deltas || {}),
        snapshot.confidence || 'low',
        snapshot.simulated ? 1 : 0,
        snapshot.measuredAt || new Date().toISOString()
      ]
    );
    return this.getPerformanceSnapshot(id);
  },

  async getPerformanceSnapshot(id) {
    const row = await this.getRow('SELECT * FROM performance_snapshots WHERE id = ?', [id]);
    return this.parsePerformanceSnapshot(row);
  },

  async listPerformanceSnapshots(options = {}) {
    const conditions = [];
    const params = [];
    if (options.videoId) {
      conditions.push('video_id = ?');
      params.push(options.videoId);
    }
    if (options.excludeVideoId) {
      conditions.push('video_id != ?');
      params.push(options.excludeVideoId);
    }
    if (options.measurementWindow) {
      conditions.push('measurement_window = ?');
      params.push(options.measurementWindow);
    }
    if (options.reliableOnly) conditions.push('simulated = 0');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.getAllRows(
      `SELECT * FROM performance_snapshots ${where} ORDER BY measured_at DESC`,
      params
    );
    return rows.map(row => this.parsePerformanceSnapshot(row));
  },

  parsePerformanceSnapshot(row) {
    if (!row) return null;
    return {
      ...row,
      videoId: row.video_id,
      productionId: row.production_id,
      measurementWindow: row.measurement_window,
      publishedAt: row.published_at,
      measuredAt: row.measured_at,
      simulated: Boolean(row.simulated),
      metrics: JSON.parse(row.metrics || '{}'),
      contentAttributes: JSON.parse(row.content_attributes || '{}'),
      baseline: JSON.parse(row.baseline || '{}'),
      deltas: JSON.parse(row.deltas || '{}')
    };
  },

  async saveRetentionSnapshot(snapshot) {
    const existing = await this.getRow(
      'SELECT id FROM retention_snapshots WHERE video_id = ? AND measurement_window = ?',
      [snapshot.videoId, snapshot.measurementWindow]
    );
    const id = existing?.id || this.generateId('retention');
    await this.executeQuery(
      `INSERT INTO retention_snapshots (
        id, video_id, production_id, short_clip_id, title, surface,
        measurement_window, published_at, duration_seconds, points,
        scene_metrics, summary, confidence, measured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id, measurement_window) DO UPDATE SET
        production_id = excluded.production_id,
        short_clip_id = excluded.short_clip_id,
        title = excluded.title,
        surface = excluded.surface,
        published_at = excluded.published_at,
        duration_seconds = excluded.duration_seconds,
        points = excluded.points,
        scene_metrics = excluded.scene_metrics,
        summary = excluded.summary,
        confidence = excluded.confidence,
        measured_at = excluded.measured_at`,
      [
        id,
        snapshot.videoId,
        snapshot.productionId || null,
        snapshot.shortClipId || null,
        snapshot.title || null,
        snapshot.surface || 'long_form',
        snapshot.measurementWindow,
        snapshot.publishedAt || null,
        Number(snapshot.durationSeconds || 0),
        JSON.stringify(snapshot.points || []),
        JSON.stringify(snapshot.sceneMetrics || []),
        JSON.stringify(snapshot.summary || {}),
        snapshot.confidence || 'low',
        snapshot.measuredAt || new Date().toISOString()
      ]
    );
    return this.getRetentionSnapshot(id);
  },

  async getRetentionSnapshot(id) {
    const row = await this.getRow('SELECT * FROM retention_snapshots WHERE id = ?', [id]);
    return this.parseRetentionSnapshot(row);
  },

  async listRetentionSnapshots(options = {}) {
    const conditions = [];
    const params = [];
    if (options.videoId) {
      conditions.push('video_id = ?');
      params.push(options.videoId);
    }
    if (options.surface) {
      conditions.push('surface = ?');
      params.push(options.surface);
    }
    if (options.measurementWindow) {
      conditions.push('measurement_window = ?');
      params.push(options.measurementWindow);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(50, Number(options.limit || 12)));
    const rows = await this.getAllRows(
      `SELECT * FROM retention_snapshots ${where} ORDER BY measured_at DESC LIMIT ?`,
      [...params, limit]
    );
    return rows.map(row => this.parseRetentionSnapshot(row));
  },

  parseRetentionSnapshot(row) {
    if (!row) return null;
    return {
      ...row,
      videoId: row.video_id,
      productionId: row.production_id,
      shortClipId: row.short_clip_id,
      measurementWindow: row.measurement_window,
      publishedAt: row.published_at,
      durationSeconds: Number(row.duration_seconds || 0),
      measuredAt: row.measured_at,
      points: JSON.parse(row.points || '[]'),
      sceneMetrics: JSON.parse(row.scene_metrics || '[]'),
      summary: JSON.parse(row.summary || '{}')
    };
  },

  async saveLearningRecommendation(recommendation) {
    const existing = await this.getRow(
      'SELECT id FROM learning_recommendations WHERE fingerprint = ?',
      [recommendation.fingerprint]
    );
    const id = existing?.id || this.generateId('learning');
    await this.executeQuery(
      `INSERT INTO learning_recommendations (
        id, fingerprint, category, title, rationale, evidence, proposed_change, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        category = excluded.category,
        title = excluded.title,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        proposed_change = excluded.proposed_change,
        confidence = excluded.confidence,
        updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        recommendation.fingerprint,
        recommendation.category,
        recommendation.title,
        recommendation.rationale,
        JSON.stringify(recommendation.evidence || {}),
        JSON.stringify(recommendation.proposedChange || {}),
        recommendation.confidence || 'low'
      ]
    );
    return this.getLearningRecommendation(id);
  },

  async getLearningRecommendation(id) {
    const row = await this.getRow('SELECT * FROM learning_recommendations WHERE id = ?', [id]);
    return this.parseLearningRecommendation(row);
  },

  async listLearningRecommendations(options = {}) {
    const conditions = [];
    const params = [];
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
    const rows = await this.getAllRows(
      `SELECT * FROM learning_recommendations ${where}
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                updated_at DESC LIMIT ?`,
      [...params, limit]
    );
    return rows.map(row => this.parseLearningRecommendation(row));
  },

  async reviewLearningRecommendation(id, status) {
    if (!['approved', 'rejected'].includes(status)) return null;
    await this.executeQuery(
      `UPDATE learning_recommendations
       SET status = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, id]
    );
    return this.getLearningRecommendation(id);
  },

  parseLearningRecommendation(row) {
    if (!row) return null;
    return {
      ...row,
      proposedChange: JSON.parse(row.proposed_change || '{}'),
      evidence: JSON.parse(row.evidence || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reviewedAt: row.reviewed_at
    };
  },

  async getPublishedContentContext(youtubeId) {
    const schedule = await this.getRow(
      `SELECT production_id, published_at, title, metadata
       FROM publish_schedule WHERE youtube_id = ? ORDER BY published_at DESC LIMIT 1`,
      [youtubeId]
    );
    if (!schedule) return {};
    const metadata = JSON.parse(schedule.metadata || '{}');
    const sourceProductionId = metadata.sourceProductionId || schedule.production_id;
    const row = await this.getRow(
      `SELECT ps.strategy, ps.script, ps.thumbnail, ps.seo, cr.editor_data
       FROM production_snapshots ps
       LEFT JOIN content_reviews cr ON cr.production_id = ps.production_id
       WHERE ps.production_id = ?`,
      [sourceProductionId]
    ) || {};
    const editorData = JSON.parse(row.editor_data || '{}');
    const thumbnail = JSON.parse(row.thumbnail || '{}');
    const selectedThumbnail = editorData.packagingExperiment?.thumbnailVariants?.[editorData.selectedThumbnailVariant];
    const isShort = metadata.contentType === 'short';
    const strategy = JSON.parse(row.strategy || '{}');
    const sourceScenes = await this.listProductionScenes(sourceProductionId);
    const shortClip = isShort && metadata.shortClipId ? await this.getShortClip(metadata.shortClipId) : null;
    return {
      productionId: sourceProductionId,
      shortClipId: metadata.shortClipId || null,
      contentFormat: isShort ? 'short' : 'long_form',
      publishedAt: schedule.published_at,
      title: isShort ? schedule.title : editorData.title || schedule.title,
      strategy: isShort
        ? { ...strategy, contentType: 'shorts', requestedStyle: 'shorts', requestedLengthKey: 'short' }
        : strategy,
      script: JSON.parse(row.script || '{}'),
      thumbnail: selectedThumbnail?.concept ? { ...thumbnail, concept: selectedThumbnail.concept } : thumbnail,
      seo: JSON.parse(row.seo || '{}'),
      productionCost: this.summarizeProductionCost(sourceScenes),
      retentionScenes: this.buildRetentionSceneContext(sourceScenes, shortClip),
      retentionDuration: isShort ? shortClip?.duration || null : sourceScenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0)
    };
  },

  buildRetentionSceneContext(scenes = [], shortClip = null) {
    let cursor = 0;
    const timeline = scenes.map(scene => {
      const duration = Math.max(0, Number(scene.duration || 0));
      const item = { ...scene, startSeconds: cursor, endSeconds: cursor + duration };
      cursor += duration;
      return item;
    });
    if (!shortClip) return timeline;

    const clipStart = Math.max(0, Number(shortClip.startSeconds || 0));
    const clipEnd = clipStart + Math.max(0, Number(shortClip.duration || 0));
    const allowed = new Set(shortClip.sourceSceneIds || []);
    return timeline.flatMap(scene => {
      if (allowed.size && !allowed.has(scene.id)) return [];
      const start = Math.max(scene.startSeconds, clipStart);
      const end = Math.min(scene.endSeconds, clipEnd);
      if (end <= start) return [];
      return [{
        ...scene,
        sourceStartSeconds: start,
        startSeconds: start - clipStart,
        endSeconds: end - clipStart,
        duration: end - start
      }];
    });
  }
};

module.exports = { analyticsRepository };
