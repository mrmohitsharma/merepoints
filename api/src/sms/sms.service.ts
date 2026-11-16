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
  shopApproved: (shop: string, days: number) =>
    `${shop} is live on Vyapar Point. Free trial for ${days} days. Start adding points to your customers now. -Vyapar Point`,
  shopReactivated: (shop: string) => `${shop} is active again on Vyapar Point. You can add points and pay out as usual. -Vyapar Point`,
  shopRejected: () => `Your Vyapar Point shop registration needs changes. Open the app to see the reason. -Vyapar Point`,
  shopSuspended: () => `Your Vyapar Point shop is suspended. Open the app or call support to know more. -Vyapar Point`,
  planDue: (shop: string, date: string) =>
    `${shop}: your Vyapar Point plan has ended. Renew by ${date} to keep adding points. -Vyapar Point`,
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
