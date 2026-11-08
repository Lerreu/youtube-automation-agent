// Strategies, scripts, thumbnails, SEO, productions, reviews and provenance.
// Methods of Database, merged into its prototype (see database/db.js).
const contentRepository = {
  // Content Strategy methods
  async saveContentStrategy(strategy) {
    const id = this.generateId('strategy');
    await this.executeQuery(
      `INSERT INTO content_strategies (
        id, topic, angle, target_audience, content_type, keywords, 
        estimated_views, best_publish_time, competitor_analysis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        strategy.topic,
        strategy.angle,
        strategy.targetAudience,
        strategy.contentType,
        JSON.stringify(strategy.keywords),
        strategy.estimatedViews,
        strategy.bestPublishTime,
        JSON.stringify(strategy.competitorAnalysis)
      ]
    );
    return id;
  },

  async getContentHistory() {
    const rows = await this.getAllRows('SELECT * FROM content_history ORDER BY publish_date DESC');
    return rows;
  },

  // Script methods
  async saveScript(script) {
    const id = this.generateId('script');
    await this.executeQuery(
      `INSERT INTO scripts (
        id, title, hook, introduction, main_content, conclusion, 
        call_to_action, full_script, duration, tone, pacing, keywords
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        script.title,
        JSON.stringify(script.hook),
        JSON.stringify(script.introduction),
        JSON.stringify(script.mainContent),
        JSON.stringify(script.conclusion),
        JSON.stringify(script.callToAction),
        script.fullScript,
        script.duration,
        script.tone,
        script.pacing,
        JSON.stringify(script.keywords)
      ]
    );
    return id;
  },

  // Thumbnail methods
  async saveThumbnail(thumbnail) {
    const id = this.generateId('thumbnail');
    await this.executeQuery(
      `INSERT INTO thumbnails (
        id, path, concept, prompt, dimensions, file_size
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        thumbnail.path,
        JSON.stringify(thumbnail.concept),
        thumbnail.prompt,
        JSON.stringify(thumbnail.dimensions),
        thumbnail.fileSize
      ]
    );
    return id;
  },

  // SEO methods
  async saveSEOData(seoData) {
    const id = this.generateId('seo');
    await this.executeQuery(
      `INSERT INTO seo_data (
        id, title, description, tags, hashtags, chapters, 
        end_screen, seo_score, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        seoData.title,
        seoData.description,
        JSON.stringify(seoData.tags),
        JSON.stringify(seoData.hashtags),
        JSON.stringify(seoData.chapters),
        JSON.stringify(seoData.endScreen),
        seoData.seoScore,
        JSON.stringify(seoData.metadata)
      ]
    );
    return id;
  },

  // Production methods
  async saveProductionData(production) {
    await this.executeQuery(
      `INSERT OR REPLACE INTO productions (
        id, status, assets, timeline, scheduled_publish_time, 
        priority, estimated_duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        production.id,
        production.status,
        JSON.stringify(production.assets),
        JSON.stringify(production.timeline),
        production.scheduledPublishTime,
        production.priority,
        production.estimatedDuration
      ]
    );
  
    return production.id;
  },

  async updateProductionData(production) {
    await this.executeQuery(
      `UPDATE productions SET 
        status = ?, assets = ?, timeline = ?, 
        scheduled_publish_time = ?, priority = ?
      WHERE id = ?`,
      [
        production.status,
        JSON.stringify(production.assets),
        JSON.stringify(production.timeline),
        production.scheduledPublishTime,
        production.priority,
        production.id
      ]
    );
  },

  async getProductionPipeline() {
    const rows = await this.getAllRows(
      'SELECT * FROM productions ORDER BY priority DESC, created_at ASC'
    );
    return rows.map(row => ({
      ...row,
      assets: JSON.parse(row.assets || '{}'),
      timeline: JSON.parse(row.timeline || '{}')
    }));
  },

  async saveProductionSnapshot(production) {
    await this.executeQuery(
      `INSERT OR REPLACE INTO production_snapshots (
        production_id, strategy, script, thumbnail, seo
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        production.id,
        JSON.stringify(production.strategy || {}),
        JSON.stringify(production.script || {}),
        JSON.stringify(production.thumbnail || {}),
        JSON.stringify(production.seo || {})
      ]
    );
  },

  async updateProductionStatus(productionId, status) {
    await this.executeQuery('UPDATE productions SET status = ? WHERE id = ?', [status, productionId]);
  },

  async getProductionBundle(productionId) {
    const row = await this.getRow(
      `SELECT p.*, ps.strategy, ps.script, ps.thumbnail, ps.seo,
              cr.status AS review_status, cr.editor_data, cr.quality_checks,
              cr.review_notes, cr.reviewed_at
       FROM productions p
       LEFT JOIN production_snapshots ps ON ps.production_id = p.id
       LEFT JOIN content_reviews cr ON cr.production_id = p.id
       WHERE p.id = ?`,
      [productionId]
    );
    if (!row) return null;

    const schedule = await this.getRow(
      'SELECT * FROM publish_schedule WHERE production_id = ? ORDER BY created_at DESC LIMIT 1',
      [productionId]
    );
    const provenance = await this.getContentProvenance(productionId);
    const discoverability = await this.getLatestDiscoverabilityAudit(productionId, 'youtube');
    const scenes = await this.listProductionScenes(productionId);
    const sceneRevisions = scenes.length ? await this.listProductionSceneRevisions(productionId, 50) : [];
    const shorts = await this.listShortClips(productionId);
    return {
      ...row,
      assets: JSON.parse(row.assets || '{}'),
      timeline: JSON.parse(row.timeline || '{}'),
      strategy: JSON.parse(row.strategy || '{}'),
      script: JSON.parse(row.script || '{}'),
      thumbnail: JSON.parse(row.thumbnail || '{}'),
      seo: JSON.parse(row.seo || '{}'),
      editorData: JSON.parse(row.editor_data || '{}'),
      qualityChecks: JSON.parse(row.quality_checks || '[]'),
      schedule: schedule ? { ...schedule, metadata: JSON.parse(schedule.metadata || '{}') } : null,
      provenance: provenance || {
        sources: [], claims: [], containsSyntheticMedia: false, status: 'not_required',
        summary: { sourceCount: 0, verifiedSources: 0, claimCount: 0, resolvedClaims: 0, highRiskClaims: 0, unresolvedClaims: 0 }
      },
      discoverability,
      scenes,
      sceneRevisions,
      shorts
    };
  },

  async getPipelineOverview(limit = 50) {
    const rows = await this.getAllRows(
      `SELECT p.id, p.status, p.assets, p.timeline, p.scheduled_publish_time,
              p.priority, p.estimated_duration, p.created_at,
              ps.strategy, ps.script, ps.seo,
              cr.status AS review_status, cr.quality_checks,
              sch.id AS schedule_id, sch.status AS schedule_status,
              sch.publish_time, sch.youtube_url, sch.error_message
       FROM productions p
       LEFT JOIN production_snapshots ps ON ps.production_id = p.id
       LEFT JOIN content_reviews cr ON cr.production_id = p.id
       LEFT JOIN publish_schedule sch ON sch.id = (
         SELECT id FROM publish_schedule WHERE production_id = p.id ORDER BY created_at DESC LIMIT 1
       )
       ORDER BY p.created_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(row => {
      const strategy = JSON.parse(row.strategy || '{}');
      const script = JSON.parse(row.script || '{}');
      const seo = JSON.parse(row.seo || '{}');
      const assets = JSON.parse(row.assets || '{}');
      return {
        ...row,
        strategy,
        script,
        seo,
        assets,
        timeline: JSON.parse(row.timeline || '{}'),
        qualityChecks: JSON.parse(row.quality_checks || '[]'),
        title: seo.title || script.title || strategy.topic || row.id,
        topic: strategy.topic || '',
        hasVideo: Boolean(assets.finalVideo?.path && !assets.finalVideo?.simulated),
        hasThumbnail: Boolean(assets.thumbnail?.path)
      };
    });
  },

  async saveContentReview(productionId, review = {}) {
    await this.executeQuery(
      `INSERT INTO content_reviews (
        production_id, status, editor_data, quality_checks, review_notes, reviewed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(production_id) DO UPDATE SET
        status = excluded.status, editor_data = excluded.editor_data,
        quality_checks = excluded.quality_checks, review_notes = excluded.review_notes,
        reviewed_at = excluded.reviewed_at, updated_at = datetime('now')`,
      [
        productionId,
        review.status || 'needs_review',
        JSON.stringify(review.editorData || {}),
        JSON.stringify(review.qualityChecks || []),
        review.reviewNotes || null,
        review.reviewedAt || null
      ]
    );
    return this.getProductionBundle(productionId);
  },

  async saveContentProvenance(productionId, provenance = {}) {
    await this.executeQuery(
      `INSERT INTO content_provenance (
        production_id, sources, claims, contains_synthetic_media, status, summary, reviewed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(production_id) DO UPDATE SET
        sources = excluded.sources, claims = excluded.claims,
        contains_synthetic_media = excluded.contains_synthetic_media,
        status = excluded.status, summary = excluded.summary,
        reviewed_at = excluded.reviewed_at, updated_at = datetime('now')`,
      [
        productionId,
        JSON.stringify(provenance.sources || []),
        JSON.stringify(provenance.claims || []),
        Number(provenance.containsSyntheticMedia === true),
        provenance.status || 'not_required',
        JSON.stringify(provenance.summary || {}),
        provenance.reviewedAt || null
      ]
    );
    return this.getContentProvenance(productionId);
  },

  async getContentProvenance(productionId) {
    const row = await this.getRow('SELECT * FROM content_provenance WHERE production_id = ?', [productionId]);
    return row ? {
      ...row,
      sources: JSON.parse(row.sources || '[]'),
      claims: JSON.parse(row.claims || '[]'),
      containsSyntheticMedia: Boolean(row.contains_synthetic_media),
      summary: JSON.parse(row.summary || '{}'),
      reviewedAt: row.reviewed_at
    } : null;
  },

  summarizeProductionCost(scenes = []) {
    const entries = scenes.flatMap(scene => [scene.actualCost, scene.narrationCost]).filter(entry => entry && (
      entry.amount !== undefined || entry.billed !== undefined || entry.invoiceRequired || entry.provider || entry.generatedSeconds
    ));
    const currencies = new Set();
    const providers = new Set();
    let amount = 0;
    let knownEntries = 0;
    let unknownEntries = 0;
    let freeEntries = 0;
    for (const entry of entries) {
      if (entry.provider) providers.add(String(entry.provider));
      if (entry.billed === false) {
        freeEntries++;
        continue;
      }
      const numericAmount = Number(entry.amount);
      if (Number.isFinite(numericAmount) && numericAmount >= 0) {
        amount += numericAmount;
        knownEntries++;
        if (entry.currency) currencies.add(String(entry.currency).toUpperCase());
      } else if (entry.invoiceRequired || entry.billed !== false) {
        unknownEntries++;
      }
    }
    return {
      amount: currencies.size > 1 ? null : knownEntries ? Number(amount.toFixed(4)) : freeEntries && unknownEntries === 0 ? 0 : null,
      currency: currencies.size === 1 ? [...currencies][0] : null,
      complete: unknownEntries === 0 && currencies.size <= 1,
      knownEntries,
      unknownEntries,
      freeEntries,
      providers: [...providers]
    };
  },

  // Keyword performance
  async updateKeywordPerformance(keyword, views, videoId) {
    const existing = await this.getRow(
      'SELECT * FROM keyword_performance WHERE keyword = ?',
      [keyword]
    );
    
    if (existing) {
      await this.executeQuery(
        `UPDATE keyword_performance SET 
          total_uses = total_uses + 1,
          total_views = total_views + ?,
          average_views = (total_views + ?) / (total_uses + 1),
          best_performing_video = CASE 
            WHEN ? > (total_views / total_uses) THEN ?
            ELSE best_performing_video
          END,
          last_used = datetime('now')
        WHERE keyword = ?`,
        [views, views, views, videoId, keyword]
      );
    } else {
      await this.executeQuery(
        `INSERT INTO keyword_performance (
          keyword, total_uses, total_views, average_views,
          best_performing_video, last_used, performance_score
        ) VALUES (?, 1, ?, ?, ?, datetime('now'), ?)`,
        [keyword, views, views, videoId, Math.min(100, views / 1000)]
      );
    }
  },

  async getKeywordHistory() {
    const rows = await this.getAllRows(
      'SELECT * FROM keyword_performance ORDER BY performance_score DESC'
    );
    return rows;
  }
};

module.exports = { contentRepository };
