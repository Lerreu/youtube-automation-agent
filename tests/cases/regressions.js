// Regression tests for reported issues and discussions.
// Methods of SystemTest, merged into its prototype (see test.js).
const { Database } = require('../../database/db');
const { Logger } = require('../../utils/logger');
const path = require('path');
const { ProductionReadinessService } = require('../../utils/production-readiness-service');

const regressionTests = {
  async testReportedDiscussionFixes() {
    const fs = require('fs').promises;
    const os = require('os');
    const sharp = require('sharp');
    const { AIVideoGenerator } = require('../../utils/ai-video-generator');
    const { ProductionManagementAgent } = require('../../agents/production-management-agent');
    const { OperatorService } = require('../../utils/operator-service');

    // Discussion #73: the slideshow must not print another channel's branding or
    // placeholder copy, and must show generated images instead of washing them out.
    const html = new AIVideoGenerator({}).createSlideshowHTML({
      title: 'Slideshow copy test',
      mainContent: {
        sections: [
          { title: 'First chapter', content: ['Spoken line one.', 'Spoken line two.'] },
          { title: 'Empty chapter', content: [] }
        ]
      }
    }, ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
    if (/Ethereal Dreamscript|New content daily|coming soon/i.test(html)) {
      throw new Error('The slideshow still renders hard-coded channel text or placeholder copy');
    }
    if (!html.includes('Spoken line one.')) {
      throw new Error('Array section content was not rendered on its chapter slide');
    }
    if (/\.background-image\s*\{[^}]*opacity:\s*0?\.\d/.test(html)) {
      throw new Error('Generated slideshow images are still washed out behind the gradient');
    }

    // Discussion #31: a simulated AI thumbnail must not replace the designer's real
    // image, and a placeholder that remains must not pass the thumbnail check.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-thumb-'));
    const createdFiles = [];
    const db = new Database();
    await db.initialize();
    try {
      const designerPath = path.join(dir, 'designer.jpg');
      await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 20, g: 40, b: 200 } } })
        .jpeg().toFile(designerPath);
      const agent = Object.create(ProductionManagementAgent.prototype);
      agent.logger = this.logger;
      agent.aiVideoGenerator = {
        generateThumbnail: async () => ({
          path: path.join(dir, 'thumbnail_sim.info'), dimensions: { width: 1792, height: 1024 }, fileSize: 1024, simulated: true
        })
      };
      const kept = await agent.processThumbnail({ path: designerPath, dimensions: { width: 1280, height: 720 }, fileSize: 1 }, { title: 'x' });
      createdFiles.push(kept.path);
      const keptImage = await sharp(kept.path).metadata().catch(() => null);
      if (kept.simulated || !keptImage?.width) {
        throw new Error('A simulated AI thumbnail replaced the designer thumbnail');
      }
      const placeholder = await agent.processThumbnail({ path: path.join(dir, 'missing.jpg') }, { title: 'x' });
      createdFiles.push(placeholder.path);
      if (!placeholder.simulated) throw new Error('A placeholder thumbnail was not marked as simulated');

      const quality = await new OperatorService(db).runQualityChecks({
        script: { title: 'Thumbnail check', fullScript: 'x'.repeat(250) },
        seo: { title: 'Thumbnail check', description: 'x'.repeat(80), tags: ['one', 'two', 'three'] },
        assets: { thumbnail: placeholder, finalVideo: { path: 'final.mp4' } }
      }, { bannedTopics: [] });
      const thumbnailCheck = quality.checks.find(check => check.id === 'thumbnail');
      if (!thumbnailCheck || thumbnailCheck.passed) {
        throw new Error('A placeholder thumbnail passed the thumbnail quality check');
      }
    } finally {
      await db.close();
      await fs.rm(dir, { recursive: true, force: true });
      for (const file of createdFiles) await fs.rm(file, { force: true });
    }

    // Discussion #74: sharp 0.33's wasm32 build crashes with @emnapi/runtime >= 1.4
    // (Termux and other platforms without a native binary).
    const [major, minor] = require('sharp').versions.sharp.split('.').map(Number);
    if (major === 0 && minor < 34) {
      throw new Error(`sharp ${major}.${minor} cannot load its wasm32 build with current @emnapi/runtime`);
    }
  },

  async testReportedIssueFixes() {
    const fs = require('fs').promises;
    const os = require('os');
    const sharp = require('sharp');
    const { AITextService } = require('../../utils/ai-text-service');
    const { AIVideoGenerator, describeImageProviderError } = require('../../utils/ai-video-generator');
    const { AnalyticsOptimizationAgent } = require('../../agents/analytics-optimization-agent');
    const { CredentialManager } = require('../../utils/credential-manager');
    const { YouTubeAutomationAgent } = require('../../index');

    const envKeys = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'MOONSHOT_API_KEY', 'MIMO_API_KEY', 'GLM_API_KEY', 'HOST', 'API_KEY', 'NODE_ENV'];
    const savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-issue-fixes-'));
    const originalGenerateText = AITextService.prototype.generateText;

    try {
      // #63: a thinking model that spends the whole budget on thoughts is retried
      // once with room for the answer, and the readiness probe budget fits thoughts.
      const gemini = new AITextService({ gemini: { apiKey: 'test-key', model: 'gemini-3.8-flash' } });
      const geminiCalls = [];
      gemini.gemini.models.generateContent = async request => {
        geminiCalls.push(request);
        if (geminiCalls.length === 1) {
          return { text: undefined, candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 13 } };
        }
        return { text: 'READY', candidates: [{ finishReason: 'STOP' }] };
      };
      const ready = await gemini.generateText('Reply with exactly READY.', { maxTokens: 16, temperature: 0 });
      if (ready !== 'READY' || geminiCalls.length !== 2 || geminiCalls[1].config.maxOutputTokens < 1024) {
        throw new Error('A thinking-model MAX_TOKENS response was not retried with a larger output budget');
      }

      geminiCalls.length = 0;
      gemini.gemini.models.generateContent = async request => {
        geminiCalls.push(request);
        return { text: undefined, candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 900 } };
      };
      let budgetMessage = '';
      try { await gemini.generateText('prompt', { maxTokens: 64 }); } catch (error) { budgetMessage = error.message; }
      if (geminiCalls.length !== 2 || !/output budget/.test(budgetMessage) || /API key/.test(budgetMessage)) {
        throw new Error('An exhausted thinking budget must retry once and then explain the budget, not blame the API key');
      }

      geminiCalls.length = 0;
      gemini.gemini.models.generateContent = async request => {
        geminiCalls.push(request);
        return { text: '', candidates: [{ finishReason: 'SAFETY' }] };
      };
      let safetyMessage = '';
      try { await gemini.generateText('prompt'); } catch (error) { safetyMessage = error.message; }
      if (geminiCalls.length !== 1 || !/blocked the response \(SAFETY\)/.test(safetyMessage)) {
        throw new Error('A blocked Gemini response must not be retried and must report the block reason');
      }

      let probeOptions = null;
      AITextService.prototype.generateText = async function (_prompt, options) {
        probeOptions = options;
        return 'READY';
      };
      const readiness = new ProductionReadinessService({}, { credentials: { gemini: { apiKey: 'test-key' } } });
      await readiness.probeText();
      if (!probeOptions || probeOptions.maxTokens < 256) {
        throw new Error('The readiness text probe budget is too small for thinking models');
      }
      AITextService.prototype.generateText = originalGenerateText;

      // #65: the cause of a failure reaches the console even when NODE_ENV=production.
      const logger = new Logger('IssueFixTest');
      if (logger.withDetail('Visual asset generation failed:', new Error('quota exhausted')) !== 'Visual asset generation failed: quota exhausted') {
        throw new Error('Error details were not appended to the console line');
      }
      if (logger.withDetail('Fallback failed: boom', new Error('boom')) !== 'Fallback failed: boom') {
        throw new Error('An already-interpolated error message was duplicated');
      }
      if (logger.withDetail('Saved', { id: 1 }) !== 'Saved') {
        throw new Error('Structured log metadata must not be appended to the console line');
      }
      process.env.NODE_ENV = 'production';
      const printed = [];
      const originalConsoleLog = console.log;
      console.log = line => printed.push(String(line));
      try {
        logger.error('Thumbnail generation failed:', new Error('limit: 0'));
        logger.warn('Failed to initialize Gemini media service:', 'module missing');
      } finally {
        console.log = originalConsoleLog;
        delete process.env.NODE_ENV;
      }
      if (!printed.some(line => line.includes('Thumbnail generation failed: limit: 0')) || !printed.some(line => line.includes('module missing'))) {
        throw new Error('Production console output hid the failure cause');
      }

      const quotaError = Object.assign(new Error(JSON.stringify({ error: {
        code: 429,
        message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image',
        status: 'RESOURCE_EXHAUSTED'
      } })), { status: 429 });
      const quota = describeImageProviderError('Gemini', 'gemini-3.1-flash-image', quotaError);
      if (!/429 RESOURCE_EXHAUSTED/.test(quota) || !/billing/.test(quota) || /\{"error"/.test(quota)) {
        throw new Error('A Gemini zero-quota error was not translated into a readable billing fix');
      }

      // #65: a failing image provider falls through to the next configured one.
      const generator = new AIVideoGenerator({ openai: { apiKey: 'test-key' }, gemini: { apiKey: 'test-key' } });
      let openAIAttempts = 0;
      generator.openai.images.generate = async () => {
        openAIAttempts++;
        throw Object.assign(new Error('401 Incorrect API key provided'), { status: 401 });
      };
      const image = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#224488' } }).png().toBuffer();
      generator.gemini.models.generateContent = async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }]
      });
      const imagePath = path.join(directory, 'fallback.png');
      await generator.generateImage('A blue test image', imagePath);
      if (openAIAttempts !== 1 || (await sharp(imagePath).metadata()).width !== 320) {
        throw new Error('A failed OpenAI image request did not fall back to Gemini');
      }
      generator.gemini.models.generateContent = async () => { throw quotaError; };
      let combined = '';
      try { await generator.generateImage('A blue test image', path.join(directory, 'none.png')); } catch (error) { combined = error.message; }
      if (!/OpenAI image generation/.test(combined) || !/Gemini image generation/.test(combined) || !/rejected/.test(combined)) {
        throw new Error('When every image provider fails, each provider failure and fix must be reported');
      }

      // #66: whole-channel statistics come from YouTube, cache briefly, and report a
      // disabled Analytics API with an activation link instead of zeroes.
      const analytics = new AnalyticsOptimizationAgent({}, {});
      let channelCalls = 0;
      analytics.youtube = { channels: { list: async () => {
        channelCalls++;
        return { data: { items: [{ id: 'UC123', snippet: { title: 'Existing Channel' }, statistics: { subscriberCount: '1200', viewCount: '45000', videoCount: '38', hiddenSubscriberCount: false } }] } };
      } } };
      analytics.youtubeAnalytics = { reports: { query: async () => ({ data: {
        columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }, { name: 'subscribersGained' }, { name: 'subscribersLost' }],
        rows: [[3100, 5400, 40, 6]]
      } }) } };
      const snapshot = await analytics.getChannelSnapshot();
      if (!snapshot.available || snapshot.channel.title !== 'Existing Channel' || snapshot.channel.subscribers !== 1200 || snapshot.channel.videos !== 38) {
        throw new Error('Channel snapshot did not report the channel-wide YouTube totals');
      }
      if (!snapshot.recent.available || snapshot.recent.watchHours !== 90 || snapshot.recent.netSubscribers !== 34) {
        throw new Error('Channel snapshot did not report 28-day analytics');
      }
      const day = 24 * 60 * 60 * 1000;
      if ((new Date(snapshot.recent.endDate) - new Date(snapshot.recent.startDate)) / day !== 27) {
        throw new Error('Channel analytics window is not 28 days');
      }
      await analytics.getChannelSnapshot();
      if (channelCalls !== 1) throw new Error('Channel snapshot was not cached between dashboard visits');

      analytics.youtubeAnalytics = { reports: { query: async () => {
        const error = new Error('YouTube Analytics API has not been used in project 42 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtubeanalytics.googleapis.com/overview?project=42 then retry.');
        error.response = { data: { error: { code: 403, message: error.message, errors: [{ reason: 'accessNotConfigured' }] } } };
        throw error;
      } } };
      const disabled = await analytics.getChannelSnapshot({ refresh: true });
      if (channelCalls !== 2 || disabled.recent.available || !/not enabled/.test(disabled.recent.reason) ||
        !/youtubeanalytics\.googleapis\.com/.test(disabled.recent.activationUrl || '') || 'views' in disabled.recent) {
        throw new Error('A disabled YouTube Analytics API must be reported with an activation link, not as zero');
      }
      const hidden = new AnalyticsOptimizationAgent({}, {});
      hidden.youtube = { channels: { list: async () => ({ data: { items: [{ id: 'UC9', snippet: {}, statistics: { viewCount: '1', videoCount: '1', hiddenSubscriberCount: true } }] } }) } };
      hidden.youtubeAnalytics = analytics.youtubeAnalytics;
      const hiddenSnapshot = await hidden.getChannelSnapshot();
      if (hiddenSnapshot.channel.subscribers !== null || !hiddenSnapshot.channel.subscribersHidden) {
        throw new Error('Hidden subscriber counts must be unavailable, not zero');
      }
      const disconnected = await new AnalyticsOptimizationAgent({}, {}).getChannelSnapshot();
      if (disconnected.available !== false || !/Connect YouTube/.test(disconnected.reason)) {
        throw new Error('A missing YouTube connection must be explained');
      }

      // #66: the dashboard listens on loopback unless HOST says otherwise.
      const server = new YouTubeAutomationAgent();
      server.initialize = async () => true;
      let listenArgs = null;
      server.app = { listen: (port, host, callback) => { listenArgs = { port, host }; if (callback) callback(); } };
      const quietLog = console.log;
      console.log = () => {};
      try {
        await server.start();
        if (listenArgs?.host !== '127.0.0.1') throw new Error(`Dashboard server bound to ${listenArgs?.host} instead of loopback by default`);
        process.env.HOST = '0.0.0.0';
        await server.start();
        if (listenArgs?.host !== '0.0.0.0') throw new Error('HOST did not override the dashboard bind address');
      } finally {
        console.log = quietLog;
        delete process.env.HOST;
      }

      // #66: credential and token files are owner-only.
      if (process.platform !== 'win32') {
        const credentials = new CredentialManager();
        credentials.tokensPath = path.join(directory, 'tokens.json');
        await fs.writeFile(credentials.tokensPath, '{}', { mode: 0o644 });
        credentials.tokens = { youtube: { refresh_token: 'test' } };
        await credentials.saveTokens();
        const mode = (await fs.stat(credentials.tokensPath)).mode & 0o777;
        if (mode !== 0o600) throw new Error(`Token file mode is ${mode.toString(8)}, expected 600`);
      }
    } finally {
      AITextService.prototype.generateText = originalGenerateText;
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }

    this.logger.info('Reported issue fix tests completed successfully');
  },

  async testOpenIssueRegressions() {
    const { ModernAuth } = require('../../modern-auth');
    const { ProductionManagementAgent } = require('../../agents/production-management-agent');
    const { YouTubeAutomationAgent } = require('../../index');

    const auth = new ModernAuth();
    const fixedRedirect = auth.resolveRedirect({
      youtube: { redirect_uris: ['http://127.0.0.1'] }
    });
    if (fixedRedirect.hostname !== '127.0.0.1' || fixedRedirect.port < 8000 || fixedRedirect.pathname !== '/') {
      throw new Error('OAuth did not use a desktop-app loopback redirect with a local dynamic port');
    }

    const visualStyles = [];
    const productionAgent = Object.create(ProductionManagementAgent.prototype);
    productionAgent.db = { getChannelProfile: async () => ({ visual_style: 'animated' }) };
    productionAgent.logger = this.logger;
    productionAgent.aiVideoGenerator = {
      generateVisualAssets: async (prompt, style) => {
        visualStyles.push({ prompt, style });
        return [`asset-${visualStyles.length}.png`];
      }
    };
    const productionData = {
      script: { title: 'Configured visuals', mainContent: { sections: [{ title: 'Clear demonstration' }] } },
      assets: {}, timeline: {}, estimatedDuration: '1:00'
    };
    await productionAgent.generateVideoContent(productionData);
    if (!visualStyles.length || visualStyles.some(item => item.style !== 'animated' || /ethereal|mystical|dreamscape/i.test(item.prompt))) {
      throw new Error('Initial scene generation mixed hardcoded ethereal cues with the configured visual style');
    }

    const pipeline = new YouTubeAutomationAgent();
    pipeline.db = {
      getChannelProfile: async () => ({}),
      saveProductionData: async data => data.id,
      saveProductionSnapshot: async () => {},
      getSetting: async () => 'true',
      saveContentReview: async () => {},
      updateProductionStatus: async () => {}
    };
    pipeline.provenance = { initialize: async () => ({ sources: [], claims: [], status: 'not_required' }) };
    pipeline.operator = {
      runQualityChecks: async () => ({ passed: true, score: 100, checks: [], blockingFailures: [] }),
      notify: async () => {}
    };
    pipeline.preparePackagingExperiment = async () => null;
    pipeline.agents = {
      strategy: { generateContentStrategy: async () => ({ topic: 'Null context', angle: 'Original angle' }) },
      scriptWriter: { generateScript: async strategy => ({ title: strategy.topic, fullScript: 'Complete script.' }) },
      thumbnailDesigner: { generateThumbnail: async () => ({ path: 'thumbnail.png' }) },
      seoOptimizer: { optimize: async script => ({ title: script.title, description: 'Description', tags: ['test'] }) },
      production: { processContent: async input => ({
        id: 'null-context-production', status: 'ready', ...input, assets: {}, timeline: {},
        scheduledPublishTime: new Date(Date.now() + 86400000).toISOString(), priority: 50
      }) },
      publishing: { scheduleContent: async () => null }
    };
    const generated = await pipeline.generateContent(null, null, 'short', { strategyContext: null });
    if (generated.contentId !== 'null-context-production') {
      throw new Error('A null manual strategy context still prevented generation');
    }

    this.logger.info('Open issue regression test completed successfully');
  }
};

module.exports = { regressionTests };
