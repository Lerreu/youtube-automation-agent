// Audience comments, engagement insights and reply drafts.
// Methods of Database, merged into its prototype (see database/db.js).
const engagementRepository = {
  async upsertAudienceComment(comment) {
    const existing = await this.getRow(
      'SELECT id FROM audience_comments WHERE comment_id = ?',
      [comment.commentId]
    );
    const id = existing?.id || this.generateId('comment');
    await this.executeQuery(
      `INSERT INTO audience_comments (
        id, comment_id, video_id, parent_comment_id, author_name, author_channel_id,
        is_channel_owner, text, like_count, reply_count, published_at, updated_at_youtube
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        text = excluded.text,
        like_count = excluded.like_count,
        reply_count = excluded.reply_count,
        updated_at_youtube = excluded.updated_at_youtube,
        updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        comment.commentId,
        comment.videoId,
        comment.parentCommentId || null,
        comment.authorName || null,
        comment.authorChannelId || null,
        comment.isChannelOwner ? 1 : 0,
        comment.text,
        Number(comment.likeCount || 0),
        Number(comment.replyCount || 0),
        comment.publishedAt || null,
        comment.updatedAtYouTube || null
      ]
    );
    return this.getAudienceComment(comment.commentId);
  },

  async getAudienceComment(commentId) {
    const row = await this.getRow('SELECT * FROM audience_comments WHERE comment_id = ?', [commentId]);
    return this.parseAudienceComment(row);
  },

  async listAudienceComments(options = {}) {
    const conditions = ['video_id = ?'];
    const params = [options.videoId];
    if (options.topLevelOnly) conditions.push('parent_comment_id IS NULL');
    if (options.analysisState) {
      conditions.push('analysis_state = ?');
      params.push(options.analysisState);
    }
    const limit = Math.max(1, Math.min(500, Number(options.limit || 200)));
    const rows = await this.getAllRows(
      `SELECT * FROM audience_comments WHERE ${conditions.join(' AND ')}
       ORDER BY like_count DESC, published_at DESC LIMIT ?`,
      [...params, limit]
    );
    return rows.map(row => this.parseAudienceComment(row));
  },

  async countAudienceComments(videoId) {
    const row = await this.getRow(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN parent_comment_id IS NULL THEN 1 ELSE 0 END) AS top_level
       FROM audience_comments WHERE video_id = ?`,
      [videoId]
    );
    return { total: Number(row?.total || 0), topLevel: Number(row?.top_level || 0) };
  },

  async setAudienceCommentAnalysis(commentId, flags) {
    await this.executeQuery(
      `UPDATE audience_comments
       SET flags = ?, analysis_state = 'analyzed', updated_at = CURRENT_TIMESTAMP
       WHERE comment_id = ?`,
      [JSON.stringify(flags || []), commentId]
    );
    return this.getAudienceComment(commentId);
  },

  async markAudienceCommentReplied(commentId) {
    await this.executeQuery(
      `UPDATE audience_comments SET replied_by_agent = 1, updated_at = CURRENT_TIMESTAMP WHERE comment_id = ?`,
      [commentId]
    );
    return this.getAudienceComment(commentId);
  },

  parseAudienceComment(row) {
    if (!row) return null;
    return {
      ...row,
      commentId: row.comment_id,
      videoId: row.video_id,
      parentCommentId: row.parent_comment_id,
      authorName: row.author_name,
      authorChannelId: row.author_channel_id,
      isChannelOwner: Boolean(row.is_channel_owner),
      likeCount: Number(row.like_count || 0),
      replyCount: Number(row.reply_count || 0),
      publishedAt: row.published_at,
      updatedAtYouTube: row.updated_at_youtube,
      flags: JSON.parse(row.flags || '[]'),
      analysisState: row.analysis_state,
      repliedByAgent: Boolean(row.replied_by_agent)
    };
  },

  async saveEngagementInsight(insight) {
    const existing = await this.getEngagementInsight(insight.videoId);
    const merged = { ...(existing || {}), ...insight };
    const id = existing?.id || this.generateId('insight');
    await this.executeQuery(
      `INSERT INTO engagement_insights (
        id, video_id, production_id, title, comment_count, analyzed_count,
        sentiment, themes, attention_flags, analysis_method, analyzed_at,
        last_synced_at, newest_comment_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        production_id = excluded.production_id,
        title = excluded.title,
        comment_count = excluded.comment_count,
        analyzed_count = excluded.analyzed_count,
        sentiment = excluded.sentiment,
        themes = excluded.themes,
        attention_flags = excluded.attention_flags,
        analysis_method = excluded.analysis_method,
        analyzed_at = excluded.analyzed_at,
        last_synced_at = excluded.last_synced_at,
        newest_comment_at = excluded.newest_comment_at,
        updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        insight.videoId,
        merged.productionId || null,
        merged.title || null,
        Number(merged.commentCount || 0),
        Number(merged.analyzedCount || 0),
        JSON.stringify(merged.sentiment || {}),
        JSON.stringify(merged.themes || []),
        JSON.stringify(merged.attentionFlags || []),
        merged.analysisMethod || 'ai',
        merged.analyzedAt || null,
        merged.lastSyncedAt || null,
        merged.newestCommentAt || null
      ]
    );
    return this.getEngagementInsight(insight.videoId);
  },

  async getEngagementInsight(videoId) {
    const row = await this.getRow('SELECT * FROM engagement_insights WHERE video_id = ?', [videoId]);
    return this.parseEngagementInsight(row);
  },

  async listEngagementInsights(options = {}) {
    const limit = Math.max(1, Math.min(50, Number(options.limit || 12)));
    const rows = await this.getAllRows(
      'SELECT * FROM engagement_insights ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );
    return rows.map(row => this.parseEngagementInsight(row));
  },

  parseEngagementInsight(row) {
    if (!row) return null;
    return {
      ...row,
      videoId: row.video_id,
      productionId: row.production_id,
      commentCount: Number(row.comment_count || 0),
      analyzedCount: Number(row.analyzed_count || 0),
      sentiment: JSON.parse(row.sentiment || '{}'),
      themes: JSON.parse(row.themes || '[]'),
      attentionFlags: JSON.parse(row.attention_flags || '[]'),
      analysisMethod: row.analysis_method,
      analyzedAt: row.analyzed_at,
      lastSyncedAt: row.last_synced_at,
      newestCommentAt: row.newest_comment_at
    };
  },

  async saveReplyDraft(draft) {
    const existing = await this.getRow('SELECT id, status FROM reply_drafts WHERE comment_id = ?', [draft.commentId]);
    if (existing?.status === 'posted') {
      const error = new Error('A posted reply cannot be replaced');
      error.status = 409;
      throw error;
    }
    const id = existing?.id || this.generateId('reply');
    await this.executeQuery(
      `INSERT INTO reply_drafts (id, comment_id, video_id, draft_text, rationale)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(comment_id) DO UPDATE SET
         draft_text = excluded.draft_text,
         rationale = excluded.rationale,
         edited_text = NULL,
         status = 'proposed',
         posted_comment_id = NULL,
         posted_at = NULL,
         failure_reason = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [id, draft.commentId, draft.videoId, draft.draftText, draft.rationale || null]
    );
    return this.getReplyDraft(id);
  },

  async getReplyDraft(id) {
    const row = await this.getRow('SELECT * FROM reply_drafts WHERE id = ?', [id]);
    return this.parseReplyDraft(row);
  },

  async listReplyDrafts(options = {}) {
    const conditions = [];
    const params = [];
    if (options.videoId) {
      conditions.push('video_id = ?');
      params.push(options.videoId);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
    const rows = await this.getAllRows(
      `SELECT * FROM reply_drafts ${where} ORDER BY updated_at DESC LIMIT ?`,
      [...params, limit]
    );
    return rows.map(row => this.parseReplyDraft(row));
  },

  async updateReplyDraft(id, changes = {}) {
    const columns = {
      editedText: 'edited_text',
      status: 'status',
      postedCommentId: 'posted_comment_id',
      postedAt: 'posted_at',
      failureReason: 'failure_reason'
    };
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(columns)) {
      if (key in changes) {
        sets.push(`${column} = ?`);
        params.push(changes[key]);
      }
    }
    if (sets.length) {
      await this.executeQuery(
        `UPDATE reply_drafts SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [...params, id]
      );
    }
    return this.getReplyDraft(id);
  },

  async countReplyDraftsPostedSince(isoTime) {
    const row = await this.getRow(
      "SELECT COUNT(*) AS posted FROM reply_drafts WHERE status = 'posted' AND posted_at >= ?",
      [isoTime]
    );
    return Number(row?.posted || 0);
  },

  parseReplyDraft(row) {
    if (!row) return null;
    return {
      ...row,
      commentId: row.comment_id,
      videoId: row.video_id,
      draftText: row.draft_text,
      editedText: row.edited_text,
      postedCommentId: row.posted_comment_id,
      postedAt: row.posted_at,
      failureReason: row.failure_reason
    };
  }
};

module.exports = { engagementRepository };
