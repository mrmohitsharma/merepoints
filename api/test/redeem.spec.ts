import { assertLedgerInvariants, auth, bill, boot, http, login, makeAdmin, makeCustomer, makeShop, pg, shutdown, wallet } from './helpers';

let admin: { token: string; userId: number };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(async () => { await assertLedgerInvariants(); await shutdown(); });

async function setup(loyalty?: any) {
  const s = await makeShop(admin, loyalty ? { loyalty } : {});
  const c = await makeCustomer();
  return { ...s, c };
}

describe('redeem: hold → paid → Received', () => {
  it('UPI flow with customer tapping Received', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 30000, 'R-1').expect(201); // 1500 pts

    const below = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'upi', points: 400 });
    expect(below.body.code).toBe('BELOW_MIN_REDEEM');

    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'upi', points: 1000 }).expect(201);
    expect(r.body).toMatchObject({ status: 'held', valueRupees: 1000, upiId: 'ramesh@ybl', balanceLeft: 500 });
    expect(r.body.upiIntent).toContain('upi://pay?pa=ramesh%40ybl');
    expect(Number((await wallet(c.userId, shopId)).held_points)).toBe(1000);

    // No second open redemption
    const dup = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 500 });
    expect(dup.body.code).toBe('REDEMPTION_OPEN');

    // Customer can't confirm before the shop says it paid
    const early = await http().post(`/v1/me/redemptions/${r.body.redemptionId}/received`).set(auth(c.token));
    expect(early.status).toBe(409);

    await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({ paymentRef: 'UPI 4471' }).expect(201);
    const pending = (await http().get('/v1/me/redemptions/pending').set(auth(c.token)).expect(200)).body;
    expect(pending[0]).toMatchObject({ id: r.body.redemptionId, status: 'paid' });

    const waiting = (await http().get(`/v1/shop/redemptions/${r.body.redemptionId}`).set(auth(owner.token, shopId)).expect(200)).body;
    expect(waiting).toMatchObject({ status: 'paid', customer_name: 'Ramesh Kumar', payment_ref: 'UPI 4471' });
    const done = await http().post(`/v1/me/redemptions/${r.body.redemptionId}/received`).set(auth(c.token)).expect(201);
    const after = (await http().get(`/v1/shop/redemptions/${r.body.redemptionId}`).set(auth(owner.token, shopId)).expect(200)).body;
    expect(after).toMatchObject({ status: 'confirmed', confirm_channel: 'app', balance_left: 500 });
    expect(done.body).toMatchObject({ status: 'confirmed', channel: 'app', valueRupees: 1000 });
    const w = await wallet(c.userId, shopId);
    expect([Number(w.balance_points), Number(w.held_points), Number(w.redeemed_points)]).toEqual([500, 0, 1000]);
    // Another customer can't touch it
    const other = await makeCustomer();
    expect((await http().post(`/v1/me/redemptions/${r.body.redemptionId}/received`).set(auth(other.token))).status).toBe(404);
  });

  it('no-internet path: shop enters SMS OTP; wrong code counted', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 20000, 'R-2').expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 600 }).expect(201);
    const paid = await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({}).expect(201);
    const wrong = paid.body.devOtp === '0000' ? '1111' : '0000';
    expect((await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/verify-otp`).set(auth(owner.token, shopId)).send({ code: wrong })).body.code).toBe('OTP_WRONG');
    expect((await pg.query('SELECT otp_attempts FROM redemptions WHERE public_id = $1', [r.body.redemptionId])).rows[0].otp_attempts).toBe(1);
    const ok = await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/verify-otp`).set(auth(owner.token, shopId)).send({ code: paid.body.devOtp }).expect(201);
    expect(ok.body).toMatchObject({ status: 'confirmed', channel: 'sms_otp' });
    const sms = (await pg.query(`SELECT template FROM sms_outbox WHERE template IN ('redeem_otp','redeem_done') ORDER BY id DESC LIMIT 2`)).rows.map((x) => x.template);
    expect(sms).toEqual(['redeem_done', 'redeem_otp']);
  });

  it('shop cancels before paying: exact points come back; cannot cancel after paying', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 20000, 'R-3').expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 800 }).expect(201);
    const x = await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/cancel`).set(auth(owner.token, shopId)).expect(201);
    expect(x.body).toMatchObject({ status: 'cancelled', balance: 1000 });

    const r2 = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 800 }).expect(201);
    await http().post(`/v1/shop/redemptions/${r2.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({}).expect(201);
    expect((await http().post(`/v1/shop/redemptions/${r2.body.redemptionId}/cancel`).set(auth(owner.token, shopId))).status).toBe(409);
  });

  it('Not received → disputed → admin resolves', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 20000, 'R-4').expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'upi', points: 1000 }).expect(201);
    await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({}).expect(201);
    await http().post(`/v1/me/redemptions/${r.body.redemptionId}/not-received`).set(auth(c.token)).send({ note: 'Nothing in my account' }).expect(201);
    const list = (await http().get('/v1/admin/disputes').set(auth(admin.token)).expect(200)).body;
    expect(list.find((d: any) => d.id === r.body.redemptionId)).toMatchObject({ status: 'disputed', dispute_note: 'Nothing in my account' });
    const res = await http().post(`/v1/admin/redemptions/${r.body.redemptionId}/resolve`).set(auth(admin.token)).send({ action: 'cancel', note: 'Shop could not show proof' }).expect(201);
    expect(res.body).toMatchObject({ status: 'cancelled', balance: 1000 });
  });

  it('stale paid redemptions are escalated after the timeout', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 20000, 'R-5').expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 500 }).expect(201);
    await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({}).expect(201);
    await pg.query(`UPDATE redemptions SET paid_at = now() - interval '25 hours' WHERE public_id = $1`, [r.body.redemptionId]);
    const e = await http().post('/v1/admin/jobs/escalate-redemptions').set(auth(admin.token)).expect(201);
    expect(e.body.escalated).toBeGreaterThanOrEqual(1);
    expect((await pg.query('SELECT status FROM redemptions WHERE public_id = $1', [r.body.redemptionId])).rows[0].status).toBe('disputed');
    // Customer can still confirm later
    await http().post(`/v1/me/redemptions/${r.body.redemptionId}/received`).set(auth(c.token)).expect(201);
  });

  it('value comes from the lots used (FIFO), even after the shop changes point value', async () => {
    const { owner, shopId, c } = await setup({ rewardPercent: 5, pointValueRupees: 1, minRedeemPoints: 100, expiryDays: null });
    await bill(owner.token, shopId, c.userId, 10000, 'V-1').expect(201);                     // 500 pts @ ₹1
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send({ rewardPercent: 5, pointValueRupees: 0.5, minRedeemPoints: 100, expiryDays: null }).expect(200);
    await bill(owner.token, shopId, c.userId, 10000, 'V-2').expect(201);                     // 500 pts @ ₹0.50
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 700 }).expect(201);
    expect(r.body.valueRupees).toBe(500 + 100); // 500×₹1 + 200×₹0.50
  });
});

describe('gifts', () => {
  it('gift reserves stock at hold, restores on cancel, counts given on Received; out of stock blocked', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 40000, 'G-1').expect(201); // 2000
    const g = await http().post('/v1/shop/gifts').set(auth(owner.token, shopId)).send({ name: 'Electric kettle', pointsCost: 750, stock: 1 }).expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'gift', giftId: g.body.id }).expect(201);
    expect(r.body).toMatchObject({ points: 750, gift: { name: 'Electric kettle' } });
    const c2 = await makeCustomer();
    await bill(owner.token, shopId, c2.userId, 40000, 'G-2').expect(201);
    expect((await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c2.userId, method: 'gift', giftId: g.body.id })).body.code).toBe('OUT_OF_STOCK');
    await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/cancel`).set(auth(owner.token, shopId)).expect(201);
    const r2 = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c2.userId, method: 'gift', giftId: g.body.id }).expect(201);
    await http().post(`/v1/shop/redemptions/${r2.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({}).expect(201);
    await http().post(`/v1/me/redemptions/${r2.body.redemptionId}/received`).set(auth(c2.token)).expect(201);
    const gift = (await pg.query('SELECT stock, given_count FROM gifts WHERE id = $1', [g.body.id])).rows[0];
    expect(gift).toEqual({ stock: 0, given_count: 1 });
  });
});

describe('isolation between shops', () => {
  it('points from shop A cannot be redeemed at shop B; staff of A cannot act for B', async () => {
    const A = await setup();
    const B = await makeShop(admin);
    await bill(A.owner.token, A.shopId, A.c.userId, 20000, 'ISO-1').expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(B.owner.token, B.shopId)).send({ customerId: A.c.userId, method: 'cash', points: 500 });
    expect(r.status).toBe(404);
    const x = await http().get('/v1/shop/customers').set(auth(A.owner.token, B.shopId));
    expect(x.body.code).toBe('NOT_SHOP_MEMBER');
    const list = (await http().get('/v1/shop/customers').set(auth(B.owner.token, B.shopId)).expect(200)).body;
    expect(list).toEqual([]);
  });
});

describe('concurrency on redeem', () => {
  it('10 parallel redemptions for the same points: exactly one wins', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 20000, 'C-1').expect(201); // 1000
    const res = await Promise.all(Array.from({ length: 10 }, () =>
      http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 1000 })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    const w = await wallet(c.userId, shopId);
    expect([Number(w.balance_points), Number(w.held_points)]).toEqual([0, 1000]);
  });
});

describe('expiry job', () => {
  it('expires old lots, writes ledger, never touches held points', async () => {
    const { owner, shopId, c } = await setup();
    await bill(owner.token, shopId, c.userId, 20000, 'E-1').expect(201); // 1000
    await bill(owner.token, shopId, c.userId, 12000, 'E-2').expect(201); // 600
    const r = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 600 }).expect(201);
    // Backdate everything: 400 left in lot 1 + 600 in lot 2 should expire; the 600 on hold must not.
    await pg.query(`UPDATE point_lots SET expires_at = now() - interval '1 day' WHERE customer_id = $1 AND shop_id = $2`, [c.userId, shopId]);
    const out = await http().post('/v1/admin/jobs/expire-points').set(auth(admin.token)).expect(201);
    expect(out.body.points).toBeGreaterThanOrEqual(1000);
    const w = await wallet(c.userId, shopId);
    expect([Number(w.balance_points), Number(w.held_points)]).toEqual([0, 600]);
    await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/paid`).set(auth(owner.token, shopId)).send({}).expect(201);
    await http().post(`/v1/me/redemptions/${r.body.redemptionId}/received`).set(auth(c.token)).expect(201);
  });
});
