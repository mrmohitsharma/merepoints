import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Db } from '../db/db.service';
import { SmsService, SMS } from '../sms/sms.service';
import { RedeemService } from '../redeem/redeem.service';
import { ExpiryService } from './expiry.service';
import { billingStateSql } from '../billing/state';

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

/**
 * Background jobs run inside the API. Each run takes a Postgres advisory lock, so with
 * several API servers only one runs a given job at a time. Off in tests; set RUN_JOBS=false
 * to disable on a server (e.g. if you move jobs to a separate worker).
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('jobs');
  private timers: NodeJS.Timeout[] = [];

  constructor(private db: Db, private sms: SmsService, private redeem: RedeemService, private expiry: ExpiryService) {}

  private jobs(): Job[] {
    return [
      { name: 'send-sms', everyMs: 15_000, run: async () => { let n = 0, sent; do { sent = await this.sms.deliverBatch(100); n += sent; } while (sent === 100 && n < 2000); return n; } },
      { name: 'escalate-redemptions', everyMs: 10 * 60_000, run: () => this.redeem.escalateStale() },
      { name: 'expire-points', everyMs: 60 * 60_000, run: () => this.expiry.run() },
      { name: 'plan-reminders', everyMs: 60 * 60_000, run: () => this.planReminders() },
      // Privacy policy: OTP records are kept for 24 hours only.
      { name: 'cleanup-otps', everyMs: 60 * 60_000, run: async () => (await this.db.pool.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '24 hours'`)).rowCount ?? 0 },
    ];
  }

  onApplicationBootstrap() {
    const enabled = process.env.RUN_JOBS ? process.env.RUN_JOBS === 'true' : process.env.NODE_ENV === 'production';
    if (!enabled) return;
    for (const j of this.jobs()) {
      const tick = () => this.runLocked(j).catch((e) => this.log.error(`${j.name}: ${e?.message ?? e}`));
      this.timers.push(setTimeout(tick, 5_000 + Math.random() * 5_000));
      this.timers.push(setInterval(tick, j.everyMs));
    }
    this.log.log('background jobs on');
  }

  onApplicationShutdown() { this.timers.forEach(clearTimeout); }

  /** Session-level advisory lock on a dedicated connection; skipped if another server holds it. */
  private async runLocked(j: Job) {
    const c = await this.db.pool.connect();
    try {
      const { rows } = await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [`job:${j.name}`]);
      if (!rows[0].ok) return;
      try { await j.run(); } finally { await c.query('SELECT pg_advisory_unlock(hashtext($1))', [`job:${j.name}`]); }
    } finally {
      c.release();
    }
  }

  /** One SMS per shop owner when a plan enters grace (once per period end). */
  async planReminders() {
    return this.db.tx(async (c) => {
      const due = (await c.query(
        `SELECT s.id, s.name, u.mobile, COALESCE(ss.current_period_end, ss.trial_ends_at) AS ends,
                COALESCE(ss.current_period_end, ss.trial_ends_at) + make_interval(days => (SELECT value::text::int FROM platform_settings WHERE key = 'grace_days')) AS grace_end
           FROM shops s JOIN shop_subscriptions ss ON ss.shop_id = s.id JOIN users u ON u.id = s.owner_user_id
          WHERE s.status = 'approved' AND ${billingStateSql('ss')} = 'grace'
            AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.shop_id = s.id AND a.action = 'billing.reminder'
                             AND a.entity_id = to_char(COALESCE(ss.current_period_end, ss.trial_ends_at), 'YYYYMMDD'))
          LIMIT 500`,
      )).rows;
      for (const d of due) {
        const by = new Date(d.grace_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
        await this.sms.enqueue(c, d.mobile, 'plan_due', SMS.planDue(String(d.name).slice(0, 30), by), null);
        await c.query(
          `INSERT INTO audit_log (shop_id, action, entity, entity_id) VALUES ($1, 'billing.reminder', 'shop', to_char($2::timestamptz, 'YYYYMMDD'))`,
          [d.id, d.ends],
        );
      }
      return due.length;
    });
  }
}
