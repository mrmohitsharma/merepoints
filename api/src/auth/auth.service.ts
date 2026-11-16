import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';
import { config } from '../config';
import { E } from '../common/errors';
import { hmac, normalizeMobile, randomDigits, safeEqual } from '../common/util';
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

  async verifyOtp(rawMobile: string, code: string, linkToken?: string) {
    const mobile = normalizeMobile(rawMobile);
    const user = await this.db.tx(async (c) => {
      const otp = (await c.query(
        `SELECT id, code_hash, attempts, expires_at FROM otp_codes
          WHERE mobile = $1 AND purpose = 'login' AND NOT used ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [mobile],
      )).rows[0];
      if (!otp || new Date(otp.expires_at) < new Date()) throw E.bad('OTP_EXPIRED', 'OTP expired. Ask for a new one.');
      if (otp.attempts >= config.otpMaxAttempts) throw E.tooMany('Too many wrong tries. Ask for a new OTP.');
      if (!safeEqual(otp.code_hash, this.hashOtp(mobile, 'login', String(code)))) {
        await c.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
        throw E.bad('OTP_WRONG', 'Wrong OTP');
      }
      await c.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otp.id]);

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
    const g = await verifier(idToken).catch(() => null);
    if (!g) throw E.unauth('Google sign-in failed');
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
