const { Logger } = require('../utils/logger');
const { AITextService } = require('../utils/ai-text-service');
const { resolveLanguage, languageInstruction } = require('../utils/content-language');

class ScriptWriterAgent {
  constructor(db, credentials) {
    this.db = db;
    this.credentials = credentials;
    this.logger = new Logger('ScriptWriter');
    this.templates = this.loadTemplates();
    this.aiTextService = new AITextService(credentials?.credentials || credentials || {});
  }

  async initialize() {
    this.logger.info('Initializing Script Writer Agent...');
    return true;
  }

  loadTemplates() {
    return {
      tutorial: {
        structure: ['hook', 'introduction', 'problem', 'solution_steps', 'demonstration', 'recap', 'cta'],
        tone: 'educational',
        pacing: 'moderate'
      },
      explainer: {
        structure: ['hook', 'question', 'background', 'explanation', 'examples', 'implications', 'summary', 'cta'],
        tone: 'informative',
        pacing: 'steady'
      },
      list: {
        structure: ['hook', 'introduction', 'list_items', 'bonus_item', 'summary', 'cta'],
        tone: 'engaging',
        pacing: 'quick'
      },
      review: {
        structure: ['hook', 'introduction', 'overview', 'pros', 'cons', 'comparison', 'verdict', 'cta'],
        tone: 'analytical',
        pacing: 'detailed'
      },
      story: {
        structure: ['hook', 'setup', 'conflict', 'journey', 'climax', 'resolution', 'lesson', 'cta'],
        tone: 'narrative',
        pacing: 'dynamic'
      }
    };
  }

  async generateScript(strategy) {
    try {
      this.logger.info(`Generating script for: ${strategy.topic}`);
      const template = this.templates[String(strategy.contentType || '').toLowerCase()] || this.templates.explainer;
      const script = await this.generateScriptWithAI(strategy, template);
      script.fullScript = this.formatFullScript(script);
      await this.db.saveScript(script);
      this.logger.info(`Script generated with AI provider: ${script.title}`);
      return script;
    } catch (error) {
      this.logger.error('Failed to generate script:', error);
      throw error;
    }
  }

  async generateScriptWithAI(strategy, template) {
    if (!this.aiTextService.isAvailable()) {
      const error = new Error('Script generation needs an AI text provider. Configure one with npm run walkthrough.');
      error.code = 'AI_TEXT_REQUIRED';
      error.status = 503;
      throw error;
    }

    const prompt = `You are writing a YouTube script plan.
Return only valid JSON with this exact shape:
{
  "title": "compelling title under 100 characters",
  "hook": "opening hook in one sentence",
  "introduction": "1-3 spoken sentences introducing the topic",
  "sections": [
    { "title": "section title", "content": ["spoken script bullet"], "duration": 60 }
  ],
  "conclusion": { "recap": ["one spoken sentence per point actually covered"], "finalThought": "closing sentence" },
  "cta": "clear call to action",
  "claims": [
    { "text": "specific factual claim a reviewer must verify", "riskLevel": "standard|high", "sourceUrls": ["exact supplied source URL"] }
  ]
}

Topic: ${strategy.topic}
Style/content type: ${strategy.contentType}
Angle: ${strategy.angle}
Target audience: ${strategy.targetAudience}
Desired length: ${strategy.requestedLength || process.env.DEFAULT_VIDEO_LENGTH || '8-12 minutes'}
Tone: ${template.tone}
Pacing: ${template.pacing}
Brand voice: ${strategy.brandVoice || 'clear, credible, and engaging'}
Channel goal: ${strategy.channelGoal || 'help the viewer understand and act'}
Channel value proposition: ${strategy.channelValueProposition || 'give the viewer practical value'}
Editorial rationale: ${strategy.planRationale || 'fit the selected topic and audience'}
Channel constraints: ${strategy.channelConstraints || 'none beyond the factual-safety rules below'}
Preferred call to action: ${strategy.callToAction || 'invite the viewer to subscribe'}
Keywords: ${(strategy.keywords || []).join(', ')}
Research sources: ${JSON.stringify(strategy.researchSources || [])}
Avoid fabricated statistics, unsupported claims, and fake urgency. Never claim personal experience, credentials, research effort or audience size for the narrator. The recap must only summarize the sections you wrote. List every externally verifiable factual claim in claims. Use only exact URLs from Research sources; use an empty sourceUrls array when the supplied sources do not support a claim.
${languageInstruction(strategy.language)} The script is narrated as written, so it must read naturally aloud in that language.`;

    try {
      const response = await this.aiTextService.generateText(prompt, {
        maxTokens: 8192,
        json: true,
        temperature: 0.7
      });
      const parsed = this.parseAIJsonResponse(response);
      const sections = this.normalizeAISections(parsed.sections, strategy);

      if (!parsed.title || !parsed.hook || sections.length === 0) {
        throw new Error('AI script response missing required fields');
      }

      this.logger.info(`Using AI script generation via ${this.aiTextService.providerName}`);
      return {
        title: String(parsed.title).slice(0, 100),
        hook: this.normalizeAIHook(parsed.hook),
        introduction: this.normalizeAIIntroduction(parsed.introduction),
        mainContent: {
          sections,
          totalDuration: this.calculateSectionsDuration(sections)
        },
        conclusion: this.normalizeAIConclusion(parsed.conclusion),
        callToAction: this.normalizeAICTA(parsed.cta, strategy),
        duration: this.estimateDuration({ sections }),
        tone: template.tone,
        pacing: template.pacing,
        keywords: strategy.keywords || [],
        claims: this.normalizeAIClaims(parsed.claims, strategy.researchSources || []),
        metadata: {
          strategy,
          generatedAt: new Date().toISOString(),
          version: '1.0',
          generationSource: 'ai'
        }
      };
    } catch (error) {
      const failure = new Error(`AI script generation failed: ${error.message}`);
      failure.code = 'AI_SCRIPT_FAILED';
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

  normalizeAIIntroduction(introduction) {
    // Spoken text lives in topicIntro; the other legacy fields stay empty so
    // nothing canned is narrated.
    return {
      greeting: '',
      topicIntro: String(introduction || '').trim().slice(0, 1000),
      valueProposition: '',
      credibility: '',
      duration: '0:05-0:20'
    };
  }

  normalizeAIConclusion(conclusion) {
    const recap = Array.isArray(conclusion?.recap) ? conclusion.recap : [];
    return {
      type: 'conclusion',
      title: 'Wrapping Up',
      recap: recap.map(line => String(line).trim()).filter(Boolean).slice(0, 8),
      finalThought: String(conclusion?.finalThought || '').trim().slice(0, 500),
      duration: '30 seconds'
    };
  }

  normalizeAIHook(hook) {
    const text = typeof hook === 'object' && hook !== null ? hook.text : hook;
    return {
      type: 'ai',
      text: String(text).trim(),
      duration: '0:00-0:05'
    };
  }

  normalizeAISections(sections, strategy) {
    if (!Array.isArray(sections)) {
      return [];
    }

    return sections
      .slice(0, 8)
      .map((section, index) => {
        const rawContent = Array.isArray(section.content)
          ? section.content
          : [section.content || section.summary || section.description];
        const content = rawContent
          .filter(Boolean)
          .map(line => String(line).trim())
          .filter(Boolean);

        return {
          type: 'ai_generated',
          title: String(section.title || `${strategy.topic} Part ${index + 1}`).trim(),
          content,
          duration: parseInt(section.duration, 10) || 60
        };
      })
      .filter(section => section.title && section.content.length > 0);
  }

  normalizeAIClaims(claims, sources) {
    if (!Array.isArray(claims)) return [];
    const allowedUrls = new Set((sources || []).map(source => source.url));
    return claims.slice(0, 25).map(item => ({
      text: String(item?.text || item?.claim || '').trim().slice(0, 1000),
      riskLevel: item?.riskLevel === 'high' ? 'high' : 'standard',
      sourceUrls: [...new Set((Array.isArray(item?.sourceUrls) ? item.sourceUrls : [])
        .map(url => String(url))
        .filter(url => allowedUrls.has(url)))]
    })).filter(item => item.text);
  }

  normalizeAICTA(cta, strategy) {
    // Fallback lines are spoken, so they follow the channel language.
    const phrases = resolveLanguage(strategy.language).phrases;
    if (cta && typeof cta === 'object') {
      return {
        type: 'call_to_action',
        subscribe: String(cta.subscribe || cta.text || phrases.subscribe(strategy.topic)),
        like: String(cta.like || phrases.like),
        comment: String(cta.comment || phrases.comment(strategy.topic)),
        nextVideo: String(cta.nextVideo || phrases.nextVideo),
        duration: '15 seconds'
      };
    }

    return {
      type: 'call_to_action',
      subscribe: String(cta || phrases.subscribePractical(strategy.topic)),
      like: phrases.like,
      comment: phrases.comment(strategy.topic),
      nextVideo: phrases.nextVideo,
      duration: '15 seconds'
    };
  }
  formatFullScript(script) {
    let fullScript = '';
    
    // Title
    fullScript += `TITLE: ${script.title}\n\n`;
    fullScript += '═'.repeat(50) + '\n\n';
    
    // Hook
    fullScript += `[${script.hook.duration}] HOOK\n`;
    fullScript += `${script.hook.text}\n\n`;
    
    // Introduction
    fullScript += `[${script.introduction.duration}] INTRODUCTION\n`;
    for (const line of [script.introduction.greeting, script.introduction.topicIntro, script.introduction.valueProposition, script.introduction.credibility]) {
      if (line) fullScript += `${line}\n`;
    }
    fullScript += '\n';
    
    // Main Content
    fullScript += 'MAIN CONTENT\n';
    fullScript += '─'.repeat(30) + '\n\n';
    
    for (const section of script.mainContent.sections) {
      fullScript += `[${this.formatDuration(section.duration)}] ${section.title.toUpperCase()}\n`;
      
      if (Array.isArray(section.content)) {
        section.content.forEach(line => {
          fullScript += `${line}\n`;
        });
      } else if (section.steps) {
        section.steps.forEach(step => {
          fullScript += `\n${step.title}\n`;
          fullScript += `${step.description}\n`;
          fullScript += `💡 ${step.tip}\n`;
        });
      } else if (section.items) {
        section.items.forEach(item => {
          fullScript += `\n#${item.number}: ${item.title}\n`;
          fullScript += `${item.description}\n`;
          fullScript += `Impact: ${item.impact}\n`;
        });
      } else if (section.points) {
        section.points.forEach(point => {
          fullScript += `• ${point}\n`;
        });
      } else {
        fullScript += `${section.content}\n`;
      }
      
      if (section.visuals) {
        fullScript += `\n[VISUALS: ${section.visuals.join(', ')}]\n`;
      }
      
      fullScript += '\n';
    }
    
    // Conclusion
    fullScript += `[${script.conclusion.duration}] CONCLUSION\n`;
    script.conclusion.recap.forEach(line => {
      fullScript += `${line}\n`;
    });
    fullScript += `\n${script.conclusion.finalThought}\n\n`;
    
    // Call to Action
    fullScript += `[${script.callToAction.duration}] CALL TO ACTION\n`;
    fullScript += `${script.callToAction.subscribe}\n`;
    fullScript += `${script.callToAction.like}\n`;
    fullScript += `${script.callToAction.comment}\n`;
    fullScript += `${script.callToAction.nextVideo}\n\n`;
    
    // Metadata
    fullScript += '═'.repeat(50) + '\n';
    fullScript += `ESTIMATED DURATION: ${script.duration}\n`;
    fullScript += `TONE: ${script.tone}\n`;
    fullScript += `PACING: ${script.pacing}\n`;
    fullScript += `KEYWORDS: ${script.keywords.join(', ')}\n`;
    
    return fullScript;
  }

  estimateDuration(mainContent) {
    const totalSeconds = mainContent.sections.reduce((total, section) => {
      return total + (section.duration || 60);
    }, 0);
    
    // Add hook, intro, conclusion, CTA
    const fullDuration = totalSeconds + 5 + 15 + 30 + 15;
    
    return this.formatDuration(fullDuration);
  }

  formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  calculateSectionsDuration(sections) {
    return sections.reduce((total, section) => total + (section.duration || 60), 0);
  }
}

module.exports = { ScriptWriterAgent };
