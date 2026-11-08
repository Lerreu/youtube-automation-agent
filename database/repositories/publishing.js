// Publish schedule and queue.
// Methods of Database, merged into its prototype (see database/db.js).
const publishingRepository = {
  // Publishing methods
  async saveScheduleEntry(entry) {
    const existing = await this.getLatestScheduleEntry(entry.productionId);
    if (existing) return existing;
    const id = this.generateId('schedule');
    entry.id = id;
    
    await this.executeQuery(
      `INSERT INTO publish_schedule (
        id, production_id, title, publish_time, status, 
        priority, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.productionId,
        entry.title,
        entry.publishTime,
        entry.status,
        entry.priority,
        JSON.stringify(entry.metadata)
      ]
    );
    
    return entry;
  },

  async updateScheduleEntry(entry) {
    await this.executeQuery(
      `UPDATE publish_schedule SET 
        title = COALESCE(?, title), publish_time = COALESCE(?, publish_time),
        status = ?, priority = COALESCE(?, priority), metadata = COALESCE(?, metadata),
        youtube_id = ?, youtube_url = ?, published_at = ?, error_message = ?
      WHERE id = ?`,
      [
        entry.title || null,
        entry.publishTime || entry.publish_time || null,
        entry.status,
        entry.priority ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.youtubeId || null,
        entry.youtubeUrl || null,
        entry.publishedAt || null,
        entry.error || null,
        entry.id
      ]
    );
  },

  async deleteScheduleEntry(id) {
    await this.executeQuery('DELETE FROM publish_schedule WHERE id = ?', [id]);
  },

  async getLatestScheduleEntry(productionId) {
    const row = await this.getRow(
      'SELECT * FROM publish_schedule WHERE production_id = ? ORDER BY created_at DESC LIMIT 1',
      [productionId]
    );
    return row ? this.deserializeScheduleEntry(row) : null;
  },

  deserializeScheduleEntry(row) {
    return {
      ...row,
      productionId: row.production_id,
      publishTime: row.publish_time,
      youtubeId: row.youtube_id,
      youtubeUrl: row.youtube_url,
      publishedAt: row.published_at,
      error: row.error_message,
      metadata: JSON.parse(row.metadata || '{}')
    };
  },

  async getPublishQueue() {
    const rows = await this.getAllRows(
      `SELECT * FROM publish_schedule
       WHERE status IN ('scheduled', 'paused')
       ORDER BY publish_time ASC`
    );

    return rows.map(row => this.deserializeScheduleEntry(row));
  },

  async getUpcomingSchedule(days = 7) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    
    const rows = await this.getAllRows(
      `SELECT * FROM publish_schedule 
       WHERE publish_time BETWEEN datetime('now') AND datetime(?)
       ORDER BY publish_time ASC`,
      [endDate.toISOString()]
    );
    
    return rows.map(row => this.deserializeScheduleEntry(row));
  }
};

module.exports = { publishingRepository };
