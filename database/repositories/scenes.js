// Production scenes, scene revisions and Shorts clips.
// Methods of Database, merged into its prototype (see database/db.js).
const scenesRepository = {
  async replaceProductionScenes(productionId, scenes = []) {
    await this.executeQuery('DELETE FROM production_scenes WHERE production_id = ?', [productionId]);
    for (const [position, scene] of scenes.entries()) {
      const id = scene.id || this.generateId('scene');
      await this.executeQuery(
        `INSERT INTO production_scenes (
          id, production_id, position, label, script_text, prompt, duration,
          asset_type, asset_origin, asset_path, audio_path,
          narration_provider, narration_model, narration_task_id, narration_error,
          narration_generated_at, narration_cost, provider, model,
          external_task_id, status, narration_status, revision, locked,
          rights_confirmed, provenance_source_ids, contains_synthetic_media,
          estimated_cost, actual_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, productionId, position, scene.label, scene.scriptText || '', scene.prompt || '', scene.duration,
          scene.assetType || 'missing', scene.assetOrigin || 'generated', scene.assetPath || null,
          scene.audioPath || null, scene.narrationProvider || null, scene.narrationModel || null,
          scene.narrationTaskId || null, scene.narrationError || null, scene.narrationGeneratedAt || null,
          JSON.stringify(scene.narrationCost || {}), scene.provider || null, scene.model || null, scene.externalTaskId || null,
          scene.status || 'ready', scene.narrationStatus || 'current', scene.revision || 1,
          scene.locked ? 1 : 0, scene.rightsConfirmed ? 1 : 0,
          JSON.stringify(scene.provenanceSourceIds || []), scene.containsSyntheticMedia ? 1 : 0,
          JSON.stringify(scene.estimatedCost || {}), JSON.stringify(scene.actualCost || {})
        ]
      );
    }
    return this.listProductionScenes(productionId);
  },

  async listProductionScenes(productionId) {
    const rows = await this.getAllRows(
      'SELECT * FROM production_scenes WHERE production_id = ? ORDER BY position, created_at',
      [productionId]
    );
    return rows.map(row => this.parseProductionScene(row));
  },

  async getProductionScene(productionId, sceneId) {
    return this.parseProductionScene(await this.getRow(
      'SELECT * FROM production_scenes WHERE production_id = ? AND id = ?',
      [productionId, sceneId]
    ));
  },

  async updateProductionScene(productionId, sceneId, changes = {}) {
    const current = await this.getProductionScene(productionId, sceneId);
    if (!current) return null;
    const next = { ...current, ...changes };
    await this.executeQuery(
      `UPDATE production_scenes SET
        position = ?, label = ?, script_text = ?, prompt = ?, duration = ?,
        asset_type = ?, asset_origin = ?, asset_path = ?, audio_path = ?,
        narration_provider = ?, narration_model = ?, narration_task_id = ?, narration_error = ?,
        narration_generated_at = ?, narration_cost = ?, provider = ?,
        model = ?, external_task_id = ?, status = ?, narration_status = ?, revision = ?,
        locked = ?, rights_confirmed = ?, provenance_source_ids = ?,
        contains_synthetic_media = ?, estimated_cost = ?, actual_cost = ?,
        updated_at = datetime('now')
       WHERE production_id = ? AND id = ?`,
      [
        next.position, next.label, next.scriptText || '', next.prompt || '', next.duration,
        next.assetType || 'missing', next.assetOrigin || 'generated', next.assetPath || null,
        next.audioPath || null, next.narrationProvider || null, next.narrationModel || null,
        next.narrationTaskId || null, next.narrationError || null, next.narrationGeneratedAt || null,
        JSON.stringify(next.narrationCost || {}), next.provider || null, next.model || null, next.externalTaskId || null,
        next.status || 'ready', next.narrationStatus || 'current', next.revision || 1,
        next.locked ? 1 : 0, next.rightsConfirmed ? 1 : 0,
        JSON.stringify(next.provenanceSourceIds || []), next.containsSyntheticMedia ? 1 : 0,
        JSON.stringify(next.estimatedCost || {}), JSON.stringify(next.actualCost || {}),
        productionId, sceneId
      ]
    );
    return this.getProductionScene(productionId, sceneId);
  },

  async reorderProductionScenes(productionId, orderedIds = []) {
    const scenes = await this.listProductionScenes(productionId);
    if (orderedIds.length !== scenes.length || new Set(orderedIds).size !== scenes.length ||
      scenes.some(scene => !orderedIds.includes(scene.id))) {
      throw new Error('Scene order must contain every scene exactly once');
    }
    // Move through temporary negative positions to preserve the unique constraint.
    for (const scene of scenes) {
      await this.executeQuery('UPDATE production_scenes SET position = ? WHERE id = ?', [-(scene.position + 1), scene.id]);
    }
    for (const [position, sceneId] of orderedIds.entries()) {
      await this.executeQuery(
        `UPDATE production_scenes SET position = ?, status = 'needs_rebuild', updated_at = datetime('now') WHERE id = ?`,
        [position, sceneId]
      );
    }
    return this.listProductionScenes(productionId);
  },

  async saveProductionSceneRevision(input = {}) {
    const id = this.generateId('scene_revision');
    await this.executeQuery(
      `INSERT INTO production_scene_revisions (
        id, production_id, scene_id, action, status, before_state, after_state,
        cost_evidence, error, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.productionId, input.sceneId, input.action, input.status || 'completed',
        JSON.stringify(input.before || {}), JSON.stringify(input.after || {}),
        JSON.stringify(input.costEvidence || {}), input.error || null,
        input.completedAt || new Date().toISOString()
      ]
    );
    return this.getProductionSceneRevision(id);
  },

  async getProductionSceneRevision(id) {
    return this.parseProductionSceneRevision(await this.getRow('SELECT * FROM production_scene_revisions WHERE id = ?', [id]));
  },

  async listProductionSceneRevisions(productionId, limit = 100) {
    const rows = await this.getAllRows(
      'SELECT * FROM production_scene_revisions WHERE production_id = ? ORDER BY created_at DESC LIMIT ?',
      [productionId, limit]
    );
    return rows.map(row => this.parseProductionSceneRevision(row));
  },

  parseProductionScene(row) {
    if (!row) return null;
    return {
      ...row,
      position: Number(row.position),
      duration: Number(row.duration),
      scriptText: row.script_text || '',
      assetType: row.asset_type || 'missing',
      assetOrigin: row.asset_origin || 'generated',
      assetPath: row.asset_path || null,
      audioPath: row.audio_path || null,
      narrationProvider: row.narration_provider || null,
      narrationModel: row.narration_model || null,
      narrationTaskId: row.narration_task_id || null,
      narrationError: row.narration_error || null,
      narrationGeneratedAt: row.narration_generated_at || null,
      narrationCost: JSON.parse(row.narration_cost || '{}'),
      externalTaskId: row.external_task_id || null,
      narrationStatus: row.narration_status || 'current',
      revision: Number(row.revision || 1),
      locked: Boolean(row.locked),
      rightsConfirmed: Boolean(row.rights_confirmed),
      provenanceSourceIds: JSON.parse(row.provenance_source_ids || '[]'),
      containsSyntheticMedia: Boolean(row.contains_synthetic_media),
      estimatedCost: JSON.parse(row.estimated_cost || '{}'),
      actualCost: JSON.parse(row.actual_cost || '{}')
    };
  },

  parseProductionSceneRevision(row) {
    return row ? {
      ...row,
      before: JSON.parse(row.before_state || '{}'),
      after: JSON.parse(row.after_state || '{}'),
      costEvidence: JSON.parse(row.cost_evidence || '{}')
    } : null;
  },

  async replaceShortClips(productionId, clips = []) {
    await this.executeQuery('DELETE FROM shorts_clips WHERE production_id = ?', [productionId]);
    for (const [position, clip] of clips.entries()) {
      const id = clip.id || this.generateId('short');
      await this.executeQuery(
        `INSERT INTO shorts_clips (
          id, production_id, position, title, description, tags, source_scene_ids,
          start_seconds, duration, layout, rationale, status, output_path, captions_path,
          publish_time, privacy_status, inherited_evidence, rendered_at, approved_at,
          schedule_id, youtube_id, youtube_url, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, productionId, position, clip.title, clip.description || '', JSON.stringify(clip.tags || []),
          JSON.stringify(clip.sourceSceneIds || []), Number(clip.startSeconds || 0), Number(clip.duration || 30),
          clip.layout || 'blur', clip.rationale || null, clip.status || 'proposed', clip.outputPath || null,
          clip.captionsPath || null, clip.publishTime || null, clip.privacyStatus || 'private',
          JSON.stringify(clip.inheritedEvidence || {}), clip.renderedAt || null, clip.approvedAt || null,
          clip.scheduleId || null, clip.youtubeId || null, clip.youtubeUrl || null, clip.error || null
        ]
      );
    }
    return this.listShortClips(productionId);
  },

  async listShortClips(productionId) {
    const rows = await this.getAllRows(
      'SELECT * FROM shorts_clips WHERE production_id = ? ORDER BY position, created_at',
      [productionId]
    );
    return rows.map(row => this.parseShortClip(row));
  },

  async getShortClip(id) {
    return this.parseShortClip(await this.getRow('SELECT * FROM shorts_clips WHERE id = ?', [id]));
  },

  async updateShortClip(id, changes = {}) {
    const current = await this.getShortClip(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    await this.executeQuery(
      `UPDATE shorts_clips SET
        title = ?, description = ?, tags = ?, source_scene_ids = ?, start_seconds = ?,
        duration = ?, layout = ?, rationale = ?, status = ?, output_path = ?, captions_path = ?,
        publish_time = ?, privacy_status = ?, inherited_evidence = ?, rendered_at = ?, approved_at = ?,
        schedule_id = ?, youtube_id = ?, youtube_url = ?, error = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        next.title, next.description || '', JSON.stringify(next.tags || []), JSON.stringify(next.sourceSceneIds || []),
        Number(next.startSeconds || 0), Number(next.duration || 30), next.layout || 'blur', next.rationale || null,
        next.status || 'proposed', next.outputPath || null, next.captionsPath || null, next.publishTime || null,
        next.privacyStatus || 'private', JSON.stringify(next.inheritedEvidence || {}), next.renderedAt || null,
        next.approvedAt || null, next.scheduleId || null, next.youtubeId || null, next.youtubeUrl || null,
        next.error || null, id
      ]
    );
    return this.getShortClip(id);
  },

  parseShortClip(row) {
    if (!row) return null;
    return {
      ...row,
      productionId: row.production_id,
      position: Number(row.position),
      tags: JSON.parse(row.tags || '[]'),
      sourceSceneIds: JSON.parse(row.source_scene_ids || '[]'),
      startSeconds: Number(row.start_seconds || 0),
      duration: Number(row.duration || 0),
      outputPath: row.output_path || null,
      captionsPath: row.captions_path || null,
      publishTime: row.publish_time || null,
      privacyStatus: row.privacy_status || 'private',
      inheritedEvidence: JSON.parse(row.inherited_evidence || '{}'),
      renderedAt: row.rendered_at || null,
      approvedAt: row.approved_at || null,
      scheduleId: row.schedule_id || null,
      youtubeId: row.youtube_id || null,
      youtubeUrl: row.youtube_url || null
    };
  }
};

module.exports = { scenesRepository };
