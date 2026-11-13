const { Logger } = require('../utils/logger');
const { AITextService } = require('../utils/ai-text-service');
const { resolveLanguage, languageInstruction, regionFor } = require('../utils/content-language');

class ContentStrategyAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ContentStrategy');
    this.trendingTopics = [];
    this.competitorData = [];
    this.contentCalendar = [];
    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});
    this.language = resolveLanguage().code;
  }

  // The channel's content language (Channel setup), re-read before each run so
  // a change in the dashboard applies to the next video.
  async refreshLanguage() {
    try {
      const profile = await this.db.getChannelProfile();
      this.language = resolveLanguage(profile?.content_language).code;
    } catch (_error) {
      this.language = resolveLanguage().code;
    }
    return this.language;
  }

  async initialize() {
    this.logger.info('Initializing Content Strategy Agent...');
    await this.refreshLanguage();
    await this.loadHistoricalData();
    await this.analyzeTrends();
    return true;
  }

  async loadHistoricalData() {
    try {
      const history = await this.db.getContentHistory();
      this.historicalPerformance = history;
    } catch (error) {
      this.logger.warn('No historical data found, starting fresh');
      this.historicalPerformance = [];
    }
  }

  async analyzeTrends() {
    try {
      // Analyze YouTube trends
      const trends = await this.fetchYouTubeTrends();
      
      // Analyze competitor channels
      const competitors = await this.analyzeCompetitors();
      this.competitorData = competitors;
      
      // Combine insights
      this.trendingTopics = this.mergeTrendData(trends, competitors);
      
      this.logger.info(`Identified ${this.trendingTopics.length} trending topics`);
    } catch (error) {
      this.logger.error('Error analyzing trends:', error);
    }
  }

  async fetchYouTubeTrends() {
    // Use YouTube API to fetch trending videos
    const youtube = this.credentials.getYouTubeClient();
    
    try {
      const response = await youtube.videos.list({
        part: 'snippet,statistics',
        chart: 'mostPopular',
        maxResults: 50,
        regionCode: regionFor(this.language)
      });

      return response.data.items.map(video => ({
        videoId: video.id,
        title: video.snippet.title,
        tags: video.snippet.tags || [],
        viewCount: parseInt(video.statistics?.viewCount, 10) || 0,
        category: video.snippet.categoryId,
        publishedAt: video.snippet.publishedAt,
        publisher: video.snippet.channelTitle || 'YouTube',
        url: `https://www.youtube.com/watch?v=${video.id}`
      }));
    } catch (error) {
      this.logger.error('Failed to fetch YouTube trends:', error);
      return [];
    }
  }

  async analyzeCompetitors() {
    const competitorChannels = (process.env.COMPETITOR_CHANNELS || '').split(',');
    const competitorData = [];

    for (const channelId of competitorChannels) {
      if (!channelId) continue;
      
      try {
        const videos = await this.getChannelVideos(channelId);
        const analysis = this.analyzeVideoPerformance(videos);
        competitorData.push({
          channelId,
          topPerformingTopics: analysis.topTopics,
          averageViews: analysis.avgViews,
          uploadFrequency: analysis.frequency
        });
      } catch (error) {
        this.logger.error(`Failed to analyze competitor ${channelId}:`, error);
      }
    }

    return competitorData;
  }

  async getChannelVideos(channelId) {
    const youtube = this.credentials.getYouTubeClient();
    
    try {
      const response = await youtube.search.list({
        part: 'snippet',
        channelId: channelId,
        maxResults: 20,
        order: 'date',
        type: 'video'
      });

      const videoIds = response.data.items.map(item => item.id.videoId).join(',');
      
      const videoDetails = await youtube.videos.list({
        part: 'statistics,snippet',
        id: videoIds
      });

      return videoDetails.data.items;
    } catch (error) {
      this.logger.error(`Failed to get videos for channel ${channelId}:`, error);
      return [];
    }
  }

  analyzeVideoPerformance(videos) {
    if (!videos || videos.length === 0) {
      return { topTopics: [], avgViews: 0, frequency: 0 };
    }

    const topics = {};
    let totalViews = 0;

    videos.forEach(video => {
      const title = video.snippet.title.toLowerCase();
      const views = parseInt(video.statistics?.viewCount, 10) || 0;
      totalViews += views;

      // Extract topics from title
      const keywords = this.extractKeywords(title);
      keywords.forEach(keyword => {
        if (!topics[keyword]) topics[keyword] = { count: 0, views: 0, evidence: [] };
        topics[keyword].count++;
        topics[keyword].views += views;
        topics[keyword].evidence.push({
          url: `https://www.youtube.com/watch?v=${video.id}`,
          title: video.snippet.title,
          publisher: video.snippet.channelTitle || 'Configured competitor channel',
          publishedAt: video.snippet.publishedAt,
          sourceType: 'video'
        });
      });
    });

    const topTopics = Object.entries(topics)
      .sort((a, b) => b[1].views - a[1].views)
      .slice(0, 10)
      .map(([topic, data]) => ({ topic, avgViews: data.views / data.count, evidence: data.evidence.slice(0, 5) }));

    return {
      topTopics,
      avgViews: totalViews / videos.length,
      frequency: videos.length
    };
  }

  extractKeywords(text) {
    // Simple keyword extraction
    const stopWords = ['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'could', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now'];
    
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.includes(word));
  }

  mergeTrendData(trends, competitors) {
    const mergedTopics = new Map();

    // Add trending topics
    trends.forEach(trend => {
      const keywords = this.extractKeywords(trend.title);
      keywords.forEach(keyword => {
        if (!mergedTopics.has(keyword)) {
          mergedTopics.set(keyword, { score: 0, sources: [], evidence: [] });
        }
        const topic = mergedTopics.get(keyword);
        topic.score += trend.viewCount / 1000000; // Normalize by millions
        topic.sources.push('trending');
        topic.evidence.push({
          url: trend.url,
          title: trend.title,
          publisher: trend.publisher,
          publishedAt: trend.publishedAt,
          sourceType: 'video'
        });
      });
    });

    // Add competitor topics
    competitors.forEach(competitor => {
      if (competitor.topPerformingTopics) {
        competitor.topPerformingTopics.forEach(({ topic, avgViews, evidence = [] }) => {
          if (!mergedTopics.has(topic)) {
            mergedTopics.set(topic, { score: 0, sources: [], evidence: [] });
          }
          const topicData = mergedTopics.get(topic);
          topicData.score += avgViews / 100000; // Normalize
          topicData.sources.push('competitor');
          topicData.evidence.push(...evidence);
        });
      }
    });

    // Convert to array and sort by score
    return Array.from(mergedTopics.entries())
      .map(([topic, data]) => ({ topic, ...data }))
      .map(item => ({
        ...item,
        evidence: [...new Map(item.evidence.filter(source => source.url).map(source => [source.url, source])).values()].slice(0, 5)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }

  async generateContentStrategy(requestedTopic = null) {
    try {
      await this.refreshLanguage();
      const strategy = await this.generateContentStrategyWithAI(requestedTopic);
      // Every later stage (script, SEO, thumbnail, captions, upload) reads it from here.
      strategy.language = this.language;
      await this.db.saveContentStrategy(strategy);
      this.logger.info(`Generated AI strategy for: ${strategy.topic}`);
      return strategy;
    } catch (error) {
      this.logger.error('Failed to generate content strategy:', error);
      throw error;
    }
  }

  async researchAndPlanChannel(channelStrategy) {
    const targetCount = Math.max(1, Math.min(5, Number(channelStrategy.videos_per_run || 1)));
    await this.refreshLanguage();
    await this.analyzeTrends();

    const recentRows = await this.db.getAllRows(
      "SELECT topic, created_at FROM content_strategies WHERE created_at >= datetime('now', '-90 days') ORDER BY created_at DESC LIMIT 50"
    );
    const approvedLearnings = this.db.listLearningRecommendations
      ? await this.db.listLearningRecommendations({ status: 'approved', limit: 10 })
      : [];
    const signals = this.trendingTopics.slice(0, 15).map(item => ({
      topic: item.topic,
      score: Number(item.score || 0),
      sources: [...new Set(item.sources || [])],
      evidence: item.evidence || []
    }));
    const sourceCatalog = [...new Map(
      signals.flatMap(signal => signal.evidence || []).map(source => [source.url, source])
    ).values()].slice(0, 30);
    const signalSources = new Set(signals.flatMap(signal => signal.sources));
    const researchSources = [
      ...(signalSources.has('trending') ? ['YouTube most-popular videos'] : []),
      ...(signalSources.has('competitor') ? ['Configured competitor channels'] : []),
      ...(recentRows.length ? ['Channel content history'] : []),
      ...(approvedLearnings.length ? ['Operator-approved channel performance learnings'] : [])
    ];
    const research = {
      generatedAt: new Date().toISOString(),
      sources: researchSources.length ? researchSources : ['No usable live signals returned; evergreen strategy fallback'],
      signals,
      sourceCatalog,
      recentTopics: recentRows.map(row => row.topic),
      competitorChannelsAnalyzed: this.competitorData.length,
      approvedLearnings: approvedLearnings.map(item => ({
        category: item.category,
        title: item.title,
        rationale: item.rationale,
        confidence: item.confidence,
        proposedChange: item.proposedChange
      }))
    };

    let plan = await this.generateAutonomousPlanWithAI(channelStrategy, research, targetCount);
    plan = this.normalizeAutonomousPlan(plan, channelStrategy, targetCount, research);
    if (plan.length < targetCount) {
      const fallback = this.buildFallbackAutonomousPlan(channelStrategy, research, targetCount);
      plan = this.normalizeAutonomousPlan([...plan, ...fallback], channelStrategy, targetCount, research);
    }

    return { research, plan };
  }

  async generateAutonomousPlanWithAI(channelStrategy, research, targetCount) {
    if (!this.aiTextService.isAvailable()) return [];
    const prompt = `You are the strategy lead for an autonomous YouTube channel.
Turn the channel strategy and the supplied research signals into a focused content plan.
Return only a valid JSON array with exactly ${targetCount} items using this shape:
[{"topic":"specific video topic","pillar":"one exact content pillar from the supplied strategy","angle":"distinct audience-relevant angle","rationale":"why this advances the channel objective using the supplied evidence","format":"explainer|tutorial|list|review|story","length":"short|medium|long","sourceUrls":["exact URL from the supplied source catalog"]}]

Channel objective: ${channelStrategy.objective}
Audience: ${channelStrategy.audience}
Value proposition: ${channelStrategy.value_proposition || 'not specified'}
Content pillars: ${(channelStrategy.contentPillars || []).join(', ')}
Preferred format: ${channelStrategy.default_format}
Preferred length: ${channelStrategy.default_length}
Success metric: ${channelStrategy.success_metric || 'not specified'}
Primary KPI: ${channelStrategy.primary_kpi || 'views'}
Target: ${channelStrategy.target_value || 'not set'} per ${channelStrategy.target_window_days || 28} days
Monthly production budget: ${channelStrategy.monthly_budget ?? 'not set'} ${channelStrategy.outcome_currency || 'USD'}
Constraints: ${channelStrategy.constraints || 'none'}
Research signals: ${JSON.stringify(research.signals)}
Allowed source catalog: ${JSON.stringify(research.sourceCatalog)}
Recent topics to avoid repeating: ${JSON.stringify(research.recentTopics)}
Operator-approved performance learnings to apply: ${JSON.stringify(research.approvedLearnings)}

Do not invent trend data, statistics, sources, URLs, or factual claims. Use only exact URLs from the supplied source catalog. Apply only the supplied approved learnings; pending or rejected recommendations are not authorized. Prefer evergreen topics when the supplied signals are weak. Learnings with category "audience_demand" are audience-requested topics mined from real comments on published videos; prefer planning a video that directly answers one when it fits the channel objective, and cite it in the rationale.
${languageInstruction(this.language)} The "pillar" value must stay exactly as written in the supplied content pillars. Write "rationale" in Brazilian Portuguese, the operator's language.`;

    try {
      const response = await this.aiTextService.generateText(prompt, { maxTokens: 4096, temperature: 0.65, json: true });
      const parsed = this.parseAIJsonResponse(response);
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed.plan) ? parsed.plan : [];
    } catch (error) {
      this.logger.warn(`AI channel plan failed; using evidence-aware fallback: ${error.message}`);
      return [];
    }
  }

  buildFallbackAutonomousPlan(channelStrategy, research, targetCount) {
    const recent = new Set(research.recentTopics.map(topic => String(topic).toLowerCase()));
    const readableSignals = research.signals
      .map(signal => signal.topic)
      .filter(topic => topic.includes(' ') && topic.length >= 8 && !recent.has(topic.toLowerCase()));
    const pillars = channelStrategy.contentPillars || [];
    const pillarGuide = resolveLanguage(this.language).phrases.pillarGuide;
    const pillarTopics = pillars.map(pillar => pillarGuide(pillar, channelStrategy.audience));
    // Only real signals and the channel's own pillars; no generic off-niche topics.
    const candidates = [...readableSignals, ...pillarTopics];

    return candidates.slice(0, targetCount).map((topic, index) => ({
      topic,
      pillar: pillars.find(pillar => topic.toLowerCase().includes(String(pillar).toLowerCase())) || pillars[index % Math.max(1, pillars.length)] || '',
      angle: `${topic} through the lens of ${channelStrategy.value_proposition || channelStrategy.objective}`,
      rationale: readableSignals.includes(topic)
        ? 'Matches a current YouTube or configured competitor signal and fits the channel strategy.'
        : research.approvedLearnings.length
          ? `Builds an evergreen topic from the channel strategy while applying approved learning: ${research.approvedLearnings[0].title}.`
          : 'Builds an evergreen topic from the channel strategy when live research signals are limited.',
      format: index === 0 ? channelStrategy.default_format : ['explainer', 'tutorial', 'list'][index % 3],
      length: channelStrategy.default_length,
      sourceUrls: research.signals.find(signal => signal.topic === topic)?.evidence?.map(source => source.url) || []
    }));
  }

  normalizeAutonomousPlan(plan, channelStrategy, targetCount, research = {}) {
    const formats = new Set(['explainer', 'tutorial', 'list', 'review', 'story']);
    const lengths = new Set(['short', 'medium', 'long']);
    const allowedSourceUrls = new Set((research.sourceCatalog || []).map(source => source.url));
    const pillars = channelStrategy.contentPillars || [];
    const seen = new Set();
    return plan
      .map(item => ({
        topic: String(item.topic || '').trim().slice(0, 200),
        pillar: pillars.find(pillar => String(pillar).toLowerCase() === String(item.pillar || '').trim().toLowerCase()) || '',
        angle: String(item.angle || '').trim().slice(0, 500),
        rationale: String(item.rationale || '').trim().slice(0, 1000),
        format: formats.has(String(item.format || '').toLowerCase())
          ? String(item.format).toLowerCase()
          : channelStrategy.default_format,
        length: lengths.has(String(item.length || '').toLowerCase())
          ? String(item.length).toLowerCase()
          : channelStrategy.default_length,
        sourceUrls: [...new Set((Array.isArray(item.sourceUrls) ? item.sourceUrls : [])
          .map(url => String(url))
          .filter(url => allowedSourceUrls.has(url)))]
      }))
      .filter(item => {
        const key = item.topic.toLowerCase();
        if (!item.topic || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, targetCount);
  }

  async generateContentStrategyWithAI(requestedTopic = null) {
    if (!this.aiTextService.isAvailable()) {
      const error = new Error('Content strategy needs an AI text provider. Configure one with npm run walkthrough.');
      error.code = 'AI_TEXT_REQUIRED';
      error.status = 503;
      throw error;
    }

    const trendingTopics = this.trendingTopics
      .slice(0, 10)
      .map(topic => topic.topic)
      .join(', ');
    const prompt = `You are selecting a YouTube content strategy.
Return only valid JSON with this exact shape:
{
  "topic": "specific video topic",
  "angle": "distinct content angle",
  "targetAudience": "specific audience",
  "contentType": "Tutorial|Explainer|List|Review|Story|News",
  "keywords": ["keyword"]
}

Requested topic: ${requestedTopic || 'none'}
Trending topics available: ${trendingTopics || 'Technology Trends'}
Channel target audience: ${process.env.TARGET_AUDIENCE || 'General audience interested in educational content'}
Avoid fabricated claims and unsupported numbers.
${languageInstruction(this.language)} When the requested topic is in another language, keep its meaning and write it in the channel language.`;

    try {
      const response = await this.aiTextService.generateText(prompt, {
        maxTokens: 2048,
        json: true,
        temperature: 0.7
      });
      const parsed = this.parseAIJsonResponse(response);
      const topic = String(parsed.topic || requestedTopic || '').trim();

      if (!topic) {
        throw new Error('AI strategy response missing topic');
      }

      const contentType = this.normalizeContentType(parsed.contentType, topic);
      const keywords = Array.isArray(parsed.keywords) && parsed.keywords.length > 0
        ? parsed.keywords.map(keyword => String(keyword).trim()).filter(Boolean)
        : this.extractKeywords(topic);

      this.logger.info(`Using AI content strategy via ${this.aiTextService.providerName}`);
      return {
        topic,
        angle: String(parsed.angle || topic).trim(),
        targetAudience: String(parsed.targetAudience || await this.identifyTargetAudience(topic)).trim(),
        contentType,
        keywords,
        // No view forecast or "best time": there is no evidence to support one.
        // The operator sets the publish time at approval.
        estimatedViews: null,
        bestPublishTime: null,
        competitorAnalysis: this.getCompetitorInsights(topic),
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      const failure = new Error(`AI content strategy failed: ${error.message}`);
      failure.code = 'AI_STRATEGY_FAILED';
      failure.cause = error;
      throw failure;
    }
  }

  parseAIJsonResponse(response) {
    const text = String(response || '').trim();
    const withoutFences = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(withoutFences);
    } catch (error) {
      const match = withoutFences.match(/\{[\s\S]*\}/);
      if (!match) {
        throw error;
      }
      return JSON.parse(match[0]);
    }
  }

  normalizeContentType(contentType, topic) {
    const allowed = new Set(['Tutorial', 'Explainer', 'List', 'Review', 'Story', 'News']);
    const normalized = String(contentType || '').trim();
    const titleCased = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();

    return allowed.has(titleCased) ? titleCased : this.selectContentType(topic);
  }
  async identifyTargetAudience(topic) {
    // Simplified audience identification
    const audiences = {
      tech: 'Tech enthusiasts, developers, early adopters',
      business: 'Entrepreneurs, business owners, professionals',
      education: 'Students, educators, lifelong learners',
      entertainment: 'General audience, entertainment seekers',
      lifestyle: 'Lifestyle enthusiasts, self-improvement seekers'
    };

    const category = this.categorize(topic);
    return audiences[category] || audiences.entertainment;
  }

  categorize(topic) {
    const categories = {
      tech: ['technology', 'software', 'app', 'ai', 'code', 'programming', 'crypto', 'blockchain'],
      business: ['business', 'money', 'finance', 'startup', 'entrepreneur', 'marketing'],
      education: ['learn', 'tutorial', 'how to', 'guide', 'course', 'study'],
      lifestyle: ['life', 'health', 'fitness', 'food', 'travel', 'fashion']
    };

    const topicLower = topic.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => topicLower.includes(keyword))) {
        return category;
      }
    }

    return 'entertainment';
  }

  selectContentType(topic) {
    const types = [
      { type: 'Tutorial', suitableFor: ['how to', 'guide', 'learn'] },
      { type: 'List', suitableFor: ['best', 'top', 'worst'] },
      { type: 'Review', suitableFor: ['review', 'vs', 'comparison'] },
      { type: 'Explainer', suitableFor: ['what is', 'why', 'explained'] },
      { type: 'News', suitableFor: ['breaking', 'latest', 'new'] },
      { type: 'Story', suitableFor: ['story', 'journey', 'experience'] }
    ];

    const topicLower = topic.toLowerCase();
    
    for (const contentType of types) {
      if (contentType.suitableFor.some(keyword => topicLower.includes(keyword))) {
        return contentType.type;
      }
    }

    return 'Explainer';
  }

  getCompetitorInsights(topic) {
    // Get insights from competitor analysis
    return this.competitorData
      .filter(competitor => 
        competitor.topPerformingTopics.some(t => 
          t.topic.toLowerCase().includes(topic.toLowerCase())
        )
      )
      .map(competitor => ({
        channelId: competitor.channelId,
        averageViews: competitor.averageViews,
        relevantVideos: competitor.topPerformingTopics.filter(t => 
          t.topic.toLowerCase().includes(topic.toLowerCase())
        )
      }));
  }


}

module.exports = { ContentStrategyAgent };
