// Database, migrations, configuration, credentials, setup walkthrough and infrastructure tests.
// Methods of SystemTest, merged into its prototype (see test.js).
const ROOT = require('path').join(__dirname, '../..');
const { Database } = require('../../database/db');
const { Logger } = require('../../utils/logger');
const { CredentialManager } = require('../../utils/credential-manager');
const path = require('path');

const coreTests = {
  async testDatabase() {
    const db = new Database();
    await db.initialize();
    
    // Test basic operations
    const stats = await db.getStats();
    if (!stats) throw new Error('Failed to get database stats');
    
    // Test settings
    await db.setSetting('test_key', 'test_value', 'Test setting');
    const value = await db.getSetting('test_key');
    if (value !== 'test_value') throw new Error('Settings read/write failed');
    
    await db.close();
    this.logger.info('Database test completed successfully');
  },

  async testProductionPersistence() {
    const db = new Database();
    await db.initialize();

    const production = {
      id: `prod_test_${Date.now()}`,
      status: 'processing',
      assets: { finalVideo: { path: 'placeholder.mp4' } },
      timeline: { created: new Date().toISOString() },
      scheduledPublishTime: new Date().toISOString(),
      priority: 25,
      estimatedDuration: '1:00'
    };

    const firstId = await db.saveProductionData(production);
    if (firstId !== production.id) {
      throw new Error('saveProductionData did not return the production id');
    }

    const secondId = await db.saveProductionData({
      ...production,
      status: 'ready',
      priority: 90
    });
    if (secondId !== production.id) {
      throw new Error('saveProductionData upsert did not return the production id');
    }

    const saved = await db.getRow('SELECT status, priority FROM productions WHERE id = ?', [production.id]);
    if (!saved || saved.status !== 'ready' || saved.priority !== 90) {
      throw new Error('saveProductionData did not upsert the existing production row');
    }

    await db.executeQuery('DELETE FROM productions WHERE id = ?', [production.id]);
    await db.close();
    this.logger.info('Production persistence test completed successfully');
  },

  async testAutomationEventsTable() {
    const db = new Database();
    await db.initialize();

    await db.executeQuery(
      "INSERT INTO automation_events (event_type, status, data, created_at) VALUES (?, ?, ?, datetime('now'))",
      ['test_event', 'success', JSON.stringify({ ok: true })]
    );

    const row = await db.getRow(
      'SELECT event_type, status, data FROM automation_events WHERE event_type = ? ORDER BY created_at DESC',
      ['test_event']
    );

    if (!row || row.status !== 'success') {
      throw new Error('automation_events row was not persisted');
    }

    await db.executeQuery('DELETE FROM automation_events WHERE event_type = ?', ['test_event']);
    await db.close();
    this.logger.info('Automation events table test completed successfully');
  },

  async testActivationMetrics() {
    const fs = require('fs').promises;
    const { ActivationMetrics } = require('../../utils/activation-metrics');
    const db = new Database();
    await db.initialize();
    const id = `activation_test_${Date.now()}`;
    const videoPath = path.join(ROOT, 'temp', `${id}.mp4`);
    const mp4Header = Buffer.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d
    ]);

    try {
      await fs.mkdir(path.dirname(videoPath), { recursive: true });
      await fs.writeFile(videoPath, mp4Header);
      await db.saveProductionData({
        id,
        status: 'ready',
        assets: { finalVideo: { path: videoPath, simulated: false } },
        timeline: { readyForUpload: new Date().toISOString() },
        scheduledPublishTime: null,
        priority: 1,
        estimatedDuration: '0:01'
      });

      const activation = new ActivationMetrics(db);
      const summary = await activation.getSummary();
      if (!summary.milestones.firstRealVideo.achieved || summary.counts.realVideos < 1) {
        throw new Error('A verified non-simulated MP4 was not counted as activation');
      }

      await fs.writeFile(videoPath, Buffer.from('renamed-but-not-an-mp4'));
      const invalidContainerSummary = await activation.getSummary();
      if (invalidContainerSummary.counts.realVideos >= summary.counts.realVideos) {
        throw new Error('A file with an .mp4 extension but no MP4 signature was counted as activation');
      }

      await fs.writeFile(videoPath, mp4Header);
      await db.updateProductionData({
        id,
        status: 'simulated',
        assets: { finalVideo: { path: videoPath, simulated: true } },
        timeline: {},
        scheduledPublishTime: null,
        priority: 1
      });
      const simulatedSummary = await activation.getSummary();
      if (simulatedSummary.counts.realVideos >= summary.counts.realVideos) {
        throw new Error('A simulated MP4 was incorrectly counted as activation');
      }
    } finally {
      await db.executeQuery('DELETE FROM productions WHERE id = ?', [id]);
      await fs.unlink(videoPath).catch(() => {});
      await db.close();
    }

    this.logger.info('Local activation metrics test completed successfully');
  },

  async testAnonymousTelemetryOptIn() {
    const { AnonymousTelemetry } = require('../../utils/anonymous-telemetry');
    const savedEnabled = process.env.ANONYMOUS_TELEMETRY_ENABLED;
    const savedEndpoint = process.env.ANONYMOUS_TELEMETRY_ENDPOINT;
    const db = new Database();
    await db.initialize();
    try {
      delete process.env.ANONYMOUS_TELEMETRY_ENABLED;
      delete process.env.ANONYMOUS_TELEMETRY_ENDPOINT;
      const telemetry = new AnonymousTelemetry(db, this.logger);
      if (telemetry.configuration().enabled) throw new Error('Anonymous telemetry was enabled without opt-in');

      process.env.ANONYMOUS_TELEMETRY_ENABLED = 'true';
      process.env.ANONYMOUS_TELEMETRY_ENDPOINT = 'http://example.com/events';
      if (telemetry.configuration().enabled) throw new Error('Anonymous telemetry accepted a non-HTTPS endpoint');
    } finally {
      if (savedEnabled === undefined) delete process.env.ANONYMOUS_TELEMETRY_ENABLED;
      else process.env.ANONYMOUS_TELEMETRY_ENABLED = savedEnabled;
      if (savedEndpoint === undefined) delete process.env.ANONYMOUS_TELEMETRY_ENDPOINT;
      else process.env.ANONYMOUS_TELEMETRY_ENDPOINT = savedEndpoint;
      await db.close();
    }
    this.logger.info('Anonymous telemetry opt-in test completed successfully');
  },

  async testSchemaMigrations() {
    const os = require('os');
    const fsp = require('fs').promises;
    const { MIGRATIONS, runMigrations } = require('../../database/migrations');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yaa-migrations-'));
    const open = async () => {
      const db = new Database();
      db.dbPath = path.join(dir, 'test.db');
      db.logger = { info: () => {}, warn: () => {}, error: () => {}, success: () => {} };
      await db.initialize();
      return db;
    };
    try {
      // Fresh database: every migration is applied once.
      let db = await open();
      const versions = (await db.getAllRows('SELECT version FROM schema_migrations ORDER BY version')).map(row => row.version);
      if (versions.join(',') !== MIGRATIONS.map(m => m.version).join(',')) throw new Error(`Unexpected applied migrations: ${versions}`);

      // A database from before versioned migrations (no schema_migrations, legacy setting) is upgraded.
      await db.executeQuery('DROP TABLE schema_migrations');
      await db.setSetting('approval_required', 'false');
      await db.close();
      db = await open();
      if (await db.getSetting('approval_required') !== null) throw new Error('Legacy approval_required setting survived the upgrade');
      if ((await db.getAllRows('SELECT version FROM schema_migrations')).length !== MIGRATIONS.length) throw new Error('Legacy database was not marked as migrated');

      // Re-opening does not re-run anything.
      const rerun = await runMigrations(db);
      if (rerun.applied.length !== 0) throw new Error('Applied migrations ran again');

      // A failing migration rolls back completely.
      const failing = [...MIGRATIONS, {
        version: MIGRATIONS.length + 1,
        name: 'broken',
        up: async target => {
          await target.executeQuery('CREATE TABLE half_done (id TEXT)');
          throw new Error('boom');
        }
      }];
      let failed = false;
      try {
        await runMigrations(db, failing);
      } catch (error) {
        failed = /Migration \d+ \(broken\) failed: boom/.test(error.message);
      }
      const leftover = await db.getRow("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'half_done'");
      if (!failed || leftover) throw new Error('A failed migration was not rolled back');

      // Code older than the database refuses to run against it.
      await db.executeQuery('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [999, 'from_the_future']);
      let refused = false;
      try {
        await runMigrations(db);
      } catch (error) {
        refused = /newer than this code supports/.test(error.message);
      }
      if (!refused) throw new Error('Older code ran against a newer schema');
      await db.close();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    this.logger.info('Schema migrations test completed successfully');
  },

  async testLogger() {
    const testLogger = new Logger('TestLogger');
    
    testLogger.info('Test info message');
    testLogger.warn('Test warning message');
    testLogger.success('Test success message');
    
    // Test timer
    const timer = testLogger.startTimer('Test Operation');
    await new Promise(resolve => setTimeout(resolve, 100));
    timer.end();
    
    this.logger.info('Logger test completed successfully');
  },

  async testDirectories() {
    const fs = require('fs').promises;
    
    const requiredDirs = [
      'config',
      'logs', 
      'data',
      'agents',
      'database',
      'utils',
      'schedules'
    ];

    for (const dir of requiredDirs) {
      const dirPath = path.join(ROOT, dir);
      await fs.access(dirPath);
    }

    this.logger.info('Directory structure test completed successfully');
  },

  async testAgentLoading() {
    // Test that agent files can be loaded
    const agentFiles = [
      '../../agents/content-strategy-agent',
      '../../agents/script-writer-agent',
      '../../agents/thumbnail-designer-agent',
      '../../agents/seo-optimizer-agent',
      '../../agents/production-management-agent',
      '../../agents/publishing-scheduling-agent',
      '../../agents/analytics-optimization-agent',
      '../../utils/discoverability-service',
      '../../utils/discoverability-adapters/darkzseo'
    ];

    for (const agentFile of agentFiles) {
      try {
        require(agentFile);
      } catch (error) {
        throw new Error(`Failed to load ${agentFile}: ${error.message}`);
      }
    }

    this.logger.info('Agent loading test completed successfully');
  },

  async testConfiguration() {
    const fs = require('fs').promises;
    
    // Check package.json
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
    if (!packageJson.name || !packageJson.dependencies) {
      throw new Error('Invalid package.json');
    }

    // Check if main index file exists
    await fs.access('./index.js');

    // The startup banner must report the real version. It was hardcoded to "v2.0"
    // through v2.4.0, so bug reports pasted a version that was four releases stale.
    const indexSource = await fs.readFile('index.js', 'utf8');
    const hardcodedBanner = indexSource.match(/YouTube Automation Agent v[\d.]/);
    if (hardcodedBanner) {
      throw new Error(
        `Startup banner hardcodes a version ("${hardcodedBanner[0]}") — interpolate package.json's version instead`
      );
    }
    if (!indexSource.includes('YouTube Automation Agent v${version}')) {
      throw new Error('Startup banner does not report the package.json version');
    }

    // package.json and package-lock.json drifted apart before v2.4.1; keep them aligned
    const lockJson = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
    if (lockJson.version !== packageJson.version) {
      throw new Error(
        `package-lock.json version (${lockJson.version}) does not match package.json (${packageJson.version})`
      );
    }

    this.logger.info('Configuration test completed successfully');
  },

  async testCredentialValidation() {
    const { PROVIDERS, AITextService } = require('../../utils/ai-text-service');
    const manager = new CredentialManager();

    // Isolate the test from any API keys set in the environment
    const envKeys = [...Object.values(PROVIDERS).map(p => p.envKey), 'GEMINI_API_KEY', 'MINIMAX_API_KEY'];
    const savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }

    try {
      manager.credentials = { youtube: { client_id: 'x' }, gemini: { apiKey: 'gm-test' } };
      if (manager.getMissingCredentials().length !== 0) {
        throw new Error('Gemini-only configuration was incorrectly reported as missing credentials');
      }

      manager.credentials = { youtube: { client_id: 'x' }, aiProvider: { provider: 'openrouter', apiKey: 'sk-or-test' } };
      if (manager.getMissingCredentials().length !== 0) {
        throw new Error('OpenRouter configuration was incorrectly reported as missing credentials');
      }

      manager.credentials = { youtube: { client_id: 'x' } };
      const missingProvider = manager.getMissingCredentials();
      if (missingProvider.length !== 1 || !/AI provider/.test(missingProvider[0])) {
        throw new Error('Missing AI provider was not detected');
      }

      manager.credentials = { openai: { apiKey: 'sk-test' } };
      const missingYouTube = manager.getMissingCredentials();
      if (missingYouTube.length !== 1 || missingYouTube[0] !== 'youtube') {
        throw new Error('Missing YouTube credentials were not detected');
      }

      // MINIMAX_API_KEY is the H3 video key. It must not count as a text
      // provider or pull a Gemini user onto MiniMax text.
      process.env.MINIMAX_API_KEY = 'mm-video-test';
      manager.credentials = { youtube: { client_id: 'x' } };
      if (manager.getMissingCredentials().length !== 1) {
        throw new Error('A MiniMax video key was treated as an AI text provider');
      }
      const geminiText = new AITextService({ gemini: { apiKey: 'gm-test' } });
      if (geminiText.providerName !== 'Google Gemini') {
        throw new Error('A MiniMax video key switched the text provider away from Gemini');
      }
      process.env.MINIMAX_TEXT_API_KEY = 'mm-text-test';
      const minimaxText = new AITextService({});
      if (minimaxText.providerName !== 'MiniMax' || minimaxText.model !== PROVIDERS.minimax.defaultModel) {
        throw new Error('MINIMAX_TEXT_API_KEY did not select MiniMax text generation');
      }
    } finally {
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
    }

    this.logger.info('Credential validation test completed successfully');
  },

  async testWalkthroughModule() {
    const { SetupWalkthrough, AI_PROVIDER_GUIDE, VIDEO_PROVIDER_GUIDE } = require('../../walkthrough');
    const { PROVIDERS, GEMINI_MODELS, GEMINI_DEFAULT_MODEL } = require('../../utils/ai-text-service');

    const walkthrough = new SetupWalkthrough();
    if (typeof walkthrough.run !== 'function') {
      throw new Error('SetupWalkthrough.run is not implemented');
    }

    // Every guided provider must be complete and coherent
    for (const [id, guide] of Object.entries(AI_PROVIDER_GUIDE)) {
      for (const field of ['label', 'keyUrl', 'instructions', 'models', 'defaultModel', 'save', 'validationCreds']) {
        if (!guide[field]) {
          throw new Error(`Provider guide "${id}" is missing "${field}"`);
        }
      }
      if (!guide.models.includes(guide.defaultModel)) {
        throw new Error(`Provider guide "${id}" default model is not in its model list`);
      }

      // save() must produce credentials that pass validation
      const credentials = {};
      guide.save(credentials, 'test-key', guide.defaultModel);
      const manager = new CredentialManager();
      manager.credentials = { youtube: { client_id: 'x' }, ...credentials };

      const envKeys = [...Object.values(PROVIDERS).map(p => p.envKey), 'GEMINI_API_KEY'];
      const savedEnv = {};
      for (const key of envKeys) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      try {
        if (manager.getMissingCredentials().length !== 0) {
          throw new Error(`Provider guide "${id}" save() output fails credential validation`);
        }
      } finally {
        for (const key of envKeys) {
          if (savedEnv[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = savedEnv[key];
          }
        }
      }
    }

    if (
      JSON.stringify(AI_PROVIDER_GUIDE.gemini.models) !== JSON.stringify(GEMINI_MODELS) ||
      AI_PROVIDER_GUIDE.gemini.defaultModel !== GEMINI_DEFAULT_MODEL
    ) {
      throw new Error('Walkthrough Gemini models drifted from the runtime catalog');
    }

    for (const id of Object.keys(PROVIDERS)) {
      if (JSON.stringify(AI_PROVIDER_GUIDE[id].models) !== JSON.stringify(PROVIDERS[id].models)) {
        throw new Error(`Walkthrough provider "${id}" models drifted from the runtime catalog`);
      }
    }

    for (const id of ['slideshow', 'seedance', 'minimax_h3', 'google_omni', 'kling', 'wan']) {
      const guide = VIDEO_PROVIDER_GUIDE[id];
      if (!guide?.label) throw new Error(`Walkthrough is missing video provider "${id}"`);
      if (id !== 'slideshow') {
        const credentials = {};
        guide.save(credentials, 'test-key', 'test-secret');
        if (!Object.keys(credentials).length || !guide.keyUrl || !guide.credentialName) {
          throw new Error(`Video provider guide "${id}" cannot save its credentials`);
        }
      }
    }

    const currentOpenRouterModels = [
      'openai/gpt-6.1-sol',
      'anthropic/claude-fable-5.1',
      'google/gemini-3.8-flash',
      'moonshotai/kimi-k3',
      'z-ai/glm-5.3',
      'deepseek/deepseek-v4.1-flash',
      'minimax/minimax-m3'
    ];
    if (JSON.stringify(PROVIDERS.openrouter.models) !== JSON.stringify(currentOpenRouterModels)) {
      throw new Error('OpenRouter curated models are not the verified current catalog');
    }

    this.logger.info('Walkthrough module test completed successfully');
  },

  async testYouTubeScopeDetection() {
    const manager = new CredentialManager();
    const forceSsl = 'https://www.googleapis.com/auth/youtube.force-ssl';
    manager.tokens = { youtube: { scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube' } };
    if (manager.hasYouTubeScope(forceSsl)) throw new Error('force-ssl must not be reported before consent');
    if (!manager.hasYouTubeScope('https://www.googleapis.com/auth/youtube')) throw new Error('Granted scopes must be detected');
    manager.tokens.youtube.scope += ` ${forceSsl}`;
    if (!manager.hasYouTubeScope(forceSsl)) throw new Error('force-ssl must be detected after consent');
    manager.tokens = {};
    if (manager.hasYouTubeScope('https://www.googleapis.com/auth/youtube')) throw new Error('Missing tokens must report no scopes');
  }
};

module.exports = { coreTests };
