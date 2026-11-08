// Publishing safety, approval gate, provenance, discoverability and reliability (quota, retries, fallback, captions).
// Methods of SystemTest, merged into its prototype (see test.js).
const ROOT = require('path').join(__dirname, '../..');
const { Database } = require('../../database/db');
const path = require('path');

const publishingTests = {
  async testPublishingSafety() {
    const { PublishingSchedulingAgent } = require('../../agents/publishing-scheduling-agent');
    const intentionalAudio = {
      intentionalSilence: true,
      silenceReason: 'This test fixture is intentionally silent.',
      silenceConfirmedAt: new Date().toISOString()
    };
    const approvedBundle = id => ({
      id, review_status: 'approved', reviewed_at: new Date().toISOString(),
      editorData: { factChecked: true, rightsConfirmed: true }
    });
    const approvedDb = { getProductionBundle: async id => approvedBundle(id) };

    // Human approval gate: unapproved content must never reach the upload step.
    for (const [label, bundle] of [
      ['missing review', null],
      ['pending review', { ...approvedBundle('prod-gate'), review_status: 'needs_review', reviewed_at: null }],
      ['unchecked facts', { ...approvedBundle('prod-gate'), editorData: { factChecked: false, rightsConfirmed: true } }],
      ['unconfirmed rights', { ...approvedBundle('prod-gate'), editorData: { factChecked: true, rightsConfirmed: false } }]
    ]) {
      const gated = new PublishingSchedulingAgent({
        getProductionBundle: async () => bundle,
        updateScheduleEntry: async () => {}
      }, {});
      gated.publishQueue = [{ productionId: 'prod-gate', title: 'Gate', status: 'scheduled', publishTime: new Date(Date.now() - 1000).toISOString(), metadata: { audio: intentionalAudio } }];
      gated.uploadToYouTube = async () => { throw new Error(`Upload started for ${label}`); };
      let gateCode = null;
      try {
        await gated.publishContent('prod-gate');
      } catch (error) {
        gateCode = error.code;
      }
      if (gateCode !== 'APPROVAL_REQUIRED') throw new Error(`Publishing was not blocked for ${label}`);
      await gated.processPublishQueue();
      if (gated.publishQueue[0].status !== 'scheduled') throw new Error(`Queue marked ${label} as failed instead of waiting for approval`);
    }

    // Shorts are gated on the approval of their source production.
    const approvalLookups = [];
    const shortGate = new PublishingSchedulingAgent({
      getProductionBundle: async id => { approvalLookups.push(id); return id === 'prod-source' ? approvedBundle(id) : null; },
      updateScheduleEntry: async () => {}
    }, {});
    shortGate.publishQueue = [{ productionId: 'short-1', title: 'Short', status: 'scheduled', metadata: { audio: intentionalAudio, sourceProductionId: 'prod-source' } }];
    shortGate.uploadToYouTube = async () => ({ id: 'youtube-short' });
    await shortGate.publishContent('short-1');
    if (!approvalLookups.includes('prod-source')) throw new Error('Short publishing did not check source approval');

    const agent = new PublishingSchedulingAgent({
      ...approvedDb,
      updateScheduleEntry: async () => {}
    }, {});

    agent.publishQueue = [
      { productionId: 'prod-a', title: 'A', status: 'scheduled', metadata: { audio: intentionalAudio } },
      { productionId: 'prod-b', title: 'B', status: 'scheduled', metadata: { audio: intentionalAudio } }
    ];
    agent.uploadToYouTube = async () => ({ id: 'youtube-1' });

    await agent.publishContent('prod-a');

    if (agent.publishQueue.length !== 1 || agent.publishQueue[0].productionId !== 'prod-b') {
      throw new Error('publishContent removed the wrong publish queue entries');
    }

    const missingNarration = new PublishingSchedulingAgent({ ...approvedDb, updateScheduleEntry: async () => {} }, {});
    missingNarration.publishQueue = [{ productionId: 'prod-no-audio', status: 'scheduled', metadata: {} }];
    missingNarration.uploadToYouTube = async () => { throw new Error('Upload must not start without narration'); };
    let narrationPublishBlocked = false;
    try {
      await missingNarration.publishContent('prod-no-audio');
    } catch (error) {
      narrationPublishBlocked = error.code === 'NARRATION_REQUIRED';
    }
    if (!narrationPublishBlocked) throw new Error('Publishing accepted a production without narration evidence');

    let missingFileRejected = false;
    try {
      await agent.getVideoStream(path.join(ROOT, 'data', 'missing-placeholder.mp4'));
    } catch (error) {
      missingFileRejected = /video file not found/.test(error.message);
    }

    if (!missingFileRejected) {
      throw new Error('getVideoStream did not reject a missing video file');
    }

    let uncertainUpdates = [];
    const uncertain = new PublishingSchedulingAgent({
      ...approvedDb,
      updateScheduleEntry: async entry => uncertainUpdates.push({ ...entry })
    }, {});
    uncertain.publishQueue = [
      { id: 'schedule-uncertain', productionId: 'prod-uncertain', title: 'Uncertain', status: 'scheduled', metadata: { audio: intentionalAudio } }
    ];
    let uploadAttempts = 0;
    uncertain.uploadToYouTube = async entry => {
      uploadAttempts++;
      entry.uploadAttempted = true;
      const error = new Error('socket closed during upload');
      error.code = 'ECONNRESET';
      throw error;
    };
    let uncertainBlocked = false;
    try {
      await uncertain.publishContent('prod-uncertain');
    } catch (error) {
      uncertainBlocked = error.code === 'UPLOAD_OUTCOME_UNKNOWN';
    }
    try {
      await uncertain.publishContent('prod-uncertain');
    } catch (error) {
      uncertainBlocked = uncertainBlocked && error.code === 'UPLOAD_OUTCOME_UNKNOWN';
    }
    if (!uncertainBlocked || uploadAttempts !== 1 || uncertainUpdates.at(-1)?.status !== 'reconciliation_required') {
      throw new Error('An uncertain upload outcome was retried or failed to require reconciliation');
    }

    let reconciliationCalls = 0;
    const recorded = {
      id: 'schedule-recorded', productionId: 'prod-recorded', title: 'Recorded', status: 'uploaded',
      youtubeId: 'youtube-existing', metadata: { audio: intentionalAudio }
    };
    const reconcile = new PublishingSchedulingAgent({
      ...approvedDb,
      getLatestScheduleEntry: async () => recorded,
      updateScheduleEntry: async () => {}
    }, {});
    reconcile.youtube = {
      videos: {
        list: async () => {
          reconciliationCalls++;
          return { data: { items: [{ id: 'youtube-existing' }] } };
        }
      }
    };
    reconcile.uploadToYouTube = async () => {
      throw new Error('A recorded upload must never be uploaded again');
    };
    const reconciled = await reconcile.publishContent('prod-recorded');
    if (reconciled.status !== 'published' || reconciliationCalls !== 1) {
      throw new Error('A recorded YouTube upload was not reconciled idempotently');
    }

    let deletedScheduleId = null;
    const scheduleActions = new PublishingSchedulingAgent({
      updateScheduleEntry: async () => {},
      deleteScheduleEntry: async id => { deletedScheduleId = id; }
    }, {});
    scheduleActions.publishQueue = [{
      id: 'schedule-actions', productionId: 'prod-actions', title: 'Actions', status: 'scheduled',
      publishTime: new Date(Date.now() + 3600000).toISOString(), metadata: { audio: intentionalAudio }
    }];
    const future = new Date(Date.now() + 7200000).toISOString();
    const rescheduled = await scheduleActions.rescheduleContent('prod-actions', future);
    if (rescheduled.publishTime !== future || rescheduled.status !== 'scheduled') {
      throw new Error('Scheduled content could not be rescheduled');
    }
    await scheduleActions.deleteScheduledContent('prod-actions');
    if (deletedScheduleId !== 'schedule-actions' || scheduleActions.publishQueue.length) {
      throw new Error('Deleting a schedule did not preserve content while removing the queue entry');
    }

    let uploadMetadata = null;
    const immediate = new PublishingSchedulingAgent({ updateScheduleEntry: async () => {} }, {});
    immediate.youtube = {
      videos: { insert: async request => { uploadMetadata = request.requestBody; return { data: { id: 'youtube-now' } }; } },
      thumbnails: { set: async () => {} }, captions: { insert: async () => {} }
    };
    immediate.getVideoStream = async () => ({ fixture: true });
    await immediate.uploadToYouTube({
      id: 'schedule-now', publishTime: new Date().toISOString(),
      metadata: { seo: { title: 'Publish now', description: 'Immediate upload.', tags: ['test'] }, video: { path: 'fixture.mp4' }, privacyStatus: 'public' }
    }, { publishNow: true });
    if (uploadMetadata?.status?.privacyStatus !== 'public' || uploadMetadata?.status?.publishAt !== undefined) {
      throw new Error('Publish now still sent a stale scheduled publishAt value');
    }

    const { detectSyntheticMedia } = require('../../utils/synthetic-media');
    const syntheticCases = [
      [{}, false, 'empty production'],
      [{ assets: { finalVideo: { provider: { actualProvider: 'slideshow' } }, audio: { status: 'ready', provider: 'simulation' }, video: { visualAssets: ['a.info'] } } }, false, 'local slideshow with placeholders'],
      [{ assets: { finalVideo: { provider: { actualProvider: 'kling' } } } }, true, 'AI video provider'],
      [{ assets: { finalVideo: { provider: { actualProvider: 'slideshow' } }, audio: { status: 'ready', provider: 'elevenlabs' } } }, true, 'slideshow with AI voice'],
      [{ assets: { audio: { status: 'unavailable', provider: 'openai' } } }, false, 'failed narration'],
      [{ assets: { video: { visualAssets: ['visual_1.png'] } } }, true, 'slideshow with AI images']
    ];
    for (const [production, expected, label] of syntheticCases) {
      if (detectSyntheticMedia(production).containsSyntheticMedia !== expected) {
        throw new Error(`Synthetic media detection was wrong for ${label}`);
      }
    }

    const previousKids = process.env.YOUTUBE_MADE_FOR_KIDS;
    delete process.env.YOUTUBE_MADE_FOR_KIDS;
    try {
      await immediate.uploadToYouTube({
        id: 'schedule-ai', publishTime: new Date().toISOString(),
        metadata: {
          seo: { title: 'AI voice', description: 'Narrated by AI.', tags: ['test'] },
          video: { path: 'fixture.mp4', provider: { actualProvider: 'slideshow' } },
          audio: { status: 'ready', provider: 'openai' },
          containsSyntheticMedia: false
        }
      }, { publishNow: true });
      if (uploadMetadata?.status?.containsSyntheticMedia !== true) {
        throw new Error('Upload dropped the AI disclosure for AI narration');
      }
      if (uploadMetadata?.status?.selfDeclaredMadeForKids !== false) {
        throw new Error('Made-for-kids should default to false');
      }
      process.env.YOUTUBE_MADE_FOR_KIDS = 'true';
      await immediate.uploadToYouTube({
        id: 'schedule-kids', publishTime: new Date().toISOString(),
        metadata: { seo: { title: 'Kids', description: 'For kids.', tags: ['test'] }, video: { path: 'fixture.mp4' } }
      }, { publishNow: true });
      if (uploadMetadata?.status?.selfDeclaredMadeForKids !== true) {
        throw new Error('YOUTUBE_MADE_FOR_KIDS was ignored');
      }
    } finally {
      if (previousKids === undefined) delete process.env.YOUTUBE_MADE_FOR_KIDS;
      else process.env.YOUTUBE_MADE_FOR_KIDS = previousKids;
    }

    this.logger.info('Publishing safety test completed successfully');
  },

  async testPlaceholderSchedulingGuard() {
    const { PublishingSchedulingAgent } = require('../../agents/publishing-scheduling-agent');
    const agent = new PublishingSchedulingAgent({
      saveScheduleEntry: async () => {}
    }, {});

    const simulated = await agent.scheduleContent({
      id: 'prod-simulated',
      script: { title: 'Simulated' },
      assets: { finalVideo: { path: 'video.mp4.assembly.json', simulated: true } }
    });
    if (simulated !== null) {
      throw new Error('Simulated production was scheduled for publishing');
    }

    const missingVideo = await agent.scheduleContent({
      id: 'prod-missing',
      script: { title: 'Missing' },
      assets: {}
    });
    if (missingVideo !== null) {
      throw new Error('Production without a final video was scheduled for publishing');
    }

    const missingNarration = await agent.scheduleContent({
      id: 'prod-no-narration', script: { title: 'No narration' }, priority: 50,
      scheduledPublishTime: new Date().toISOString(),
      assets: { finalVideo: { path: 'video.mp4' } }, seo: {}
    });
    if (missingNarration !== null) throw new Error('Production without narration was scheduled for publishing');

    const real = await agent.scheduleContent({
      id: 'prod-real',
      script: { title: 'Real' },
      priority: 50,
      scheduledPublishTime: new Date().toISOString(),
      assets: {
        finalVideo: { path: 'video.mp4' }, thumbnail: {}, captions: {},
        audio: {
          intentionalSilence: true,
          silenceReason: 'This fixture intentionally uses a silent timeline.',
          silenceConfirmedAt: new Date().toISOString()
        }
      },
      seo: {}
    });
    if (!real || agent.publishQueue.length !== 1) {
      throw new Error('Real production was not scheduled for publishing');
    }

    this.logger.info('Placeholder scheduling guard test completed successfully');
  },

  async testProvenanceDesk() {
    const fs = require('fs').promises;
    const os = require('os');
    const { ProvenanceService } = require('../../utils/provenance-service');
    const { OperatorService } = require('../../utils/operator-service');
    const { PublishingSchedulingAgent } = require('../../agents/publishing-scheduling-agent');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-provenance-'));
    const db = new Database();
    db.dbPath = path.join(directory, 'provenance.db');
    await db.initialize();
    const productionId = 'prod-provenance-test';
    const videoPath = path.join(directory, 'video.mp4');
    const audioPath = path.join(directory, 'narration.mp3');
    await fs.writeFile(videoPath, Buffer.from('test-video'));
    await fs.writeFile(audioPath, Buffer.from('test-audio'));

    try {
      await db.saveProductionData({
        id: productionId,
        status: 'needs_review',
        assets: { finalVideo: { path: videoPath, simulated: false }, audio: { path: audioPath, status: 'ready', simulated: false, provider: 'fixture-tts' } },
        timeline: {}, scheduledPublishTime: new Date(Date.now() + 86400000).toISOString(),
        priority: 50, estimatedDuration: '1:00'
      });
      const production = {
        id: productionId,
        strategy: {
          topic: 'Evidence-aware automation',
          researchSources: [{
            url: 'https://example.com/research/fact',
            title: 'Official research evidence',
            publisher: 'Example Institute',
            sourceType: 'official'
          }]
        },
        script: {
          title: 'Evidence-aware automation',
          fullScript: 'A sufficiently detailed script with a factual statement that must be reviewed before this production can be approved.'.repeat(3),
          claims: [{
            text: 'The documented workflow reduces repeated manual steps.',
            riskLevel: 'standard',
            sourceUrls: ['https://example.com/research/fact']
          }]
        },
        seo: {
          title: 'Evidence-aware automation',
          description: 'A detailed description of an evidence-aware automation workflow for careful channel operators.',
          tags: ['automation', 'evidence', 'workflow']
        },
        assets: { finalVideo: { path: videoPath, simulated: false }, audio: { path: audioPath, status: 'ready', simulated: false, provider: 'fixture-tts' } }
      };
      await db.saveProductionSnapshot(production);

      const provenanceService = new ProvenanceService(db);
      const initialized = await provenanceService.initialize(productionId, production);
      if (
        initialized.status !== 'blocked' || initialized.sources.length !== 1 ||
        initialized.claims.length !== 1 || initialized.claims[0].sourceIds.length !== 1
      ) {
        throw new Error('Generated research sources and claims were not initialized as unresolved provenance');
      }

      const publishGuard = new PublishingSchedulingAgent(db, {});
      publishGuard.publishQueue = [{ productionId, status: 'scheduled', metadata: {} }];
      let blockedPublishRejected = false;
      try {
        await publishGuard.publishContent(productionId);
      } catch (error) {
        blockedPublishRejected = error.code === 'PROVENANCE_BLOCKED';
      }
      if (!blockedPublishRejected) throw new Error('Publishing did not independently enforce the provenance gate');

      let unverifiedSupportRejected = false;
      try {
        await provenanceService.review(productionId, {
          sources: initialized.sources,
          claims: [{ ...initialized.claims[0], status: 'supported' }]
        });
      } catch (error) {
        unverifiedSupportRejected = /verified source/.test(error.message);
      }
      if (!unverifiedSupportRejected) throw new Error('A claim was supported without reviewer-verified evidence');

      const reviewed = await provenanceService.review(productionId, {
        sources: initialized.sources.map(source => ({ ...source, status: 'verified' })),
        claims: [{ ...initialized.claims[0], status: 'supported' }],
        containsSyntheticMedia: true
      });
      if (reviewed.status !== 'verified' || !reviewed.containsSyntheticMedia || reviewed.summary.unresolvedClaims !== 0) {
        throw new Error('A complete evidence review was not persisted as verified');
      }

      const bundle = await db.getProductionBundle(productionId);
      const quality = await new OperatorService(db).runQualityChecks({ ...production, provenance: bundle.provenance }, {});
      if (!quality.passed || !quality.checks.find(check => check.id === 'provenance' && check.passed)) {
        throw new Error('Verified provenance did not satisfy the production quality gate');
      }

      let uploadRequest;
      const publishing = new PublishingSchedulingAgent(db, {});
      publishing.youtube = {
        videos: { insert: async request => { uploadRequest = request; return { data: { id: 'provenance-video' } }; } }
      };
      await publishing.uploadToYouTube({
        publishTime: new Date(Date.now() + 86400000).toISOString(),
        metadata: {
          seo: production.seo,
          video: { path: videoPath },
          privacyStatus: 'private',
          containsSyntheticMedia: true
        }
      });
      if (uploadRequest?.requestBody?.status?.containsSyntheticMedia !== true) {
        throw new Error('Synthetic-media disclosure was not handed to the YouTube upload request');
      }

      let emptyWaiverRejected = false;
      try {
        new ProvenanceService(db).build({
          sources: reviewed.sources,
          claims: [{ ...reviewed.claims[0], status: 'waived', notes: '' }]
        });
      } catch (error) {
        emptyWaiverRejected = /reviewer note/.test(error.message);
      }
      if (!emptyWaiverRejected) throw new Error('A claim waiver without a reviewer note was accepted');
    } finally {
      await db.close();
      await fs.rm(directory, { recursive: true, force: true });
    }

    this.logger.info('Research and provenance desk test completed successfully');
  },

  async testDiscoverabilityPreflight() {
    const fs = require('fs').promises;
    const os = require('os');
    const { DiscoverabilityService } = require('../../utils/discoverability-service');
    const { DarkzSEOAdapter } = require('../../utils/discoverability-adapters/darkzseo');
    const { OperatorService } = require('../../utils/operator-service');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-discoverability-'));
    const db = new Database();
    db.dbPath = path.join(directory, 'discoverability.db');
    await db.initialize();
    const productionId = 'prod-discoverability-test';
    const fakeAdapter = {
      audit: async content => ({
        schemaVersion: '1.0',
        engine: { name: 'darkzseo', version: '1.4.0' },
        mode: 'content',
        target: content.id,
        status: 'attention_required',
        summary: {
          severity: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 },
          category: { SEO: 0, GEO: 1, AIO: 0, AEO: 0 }
        },
        findings: [{
          ruleId: 'geo.trust_network', category: 'GEO', severity: 'HIGH',
          applicability: ['youtube', 'content'],
          message: 'Trust Network: Long content lacks authority links',
          remediation: 'Add a verified authority source.'
        }]
      })
    };

    try {
      const bundledReport = await new DarkzSEOAdapter({ scriptPath: null }).audit({
        id: 'bundled-audit', platform: 'youtube', brand: 'YouTube Automation Agent', title: 'Best workflow review',
        description: 'A useful comparison.', transcript: 'Detailed content '.repeat(100),
        sections: [{ title: 'What should you choose?', content: 'answer '.repeat(61) }]
      });
      if (
        bundledReport.engine.version !== '1.4.0-bundled' ||
        !bundledReport.findings.some(finding => finding.ruleId === 'aio.comparison_intent') ||
        !bundledReport.findings.some(finding => finding.ruleId === 'aio.direct_answer')
      ) {
        throw new Error('The bundled discoverability audit did not provide the public content contract');
      }
      const configuredPath = process.env.DARKZSEO_PATH;
      delete process.env.DARKZSEO_PATH;
      try {
        if (new DarkzSEOAdapter().scriptPath !== null) {
          throw new Error('DarkzSEO selected an external Python checkout without explicit configuration');
        }
      } finally {
        if (configuredPath === undefined) delete process.env.DARKZSEO_PATH;
        else process.env.DARKZSEO_PATH = configuredPath;
      }
      const brokenExternal = new DarkzSEOAdapter({ scriptPath: 'broken-darkzseo.py' });
      brokenExternal.auditExternal = async () => {
        const error = new Error('No module named darkzseo');
        error.code = 'DARKZSEO_FAILED';
        throw error;
      };
      const fallbackReport = await brokenExternal.audit({
        id: 'external-fallback', platform: 'youtube', title: 'Fallback audit'
      });
      if (fallbackReport.engine.version !== '1.4.0-bundled' || fallbackReport.status === 'unavailable') {
        throw new Error('A broken external DarkzSEO runtime did not fall back to the bundled audit');
      }
      await db.saveProductionData({
        id: productionId, status: 'needs_review', assets: {}, timeline: {},
        scheduledPublishTime: null, priority: 50, estimatedDuration: '1:00'
      });
      const production = {
        id: productionId,
        script: { title: 'YouTube Automation Agent discoverability', fullScript: 'Detailed content '.repeat(200), sections: [] },
        seo: { title: 'YouTube Automation Agent discoverability', description: 'A detailed discoverability review.', chapters: [] },
        provenance: { sources: [] }
      };
      await db.saveProductionSnapshot(production);
      const service = new DiscoverabilityService(db, { adapter: fakeAdapter });
      const first = await service.auditProduction(production, { channel_name: 'YouTube Automation Agent' });
      if (first.engineVersion !== '1.4.0' || first.findings.length !== 1 || first.pendingCount !== 1) {
        throw new Error('The versioned DarkzSEO report was not persisted');
      }

      const quality = await new OperatorService(db).runQualityChecks({ ...production, discoverability: first }, {});
      const discoverabilityCheck = quality.checks.find(check => check.id === 'discoverability');
      if (!discoverabilityCheck || discoverabilityCheck.passed || discoverabilityCheck.blocking) {
        throw new Error('High-priority discoverability guidance was not advisory and visible');
      }

      let shortReasonRejected = false;
      try {
        await service.reviewFinding(first.findings[0].id, { status: 'dismissed', reason: 'no' });
      } catch (error) {
        shortReasonRejected = /at least 5/.test(error.message);
      }
      if (!shortReasonRejected) throw new Error('A false-positive dismissal without reviewer evidence was accepted');

      await service.reviewFinding(first.findings[0].id, { status: 'dismissed', reason: 'The cited source is attached in the approved evidence desk.' });
      const second = await service.auditProduction(production, { channel_name: 'YouTube Automation Agent' });
      if (second.findings[0].reviewStatus !== 'dismissed' || second.pendingCount !== 0) {
        throw new Error('Finding review evidence did not carry forward across matching audits');
      }
      const reviewedQuality = await new OperatorService(db).runQualityChecks({ ...production, discoverability: second }, {});
      if (!reviewedQuality.checks.find(check => check.id === 'discoverability' && check.passed)) {
        throw new Error('A dismissed false positive remained an actionable quality warning');
      }

      const { YouTubeAutomationAgent } = require('../../index');
      const apiAgent = new YouTubeAutomationAgent();
      apiAgent.db = db;
      apiAgent.operator = new OperatorService(db);
      apiAgent.discoverability = service;
      apiAgent.setupAPI();
      const server = await new Promise(resolve => {
        const listener = apiAgent.app.listen(0, '127.0.0.1', () => resolve(listener));
      });
      try {
        const address = server.address();
        const apiHeaders = { 'content-type': 'application/json', ...(process.env.API_KEY ? { 'x-api-key': process.env.API_KEY } : {}) };
        const runResponse = await fetch(`http://127.0.0.1:${address.port}/api/content/${productionId}/discoverability/run`, {
          method: 'POST', headers: apiHeaders, body: JSON.stringify({ platform: 'youtube' })
        });
        const runPayload = await runResponse.json();
        if (!runResponse.ok || runPayload.audit?.schemaVersion !== '1.0' || !runPayload.result?.discoverability) {
          throw new Error('Discoverability run API did not return the persisted versioned audit');
        }
        const apiFinding = runPayload.audit.findings[0];
        const reviewResponse = await fetch(`http://127.0.0.1:${address.port}/api/discoverability/findings/${apiFinding.id}`, {
          method: 'PATCH', headers: apiHeaders, body: JSON.stringify({ status: 'accepted' })
        });
        const reviewPayload = await reviewResponse.json();
        if (!reviewResponse.ok || reviewPayload.result?.finding?.reviewStatus !== 'accepted') {
          throw new Error('Discoverability review API did not persist the operator decision');
        }
      } finally {
        await new Promise(resolve => server.close(resolve));
      }

      const unavailableService = new DiscoverabilityService(db, {
        adapter: { audit: async () => { const error = new Error('Python is not installed'); error.code = 'DARKZSEO_UNAVAILABLE'; throw error; } }
      });
      const unavailable = await unavailableService.auditProduction(production, { channel_name: 'YouTube Automation Agent' });
      if (unavailable.status !== 'unavailable' || unavailable.errorCode !== 'DARKZSEO_UNAVAILABLE' || unavailable.findings.length !== 0) {
        throw new Error('An unavailable DarkzSEO runtime was not stored explicitly');
      }
      const unavailableQuality = await new OperatorService(db).runQualityChecks({ ...production, discoverability: unavailable }, {});
      const unavailableCheck = unavailableQuality.checks.find(check => check.id === 'discoverability');
      if (!unavailableCheck || unavailableCheck.passed || unavailableCheck.blocking) {
        throw new Error('DarkzSEO runtime availability did not remain an explicit non-blocking check');
      }
    } finally {
      await db.close();
      await fs.rm(directory, { recursive: true, force: true });
    }

    this.logger.info('DarkzSEO discoverability preflight test completed successfully');
  },

  async testReliability() {
    const { guardYouTubeClient, QuotaTracker, quotaCost } = require('../../utils/youtube-api-guard');
    const { AITextService } = require('../../utils/ai-text-service');
    const { ProductionManagementAgent } = require('../../agents/production-management-agent');
    const { PublishingSchedulingAgent } = require('../../agents/publishing-scheduling-agent');
    const noSleep = async () => {};
    const quietLogger = { warn: () => {}, info: () => {}, error: () => {} };
    const apiError = (code, reason) => Object.assign(new Error(reason || `HTTP ${code}`), { code, errors: reason ? [{ reason }] : undefined });

    // Quota: costs are counted per request and calls stop before the limit.
    if (quotaCost('videos.insert') !== 1600 || quotaCost('videos.list') !== 1 || quotaCost('search.list') !== 100) {
      throw new Error('Unexpected YouTube quota costs');
    }
    const tracker = new QuotaTracker({ dailyLimit: 1700 });
    let inserts = 0;
    const client = guardYouTubeClient({
      videos: { insert: async () => { inserts++; return { data: { id: 'v1' } }; }, list: async () => ({ data: { items: [] } }) }
    }, { tracker, sleep: noSleep, logger: quietLogger });
    await client.videos.insert({});
    await client.videos.list({});
    let quotaCode = null;
    try {
      await client.videos.insert({});
    } catch (error) {
      quotaCode = error.code;
    }
    if (quotaCode !== 'YOUTUBE_QUOTA_EXHAUSTED' || inserts !== 1 || tracker.snapshot().used !== 1601) {
      throw new Error('Quota guard did not stop an upload that would exceed the daily limit');
    }

    // The guard must work on real googleapis clients, whose resources are read-only properties.
    const { google } = require('googleapis');
    const realGuarded = guardYouTubeClient(google.youtube({ version: 'v3', auth: 'fake-key' }), { tracker: new QuotaTracker({ dailyLimit: 10 }) });
    if (typeof realGuarded.videos.list !== 'function' || typeof realGuarded.thumbnails.set !== 'function') {
      throw new Error('Guard cannot wrap a real googleapis client');
    }

    // Day rollover resets usage (quota resets at midnight Pacific).
    let now = new Date('2026-01-10T12:00:00Z');
    const rolling = new QuotaTracker({ dailyLimit: 100, now: () => now });
    rolling.reserve('videos.list');
    now = new Date('2026-01-11T12:00:00Z');
    if (rolling.snapshot().used !== 0) throw new Error('Quota usage did not reset on a new Pacific day');

    // Retries: transient read errors are retried; uploads are not retried after an unknown outcome.
    let listCalls = 0;
    const flaky = guardYouTubeClient({
      videos: {
        list: async () => { listCalls++; if (listCalls < 3) throw apiError(503, 'backendError'); return { data: { items: [1] } }; },
        insert: async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); }
      },
      commentThreads: { insert: async () => { throw apiError(429, 'rateLimitExceeded'); } }
    }, { tracker: new QuotaTracker({ dailyLimit: 100000 }), sleep: noSleep, logger: quietLogger, maxRetries: 3 });
    const listed = await flaky.videos.list({});
    if (listCalls !== 3 || listed.data.items.length !== 1) throw new Error('Transient read errors were not retried');
    let insertAttempts = 0;
    const insertClient = guardYouTubeClient({
      videos: { insert: async () => { insertAttempts++; throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); } }
    }, { tracker: new QuotaTracker({ dailyLimit: 100000 }), sleep: noSleep, logger: quietLogger });
    await insertClient.videos.insert({}).catch(() => {});
    if (insertAttempts !== 1) throw new Error('An upload with an unknown outcome was retried');
    let rateLimited = 0;
    const rateClient = guardYouTubeClient({
      commentThreads: { insert: async () => { rateLimited++; throw apiError(429, 'rateLimitExceeded'); } }
    }, { tracker: new QuotaTracker({ dailyLimit: 100000 }), sleep: noSleep, logger: quietLogger, maxRetries: 2 });
    await rateClient.commentThreads.insert({}).catch(() => {});
    if (rateLimited !== 3) throw new Error('A rate-limited write was not retried');

    // YouTube's own quotaExceeded is final for the day.
    const exhausted = new QuotaTracker({ dailyLimit: 10000 });
    let quotaCalls = 0;
    const quotaClient = guardYouTubeClient({
      search: { list: async () => { quotaCalls++; throw apiError(403, 'quotaExceeded'); } }
    }, { tracker: exhausted, sleep: noSleep, logger: quietLogger });
    let exhaustedCode = null;
    try {
      await quotaClient.search.list({});
    } catch (error) {
      exhaustedCode = error.code;
    }
    if (exhaustedCode !== 'YOUTUBE_QUOTA_EXHAUSTED' || quotaCalls !== 1 || exhausted.remaining() !== 0) {
      throw new Error('quotaExceeded from YouTube was retried or not recorded');
    }

    // Publishing: a quota stop keeps the entry scheduled for the next day.
    const updates = [];
    const publisher = new PublishingSchedulingAgent({
      getProductionBundle: async id => ({ id, review_status: 'approved', reviewed_at: new Date().toISOString(), editorData: { factChecked: true, rightsConfirmed: true } }),
      updateScheduleEntry: async entry => updates.push({ ...entry })
    }, {});
    publisher.publishQueue = [{
      productionId: 'prod-quota', title: 'Quota', status: 'scheduled', publishTime: new Date(Date.now() - 1000).toISOString(),
      metadata: { audio: { intentionalSilence: true, silenceReason: 'This test fixture is intentionally silent.', silenceConfirmedAt: new Date().toISOString() } }
    }];
    publisher.uploadToYouTube = async entry => {
      entry.uploadAttempted = true;
      throw Object.assign(new Error('quota'), { code: 'YOUTUBE_QUOTA_EXHAUSTED', status: 429 });
    };
    await publisher.processPublishQueue();
    if (publisher.publishQueue[0].status !== 'scheduled' || updates.at(-1)?.status !== 'scheduled') {
      throw new Error('A quota stop did not leave the upload scheduled');
    }

    // AI text: the next configured provider answers when the primary fails.
    const service = Object.create(AITextService.prototype);
    Object.assign(service, {
      logger: quietLogger,
      providerName: 'Primary',
      model: 'primary-model',
      gemini: null,
      client: { chat: { completions: { create: async () => { throw Object.assign(new Error('invalid key'), { status: 401 }); } } } },
      fallbacks: [{ name: 'Backup', model: 'backup-model', gemini: null, client: { chat: { completions: { create: async request => ({ choices: [{ message: { content: `ok from ${request.model}` } }] }) } } } }]
    });
    const answer = await service.generateText('hi');
    if (answer !== 'ok from backup-model' || service.lastProviderName !== 'Backup') throw new Error('AI text fallback did not use the backup provider');
    service.fallbacks[0].client.chat.completions.create = async () => { throw new Error('also down'); };
    let allFailed = null;
    try {
      await service.generateText('hi');
    } catch (error) {
      allFailed = error;
    }
    if (allFailed?.code !== 'AI_TEXT_PROVIDERS_FAILED' || !/Primary: invalid key/.test(allFailed.message) || !/Backup: also down/.test(allFailed.message)) {
      throw new Error('AI text fallback did not report every provider failure');
    }

    // Captions: narrated text, spread over the measured audio length.
    const production = new ProductionManagementAgent({}, {});
    production.aiVideoGenerator.getMediaDuration = async () => 12;
    const script = {
      hook: { text: 'Sour espresso means under extraction.' },
      introduction: { greeting: '', topicIntro: 'Here is the fix.', valueProposition: '', credibility: '' },
      mainContent: { sections: [{ title: 'Grind', content: ['Grind finer one step at a time.'] }] },
      conclusion: { recap: ['Change one thing.'], finalThought: 'Taste each shot.' }
    };
    const measured = await production.createSRTCaptions({ script, assets: { audio: { status: 'ready', path: 'narration.mp3' } } });
    const narrated = production.formatScriptForTTS(script).split(/\s+/).filter(Boolean).join(' ');
    const captioned = measured.srt.split('\n\n').filter(Boolean).map(block => block.split('\n').slice(2).join(' ')).join(' ');
    if (measured.timing !== 'audio_proportional' || captioned !== narrated) {
      throw new Error('Captions do not match the narrated text');
    }
    const lastTime = measured.srt.trim().split('\n\n').at(-1).split('\n')[1].split(' --> ')[1];
    if (lastTime !== '00:00:12,000') throw new Error(`Captions do not end with the narration (ended at ${lastTime})`);
    const estimated = await production.createSRTCaptions({ script, assets: { audio: { status: 'unavailable' } } });
    if (estimated.timing !== 'estimated') throw new Error('Captions without audio were not marked as estimated');

    this.logger.info('Reliability test completed successfully');
  }
};

module.exports = { publishingTests };
