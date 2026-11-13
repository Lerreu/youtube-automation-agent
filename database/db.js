const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');
const { runMigrations } = require('./migrations');
const { schemaRepository } = require('./repositories/schema');
const { contentRepository } = require('./repositories/content');
const { jobsRepository } = require('./repositories/jobs');
const { scenesRepository } = require('./repositories/scenes');
const { discoverabilityRepository } = require('./repositories/discoverability');
const { channelRepository } = require('./repositories/channel');
const { publishingRepository } = require('./repositories/publishing');
const { analyticsRepository } = require('./repositories/analytics');
const { experimentsRepository } = require('./repositories/experiments');
const { engagementRepository } = require('./repositories/engagement');

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'youtube_automation.db');
    this.db = null;
    this.logger = new Logger('Database');
  }

  async initialize() {
    try {
      this.logger.info('Initializing database...');
      
      // Ensure data directory exists
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      
      // Migrations run with foreign keys off (SQLite's procedure for table
      // rebuilds); enforcement is switched on right after.
      this.db = new DatabaseSync(this.dbPath, { enableForeignKeyConstraints: false });
      // Wait instead of failing if a backup or another tool briefly locks the file.
      this.db.exec('PRAGMA busy_timeout = 5000');

      await this.createTables();

      this.db.exec('PRAGMA foreign_keys = ON');
      // Rows written before enforcement may point at missing parents; they are
      // left in place, but reported.
      const orphans = await this.getAllRows('PRAGMA foreign_key_check');
      if (orphans.length) {
        const tables = [...new Set(orphans.map(row => row.table))].join(', ');
        this.logger.warn(`${orphans.length} existing row(s) reference missing records (${tables}); new writes are checked.`);
      }

      this.logger.success('Database initialized successfully');
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async createTables() {
    await runMigrations(this);
    await this.insertDefaultSettings();
  }

  // Settings
  async getSetting(key) {
    const row = await this.getRow(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );
    return row ? row.value : null;
  }

  async setSetting(key, value, description = null) {
    await this.executeQuery(
      `INSERT OR REPLACE INTO settings (key, value, description, updated_at) 
       VALUES (?, ?, COALESCE(?, (SELECT description FROM settings WHERE key = ?)), datetime('now'))`,
      [key, value, description, key]
    );
  }

  async getAllSettings() {
    const rows = await this.getAllRows('SELECT * FROM settings ORDER BY key');
    return rows.reduce((settings, row) => {
      settings[row.key] = row.value;
      return settings;
    }, {});
  }

  // Utility methods
  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  // node:sqlite is synchronous; these helpers keep the async interface the
  // rest of the code uses. Rows are copied to plain objects (node:sqlite
  // returns null-prototype objects).
  bindParams(params) {
    const list = Array.isArray(params) ? params : [params];
    return list.map(value => {
      if (value === undefined) return null;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value instanceof Date) return value.getTime();
      return value;
    });
  }

  async executeQuery(query, params = []) {
    const result = this.db.prepare(query).run(...this.bindParams(params));
    return { lastID: Number(result.lastInsertRowid), changes: Number(result.changes) };
  }

  async getRow(query, params = []) {
    const row = this.db.prepare(query).get(...this.bindParams(params));
    return row ? { ...row } : undefined;
  }

  async getAllRows(query, params = []) {
    return this.db.prepare(query).all(...this.bindParams(params)).map(row => ({ ...row }));
  }

  async close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (error) {
        this.logger.error('Error closing database:', error);
      }
      this.db = null;
    }
  }

  async backup() {
    try {
      const backupPath = path.join(
        path.dirname(this.dbPath),
        `backup_${Date.now()}.db`
      );
      
      const fs = require('fs').promises;
      await fs.copyFile(this.dbPath, backupPath);
      
      this.logger.info(`Database backed up to: ${backupPath}`);
      return backupPath;
    } catch (error) {
      this.logger.error('Database backup failed:', error);
      throw error;
    }
  }

  async getStats() {
    const [
      strategiesCount,
      scriptsCount,
      productionsCount,
      publishedCount,
      analyticsCount
    ] = await Promise.all([
      this.getRow('SELECT COUNT(*) as count FROM content_strategies'),
      this.getRow('SELECT COUNT(*) as count FROM scripts'),
      this.getRow('SELECT COUNT(*) as count FROM productions'),
      this.getRow("SELECT COUNT(*) as count FROM publish_schedule WHERE status = 'published'"),
      this.getRow('SELECT COUNT(*) as count FROM analytics_reports')
    ]);

    return {
      strategies: strategiesCount.count,
      scripts: scriptsCount.count,
      productions: productionsCount.count,
      published: publishedCount.count,
      analytics: analyticsCount.count,
      dbSize: await this.getDatabaseSize()
    };
  }

  async getDatabaseSize() {
    try {
      const fs = require('fs').promises;
      const stats = await fs.stat(this.dbPath);
      return `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
    } catch (error) {
      return 'Unknown';
    }
  }
}

Object.assign(
  Database.prototype,
  schemaRepository,
  contentRepository,
  jobsRepository,
  scenesRepository,
  discoverabilityRepository,
  channelRepository,
  publishingRepository,
  analyticsRepository,
  experimentsRepository,
  engagementRepository
);

module.exports = { Database };
