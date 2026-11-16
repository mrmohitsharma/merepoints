/**
 * Create a Super Admin login from the command line (first owner, or recovery):
 *   npm run create-admin -- <username> "<Full name>" <owner|ops|support>
 * The password is read from ADMIN_PASSWORD so it never lands in shell history.
 */
import { Pool } from 'pg';
import { config } from '../config';
import { assertStrongPassword, hashPassword } from '../common/password';

async function main() {
  const [username, name, role = 'owner'] = process.argv.slice(2);
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!username || !name || !['owner', 'ops', 'support'].includes(role)) {
    console.error('Usage: ADMIN_PASSWORD=... npm run create-admin -- <username> "<Full name>" <owner|ops|support>');
    process.exit(1);
  }
  assertStrongPassword(password);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const r = await pool.query(
    `INSERT INTO admin_users (username, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,FALSE)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = TRUE, failed_attempts = 0,
       locked_until = NULL, token_version = admin_users.token_version + 1
     RETURNING id`, [username, name, await hashPassword(password), role],
  );
  console.log(`Admin "${username}" (${role}) ready, id ${r.rows[0].id}`);
  await pool.end();
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
