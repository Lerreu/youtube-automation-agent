// Baseline schema (migration 1), column backfills and default settings.
// Methods of Database, merged into its prototype (see database/db.js).
const schemaRepository = {
  // Migration 1 (see database/migrations.js). Do not change: add a new migration instead.
  async createBaselineSchema() {
    const tables = [
      // Content Strategy
      `CREATE TABLE IF NOT EXISTS content_strategies (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        angle TEXT NOT NULL,
        target_audience TEXT NOT NULL,
        content_type TEXT NOT NULL,
        keywords TEXT NOT NULL,
        estimated_views INTEGER DEFAULT 0,
        best_publish_time TEXT,
        competitor_analysis TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Scripts
      `CREATE TABLE IF NOT EXISTS scripts (
        id TEXT PRIMARY KEY,
        strategy_id TEXT,
        title TEXT NOT NULL,
        hook TEXT,
        introduction TEXT,
        main_content TEXT NOT NULL,
        conclusion TEXT,
        call_to_action TEXT,
        full_script TEXT,
        duration TEXT,
        tone TEXT,
        pacing TEXT,
        keywords TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (strategy_id) REFERENCES content_strategies(id)
      )`,
      
      // Thumbnails
      `CREATE TABLE IF NOT EXISTS thumbnails (
        id TEXT PRIMARY KEY,
        script_id TEXT,
        path TEXT NOT NULL,
        concept TEXT,
        prompt TEXT,
        dimensions TEXT,
        file_size INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (script_id) REFERENCES scripts(id)
      )`,
      
      // SEO Data
      `CREATE TABLE IF NOT EXISTS seo_data (
        id TEXT PRIMARY KEY,
        script_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        tags TEXT NOT NULL,
        hashtags TEXT,
        chapters TEXT,
        end_screen TEXT,
        seo_score INTEGER DEFAULT 0,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (script_id) REFERENCES scripts(id)
      )`,
      
      // Production Data
      `CREATE TABLE IF NOT EXISTS productions (
        id TEXT PRIMARY KEY,
        strategy_id TEXT,
        script_id TEXT,
        thumbnail_id TEXT,
        seo_id TEXT,
        status TEXT DEFAULT 'processing',
        assets TEXT,
        timeline TEXT,
        scheduled_publish_time TEXT,
        priority INTEGER DEFAULT 50,
        estimated_duration TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (strategy_id) REFERENCES content_strategies(id),
        FOREIGN KEY (script_id) REFERENCES scripts(id),
        FOREIGN KEY (thumbnail_id) REFERENCES thumbnails(id),
        FOREIGN KEY (seo_id) REFERENCES seo_data(id)
      )`,
      
      // Publishing Schedule
      `CREATE TABLE IF NOT EXISTS publish_schedule (
        id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL,
        title TEXT NOT NULL,
        publish_time TEXT NOT NULL,
        status TEXT DEFAULT 'scheduled',
        priority INTEGER DEFAULT 50,
        metadata TEXT,
        youtube_id TEXT,
        youtube_url TEXT,
        published_at TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      
      // Analytics Reports
      `CREATE TABLE IF NOT EXISTS analytics_reports (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        youtube_id TEXT,
        video_details TEXT,
        analytics_data TEXT,
        thumbnail_metrics TEXT,
        seo_metrics TEXT,
        insights TEXT,
        performance_score INTEGER DEFAULT 0,
        performance_grade TEXT,
        analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      // Evidence-backed channel learning
      `CREATE TABLE IF NOT EXISTS performance_snapshots (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        production_id TEXT,
        measurement_window TEXT NOT NULL,
        published_at TEXT,
        metrics TEXT NOT NULL,
        content_attributes TEXT NOT NULL,
        baseline TEXT,
        deltas TEXT,
        confidence TEXT DEFAULT 'low',
        simulated INTEGER DEFAULT 0,
        measured_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(video_id, measurement_window)
      )`,
      `CREATE TABLE IF NOT EXISTS learning_recommendations (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence TEXT NOT NULL,
        proposed_change TEXT NOT NULL,
        confidence TEXT DEFAULT 'low',
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS growth_experiments (
        id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        recommendation_id TEXT,
        title TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        primary_metric TEXT NOT NULL DEFAULT 'ctr',
        status TEXT NOT NULL DEFAULT 'draft',
        arm_duration_hours INTEGER NOT NULL DEFAULT 48,
        min_impressions INTEGER NOT NULL DEFAULT 1000,
        guardrails TEXT NOT NULL DEFAULT '{}',
        current_arm_id TEXT,
        winning_arm_id TEXT,
        result TEXT NOT NULL DEFAULT '{}',
        approved_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        adopted_at TEXT,
        cancelled_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS experiment_arms (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        arm_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        title TEXT NOT NULL,
        thumbnail_path TEXT NOT NULL,
        is_control INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        baseline_metrics TEXT NOT NULL DEFAULT '{}',
        final_metrics TEXT NOT NULL DEFAULT '{}',
        result TEXT NOT NULL DEFAULT '{}',
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(experiment_id, arm_index),
        FOREIGN KEY (experiment_id) REFERENCES growth_experiments(id)
      )`,
      `CREATE TABLE IF NOT EXISTS experiment_samples (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        arm_id TEXT NOT NULL,
        metrics TEXT NOT NULL,
        traffic_sources TEXT NOT NULL DEFAULT '[]',
        captured_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (experiment_id) REFERENCES growth_experiments(id),
        FOREIGN KEY (arm_id) REFERENCES experiment_arms(id)
      )`,
      `CREATE TABLE IF NOT EXISTS retention_snapshots (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        production_id TEXT,
        short_clip_id TEXT,
        title TEXT,
        surface TEXT NOT NULL DEFAULT 'long_form',
        measurement_window TEXT NOT NULL,
        published_at TEXT,
        duration_seconds REAL NOT NULL,
        points TEXT NOT NULL,
        scene_metrics TEXT NOT NULL,
        summary TEXT NOT NULL,
        confidence TEXT DEFAULT 'low',
        measured_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(video_id, measurement_window)
      )`,

      `CREATE TABLE IF NOT EXISTS audience_comments (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL UNIQUE,
        video_id TEXT NOT NULL,
        parent_comment_id TEXT,
        author_name TEXT,
        author_channel_id TEXT,
        is_channel_owner INTEGER DEFAULT 0,
        text TEXT NOT NULL,
        like_count INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        published_at TEXT,
        updated_at_youtube TEXT,
        flags TEXT NOT NULL DEFAULT '[]',
        analysis_state TEXT DEFAULT 'pending',
        replied_by_agent INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS engagement_insights (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL UNIQUE,
        production_id TEXT,
        title TEXT,
        comment_count INTEGER DEFAULT 0,
        analyzed_count INTEGER DEFAULT 0,
        sentiment TEXT NOT NULL DEFAULT '{}',
        themes TEXT NOT NULL DEFAULT '[]',
        attention_flags TEXT NOT NULL DEFAULT '[]',
        analysis_method TEXT DEFAULT 'ai',
        analyzed_at TEXT,
        last_synced_at TEXT,
        newest_comment_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS reply_drafts (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL UNIQUE,
        video_id TEXT NOT NULL,
        draft_text TEXT NOT NULL,
        edited_text TEXT,
        status TEXT DEFAULT 'proposed',
        rationale TEXT,
        posted_comment_id TEXT,
        posted_at TEXT,
        failure_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      // Keywords Performance
      `CREATE TABLE IF NOT EXISTS keyword_performance (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        total_uses INTEGER DEFAULT 0,
        total_views INTEGER DEFAULT 0,
        average_views INTEGER DEFAULT 0,
        best_performing_video TEXT,
        last_used TEXT,
        performance_score INTEGER DEFAULT 0
      )`,
      
      // Content Performance History
      `CREATE TABLE IF NOT EXISTS content_history (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        content_type TEXT NOT NULL,
        publish_date TEXT NOT NULL,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        watch_time INTEGER DEFAULT 0,
        ctr REAL DEFAULT 0,
        retention_rate REAL DEFAULT 0,
        performance_score INTEGER DEFAULT 0,
        youtube_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Automation Events
      `CREATE TABLE IF NOT EXISTS automation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS generation_jobs (
        id TEXT PRIMARY KEY,
        topic TEXT,
        style TEXT,
        length TEXT DEFAULT 'medium',
        source TEXT DEFAULT 'manual',
        status TEXT DEFAULT 'queued',
        stage TEXT DEFAULT 'queued',
        progress INTEGER DEFAULT 0,
        production_id TEXT,
        title TEXT,
        error TEXT,
        details TEXT,
        cancel_requested INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS generation_checkpoints (
        job_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        artifact TEXT,
        attempt_count INTEGER DEFAULT 0,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (job_id, stage),
        FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
      )`,
      `CREATE TABLE IF NOT EXISTS media_generation_tasks (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        production_id TEXT,
        scene_index INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        external_task_id TEXT,
        status TEXT DEFAULT 'submitting',
        request TEXT NOT NULL DEFAULT '{}',
        provider_data TEXT NOT NULL DEFAULT '{}',
        output_path TEXT,
        error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        UNIQUE(job_id, scene_index, provider),
        FOREIGN KEY (job_id) REFERENCES generation_jobs(id)
      )`,
      `CREATE TABLE IF NOT EXISTS production_snapshots (
        production_id TEXT PRIMARY KEY,
        strategy TEXT,
        script TEXT,
        thumbnail TEXT,
        seo TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS content_reviews (
        production_id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'needs_review',
        editor_data TEXT,
        quality_checks TEXT,
        review_notes TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS content_provenance (
        production_id TEXT PRIMARY KEY,
        sources TEXT NOT NULL DEFAULT '[]',
        claims TEXT NOT NULL DEFAULT '[]',
        contains_synthetic_media INTEGER DEFAULT 0,
        status TEXT DEFAULT 'not_required',
        summary TEXT NOT NULL DEFAULT '{}',
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS discoverability_audits (
        id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'youtube',
        mode TEXT NOT NULL DEFAULT 'content',
        engine TEXT NOT NULL DEFAULT 'darkzseo',
        engine_version TEXT,
        schema_version TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '{}',
        error_code TEXT,
        error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS discoverability_findings (
        id TEXT PRIMARY KEY,
        audit_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        applicability TEXT NOT NULL DEFAULT '[]',
        message TEXT NOT NULL,
        remediation TEXT,
        fingerprint TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'pending',
        review_reason TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (audit_id) REFERENCES discoverability_audits(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_discoverability_audits_production
       ON discoverability_audits(production_id, platform, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_discoverability_findings_audit
       ON discoverability_findings(audit_id, severity, review_status)`,
      `CREATE TABLE IF NOT EXISTS production_scenes (
        id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        label TEXT NOT NULL,
        script_text TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        duration REAL NOT NULL DEFAULT 5,
        asset_type TEXT DEFAULT 'missing',
        asset_origin TEXT DEFAULT 'generated',
        asset_path TEXT,
        audio_path TEXT,
        narration_provider TEXT,
        narration_model TEXT,
        narration_task_id TEXT,
        narration_error TEXT,
        narration_generated_at TEXT,
        narration_cost TEXT NOT NULL DEFAULT '{}',
        provider TEXT,
        model TEXT,
        external_task_id TEXT,
        status TEXT DEFAULT 'ready',
        narration_status TEXT DEFAULT 'current',
        revision INTEGER DEFAULT 1,
        locked INTEGER DEFAULT 0,
        rights_confirmed INTEGER DEFAULT 0,
        provenance_source_ids TEXT NOT NULL DEFAULT '[]',
        contains_synthetic_media INTEGER DEFAULT 0,
        estimated_cost TEXT NOT NULL DEFAULT '{}',
        actual_cost TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(production_id, position),
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS production_scene_revisions (
        id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT DEFAULT 'completed',
        before_state TEXT NOT NULL DEFAULT '{}',
        after_state TEXT NOT NULL DEFAULT '{}',
        cost_evidence TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (production_id) REFERENCES productions(id),
        FOREIGN KEY (scene_id) REFERENCES production_scenes(id)
      )`,
      `CREATE TABLE IF NOT EXISTS shorts_clips (
        id TEXT PRIMARY KEY,
        production_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        source_scene_ids TEXT NOT NULL DEFAULT '[]',
        start_seconds REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 30,
        layout TEXT NOT NULL DEFAULT 'blur',
        rationale TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        output_path TEXT,
        captions_path TEXT,
        publish_time TEXT,
        privacy_status TEXT DEFAULT 'private',
        inherited_evidence TEXT NOT NULL DEFAULT '{}',
        rendered_at TEXT,
        approved_at TEXT,
        schedule_id TEXT,
        youtube_id TEXT,
        youtube_url TEXT,
        error TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(production_id, position),
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`,
      `CREATE TABLE IF NOT EXISTS channel_profiles (
        id TEXT PRIMARY KEY,
        channel_name TEXT,
        goal TEXT,
        target_audience TEXT,
        brand_voice TEXT,
        default_style TEXT,
        call_to_action TEXT,
        banned_topics TEXT,
        visual_style TEXT,
        timezone TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS content_ideas (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        angle TEXT,
        style TEXT,
        status TEXT DEFAULT 'backlog',
        rationale TEXT,
        scheduled_for TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS channel_strategies (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        audience TEXT NOT NULL,
        value_proposition TEXT,
        content_pillars TEXT NOT NULL,
        cadence_per_week INTEGER DEFAULT 1,
        videos_per_run INTEGER DEFAULT 1,
        default_format TEXT DEFAULT 'explainer',
        default_length TEXT DEFAULT 'medium',
        success_metric TEXT,
        primary_kpi TEXT DEFAULT 'views',
        target_value REAL,
        target_window_days INTEGER DEFAULT 28,
        monthly_budget REAL,
        outcome_currency TEXT DEFAULT 'USD',
        constraints TEXT,
        status TEXT DEFAULT 'draft',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS operator_runs (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        status TEXT DEFAULT 'queued',
        stage TEXT DEFAULT 'queued',
        progress INTEGER DEFAULT 0,
        research TEXT,
        plan TEXT,
        generated_jobs TEXT,
        summary TEXT,
        error TEXT,
        cancel_requested INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (strategy_id) REFERENCES channel_strategies(id)
      )`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        level TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        status TEXT DEFAULT 'unread',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS readiness_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        checks TEXT NOT NULL,
        summary TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
            // System Settings
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const tableQuery of tables) {
      await this.executeQuery(tableQuery);
    }

    await this.ensureColumns('production_scenes', {
      narration_provider: 'TEXT',
      narration_model: 'TEXT',
      narration_task_id: 'TEXT',
      narration_error: 'TEXT',
      narration_generated_at: 'TEXT',
      narration_cost: "TEXT NOT NULL DEFAULT '{}'"
    });
    await this.ensureColumns('channel_strategies', {
      primary_kpi: "TEXT DEFAULT 'views'",
      target_value: 'REAL',
      target_window_days: 'INTEGER DEFAULT 28',
      monthly_budget: 'REAL',
      outcome_currency: "TEXT DEFAULT 'USD'"
    });
    await this.ensureColumns('discoverability_audits', {
      error_code: 'TEXT'
    });
  },

  async ensureColumns(tableName, columns) {
    const allowedTables = new Set(['production_scenes', 'channel_strategies', 'discoverability_audits']);
    if (!allowedTables.has(tableName)) throw new Error(`Unsupported migration table: ${tableName}`);
    const existing = new Set((await this.getAllRows(`PRAGMA table_info(${tableName})`)).map(column => column.name));
    for (const [columnName, definition] of Object.entries(columns)) {
      if (!existing.has(columnName)) {
        await this.executeQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
      }
    }
  },

  async insertDefaultSettings() {
    const defaultSettings = [
      ['daily_content_enabled', 'true', 'Enable daily content generation'],
      ['auto_publish_enabled', 'true', 'Enable automatic publishing'],
      ['analytics_enabled', 'true', 'Enable analytics collection'],
      ['optimization_enabled', 'true', 'Enable automatic optimization'],
      ['thumbnail_ab_testing', 'false', 'Enable thumbnail A/B testing'],
      ['content_backup_enabled', 'true', 'Enable content backup'],
      ['notification_enabled', 'true', 'Enable system notifications'],
      ['automation_paused', 'false', 'Pause generation and publishing automation'],
      ['channel_timezone', 'America/Chicago', 'Timezone used to present channel schedules'],
      ['max_daily_posts', '1', 'Maximum posts per day'],
      ['content_buffer_days', '3', 'Days of content to keep in buffer'],
      ['video_provider', 'slideshow', 'Video provider: slideshow, auto, seedance, minimax_h3, google_omni, kling, or wan'],
      ['video_provider_order', 'seedance,minimax_h3,google_omni,kling,wan,slideshow', 'Provider priority used by automatic routing'],
      ['video_generation_mode', 'hybrid', 'Use provider clips within a locally assembled long-form video'],
      ['video_clip_duration', '8', 'Requested duration for each generated provider clip'],
      ['video_max_generated_seconds', '60', 'Maximum paid provider seconds per production'],
      ['video_resolution', '720p', 'Requested generated clip resolution'],
      ['video_aspect_ratio', '16:9', 'Requested generated clip aspect ratio']
    ];

    for (const [key, value, description] of defaultSettings) {
      await this.executeQuery(
        'INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)',
        [key, value, description]
      );
    }

    await this.executeQuery(
      `INSERT OR IGNORE INTO channel_profiles (
        id, channel_name, goal, target_audience, brand_voice, default_style,
        call_to_action, banned_topics, visual_style, timezone
      ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        process.env.CHANNEL_NAME || 'My YouTube Channel',
        'Grow a trusted, useful YouTube channel',
        process.env.TARGET_AUDIENCE || 'General audience',
        'Clear, credible, and engaging',
        'explainer',
        'Subscribe for more useful videos.',
        '[]',
        'Clean, high-contrast, and readable',
        process.env.CHANNEL_TIMEZONE || 'America/Chicago'
      ]
    );
  }
};

module.exports = { schemaRepository };
