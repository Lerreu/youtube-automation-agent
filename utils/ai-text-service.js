const OpenAI = require('openai');
const { Logger } = require('./logger');

const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-4-argon',
  'gemini-3.5-flash-lite',
];
const GEMINI_DEFAULT_MODEL = GEMINI_MODELS[0];
// Floor for the single retry after a thinking model exhausts a small budget.
const GEMINI_THINKING_RETRY_MIN_TOKENS = 1024;

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.1-sol',
    models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'],
    envKey: 'OPENAI_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-6.1-sol',
    models: ['openai/gpt-6.1-sol', 'anthropic/claude-fable-5.1', 'google/gemini-3.8-flash', 'moonshotai/kimi-k3', 'z-ai/glm-5.3', 'deepseek/deepseek-v4.1-flash', 'minimax/minimax-m3'],
    envKey: 'OPENROUTER_API_KEY',
  },
  kimi: {
    name: 'Kimi (Moonshot AI)',
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k3',
    models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'],
    envKey: 'MOONSHOT_API_KEY',
  },
  mimo: {
    name: 'MiMo (Xiaomi)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.6-pro',
    models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'],
    envKey: 'MIMO_API_KEY',
  },
  glm: {
    name: 'GLM (Zhipu AI)',
    baseURL: 'https://api.z.ai/api/paas/v4/',
    defaultModel: 'glm-5.3',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
    envKey: 'GLM_API_KEY',
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    envKey: 'DEEPSEEK_API_KEY',
  },
  minimax: {
    name: 'MiniMax',
    baseURL: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M3.1-Flash',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3'],
    // MINIMAX_API_KEY already selects MiniMax H3 video; reusing it here would
    // silently switch Gemini users with a video key over to MiniMax text.
    envKey: 'MINIMAX_TEXT_API_KEY',
  },
};

class AITextService {
  constructor(credentials = {}) {
    this.logger = new Logger('AITextService');
    this.client = null;
    this.gemini = null;
    this.model = null;
    this.providerName = null;
    // Other configured providers, tried in order when the primary one fails.
    this.fallbacks = [];

    this._init(credentials);
  }

  _init(credentials) {
    const backends = [];
    const seen = new Set();
    const add = backend => {
      if (backend && !seen.has(backend.id)) {
        seen.add(backend.id);
        backends.push(backend);
      }
    };

    const provider = credentials.aiProvider?.provider;
    const apiKey = credentials.aiProvider?.apiKey;
    if (provider && PROVIDERS[provider] && apiKey) {
      add(this._initOpenAICompatible(provider, PROVIDERS[provider], apiKey, credentials.aiProvider?.model));
    }
    for (const [id, preset] of Object.entries(PROVIDERS)) {
      const key = process.env[preset.envKey];
      if (key && !seen.has(id)) add(this._initOpenAICompatible(id, preset, key));
    }
    const geminiKey = credentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) add(this._initGemini(geminiKey, credentials.gemini?.model));

    if (!backends.length) {
      this.logger.warn('No AI text provider configured — text generation unavailable');
      return;
    }
    const [primary, ...rest] = backends;
    this.client = primary.client || null;
    this.gemini = primary.gemini || null;
    this.model = primary.model;
    this.providerName = primary.name;
    this.fallbacks = process.env.AI_TEXT_FALLBACK === 'false' ? [] : rest;
    this.logger.info(`${primary.name} initialized (model: ${primary.model})${this.fallbacks.length ? `; fallbacks: ${this.fallbacks.map(item => item.name).join(', ')}` : ''}`);
  }

  _initOpenAICompatible(id, preset, apiKey, model) {
    return {
      id,
      name: preset.name,
      model: model || preset.defaultModel,
      client: new OpenAI({ apiKey, baseURL: preset.baseURL }),
      gemini: null
    };
  }

  _initGemini(apiKey, model) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      return { id: 'gemini', name: 'Google Gemini', model: model || GEMINI_DEFAULT_MODEL, client: null, gemini: new GoogleGenAI({ apiKey }) };
    } catch (error) {
      this.logger.error('Failed to initialize Gemini:', error.message);
      return null;
    }
  }

  async generateText(prompt, options = {}) {
    const primary = { client: this.client, gemini: this.gemini, model: options.model || this.model, name: this.providerName };
    try {
      return await this._generateWith(primary, prompt, options);
    } catch (primaryError) {
      const fallbacks = this.fallbacks || [];
      if (!fallbacks.length) throw primaryError;
      const failures = [`${primary.name}: ${primaryError.message}`];
      for (const backend of fallbacks) {
        this.logger.warn(`${failures.at(-1)} — trying ${backend.name}`);
        try {
          const text = await this._generateWith(backend, prompt, { ...options, model: backend.model });
          this.lastProviderName = backend.name;
          return text;
        } catch (error) {
          failures.push(`${backend.name}: ${error.message}`);
        }
      }
      const error = new Error(`All AI text providers failed. ${failures.join(' | ')}`);
      error.code = 'AI_TEXT_PROVIDERS_FAILED';
      error.cause = primaryError;
      throw error;
    }
  }

  async _generateWith(backend, prompt, options = {}) {
    const model = backend.model;
    const maxTokens = options.maxTokens || 2048;
    const temperature = options.temperature ?? 0.7;

    if (backend.gemini) {
      const config = { maxOutputTokens: maxTokens };
      if (!/^gemini-(?:3\.(?:[5-9]|\d{2,})|[4-9]|\d{2,})[.-]/.test(model)) config.temperature = temperature;
      // JSON mode: Gemini returns a syntactically valid JSON document.
      if (options.json) config.responseMimeType = 'application/json';
      let response = await backend.gemini.models.generateContent({
        model,
        contents: prompt,
        config,
      });
      let text = response && response.text;

      // Thinking models (gemini-3.x flash/pro) count thoughts against
      // maxOutputTokens, so a budget can be spent before any text is written
      // or before the answer is finished (a JSON document cut in half).
      // Retry once with room for the thoughts plus the whole answer.
      let budget = maxTokens;
      if (this._geminiFinishReason(response) === 'MAX_TOKENS') {
        budget = Math.max(maxTokens * 4, GEMINI_THINKING_RETRY_MIN_TOKENS);
        response = await backend.gemini.models.generateContent({
          model,
          contents: prompt,
          config: { ...config, maxOutputTokens: budget },
        });
        text = response && response.text;
      }

      if (!this._hasText(text)) {
        throw new Error(this._geminiEmptyResponseMessage(response, backend.name));
      }
      if (this._geminiFinishReason(response) === 'MAX_TOKENS') {
        throw new Error(`${backend.name} stopped at its ${budget}-token output limit before finishing the answer. Choose a shorter video length or a model that does not think.`);
      }
      return text;
    }

    if (!backend.client) {
      throw new Error('No AI text provider configured');
    }

    const params = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
    };

    const tokenParams = [
      { max_completion_tokens: maxTokens },
      { max_tokens: maxTokens },
    ];

    let lastError = null;
    for (let index = 0; index < tokenParams.length; index++) {
      const request = { ...params, ...tokenParams[index] };
      try {
        const response = await backend.client.chat.completions.create(request);
        return this._extractContent(response, backend.name);
      } catch (error) {
        lastError = error;
        const message = error?.message || '';
        const unsupportedTemperature =
          error?.status === 400 &&
          /temperature/i.test(message) &&
          /(unsupported value|does not support|only the default)/i.test(message);

        if (unsupportedTemperature) {
          const { temperature: _temperature, ...withoutTemperature } = request;
          try {
            const response = await backend.client.chat.completions.create(withoutTemperature);
            return this._extractContent(response, backend.name);
          } catch (retryError) {
            lastError = retryError;
          }
        }

        // Older models and some providers reject max_completion_tokens with a
        // 400; retry with the legacy max_tokens spelling. This also applies if
        // the temperature-compatible retry exposed the token incompatibility.
        if (
          index === 0 &&
          lastError?.status === 400 &&
          /max(_completion)?_tokens/i.test(lastError.message || '')
        ) {
          continue;
        }
        throw lastError;
      }
    }

    throw lastError;
  }

  _hasText(text) {
    return typeof text === 'string' && text.trim().length > 0;
  }

  _geminiFinishReason(response) {
    return response?.candidates?.[0]?.finishReason || null;
  }

  _geminiEmptyResponseMessage(response, name = this.providerName) {
    const finishReason = this._geminiFinishReason(response);
    const blockReason = response?.promptFeedback?.blockReason;
    if (finishReason === 'MAX_TOKENS') {
      const thoughts = response?.usageMetadata?.thoughtsTokenCount;
      return `${name} spent its whole output budget${thoughts ? ` (${thoughts} thinking tokens)` : ''} before writing any text. Raise maxTokens, or choose a model that does not think, such as gemini-3.5-flash-lite.`;
    }
    if (blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finishReason)) {
      return `${name} blocked the response (${blockReason || finishReason}). Rephrase the prompt or topic and try again.`;
    }
    return `${name} returned an empty response${finishReason ? ` (finishReason: ${finishReason})` : ''}. Check the API key and model quota — free-tier Gemini keys are rate-limited and can return empty output.`;
  }

  _extractContent(response, name = this.providerName) {
    const content =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message
        ? response.choices[0].message.content
        : null;

    if (typeof content !== 'string' || !content.trim()) {
      // A null/empty body used to surface as cryptic "Unexpected end of JSON input"
      // in the agents' JSON parsers. Report the real cause instead.
      throw new Error(
        `${name} returned an empty response. Check the API key and model quota.`
      );
    }
    // A reply cut at the token limit is unusable (half a JSON document).
    if (response.choices[0].finish_reason === 'length') {
      throw new Error(`${name} stopped at its output limit before finishing the answer. Choose a shorter video length or raise the token budget.`);
    }
    return content;
  }

  isAvailable() {
    return !!(this.client || this.gemini);
  }
}

module.exports = { AITextService, PROVIDERS, GEMINI_MODELS, GEMINI_DEFAULT_MODEL };
