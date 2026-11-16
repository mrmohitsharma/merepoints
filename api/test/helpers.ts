process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vyapar_test';
process.env.OTP_DEV_ECHO = 'true';

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { migrate } from '../src/db/migrate';
import { createApp } from '../src/main';

export let app: INestApplication;
export let http: () => request.Agent;
export const pg = new Pool({ connectionString: process.env.DATABASE_URL });

export async function boot() {
  await migrate(process.env.DATABASE_URL, { reset: true });
  app = await createApp();
  await app.init();
  http = () => request.agent(app.getHttpServer());
}

export async function shutdown() {
  await app?.close();
  await pg.end();
}

let mobileSeq = 6000000000;
export const nextMobile = () => String(++mobileSeq);

export async function login(mobile = nextMobile()) {
  const otp = await http().post('/v1/auth/otp').send({ mobile }).expect(201);
  const v = await http().post('/v1/auth/verify').send({ mobile, code: otp.body.devCode }).expect(201);
  return { token: v.body.token as string, userId: v.body.user.id as number, mobile };
}

export const auth = (token: string, shopId?: number) => ({
  Authorization: `Bearer ${token}`,
  ...(shopId ? { 'X-Shop-Id': String(shopId) } : {}),
});

export async function makeAdmin() {
  const a = await login();
  await pg.query('UPDATE users SET is_super_admin = TRUE WHERE id = $1', [a.userId]);
  return a;
}

export const shopBody = (over: Record<string, any> = {}) => ({
  name: 'Sharma Hardware & Ply',
  ownerName: 'Rajesh Sharma',
  categories: ['plywood', 'hardware'],
  location: { lat: 28.4721, lng: 77.0436, accuracyM: 8 },
  address: { line: 'Shop 12, Sector 14 Market', city: 'Gurugram', state: 'Haryana', pincode: '122001' },
  loyalty: { rewardPercent: 5, pointValueRupees: 1, minBillRupees: 500, maxPointsPerBill: 2000, minRedeemPoints: 500, maxRedeemPoints: 2000, expiryDays: 365 },
  ...over,
});

/** Registers + approves a shop. Returns owner session and shop id. */
export async function makeShop(admin: { token: string }, over: Record<string, any> = {}) {
  const owner = await login();
  const r = await http().post('/v1/shops').set(auth(owner.token)).send(shopBody(over)).expect(201);
  await http().post(`/v1/admin/shops/${r.body.id}/status`).set(auth(admin.token)).send({ status: 'approved' }).expect(201);
  return { owner, shopId: r.body.id as number };
}

export async function makeCustomer(over: Record<string, any> = {}) {
  const c = await login();
  await http().post('/v1/me/customer').set(auth(c.token)).send({ name: 'Ramesh Kumar', profession: 'carpenter', city: 'Gurugram', upiId: 'ramesh@ybl', ...over }).expect(201);
  return c;
}

export function bill(token: string, shopId: number, customerId: number, amountRupees: number, invoiceNo?: string, key?: string) {
  const req = http().post('/v1/shop/points/bill').set(auth(token, shopId));
  if (key) req.set('Idempotency-Key', key);
  return req.send({ customerId, amountRupees, ...(invoiceNo ? { invoiceNo } : {}) });
}

export async function wallet(customerId: number, shopId: number) {
  return (await pg.query('SELECT * FROM wallets WHERE customer_id = $1 AND shop_id = $2', [customerId, shopId])).rows[0];
}

/**
 * The core invariant: for every wallet, balance = sum of open lots, and
 * held = sum of points in open redemptions. Checked after every test file.
 */
export async function assertLedgerInvariants() {
  const bad = (await pg.query(`
    SELECT w.customer_id, w.shop_id, w.balance_points, w.held_points,
           COALESCE((SELECT sum(points_remaining) FROM point_lots l WHERE l.customer_id = w.customer_id AND l.shop_id = w.shop_id AND (l.expires_at IS NULL OR l.expires_at > now())), 0) AS lots,
           COALESCE((SELECT sum(points) FROM redemptions r WHERE r.customer_id = w.customer_id AND r.shop_id = w.shop_id AND r.status IN ('held','paid','disputed')), 0) AS open_red,
           (SELECT balance_after FROM ledger_entries le WHERE le.customer_id = w.customer_id AND le.shop_id = w.shop_id ORDER BY id DESC LIMIT 1) AS last_ledger,
           COALESCE((SELECT sum(points) FROM ledger_entries le WHERE le.customer_id = w.customer_id AND le.shop_id = w.shop_id), 0) AS ledger_sum
      FROM wallets w`)).rows.filter((r) =>
        Number(r.balance_points) !== Number(r.lots) || Number(r.held_points) !== Number(r.open_red) ||
        (r.last_ledger !== null && Number(r.last_ledger) !== Number(r.balance_points)) || Number(r.ledger_sum) !== Number(r.balance_points));
  if (bad.length) throw new Error('Ledger invariant broken: ' + JSON.stringify(bad, null, 1));
}
