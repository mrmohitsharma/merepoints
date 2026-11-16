import { assertLedgerInvariants, auth, bill, boot, http, login, makeAdmin, makeCustomer, makeShop, pg, shopBody, shutdown, wallet } from './helpers';

let admin: { token: string };

beforeAll(async () => {
  await boot();
  admin = await makeAdmin();
});
afterAll(async () => {
  await assertLedgerInvariants();
  await shutdown();
});

describe('login & roles', () => {
  it('OTP login, wrong code counted, role list after sign-up', async () => {
    const mobile = '9876543210';
    const otp = await http().post('/v1/auth/otp').send({ mobile: '+91 98765 43210' }).expect(201);
    await http().post('/v1/auth/verify').send({ mobile, code: otp.body.devCode === '000000' ? '111111' : '000000' }).expect(400);
    const v = await http().post('/v1/auth/verify').send({ mobile, code: otp.body.devCode }).expect(201);
    expect(v.body.user.mobile).toBe('919876543210');
    expect(v.body.roles).toEqual({ customer: false, superAdmin: false, shops: [] });
    // OTP can't be reused
    await http().post('/v1/auth/verify').send({ mobile, code: otp.body.devCode }).expect(400);
  });

  it('rejects bad mobile numbers', async () => {
    await http().post('/v1/auth/otp').send({ mobile: '12345' }).expect(400);
  });
});

describe('shop sign-up', () => {
  it('requires accurate GPS and goes to pending until admin approves', async () => {
    const o = await login();
    const bad = await http().post('/v1/shops').set(auth(o.token)).send(shopBody({ location: { lat: 28.47, lng: 77.04, accuracyM: 350 } })).expect(400);
    expect(bad.body.code).toBe('GPS_NOT_ACCURATE');
    const r = await http().post('/v1/shops').set(auth(o.token)).send(shopBody()).expect(201);
    expect(r.body.status).toBe('pending');
    const c = await makeCustomer();
    const blocked = await bill(o.token, r.body.id, c.userId, 1000);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('SHOP_NOT_APPROVED');
    // Owner can still see/edit settings while pending
    await http().get('/v1/shop/config').set(auth(o.token, r.body.id)).expect(200);
  });
});

describe('earning points from a bill', () => {
  let shop: { owner: any; shopId: number };
  let cust: { token: string; userId: number };
  beforeAll(async () => {
    shop = await makeShop(admin);
    cust = await makeCustomer();
  });

  it('₹10,000 at 5% = 500 points, worth ₹500', async () => {
    const r = await bill(shop.owner.token, shop.shopId, cust.userId, 10000, 'INV-1').expect(201);
    expect(r.body).toMatchObject({ points: 500, basePoints: 500, valueRupees: 500, balance: 500, newCustomerAtShop: true });
    expect(r.body.entryId).toMatch(/^VP-ER-[2-9A-Z]{7}$/);
  });

  it('blocks the same invoice twice (case-insensitive)', async () => {
    const r = await bill(shop.owner.token, shop.shopId, cust.userId, 2000, 'inv-1');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_INVOICE');
  });

  it('enforces minimum bill and per-bill cap', async () => {
    const small = await bill(shop.owner.token, shop.shopId, cust.userId, 499);
    expect(small.body.code).toBe('BELOW_MIN_BILL');
    const big = await bill(shop.owner.token, shop.shopId, cust.userId, 100000, 'INV-BIG').expect(201);
    expect(big.body).toMatchObject({ points: 2000, capped: true });
  });

  it('idempotency key: retry returns the same result and adds nothing', async () => {
    const before = await wallet(cust.userId, shop.shopId);
    const a = await bill(shop.owner.token, shop.shopId, cust.userId, 1000, 'INV-RETRY', 'key-abc').expect(201);
    const b = await bill(shop.owner.token, shop.shopId, cust.userId, 1000, 'INV-RETRY', 'key-abc').expect(201);
    expect(b.body.replayed).toBe(true);
    expect(b.body.entryId).toBe(a.body.entryId);
    const after = await wallet(cust.userId, shop.shopId);
    expect(Number(after.balance_points) - Number(before.balance_points)).toBe(50);
    const mismatch = await bill(shop.owner.token, shop.shopId, cust.userId, 9999, 'INV-OTHER', 'key-abc');
    expect(mismatch.body.code).toBe('IDEMPOTENCY_MISMATCH');
  });

  it('changing the % only affects new bills; old points keep their value', async () => {
    await http().put('/v1/shop/config').set(auth(shop.owner.token, shop.shopId))
      .send({ ...shopBody().loyalty, rewardPercent: 2, pointValueRupees: 0.5 }).expect(200);
    const r = await bill(shop.owner.token, shop.shopId, cust.userId, 10000, 'INV-NEWRATE').expect(201);
    expect(r.body).toMatchObject({ points: 200, valueRupees: 100 });
    const lots = (await pg.query('SELECT point_value_paise, count(*)::int n FROM point_lots WHERE customer_id = $1 AND shop_id = $2 GROUP BY 1 ORDER BY 1', [cust.userId, shop.shopId])).rows;
    expect(lots).toEqual([{ point_value_paise: 50, n: 1 }, { point_value_paise: 100, n: 3 }]);
    // restore
    await http().put('/v1/shop/config').set(auth(shop.owner.token, shop.shopId)).send(shopBody().loyalty).expect(200);
  });

  it('parallel bills from two counters never lose an update', async () => {
    const before = Number((await wallet(cust.userId, shop.shopId)).balance_points);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => bill(shop.owner.token, shop.shopId, cust.userId, 1000, `PAR-${i}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const after = Number((await wallet(cust.userId, shop.shopId)).balance_points);
    expect(after - before).toBe(12 * 50);
  });
});

describe('one offer at a time + multiplier', () => {
  let shop: { owner: any; shopId: number };
  beforeAll(async () => { shop = await makeShop(admin); });

  it('1.5x offer: ₹10,000 at 5% = 750; overlapping offer rejected; profession-only offer respected', async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    await http().post('/v1/shop/offers').set(auth(shop.owner.token, shop.shopId))
      .send({ name: 'Diwali Dhamaka', multiplier: 1.5, startsAt: iso(now - 60_000), endsAt: iso(now + 86400_000) }).expect(201);
    const overlap = await http().post('/v1/shop/offers').set(auth(shop.owner.token, shop.shopId))
      .send({ name: 'Clash', multiplier: 2, startsAt: iso(now + 3600_000), endsAt: iso(now + 2 * 86400_000) });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('OFFER_OVERLAP');
    // Back-to-back is fine ([) ranges)
    await http().post('/v1/shop/offers').set(auth(shop.owner.token, shop.shopId))
      .send({ name: 'Carpenters week', multiplier: 2, startsAt: iso(now + 86400_000), endsAt: iso(now + 3 * 86400_000), professions: ['carpenter'] }).expect(201);

    const c = await makeCustomer();
    const r = await bill(shop.owner.token, shop.shopId, c.userId, 10000, 'OFF-1').expect(201);
    expect(r.body).toMatchObject({ points: 750, basePoints: 500, rate: { multiplier: 1.5, offerName: 'Diwali Dhamaka' } });
    const offers = (await http().get('/v1/shop/offers').set(auth(shop.owner.token, shop.shopId)).expect(200)).body;
    expect(offers.find((o: any) => o.name === 'Diwali Dhamaka')).toMatchObject({ status: 'live', extra_points: 250 });
    expect(offers.find((o: any) => o.name === 'Carpenters week').status).toBe('scheduled');
  });
});

describe('manual points & staff limits', () => {
  it('staff limited to 500/day (race-safe); owner unlimited; staff without permission blocked', async () => {
    const { owner, shopId } = await makeShop(admin);
    const c = await makeCustomer();
    const staff = await login();
    await http().post('/v1/shop/staff').set(auth(owner.token, shopId)).send({ mobile: staff.mobile, name: 'Amit', canManual: true, manualDailyLimit: 500 }).expect(201);
    const send = (pts: number, tok = staff.token) => http().post('/v1/shop/points/manual').set(auth(tok, shopId)).send({ customerId: c.userId, points: pts, reason: 'festival_bonus' });

    // 5 parallel requests of 150 = 750 > 500: only 3 may pass.
    const res = await Promise.all(Array.from({ length: 5 }, () => send(150)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(3);
    expect(res.filter((r) => r.status === 403).every((r) => r.body.code === 'MANUAL_LIMIT')).toBe(true);
    await send(5000, owner.token).expect(201);

    const staff2 = await login();
    await http().post('/v1/shop/staff').set(auth(owner.token, shopId)).send({ mobile: staff2.mobile, name: 'Vikas' }).expect(201);
    const denied = await send(10, staff2.token);
    expect(denied.body.code).toBe('NO_PERMISSION');
    // staff can't open owner screens
    expect((await http().get('/v1/shop/reports/dashboard').set(auth(staff.token, shopId))).body.code).toBe('OWNER_ONLY');
  });
});

describe('reversal', () => {
  it('creator can reverse within window; frees invoice; blocked once points are used; owner after window', async () => {
    const { owner, shopId } = await makeShop(admin);
    const c = await makeCustomer();
    const staff = await login();
    await http().post('/v1/shop/staff').set(auth(owner.token, shopId)).send({ mobile: staff.mobile, name: 'Amit' }).expect(201);

    const e = await bill(staff.token, shopId, c.userId, 10000, 'REV-1').expect(201);
    const rv = await http().post(`/v1/shop/points/${e.body.entryId}/reverse`).set(auth(staff.token, shopId)).send({ reason: 'Wrong customer' }).expect(201);
    expect(rv.body.balance).toBe(0);
    await http().post(`/v1/shop/points/${e.body.entryId}/reverse`).set(auth(owner.token, shopId)).send({ reason: 'again' }).expect(409);
    await bill(staff.token, shopId, c.userId, 10000, 'REV-1').expect(201); // invoice freed

    // Window closed for staff
    const e2 = await bill(staff.token, shopId, c.userId, 12000, 'REV-2').expect(201);
    await pg.query(`UPDATE ledger_entries SET created_at = now() - interval '20 minutes' WHERE public_id = $1`, [e2.body.entryId]);
    const late = await http().post(`/v1/shop/points/${e2.body.entryId}/reverse`).set(auth(staff.token, shopId)).send({ reason: 'late' });
    expect(late.body.code).toBe('REVERSE_WINDOW_OVER');

    // Once any of the lot is redeemed it can't be reversed (customer may already have the cash)
    await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 1000 }).expect(201);
    const used = await http().post(`/v1/shop/points/${e2.body.entryId}/reverse`).set(auth(owner.token, shopId)).send({ reason: 'owner' });
    expect(used.body.code).toBe('POINTS_ALREADY_USED');
  });
});
