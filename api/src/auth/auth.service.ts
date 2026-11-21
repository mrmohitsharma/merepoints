import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Db, Q } from '../db/db.service';
import { config } from '../config';
import { AppError, E } from '../common/errors';
import { hashPassword, hmac, normalizeMobile, randomDigits, safeEqual, verifyPassword } from '../common/util';
import { SMS, SmsService } from '../sms/sms.service';

@Injectable()
export class AuthService {
  constructor(private db: Db, private jwt: JwtService, private sms: SmsService) {}

  private hashOtp(mobile: string, purpose: string, code: string) {
    return hmac(config.otpSecret, `${mobile}:${purpose}:${code}`);
  }

  async requestOtp(rawMobile: string) {
    const mobile = normalizeMobile(rawMobile);
    return this.db.tx(async (c) => {
      // Serialise per mobile so the hourly limit can't be raced.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${mobile}`]);
      const { n } = (await c.query(
        `SELECT count(*)::int AS n FROM otp_codes WHERE mobile = $1 AND purpose = 'login' AND created_at > now() - interval '1 hour'`, [mobile],
      )).rows[0];
      if (n >= config.otpMaxPerHour) throw E.tooMany('Too many OTP requests. Try again in an hour.');
      const code = randomDigits(6);
      await c.query(
        `INSERT INTO otp_codes (mobile, purpose, code_hash, expires_at) VALUES ($1,'login',$2, now() + make_interval(secs => $3))`,
        [mobile, this.hashOtp(mobile, 'login', code), config.otpTtlSeconds],
      );
      await this.sms.enqueue(c, mobile, 'otp', SMS.otp(code));
      return { sent: true, expiresInSeconds: config.otpTtlSeconds, ...(config.otpDevEcho ? { devCode: code } : {}) };
    });
  }


  /** Checks the latest unused code for this mobile and purpose; wrong tries are counted, a right code is used up. */
  private async consumeOtp(c: Q, mobile: string, purpose: 'login' | 'password_reset', code: string) {
    const otp = (await c.query(
      `SELECT id, code_hash, attempts, expires_at FROM otp_codes
        WHERE mobile = $1 AND purpose = $2 AND NOT used ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [mobile, purpose],
    )).rows[0];
    if (!otp || new Date(otp.expires_at) < new Date()) throw E.bad('OTP_EXPIRED', 'Code expired. Ask for a new one.');
    if (otp.attempts >= config.otpMaxAttempts) throw E.tooMany('Too many wrong tries. Ask for a new code.');
    if (!safeEqual(otp.code_hash, this.hashOtp(mobile, purpose, String(code)))) {
      await c.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      throw E.bad('OTP_WRONG', 'Wrong code');
    }
    await c.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otp.id]);
  }

  // ------------------------------------------------------------------ email + password
  /** New email login. The mobile is verified by OTP once (points and SMS run on it), then email + password works on its own. */
  async emailSignup(b: { email: string; password: string; mobile: string; code: string; name?: string }) {
    const mobile = normalizeMobile(b.mobile);
    const email = b.email.trim().toLowerCase();
    const hash = await hashPassword(b.password);
    const id = await this.db.tx(async (c) => {
      await this.consumeOtp(c, mobile, 'login', b.code);
      const taken = (await c.query('SELECT 1 FROM users WHERE email = $1 AND mobile <> $2 AND deleted_at IS NULL', [email, mobile])).rows[0];
      if (taken) throw E.conflict('EMAIL_TAKEN', 'This email is already registered. Log in instead.');
      const ex = (await c.query('SELECT id, email, password_hash FROM users WHERE mobile = $1 FOR UPDATE', [mobile])).rows[0];
      if (ex?.password_hash) throw E.conflict('ACCOUNT_EXISTS', 'This mobile already has an email login. Log in, or tap Forgot password.');
      if (ex?.email && String(ex.email).toLowerCase() !== email) throw E.conflict('EMAIL_MISMATCH', 'This mobile is already linked to another email. Log in with that email.');
      const u = (await c.query(
        `INSERT INTO users (mobile, email, name, password_hash) VALUES ($1,$2,$3,$4)
         ON CONFLICT (mobile) DO UPDATE SET email = COALESCE(users.email, EXCLUDED.email), name = COALESCE(users.name, EXCLUDED.name), password_hash = EXCLUDED.password_hash
         RETURNING id`, [mobile, email, b.name ?? null, hash],
      )).rows[0];
      return u.id as number;
    });
    return this.session(id);
  }

  async emailLogin(b: { email: string; password: string }) {
    const email = b.email.trim().toLowerCase();
    const bad = () => E.unauth('Wrong email or password. If you never set a password, tap Forgot password.');
    const u = await this.db.one('SELECT id, password_hash, failed_logins, locked_until FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    if (!u) {
      await verifyPassword(b.password, null); // same effort whether or not the email exists
      throw bad();
    }
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
      throw E.tooMany(`Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`);
    }
    if (!(await verifyPassword(b.password, u.password_hash))) {
      await this.db.pool.query(
        `UPDATE users SET failed_logins = CASE WHEN $2::int >= $3::int THEN 0 ELSE $2::int END,
                          locked_until = CASE WHEN $2::int >= $3::int THEN now() + make_interval(mins => $4::int) ELSE locked_until END
          WHERE id = $1`,
        [u.id, u.failed_logins + 1, config.loginMaxFails, config.loginLockMinutes],
      );
      throw bad();
    }
    await this.db.pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
    return this.session(u.id);
  }

  /** Sends a reset code by SMS to the mobile on the account. The answer is the same whether or not the email exists. */
  async forgotPassword(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const u = await this.db.one('SELECT id, mobile FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    if (!u) return { sent: true, expiresInSeconds: config.otpTtlSeconds };
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`otp:${u.mobile}`]);
      const { n } = (await c.query(`SELECT count(*)::int AS n FROM otp_codes WHERE mobile = $1 AND purpose = 'password_reset' AND created_at > now() - interval '1 hour'`, [u.mobile])).rows[0];
      if (n >= config.otpMaxPerHour) throw E.tooMany('Too many reset requests. Try again in an hour.');
      const code = randomDigits(6);
      await c.query(`INSERT INTO otp_codes (mobile, purpose, code_hash, expires_at) VALUES ($1,'password_reset',$2, now() + make_interval(secs => $3))`,
        [u.mobile, this.hashOtp(u.mobile, 'password_reset', code), config.otpTtlSeconds]);
      await this.sms.enqueue(c, u.mobile, 'password_reset', SMS.passwordReset(code));
      return { sent: true, expiresInSeconds: config.otpTtlSeconds, ...(config.otpDevEcho ? { devCode: code } : {}) };
    });
  }

  async resetPassword(b: { email: string; code: string; password: string }) {
    const email = b.email.trim().toLowerCase();
    const hash = await hashPassword(b.password);
    const id = await this.db.tx(async (c) => {
      const u = (await c.query('SELECT id, mobile FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE', [email])).rows[0];
      if (!u) throw E.bad('OTP_WRONG', 'Wrong code');
      await this.consumeOtp(c, u.mobile, 'password_reset', b.code);
      await c.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id, hash]);
      return u.id as number;
    });
    return this.session(id);
  }

  async verifyOtp(rawMobile: string, code: string, linkToken?: string) {
    const mobile = normalizeMobile(rawMobile);
    const user = await this.db.tx(async (c) => {
      await this.consumeOtp(c, mobile, 'login', code);

      let google: { sub: string; email?: string; name?: string } | null = null;
      if (linkToken) {
        const p: any = await this.jwt.verifyAsync(linkToken).catch(() => null);
        if (!p || p.kind !== 'google_link') throw E.bad('LINK_EXPIRED', 'Google sign-in expired. Try again.');
        google = { sub: p.gsub, email: p.email, name: p.name };
      }
      const u = (await c.query(
        `INSERT INTO users (mobile, google_sub, email, name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (mobile) DO UPDATE SET
           google_sub = COALESCE(users.google_sub, EXCLUDED.google_sub),
           email      = COALESCE(users.email, EXCLUDED.email),
           name       = COALESCE(users.name, EXCLUDED.name)
         RETURNING id`,
        [mobile, google?.sub ?? null, google?.email ?? null, google?.name ?? null],
      )).rows[0];
      return u.id as number;
    });
    return this.session(user);
  }

  /**
   * Google sign-in. idToken must be verified against Google's public keys
   * (google-auth-library OAuth2Client.verifyIdToken) — injected as `verifier` so tests can stub it.
   * If the Google account is already linked we log in; otherwise the app must verify a mobile once.
   */
  async google(idToken: string, verifier: (t: string) => Promise<{ sub: string; email?: string; name?: string }>) {
    const g = await verifier(idToken).catch((e) => { if (e instanceof AppError) throw e; return null; });
    if (!g) throw E.bad('GOOGLE_FAILED', 'Google sign-in failed. Please try again.');
    const u = await this.db.one('SELECT id FROM users WHERE google_sub = $1', [g.sub]);
    if (u) return this.session(u.id);
    const linkToken = await this.jwt.signAsync({ kind: 'google_link', gsub: g.sub, email: g.email, name: g.name }, { expiresIn: '15m' });
    return { needsMobile: true, linkToken, email: g.email, name: g.name };
  }

  /** Everything the app needs to show the role switch after login. */
  async session(userId: number) {
    const token = await this.jwt.signAsync({ sub: userId, kind: 'access' });
    return { token, ...(await this.me(userId)) };
  }

  async me(userId: number) {
    const u = await this.db.one(
      `SELECT u.id, u.mobile, u.name, u.email, u.is_super_admin, c.user_id IS NOT NULL AS is_customer, c.language
         FROM users u LEFT JOIN customers c ON c.user_id = u.id WHERE u.id = $1`, [userId],
    );
    if (!u) throw E.unauth();
    const shops = await this.db.many(
      `SELECT s.id, s.name, s.logo_url, s.status, m.role
         FROM shop_members m JOIN shops s ON s.id = m.shop_id
        WHERE m.user_id = $1 AND m.active ORDER BY m.role, s.name`, [userId],
    );
    return {
      user: { id: u.id, mobile: u.mobile, name: u.name, email: u.email, language: u.language ?? 'en' },
      roles: { customer: u.is_customer, superAdmin: u.is_super_admin, shops },
    };
  }
}
