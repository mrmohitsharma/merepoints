import { Injectable, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';
import { AppError, E } from '../common/errors';
import { AdminRole } from '../common/auth';
import { assertStrongPassword, hashPassword, verifyPassword } from '../common/password';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const ADMIN_TOKEN_TTL = '12h';
// Same work as a real check, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

@Injectable()
export class AdminAuthService implements OnModuleInit {
  constructor(private db: Db, private jwt: JwtService) {}

  /** First deploy: ADMIN_BOOTSTRAP_USERNAME/PASSWORD create the first owner if there is no admin yet. */
  async onModuleInit() {
    const u = process.env.ADMIN_BOOTSTRAP_USERNAME, p = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!u || !p) return;
    const exists = await this.db.one('SELECT 1 FROM admin_users LIMIT 1').catch(() => null);
    if (exists) return;
    await this.create(null, { username: u, name: process.env.ADMIN_BOOTSTRAP_NAME ?? u, password: p, role: 'owner' }).catch(() => undefined);
  }

  private token(a: { id: number; pwv: number }) {
    return this.jwt.signAsync({ sub: a.id, kind: 'admin', pwv: Number(a.pwv) }, { expiresIn: ADMIN_TOKEN_TTL });
  }

  async login(username: string, password: string, ip?: string) {
    const a = await this.db.one(
      `SELECT id, username, name, role, active, password_hash, failed_attempts, locked_until, must_change_password,
              token_version AS pwv
         FROM admin_users WHERE username = $1`, [username.trim()],
    );
    if (a?.locked_until && new Date(a.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(a.locked_until).getTime() - Date.now()) / 60000);
      throw new AppError(423, 'ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${mins} minute${mins > 1 ? 's' : ''}, or ask the owner to reset it.`);
    }
    const ok = await verifyPassword(password, a?.password_hash ?? DUMMY_HASH);
    if (!a || !ok || !a.active) {
      if (a) {
        await this.db.pool.query(
          // 5th wrong try locks for 15 minutes and resets the counter for after the lock.
          `UPDATE admin_users SET
                  locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) END,
                  failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END
            WHERE id = $1`,
          [a.id, MAX_ATTEMPTS, LOCK_MINUTES],
        );
        await this.audit(a.id, 'admin.login_failed', { ip });
      }
      throw E.unauth('Wrong username or password');
    }
    await this.db.pool.query('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [a.id]);
    await this.audit(a.id, 'admin.login', { ip });
    return { token: await this.token(a), admin: this.present(a) };
  }

  async me(id: number) {
    const a = await this.db.one('SELECT id, username, name, role, must_change_password FROM admin_users WHERE id = $1', [id]);
    if (!a) throw E.notFound('Admin');
    return this.present(a);
  }

  async changePassword(id: number, current: string, next: string) {
    const a = await this.db.one('SELECT password_hash FROM admin_users WHERE id = $1', [id]);
    if (!a || !(await verifyPassword(current, a.password_hash))) throw E.bad('WRONG_PASSWORD', 'Current password is wrong');
    if (current === next) throw E.bad('SAME_PASSWORD', 'Choose a new password, different from the current one');
    assertStrongPassword(next);
    const r = await this.db.one(
      `UPDATE admin_users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now(), token_version = token_version + 1
        WHERE id = $1 RETURNING id, token_version AS pwv`, [id, await hashPassword(next)],
    );
    await this.audit(id, 'admin.password_changed', null);
    // Old tokens stop working; hand back a fresh one.
    return { token: await this.token(r!) };
  }

  // ---------------------------------------------------------------- team management (owner only)
  list() {
    return this.db.many(
      `SELECT id, username, name, role, active, must_change_password, last_login_at, created_at,
              (locked_until > now()) AS locked
         FROM admin_users ORDER BY active DESC, role, name`,
    );
  }

  async create(byId: number | null, b: { username: string; name: string; password: string; role: AdminRole }) {
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(b.username)) throw E.bad('BAD_USERNAME', 'Username: 3–30 letters, numbers, dot, dash or underscore');
    assertStrongPassword(b.password);
    const r = await this.db.one(
      `INSERT INTO admin_users (username, name, password_hash, role, created_by, must_change_password)
       VALUES ($1,$2,$3,$4::admin_role,$5,$6)
       ON CONFLICT (username) DO NOTHING RETURNING id`,
      [b.username, b.name, await hashPassword(b.password), b.role, byId, byId !== null],
    );
    if (!r) throw E.conflict('USERNAME_TAKEN', 'This username is already used');
    if (byId) await this.audit(byId, 'admin.create', { id: r.id, username: b.username, role: b.role });
    return { id: r.id };
  }

  async update(byId: number, id: number, b: { name?: string; role?: AdminRole; active?: boolean }) {
    if (id === byId && (b.active === false || (b.role && b.role !== 'owner'))) {
      throw E.bad('SELF_CHANGE', 'You cannot remove your own owner access. Ask another owner.');
    }
    return this.db.tx(async (c) => {
      const r = (await c.query(
        `UPDATE admin_users SET name = COALESCE($2, name), role = COALESCE($3::admin_role, role), active = COALESCE($4, active),
                token_version = CASE WHEN $4 = FALSE THEN token_version + 1 ELSE token_version END
          WHERE id = $1 RETURNING id`, [id, b.name ?? null, b.role ?? null, b.active ?? null],
      )).rows[0];
      if (!r) throw E.notFound('Admin');
      const owners = (await c.query(`SELECT count(*)::int AS n FROM admin_users WHERE role = 'owner' AND active`)).rows[0].n;
      if (owners === 0) throw E.bad('LAST_OWNER', 'There must be at least one active owner');
      await c.query(`INSERT INTO audit_log (admin_id, action, entity, entity_id, details) VALUES ($1,'admin.update','admin',$2,$3)`, [byId, id, JSON.stringify(b)]);
      return { ok: true };
    });
  }

  /** Sets a temporary password; the admin must change it at next login. Unlocks the account. */
  async resetPassword(byId: number, id: number, temp: string) {
    assertStrongPassword(temp);
    const r = await this.db.one(
      `UPDATE admin_users SET password_hash = $2, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL, password_changed_at = now(), token_version = token_version + 1
        WHERE id = $1 RETURNING id`, [id, await hashPassword(temp)],
    );
    if (!r) throw E.notFound('Admin');
    await this.audit(byId, 'admin.password_reset', { id });
    return { ok: true };
  }

  private present(a: any) {
    return { id: a.id, username: a.username, name: a.name, role: a.role as AdminRole, mustChangePassword: a.must_change_password };
  }

  private async audit(adminId: number, action: string, details: unknown) {
    await this.db.pool.query(
      `INSERT INTO audit_log (admin_id, action, entity, entity_id, details) VALUES ($1,$2,'admin',$3,$4)`,
      [adminId, action, String(adminId), details == null ? null : JSON.stringify(details)],
    );
  }
}
