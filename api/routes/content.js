// Content review, scenes, Shorts, assets, provenance, discoverability and scheduling.
// Extracted from index.js; `agent` is the YouTubeAutomationAgent instance.
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { ProvenanceService } = require('../../utils/provenance-service');
const ROOT = path.join(__dirname, '..', '..');

function register(agent, { app, protect }) {
  app.get('/api/content/:productionId', async (req, res) => {
    let bundle = await agent.db.getProductionBundle(req.params.productionId);
    if (!bundle) return res.status(404).json({ error: 'Content not found' });
    if (agent.scenes && !bundle.scenes?.length) {
      await agent.scenes.ensureManifest(bundle);
      bundle = await agent.db.getProductionBundle(req.params.productionId);
    }
    return res.json(agent.decorateContentBundle(bundle));
  });

  app.get('/api/content/:productionId/scenes/:sceneId/estimate', async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
      const result = await agent.scenes.regenerationEstimate(req.params.productionId, req.params.sceneId, {
        provider: req.query.provider
      });
      return res.json(result);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message, code: error.code, details: error.details });
    }
  });

  app.patch('/api/content/:productionId/scenes/:sceneId', protect, async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
      const result = await agent.scenes.updateScene(req.params.productionId, req.params.sceneId, req.body || {});
      await agent.refreshContentReview(req.params.productionId, 'Scene changes require review before scheduling');
      return res.json({ success: true, result: agent.scenes.decorateScene(result, req.params.productionId) });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
    }
  });

  app.post('/api/content/:productionId/scenes/reorder', protect, async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
      const result = await agent.scenes.reorder(req.params.productionId, req.body?.sceneIds);
      await agent.refreshContentReview(req.params.productionId, 'Timeline order changed; rebuild and review before scheduling');
      return res.json({ success: true, result: result.map(scene => agent.scenes.decorateScene(scene, req.params.productionId)) });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
    }
  });

  app.post('/api/content/:productionId/scenes/:sceneId/regenerate', protect, async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
      const result = await agent.scenes.regenerate(req.params.productionId, req.params.sceneId, req.body || {});
      await agent.refreshContentReview(req.params.productionId, 'Regenerated scene must be rebuilt and reviewed');
      return res.status(202).json({ success: true, result: {
        ...result,
        scene: agent.scenes.decorateScene(result.scene, req.params.productionId)
      } });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
    }
  });

  app.post('/api/content/:productionId/shorts/propose', protect, async (req, res) => {
    try {
      if (!agent.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
      const result = await agent.shorts.propose(req.params.productionId, req.body || {});
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.patch('/api/content/:productionId/shorts/:clipId', protect, async (req, res) => {
    try {
      if (!agent.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
      const result = await agent.shorts.update(req.params.productionId, req.params.clipId, req.body || {});
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/content/:productionId/shorts/:clipId/render', protect, async (req, res) => {
    try {
      if (!agent.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
      const result = await agent.shorts.render(req.params.productionId, req.params.clipId);
      return res.status(202).json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/content/:productionId/shorts/:clipId/approve', protect, async (req, res) => {
    try {
      if (!agent.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
      const result = await agent.shorts.approve(req.params.productionId, req.params.clipId, req.body || {});
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.get('/api/content/:productionId/shorts/:clipId/asset/:kind', async (req, res) => {
    try {
      const clip = await agent.db.getShortClip(req.params.clipId);
      if (!clip || clip.productionId !== req.params.productionId) return res.status(404).json({ error: 'Short asset not found' });
      const filePath = req.params.kind === 'video' ? clip.outputPath : req.params.kind === 'captions' ? clip.captionsPath : null;
      if (!filePath) return res.status(404).json({ error: 'Short asset not found' });
      const resolved = path.resolve(filePath);
      const shortsRoot = path.resolve(ROOT, 'data', 'shorts');
      if (!resolved.startsWith(`${shortsRoot}${path.sep}`)) return res.status(403).json({ error: 'Short asset path is not allowed' });
      await fs.access(resolved);
      return res.sendFile(resolved);
    } catch (_error) {
      return res.status(404).json({ error: 'Short asset not found' });
    }
  });

  app.post('/api/content/:productionId/scenes/:sceneId/narration', protect, async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Narration recovery requires completed setup' });
      const result = await agent.scenes.regenerateNarration(req.params.productionId, req.params.sceneId, req.body || {});
      await agent.refreshContentReview(req.params.productionId, 'Narration regenerated; rebuild the final video before approval');
      return res.status(202).json({ success: true, result: agent.scenes.decorateScene(result, req.params.productionId) });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
    }
  });

  app.post('/api/content/:productionId/narration/silence', protect, async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Narration recovery requires completed setup' });
      const result = await agent.scenes.setSilenceOverride(req.params.productionId, req.body || {});
      await agent.refreshContentReview(
        req.params.productionId,
        result.enabled ? 'Intentional silence recorded; rebuild and review before approval' : 'Narration is required again; regenerate it before approval'
      );
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
    }
  });

  app.put(
    '/api/content/:productionId/scenes/:sceneId/asset',
    protect,
    express.raw({ type: ['image/*', 'video/*'], limit: '100mb' }),
    async (req, res) => {
      try {
        if (!agent.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const result = await agent.scenes.replaceAsset(req.params.productionId, req.params.sceneId, {
          buffer: req.body,
          contentType: req.get('content-type'),
          filename: req.get('x-file-name'),
          rightsConfirmed: req.get('x-rights-confirmed') === 'true',
          containsSyntheticMedia: req.get('x-synthetic-media') === 'true'
        });
        await agent.refreshContentReview(req.params.productionId, 'Replacement scene asset must be rebuilt and reviewed');
        return res.json({ success: true, result: agent.scenes.decorateScene(result, req.params.productionId) });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    }
  );

  app.post('/api/content/:productionId/scenes/rebuild', protect, async (req, res) => {
    try {
      if (!agent.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
      const result = await agent.scenes.rebuild(req.params.productionId);
      await agent.refreshContentReview(req.params.productionId, 'Scene repair rebuilt; final approval is required');
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
    }
  });

  app.get('/api/content/:productionId/scenes/:sceneId/asset', async (req, res) => {
    try {
      const scene = await agent.db.getProductionScene(req.params.productionId, req.params.sceneId);
      if (!scene?.assetPath) return res.status(404).json({ error: 'Scene asset not found' });
      const resolved = path.resolve(scene.assetPath);
      const dataRoot = path.resolve(ROOT, 'data');
      if (!resolved.startsWith(`${dataRoot}${path.sep}`)) return res.status(403).json({ error: 'Scene asset path is not allowed' });
      await fs.access(resolved);
      return res.sendFile(resolved);
    } catch (_error) {
      return res.status(404).json({ error: 'Scene asset not found' });
    }
  });

  app.patch('/api/content/:productionId', protect, async (req, res) => {
    try {
      const bundle = await agent.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ error: 'Content not found' });
      if (bundle.review_status === 'approved' && bundle.schedule?.status === 'published') {
        return res.status(409).json({ error: 'Published content cannot be edited here' });
      }
      const editorData = agent.validateEditorData(req.body, bundle.editorData);
      const result = await agent.db.saveContentReview(bundle.id, {
        status: bundle.review_status || 'needs_review',
        editorData,
        qualityChecks: bundle.qualityChecks,
        reviewNotes: req.body.reviewNotes ?? bundle.review_notes,
        reviewedAt: bundle.reviewed_at
      });
      return res.json({ success: true, result: agent.decorateContentBundle(result) });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/content/:productionId/approve', protect, async (req, res) => {
    try {
      const result = await agent.approveContent(req.params.productionId, req.body || {});
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, quality: error.quality });
    }
  });

  app.post('/api/content/:productionId/reject', protect, async (req, res) => {
    const bundle = await agent.db.getProductionBundle(req.params.productionId);
    if (!bundle) return res.status(404).json({ error: 'Content not found' });
    await agent.db.saveContentReview(bundle.id, {
      status: 'rejected',
      editorData: bundle.editorData,
      qualityChecks: bundle.qualityChecks,
      reviewNotes: req.body?.notes || 'Rejected by operator',
      reviewedAt: new Date().toISOString()
    });
    await agent.db.updateProductionStatus(bundle.id, 'rejected');
    return res.json({ success: true });
  });

  app.post('/api/content/:productionId/retry', protect, async (req, res) => {
    const bundle = await agent.db.getProductionBundle(req.params.productionId);
    if (!bundle) return res.status(404).json({ error: 'Content not found' });
    const job = await agent.startGenerationJob({
      topic: bundle.strategy.topic || bundle.editorData.title || null,
      style: bundle.strategy.requestedStyle || bundle.strategy.contentType || null,
      length: bundle.strategy.requestedLengthKey || 'medium',
      source: 'retry'
    });
    return res.status(202).json({ success: true, result: job });
  });

  app.get('/api/content/:productionId/asset/:kind', async (req, res) => {
    try {
      const bundle = await agent.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ error: 'Content not found' });
      const allowed = {
        video: bundle.assets?.finalVideo?.path,
        thumbnail: bundle.assets?.thumbnail?.path,
        captions: bundle.assets?.captions?.path,
        script: bundle.assets?.script?.originalPath
      };
      const experimentMatch = req.params.kind.match(/^experiment-thumbnail-(\d+)$/);
      const experimentPath = experimentMatch
        ? bundle.editorData?.packagingExperiment?.thumbnailVariants?.[Number(experimentMatch[1])]?.path
        : null;
      const filePath = allowed[req.params.kind] || experimentPath;
      if (!filePath) return res.status(404).json({ error: 'Asset not found' });
      const resolved = path.resolve(filePath);
      const dataRoot = path.resolve(ROOT, 'data');
      const experimentRoot = path.resolve(ROOT, 'uploads', 'thumbnails');
      const allowedPath = [dataRoot, experimentRoot]
        .some(root => resolved.startsWith(`${root}${path.sep}`));
      if (!allowedPath) return res.status(403).json({ error: 'Asset path is not allowed' });
      await fs.access(resolved);
      return res.sendFile(resolved);
    } catch (_error) {
      return res.status(404).json({ error: 'Asset not found' });
    }
  });

  app.put('/api/content/:productionId/provenance', protect, async (req, res) => {
    try {
      const bundle = await agent.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ error: 'Content not found' });
      if (bundle.review_status === 'approved' || bundle.schedule) {
        return res.status(409).json({ error: 'Provenance is locked after content is approved or scheduled' });
      }
      if (!agent.provenance) agent.provenance = new ProvenanceService(agent.db);
      await agent.provenance.review(bundle.id, req.body || {});
      const updated = await agent.db.getProductionBundle(bundle.id);
      const profile = await agent.db.getChannelProfile() || {};
      const quality = await agent.operator.runQualityChecks({
        ...updated,
        scheduledPublishTime: updated.scheduled_publish_time
      }, profile);
      const reviewStatus = quality.passed ? 'needs_review' : 'needs_attention';
      const result = await agent.db.saveContentReview(bundle.id, {
        status: reviewStatus,
        editorData: updated.editorData,
        qualityChecks: quality.checks,
        reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,
        reviewedAt: null
      });
      return res.json({ success: true, result: agent.decorateContentBundle(result) });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/content/:productionId/discoverability/run', protect, async (req, res) => {
    try {
      const bundle = await agent.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ success: false, error: 'Content not found' });
      const profile = await agent.db.getChannelProfile() || {};
      const audit = await agent.discoverability.auditProduction(bundle, profile, req.body?.platform || 'youtube');
      if (bundle.review_status !== 'approved' && !bundle.schedule) {
        const updated = await agent.db.getProductionBundle(bundle.id);
        const quality = await agent.operator.runQualityChecks({
          ...updated,
          scheduledPublishTime: updated.scheduled_publish_time
        }, profile);
        await agent.db.saveContentReview(bundle.id, {
          status: quality.passed ? 'needs_review' : 'needs_attention',
          editorData: updated.editorData,
          qualityChecks: quality.checks,
          reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,
          reviewedAt: null
        });
      }
      const result = await agent.db.getProductionBundle(bundle.id);
      return res.json({ success: true, result: agent.decorateContentBundle(result), audit });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });

  app.patch('/api/content/:productionId/schedule', protect, async (req, res) => {
    try {
      if (!agent.agents.publishing) return res.status(503).json({ error: 'Publishing requires completed setup' });
      const result = await agent.agents.publishing.rescheduleContent(req.params.productionId, req.body?.publishTime);
      await agent.db.updateProductionStatus(req.params.productionId, 'scheduled');
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.post('/api/content/:productionId/publish-now', protect, async (req, res) => {
    try {
      if (!agent.agents.publishing) return res.status(503).json({ error: 'Publishing requires completed setup' });
      const result = await agent.agents.publishing.emergencyPublish(req.params.productionId);
      await agent.db.updateProductionStatus(req.params.productionId, result.status);
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.delete('/api/content/:productionId/schedule', protect, async (req, res) => {
    try {
      if (!agent.agents.publishing) return res.status(503).json({ error: 'Publishing requires completed setup' });
      const result = await agent.agents.publishing.deleteScheduledContent(req.params.productionId);
      await agent.db.updateProductionStatus(req.params.productionId, 'approved');
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
    }
  });

  app.patch('/api/discoverability/findings/:findingId', protect, async (req, res) => {
    try {
      const finding = await agent.discoverability.reviewFinding(req.params.findingId, req.body || {});
      const audit = await agent.db.getLatestDiscoverabilityAudit(finding.production_id, finding.platform);
      return res.json({ success: true, result: { finding, audit } });
    } catch (error) {
      return res.status(error.status || 400).json({ success: false, error: error.message });
    }
  });
}

module.exports = { register };
