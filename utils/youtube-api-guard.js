const { Logger } = require('./logger');

// YouTube Data API v3 quota costs per method (units). Unknown reads cost 1 and
// unknown writes 50, which matches the documented defaults. Verify against
// https://developers.google.com/youtube/v3/determine_quota_cost when Google
// changes prices; YOUTUBE_DAILY_QUOTA sets the project's daily allowance.
const QUOTA_COSTS = {
  'videos.insert': 1600,
  'videos.update': 50,
  'videos.delete': 50,
  'search.list': 100,
  'captions.insert': 400,
  'captions.update': 450,
  'captions.list': 50,
  'thumbnails.set': 50,
  'comments.insert': 50,
  'commentThreads.insert': 50
};

// Requests whose effect is unknown after a network error or 5xx. They are only
// retried when YouTube explicitly rejected them before doing any work (429).
const NON_IDEMPOTENT = new Set(['videos.insert', 'captions.insert', 'comments.insert', 'commentThreads.insert']);

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError']);
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded']);
const RETRYABLE_NETWORK = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ESOCKETTIMEDOUT', 'EPIPE']);

function quotaCost(method) {
  if (QUOTA_COSTS[method] !== undefined) return QUOTA_COSTS[method];
  return /\.(list)$/.test(method) ? 1 : 50;
}

function errorReason(error) {
  return error?.errors?.[0]?.reason
    || error?.response?.data?.error?.errors?.[0]?.reason
    || null;
}

function errorStatus(error) {
  return Number(error?.code) || Number(error?.status) || Number(error?.response?.status) || null;
}

function pacificDate(now = new Date()) {
  // YouTube resets the daily quota at midnight Pacific Time.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

class QuotaTracker {
  constructor(options = {}) {
    this.dailyLimit = options.dailyLimit
      || Number.parseInt(process.env.YOUTUBE_DAILY_QUOTA, 10)
      || 10000;
    this.now = options.now || (() => new Date());
    this.date = pacificDate(this.now());
    this.used = 0;
    this.db = null;
  }

  async attachDatabase(db) {
    this.db = db;
    try {
      const saved = JSON.parse(await db.getSetting('youtube_quota_usage') || 'null');
      if (saved?.date === pacificDate(this.now())) {
        this.date = saved.date;
        this.used = Math.max(this.used, Number(saved.used) || 0);
      }
    } catch (_error) {
      // A missing or corrupt record starts the day at zero.
    }
  }

  rollover() {
    const today = pacificDate(this.now());
    if (today !== this.date) {
      this.date = today;
      this.used = 0;
    }
  }

  remaining() {
    this.rollover();
    return Math.max(0, this.dailyLimit - this.used);
  }

  reserve(method) {
    const cost = quotaCost(method);
    if (cost > this.remaining()) {
      const error = new Error(`YouTube API daily quota would be exceeded by ${method} (cost ${cost}, remaining ${this.remaining()} of ${this.dailyLimit}). It resets at midnight Pacific Time.`);
      error.code = 'YOUTUBE_QUOTA_EXHAUSTED';
      error.status = 429;
      throw error;
    }
    this.used += cost;
    this.persist();
    return cost;
  }

  markExhausted() {
    this.rollover();
    this.used = this.dailyLimit;
    this.persist();
  }

  persist() {
    if (!this.db) return;
    this.db.setSetting('youtube_quota_usage', JSON.stringify({ date: this.date, used: this.used }))
      .catch(() => {});
  }

  snapshot() {
    this.rollover();
    return { date: this.date, used: this.used, limit: this.dailyLimit, remaining: this.remaining() };
  }
}

const sharedTracker = new QuotaTracker();

function shouldRetry(method, error) {
  const status = errorStatus(error);
  const reason = errorReason(error);
  if (QUOTA_REASONS.has(reason)) return false;
  const rejectedBeforeWork = status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
  if (NON_IDEMPOTENT.has(method)) return rejectedBeforeWork;
  return rejectedBeforeWork
    || RETRYABLE_STATUS.has(status)
    || RETRYABLE_REASONS.has(reason)
    || RETRYABLE_NETWORK.has(error?.code);
}

/**
 * Wraps a googleapis client (youtube v3 or youtubeAnalytics v2) so every
 * resource method call is quota-checked (Data API only) and retried with
 * exponential backoff when the failure is transient and safe to repeat.
 */
function guardYouTubeClient(client, options = {}) {
  const tracker = options.tracker || sharedTracker;
  const countQuota = options.countQuota !== false;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const logger = options.logger || new Logger('YouTubeAPI');

  const call = async (method, fn, args) => {
    for (let attempt = 0; ; attempt++) {
      if (countQuota) tracker.reserve(method);
      try {
        return await fn(...args);
      } catch (error) {
        if (QUOTA_REASONS.has(errorReason(error))) {
          if (countQuota) tracker.markExhausted();
          error.code = 'YOUTUBE_QUOTA_EXHAUSTED';
          error.status = 429;
          throw error;
        }
        if (attempt >= maxRetries || !shouldRetry(method, error)) throw error;
        const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs);
        logger.warn(`${method} failed (${errorStatus(error) || error.code || 'error'}${errorReason(error) ? `/${errorReason(error)}` : ''}); retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await sleep(delay);
      }
    }
  };

  // googleapis defines resources as read-only, non-configurable properties, so
  // the proxies use an empty target and read from the real object instead.
  const wrapResource = (resource, name) => new Proxy({}, {
    get(_target, prop) {
      const value = resource[prop];
      if (typeof prop !== 'string') return value;
      if (typeof value === 'function') {
        return (...args) => call(`${name}.${prop}`, value.bind(resource), args);
      }
      if (value && typeof value === 'object' && prop !== 'context') return wrapResource(value, `${name}.${prop}`);
      return value;
    },
    has: (_target, prop) => prop in resource
  });

  return new Proxy({}, {
    get(_target, prop) {
      const value = client[prop];
      if (typeof prop === 'string' && value && typeof value === 'object' && !['context', '_options'].includes(prop)) {
        return wrapResource(value, prop);
      }
      return typeof value === 'function' ? value.bind(client) : value;
    },
    has: (_target, prop) => prop in client
  });
}

module.exports = { guardYouTubeClient, QuotaTracker, sharedTracker, quotaCost, shouldRetry, pacificDate };
