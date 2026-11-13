// Channel content language: stored in Channel setup and followed by every stage.
// Methods of SystemTest, merged into its prototype (see test.js).
const path = require('path');
const { Database } = require('../../database/db');

const languageTests = {
  async testContentLanguage() {
    const { resolveLanguage, languageInstruction, regionFor, DEFAULT_LANGUAGE } = require('../../utils/content-language');
    const { validationMethods } = require('../../api/validation');
    const { ContentStrategyAgent } = require('../../agents/content-strategy-agent');
    const { ScriptWriterAgent } = require('../../agents/script-writer-agent');
    const { SEOOptimizerAgent } = require('../../agents/seo-optimizer-agent');
    const { ThumbnailDesignerAgent } = require('../../agents/thumbnail-designer-agent');

    // Unknown codes fall back to the default instead of breaking generation.
    if (resolveLanguage('xx').code !== DEFAULT_LANGUAGE || DEFAULT_LANGUAGE !== 'pt-BR') throw new Error('Unknown language did not fall back to pt-BR');
    if (!languageInstruction('es').includes('Spanish')) throw new Error('Language instruction does not name the language');
    const savedRegion = process.env.YOUTUBE_REGION;
    try {
      delete process.env.YOUTUBE_REGION;
      if (regionFor('pt-BR') !== 'BR' || regionFor('en') !== 'US') throw new Error('Region does not follow the content language');
      process.env.YOUTUBE_REGION = 'PT';
      if (regionFor('pt-BR') !== 'PT') throw new Error('An explicit YOUTUBE_REGION was ignored');
    } finally {
      if (savedRegion === undefined) delete process.env.YOUTUBE_REGION; else process.env.YOUTUBE_REGION = savedRegion;
    }

    // Channel setup accepts only supported languages.
    if (validationMethods.validateProfile({ contentLanguage: 'es' }).contentLanguage !== 'es') throw new Error('A supported language was rejected');
    let rejected = false;
    try { validationMethods.validateProfile({ contentLanguage: 'klingon' }); } catch (_error) { rejected = true; }
    if (!rejected) throw new Error('An unsupported language was accepted');

    // The language is stored on the channel profile (migration 4).
    const os = require('os');
    const fsp = require('fs').promises;
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yaa-language-'));
    const db = new Database();
    db.dbPath = path.join(dir, 'test.db');
    db.logger = { info: () => {}, warn: () => {}, error: () => {}, success: () => {} };
    try {
      await db.initialize();
      await db.saveChannelProfile({ channelName: 'Canal', contentLanguage: 'en' });
      await db.saveChannelProfile({ goal: 'Ensinar' });
      if ((await db.getChannelProfile()).content_language !== 'en') throw new Error('Content language was not kept across profile saves');
    } finally {
      await db.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }

    // The strategy reads the channel language, asks for it and stamps it on the production.
    const prompts = [];
    const strategyAgent = new ContentStrategyAgent({
      getChannelProfile: async () => ({ content_language: 'es' }),
      saveContentStrategy: async () => {}
    }, {});
    strategyAgent.aiTextService = {
      isAvailable: () => true,
      providerName: 'test',
      generateText: async prompt => {
        prompts.push(prompt);
        return JSON.stringify({ topic: 'Café en casa', angle: 'Molienda', targetAudience: 'Principiantes', contentType: 'Tutorial', keywords: ['café'] });
      }
    };
    const strategy = await strategyAgent.generateContentStrategy('Home espresso');
    if (strategy.language !== 'es' || !prompts[0].includes('Spanish')) throw new Error('Strategy did not follow the channel language');

    // Spoken fallbacks, description footer and thumbnail label follow it too.
    const writer = new ScriptWriterAgent({}, {});
    const cta = writer.normalizeAICTA(null, { topic: 'café', language: 'pt-BR' });
    if (!cta.subscribe.startsWith('Inscreva-se') || cta.like !== 'Deixe seu like se este vídeo ajudou.') throw new Error('Call to action fallback is not in Portuguese');
    const seo = new SEOOptimizerAgent({}, {});
    const savedEmail = process.env.BUSINESS_EMAIL;
    try {
      process.env.BUSINESS_EMAIL = 'contato@example.com';
      if (!seo.appendDescriptionFooter('Descrição', 'pt-BR').includes('Contato comercial: contato@example.com')) throw new Error('Description footer is not in Portuguese');
    } finally {
      if (savedEmail === undefined) delete process.env.BUSINESS_EMAIL; else process.env.BUSINESS_EMAIL = savedEmail;
    }
    const thumbnail = new ThumbnailDesignerAgent({}, {});
    if (thumbnail.generateSecondaryText({ metadata: { strategy: { contentType: 'Tutorial', language: 'pt-BR' } } }) !== 'PASSO A PASSO') {
      throw new Error('Thumbnail label is not in Portuguese');
    }
  }
};

module.exports = { languageTests };
