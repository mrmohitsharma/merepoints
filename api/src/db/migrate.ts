import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { config } from '../config';

/** Applies migrations/*.sql in name order, each in its own transaction, once. */
export async function migrate(databaseUrl = config.databaseUrl, opts: { reset?: boolean } = {}) {
  const c = new Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    if (opts.reset) {
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const dir = join(__dirname, '..', '..', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log(`migrated ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  migrate(config.databaseUrl, { reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
