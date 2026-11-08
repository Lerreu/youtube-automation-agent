// Content honesty: strategy, scripts, SEO, analytics and thumbnails without fabricated data.
// Methods of SystemTest, merged into its prototype (see test.js).
const path = require('path');

const contentTests = {
  async testEvergreenTopics() {
    const { ContentStrategyAgent } = require('../../agents/content-strategy-agent');
    const saved = [];
    const agent = new ContentStrategyAgent({ saveContentStrategy: async strategy => saved.push(strategy) }, {});

    // Without an AI provider the strategy must fail loudly, never invent a topic.
    agent.aiTextService = { isAvailable: () => false };
    let code = null;
    try {
      await agent.generateContentStrategy();
    } catch (error) {
      code = error.code;
    }
    if (code !== 'AI_TEXT_REQUIRED' || saved.length) {
      throw new Error('Strategy generation did not fail loudly without an AI provider');
    }

    // A failing provider must not fall back to templates either.
    agent.aiTextService = { isAvailable: () => true, generateText: async () => { throw new Error('provider down'); } };
    code = null;
    try {
      await agent.generateContentStrategy('Home espresso');
    } catch (error) {
      code = error.code;
    }
    if (code !== 'AI_STRATEGY_FAILED' || saved.length) {
      throw new Error('A failed AI strategy fell back to template output');
    }

    // A real AI strategy carries no invented view forecast or publish time.
    agent.aiTextService = {
      isAvailable: () => true,
      providerName: 'test',
      generateText: async () => JSON.stringify({ topic: 'Home espresso basics', angle: 'Dialing in grind size', targetAudience: 'Beginners', contentType: 'Tutorial', keywords: ['espresso'] })
    };
    const strategy = await agent.generateContentStrategy();
    if (strategy.estimatedViews !== null || strategy.bestPublishTime !== null || saved.length !== 1) {
      throw new Error('AI strategy still includes fabricated estimates');
    }
    for (const removed of ['selectOptimalTopic', 'predictViews', 'calculateBestPublishTime', 'generateAngle']) {
      if (typeof agent[removed] === 'function') throw new Error(`Template helper ${removed} still exists`);
    }

    this.logger.info('Strategy honesty test completed successfully');
  },

  async testContentHonesty() {
    const fsp = require('fs').promises;
    const os = require('os');
    const { AnalyticsOptimizationAgent } = require('../../agents/analytics-optimization-agent');
    const { ScriptWriterAgent } = require('../../agents/script-writer-agent');
    const { SEOOptimizerAgent } = require('../../agents/seo-optimizer-agent');
    const { ThumbnailDesignerAgent } = require('../../agents/thumbnail-designer-agent');
    const expectCode = async (promise, code, label) => {
      let actual = null;
      try {
        await promise;
      } catch (error) {
        actual = error.code;
      }
      if (actual !== code) throw new Error(`${label}: expected ${code}, got ${actual}`);
    };

    // Analytics: an API failure surfaces as unavailable, never as invented numbers.
    const analytics = new AnalyticsOptimizationAgent({}, { getYouTubeAuth: () => ({}) });
    analytics.youtubeAnalytics = { reports: { query: async () => { throw new Error('quota exceeded'); } } };
    await expectCode(analytics.getVideoAnalytics('vid-1', { startDate: '2026-01-01', endDate: '2026-01-07' }), 'ANALYTICS_UNAVAILABLE', 'Analytics failure');
    const demographics = await analytics.getDemographicsAnalytics('vid-1', '2026-01-01', '2026-01-07');
    if (demographics.available !== false || demographics.ageGroups.length || demographics.primaryAudience !== null) {
      throw new Error('Demographics failure returned invented audience data');
    }
    if (analytics.identifyPrimaryAudience([['age25-34', 20], ['age18-24', 55]], [['female', 70]]) !== 'female age18-24') {
      throw new Error('Primary audience did not use the largest real segments');
    }
    for (const removed of ['getSimulatedAnalytics', 'getSimulatedDemographics']) {
      if (typeof analytics[removed] === 'function') throw new Error(`${removed} still exists`);
    }

    // Script: no template fallback; intro and recap come from the model only.
    const scripts = [];
    const writer = new ScriptWriterAgent({ saveScript: async script => scripts.push(script) }, {});
    const strategy = { topic: 'Home espresso basics', contentType: 'Tutorial', angle: 'Grind size', targetAudience: 'Beginners', keywords: ['espresso'] };
    writer.aiTextService = { isAvailable: () => false };
    await expectCode(writer.generateScript(strategy), 'AI_TEXT_REQUIRED', 'Script without AI');
    writer.aiTextService = { isAvailable: () => true, generateText: async () => 'not json' };
    await expectCode(writer.generateScript(strategy), 'AI_SCRIPT_FAILED', 'Script with broken AI output');
    writer.aiTextService = {
      isAvailable: () => true,
      providerName: 'test',
      generateText: async () => JSON.stringify({
        title: 'Dialing in espresso grind size',
        hook: 'Sour shots usually mean the grind is too coarse.',
        introduction: 'Here is how to adjust grind size step by step.',
        sections: [{ title: 'Start coarse', content: ['Begin with a medium-fine setting.'], duration: 60 }],
        conclusion: { recap: ['Adjust one step at a time.'], finalThought: 'Taste every change.' },
        cta: 'Subscribe for more brewing guides.',
        claims: []
      })
    };
    const script = await writer.generateScript(strategy);
    if (scripts.length !== 1) throw new Error('A failed script attempt was saved');
    for (const canned of ["I've spent months", 'hundreds of people', 'welcome back to the channel', 'is a journey, not a destination', '[Specific case study]']) {
      if (script.fullScript.includes(canned)) throw new Error(`Script still contains canned text: ${canned}`);
    }
    if (script.introduction.topicIntro !== 'Here is how to adjust grind size step by step.' || script.conclusion.recap[0] !== 'Adjust one step at a time.') {
      throw new Error('Script intro or recap did not come from the model');
    }
    if (typeof writer.getCredibilityStatement === 'function') throw new Error('Fabricated credibility generator still exists');

    // SEO: no template fallback, no fake credits or placeholders, footer only from real env values.
    const seoAgent = new SEOOptimizerAgent({ saveSEOData: async () => {} }, {});
    seoAgent.aiTextService = { isAvailable: () => false };
    await expectCode(seoAgent.optimize(script, strategy), 'AI_TEXT_REQUIRED', 'SEO without AI');
    seoAgent.aiTextService = {
      isAvailable: () => true,
      providerName: 'test',
      generateText: async () => JSON.stringify({ title: 'Espresso grind size guide', description: 'How to fix sour espresso.', tags: ['espresso'] })
    };
    const envKeys = ['WEBSITE_URL', 'SOCIAL_LINKS', 'BUSINESS_EMAIL'];
    const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    try {
      envKeys.forEach(key => delete process.env[key]);
      const bare = await seoAgent.optimize(script, strategy);
      if (bare.description !== 'How to fix sour espresso.') throw new Error(`SEO description gained unconfigured content: ${bare.description}`);
      process.env.BUSINESS_EMAIL = 'hello@example.com';
      const withEmail = await seoAgent.optimize(script, strategy);
      if (!withEmail.description.endsWith('Business inquiries: hello@example.com') || /Audio Library|\[Your/.test(withEmail.description)) {
        throw new Error('SEO footer was not built only from configured values');
      }
      const emptyTagsScore = await seoAgent.calculateSEOScore('Title', 'Description', []);
      if (!Number.isFinite(emptyTagsScore)) throw new Error('SEO score failed for empty tags');
    } finally {
      envKeys.forEach(key => {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      });
    }

    // Thumbnail: SVG text is escaped, labels carry no hype, output is deterministic.
    const designer = new ThumbnailDesignerAgent({ saveThumbnail: async () => {} }, {});
    if (designer.escapeSvgText('Tips & <Tricks>') !== 'Tips &amp; &lt;Tricks&gt;') throw new Error('SVG text is not escaped');
    const listConcept = await designer.generateConcept({ title: 'Five espresso mistakes', metadata: { strategy: { contentType: 'List' } } });
    const storyConcept = await designer.generateConcept({ title: 'A barista story', metadata: { strategy: { contentType: 'Story' } } });
    if (/BELIEVE|MUST WATCH/.test(listConcept.secondaryText + storyConcept.secondaryText)) throw new Error('Thumbnail still uses clickbait labels');
    if (designer.generateAlternativeText('GUIDE', 'Espresso guide for beginners') !== 'ESPRESSO') throw new Error('Alternate thumbnail text was not taken from the title');
    // Rendering a title with & and < used to produce invalid SVG; it must render now.
    const rendered = [];
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'yaa-thumb-'));
    try {
      designer.templatesPath = tmp;
      await designer.ensureTemplatesDirectory();
      const unsafe = { ...listConcept, primaryText: 'R&D <TIPS>' };
      rendered.push(await designer.createThumbnail(unsafe));
      rendered.push(await designer.addTextOverlay(rendered[0], unsafe));
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
      await Promise.all(rendered.filter(Boolean).map(file => fsp.rm(file, { force: true })));
    }

    this.logger.info('Content honesty test completed successfully');
  }
};

module.exports = { contentTests };
