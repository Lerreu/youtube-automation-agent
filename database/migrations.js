// Versioned schema migrations. Append new entries with the next version number;
// never edit or reorder an entry that has shipped. Each migration runs once, in
// its own transaction, and is recorded in schema_migrations.
const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline_schema',
    // The schema as it existed before versioned migrations. It is idempotent
    // (CREATE IF NOT EXISTS + add missing columns), so it also upgrades
    // databases created by earlier releases.
    up: db => db.createBaselineSchema()
  },
  {
    version: 2,
    name: 'drop_removed_settings',
    // approval_required (human approval is now mandatory) and
    // publish_time_optimization (the fake optimizer was removed).
    up: db => db.executeQuery("DELETE FROM settings WHERE key IN ('approval_required', 'publish_time_optimization')")
  },
  {
    version: 3,
    name: 'drop_non_reference_foreign_keys',
    // Foreign keys are enforced from this version on. Two declared references
    // were never true references and are removed:
    // - publish_schedule.production_id holds a production ID or a Shorts clip ID;
    // - production_scene_revisions.scene_id is history that outlives replaced scenes.
    up: async db => {
      await rebuildTable(db, 'publish_schedule', `(
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      await rebuildTable(db, 'production_scene_revisions', `(
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
        FOREIGN KEY (production_id) REFERENCES productions(id)
      )`);
    }
  },
  {
    version: 4,
    name: 'channel_content_language',
    // Language every production of the channel is written and narrated in.
    // NULL means the default (see utils/content-language.js).
    up: async db => {
      const columns = (await db.getAllRows('PRAGMA table_info(channel_profiles)')).map(column => column.name);
      if (!columns.includes('content_language')) {
        await db.executeQuery('ALTER TABLE channel_profiles ADD COLUMN content_language TEXT');
      }
    }
  }
];

// SQLite cannot drop a constraint in place: create the new table, copy the
// columns both versions share, then swap. Runs with foreign keys off.
async function rebuildTable(db, table, definition) {
  const temp = `${table}__rebuild`;
  await db.executeQuery(`CREATE TABLE ${temp} ${definition}`);
  const newColumns = new Set((await db.getAllRows(`PRAGMA table_info(${temp})`)).map(column => column.name));
  const shared = (await db.getAllRows(`PRAGMA table_info(${table})`)).map(column => column.name).filter(name => newColumns.has(name));
  const columns = shared.join(', ');
  await db.executeQuery(`INSERT INTO ${temp} (${columns}) SELECT ${columns} FROM ${table}`);
  await db.executeQuery(`DROP TABLE ${table}`);
  await db.executeQuery(`ALTER TABLE ${temp} RENAME TO ${table}`);
}

function validate(migrations) {
  const versions = migrations.map(migration => migration.version);
  versions.forEach((version, index) => {
    if (!Number.isInteger(version) || version !== index + 1) {
      throw new Error(`Migrations must be numbered 1..n in order; found ${version} at position ${index + 1}`);
    }
  });
}

async function runMigrations(db, migrations = MIGRATIONS, logger = db.logger) {
  validate(migrations);
  await db.executeQuery(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set((await db.getAllRows('SELECT version FROM schema_migrations')).map(row => Number(row.version)));
  const latestKnown = migrations.length;
  const newest = Math.max(0, ...applied);
  if (newest > latestKnown) {
    throw new Error(`Database schema version ${newest} is newer than this code supports (${latestKnown}). Update the application.`);
  }

  const ran = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.db.exec('BEGIN');
    try {
      await migration.up(db);
      await db.executeQuery('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [migration.version, migration.name]);
      db.db.exec('COMMIT');
    } catch (error) {
      db.db.exec('ROLLBACK');
      error.message = `Migration ${migration.version} (${migration.name}) failed: ${error.message}`;
      throw error;
    }
    ran.push(migration.version);
    logger?.info?.(`Applied migration ${migration.version}: ${migration.name}`);
  }
  return { applied: ran, version: latestKnown };
}

module.exports = { MIGRATIONS, runMigrations };
