// HTTP API, API key/CSRF protection and OAuth hardening tests.
// Methods of SystemTest, merged into its prototype (see test.js).
const { Database } = require('../../database/db');
const { CredentialManager } = require('../../utils/credential-manager');
const path = require('path');

const apiSecurityTests = {
  async testOperatorWorkflowAPI() {
    const { YouTubeAutomationAgent } = require('../../index');
    const { OperatorService } = require('../../utils/operator-service');
    const db = new Database();
    await db.initialize();
    let server;
    let job;
    let learningRecommendation;

    try {
      job = await db.createGenerationJob({ topic: 'Operator workflow test', style: 'explainer', length: 'short' });
      await db.updateGenerationJob(job.id, { status: 'running', stage: 'script', progress: 25 });
      const updated = await db.getGenerationJob(job.id);
      if (updated.stage !== 'script' || updated.progress !== 25) {
        throw new Error('Generation job progress was not persisted');
      }

      const operator = new OperatorService(db);
      operator.notify = async () => null;
      const quality = await operator.runQualityChecks({
        script: { title: 'Test title', fullScript: 'x'.repeat(250) },
        seo: { title: 'Test title', description: 'x'.repeat(80), tags: ['one', 'two', 'three'] },
        assets: { finalVideo: { path: 'placeholder.info', simulated: true } }
      }, { bannedTopics: [] });
      if (quality.passed || !quality.blockingFailures.includes('video')) {
        throw new Error('Quality gate did not block a simulated video');
      }

      const agent = new YouTubeAutomationAgent();
      agent.db = db;
      agent.operator = operator;
      agent.agents = {
        analytics: {
          getRecentAnalytics: async () => ({ totalVideos: 0, averagePerformanceScore: 0, topPerformers: [], insights: [] })
        }
      };
      agent.scheduler = {
        isEnabled: true,
        pauseAutomation: async function() { this.isEnabled = false; },
        resumeAutomation: async function() { this.isEnabled = true; }
      };
      agent.isInitialized = true;
      agent.setupAPI();
      server = await new Promise(resolve => {
        const running = agent.app.listen(0, () => resolve(running));
      });
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
      const dashboard = await response.json();
      if (
        !response.ok ||
        !Array.isArray(dashboard.jobs) ||
        !Array.isArray(dashboard.pipeline) ||
        !Array.isArray(dashboard.operatorRuns) ||
        dashboard.activation?.privacy !== 'local-only'
      ) {
        throw new Error('Operator dashboard API did not return its data contract');
      }
      const unavailableStart = await fetch(`http://127.0.0.1:${port}/api/operator/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY },
        body: '{}'
      });
      if (unavailableStart.status !== 503) {
        throw new Error('Autonomous operator did not fail closed when its strategy agent was unavailable');
      }

      learningRecommendation = await db.saveLearningRecommendation({
        fingerprint: `operator-api-${Date.now()}`,
        category: 'format',
        title: 'Test evidence-backed recommendation',
        rationale: 'Created only for API contract verification.',
        evidence: { sampleSize: 4 },
        proposedChange: { target: 'future_plans', prefer: 'tutorial' },
        confidence: 'medium'
      });
      const approveLearning = await fetch(
        `http://127.0.0.1:${port}/api/learning/recommendations/${learningRecommendation.id}/approve`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.API_KEY }, body: '{}' }
      );
      const approvedLearning = await approveLearning.json();
      if (!approveLearning.ok || approvedLearning.result?.status !== 'approved') {
        throw new Error('Learning recommendation review API did not persist approval');
      }
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      if (job) await db.executeQuery('DELETE FROM generation_jobs WHERE id = ?', [job.id]);
      if (learningRecommendation) await db.executeQuery('DELETE FROM learning_recommendations WHERE id = ?', [learningRecommendation.id]);
      await db.close();
    }

    this.logger.info('Operator workflow API test completed successfully');
  },

  async testAPIValidationAndSecurity() {
    const { YouTubeAutomationAgent } = require('../../index');
    const agent = new YouTubeAutomationAgent();

    if (typeof agent.validateGenerateRequestBody !== 'function') {
      throw new Error('validateGenerateRequestBody is not implemented');
    }
    if (typeof agent.requireAPIKey !== 'function') {
      throw new Error('requireAPIKey is not implemented');
    }

    const valid = agent.validateGenerateRequestBody({
      topic: 'Node automation',
      style: 'tutorial'
    });
    if (!valid.valid || valid.value.topic !== 'Node automation') {
      throw new Error('Valid generate request was rejected');
    }

    const invalidTopic = agent.validateGenerateRequestBody({ topic: 123 });
    if (invalidTopic.valid || invalidTopic.status !== 400) {
      throw new Error('Non-string topic was not rejected');
    }

    // The dashboard's "Generate Content Now" button sends an explicit null topic
    // to mean "pick a trending topic for me". null must be accepted, not rejected.
    const dashboardPayload = agent.validateGenerateRequestBody({ topic: null, style: 'story' });
    if (!dashboardPayload.valid) {
      throw new Error(`Dashboard generate payload was rejected: ${dashboardPayload.error}`);
    }
    if (dashboardPayload.value.topic !== null || dashboardPayload.value.style !== 'story') {
      throw new Error('Null topic was not normalised to an auto-selected topic');
    }

    const nullStyle = agent.validateGenerateRequestBody({ topic: 'Node automation', style: null });
    if (!nullStyle.valid || nullStyle.value.style !== null) {
      throw new Error('Null style was not accepted as "no style preference"');
    }

    const nullLength = agent.validateGenerateRequestBody({ topic: null, style: null, length: null });
    if (!nullLength.valid || nullLength.value.length !== 'medium') {
      throw new Error('Null length did not fall back to the default length');
    }

    const blankTopic = agent.validateGenerateRequestBody({ topic: '   ' });
    if (!blankTopic.valid || blankTopic.value.topic !== null) {
      throw new Error('Whitespace-only topic was not normalised to null');
    }

    const invalidStyle = agent.validateGenerateRequestBody({ style: 'x'.repeat(51) });
    if (invalidStyle.valid || invalidStyle.status !== 400) {
      throw new Error('Overlong style was not rejected');
    }

    const previousKey = process.env.API_KEY;
    delete process.env.API_KEY;
    const middleware = agent.requireAPIKey();

    let unsetNextCalled = false;
    const unsetResponse = this.createMockResponse();
    middleware({ get: () => '' }, unsetResponse, () => { unsetNextCalled = true; });
    if (unsetNextCalled || unsetResponse.statusCode !== 503) {
      throw new Error('Mutating routes were open while API_KEY was unset');
    }

    const csrf = agent.rejectCrossSiteWrites();
    const csrfCases = [
      [{ method: 'POST', headers: { origin: 'https://evil.example', host: '127.0.0.1:3456' } }, false, 'foreign Origin'],
      [{ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3456' } }, false, 'cross-site fetch'],
      [{ method: 'POST', headers: { origin: 'http://127.0.0.1:3456', host: '127.0.0.1:3456', 'sec-fetch-site': 'same-origin' } }, true, 'same-origin dashboard'],
      [{ method: 'POST', headers: { host: '127.0.0.1:3456' } }, true, 'non-browser client'],
      [{ method: 'GET', headers: { origin: 'https://evil.example', host: '127.0.0.1:3456' } }, true, 'cross-site read']
    ];
    for (const [request, allowed, label] of csrfCases) {
      let passed = false;
      const response = this.createMockResponse();
      csrf({ method: request.method, protocol: 'http', get: name => request.headers[name.toLowerCase()] }, response, () => { passed = true; });
      if (passed !== allowed) throw new Error(`Cross-site write check was wrong for ${label}`);
    }

    process.env.API_KEY = 'test-secret';

    let rejectedNextCalled = false;
    const rejectedResponse = this.createMockResponse();
    middleware({ get: () => 'wrong-secret' }, rejectedResponse, () => {
      rejectedNextCalled = true;
    });

    if (rejectedNextCalled || rejectedResponse.statusCode !== 401) {
      throw new Error('Invalid API key was not rejected');
    }

    let acceptedNextCalled = false;
    const acceptedResponse = this.createMockResponse();
    middleware({ get: () => 'test-secret' }, acceptedResponse, () => {
      acceptedNextCalled = true;
    });

    if (!acceptedNextCalled || acceptedResponse.statusCode) {
      throw new Error('Valid API key was not accepted');
    }

    if (previousKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previousKey;
    }

    this.logger.info('API validation and security test completed successfully');
  },

  async testYouTubeOAuthHardening() {
    const os = require('os');
    const fsp = require('fs').promises;
    const { google } = require('googleapis');
    const { ModernAuth, parseCallback, escapeHtml } = require('../../modern-auth');

    const auth = new ModernAuth({ openBrowser: false });
    const client = new google.auth.OAuth2('client-id', 'client-secret', 'http://127.0.0.1:8123/');
    const request = await auth.buildAuthRequest(client);
    const authUrl = new URL(request.authUrl);
    if (authUrl.searchParams.get('state') !== request.state || request.state.length < 32) {
      throw new Error('OAuth request is missing a strong state parameter');
    }
    if (authUrl.searchParams.get('code_challenge_method') !== 'S256' || !authUrl.searchParams.get('code_challenge') || !request.codeVerifier) {
      throw new Error('OAuth request is missing PKCE');
    }

    const callback = query => new URL(`http://127.0.0.1:8123/?${query}`);
    if (parseCallback(callback(`code=abc&state=${request.state}`), request.state).code !== 'abc') {
      throw new Error('A valid OAuth callback was rejected');
    }
    for (const query of ['code=abc', 'code=abc&state=forged', `state=${request.state}`, `error=access_denied&state=forged`]) {
      if (!parseCallback(callback(query), request.state).error) throw new Error(`OAuth callback accepted: ${query}`);
    }
    if (escapeHtml('<script>alert(1)</script>').includes('<script>')) {
      throw new Error('OAuth error page does not escape HTML');
    }

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yaa-tokens-'));
    try {
      const manager = new CredentialManager();
      manager.tokensPath = path.join(dir, 'tokens.json');
      manager.credentials.youtube = { client_id: 'id', client_secret: 'secret', redirect_uris: ['http://127.0.0.1'] };
      manager.tokens.youtube = { access_token: 'old', refresh_token: 'refresh-1' };
      const ytAuth = manager.getYouTubeAuth();
      if (manager.getYouTubeAuth() !== ytAuth) throw new Error('YouTube auth client is not reused');
      ytAuth.emit('tokens', { access_token: 'new', expiry_date: 123 });
      await new Promise(resolve => setTimeout(resolve, 50));
      const saved = JSON.parse(await fsp.readFile(manager.tokensPath, 'utf8'));
      if (saved.youtube.access_token !== 'new' || saved.youtube.refresh_token !== 'refresh-1') {
        throw new Error('Refreshed YouTube tokens were not persisted with the original refresh token');
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }

    this.logger.info('YouTube OAuth hardening test completed successfully');
  }
};

module.exports = { apiSecurityTests };
