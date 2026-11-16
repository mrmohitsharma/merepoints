import { Injectable } from '@nestjs/common';
import { Db, Q } from '../db/db.service';
import { E } from '../common/errors';

/** SMS templates. Keep each under 160 characters after filling in values (DLT-registered in production). */
export const SMS = {
  otp: (code: string) => `${code} is your Vyapar Point code. Valid 5 min. Do not share it. -Vyapar Point`,
  earned: (shop: string, pts: number, bal: number) =>
    `${shop}: +${pts} points added. Balance with them: ${bal} pts. Not you? Reply HELP. -Vyapar Point`,
  redeemOtp: (shop: string, pts: number, rupees: string, code: string) =>
    `Got Rs ${rupees} from ${shop} for ${pts} pts? Tap Received in app or tell them code ${code}. -Vyapar Point`,
  redeemDone: (shop: string, pts: number, rupees: string, ref: string) =>
    `${shop}: ${pts} pts redeemed for Rs ${rupees}. Ref ${ref}. -Vyapar Point`,
  invite: (shop: string, pts: number) =>
    `${shop} gave you ${pts} points on Vyapar Point. Get the app to see and use them: vyp.in/app -Vyapar Point`,
};

@Injectable()
export class SmsService {
  constructor(private db: Db) {}

  /** Writes to the outbox inside the caller's transaction. A worker delivers it. */
  async enqueue(q: Q, mobile: string, template: string, body: string, shopId: number | null = null) {
    if (body.length > 160) throw E.bad('SMS_TOO_LONG', 'Message is longer than one SMS (160 characters)');
    await q.query('INSERT INTO sms_outbox (mobile, template, body, shop_id) VALUES ($1,$2,$3,$4)', [mobile, template, body, shopId]);
  }

  /**
   * Worker: claims queued rows with SKIP LOCKED so several workers can run safely.
   * Provider call is a stub here; plug in MSG91/Gupshup/Kaleyra with DLT template ids.
   */
  async deliverBatch(limit = 100): Promise<number> {
    return this.db.tx(async (c) => {
      const rows = (await c.query(
        `SELECT id, mobile, body FROM sms_outbox WHERE status = 'queued' ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit],
      )).rows;
      for (const r of rows) {
        // await provider.send(r.mobile, r.body)
        await c.query(`UPDATE sms_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [r.id]);
      }
      return rows.length;
    });
  }
}
