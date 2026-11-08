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
  }
];

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
