import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

const SLABS = [{ fromRupees: 0, percent: 2 }, { fromRupees: 10000, percent: 5 }, { fromRupees: 20000, percent: 7 }];
const rules = (over: Record<string, unknown> = {}) => ({
  pointValueRupees: 1, minBillRupees: 0, minRedeemPoints: 500, expiryDays: 365, rewardSlabs: SLABS, ...over,
});

describe('reward slabs by bill amount', () => {
  test('the slab a bill falls in sets the % for the whole bill', async () => {
    const { owner, shopId } = await makeShop(admin);
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules()).expect(200);
    const c = await makeCustomer();
    const cases: [number, number, number][] = [
      [5000, 100, 2],     // below ₹10,000: 2%
      [9999, 199, 2],
      [10000, 500, 5],    // ₹10,000 exactly: next slab
      [15000, 750, 5],
      [20000, 1400, 7],
      [50000, 3500, 7],   // last slab has no upper end
    ];
    for (const [amount, points, pct] of cases) {
      const r = await bill(owner.token, shopId, c.userId, amount).expect(201);
      expect([amount, r.body.points, r.body.rate.rewardPercent]).toEqual([amount, points, pct]);
    }
    const stored = (await pg.query('SELECT amount_paise, reward_bps FROM bills WHERE shop_id = $1 ORDER BY id', [shopId])).rows;
    expect(stored.map((b) => b.reward_bps)).toEqual([200, 200, 500, 500, 700, 700]);
  });

  test('offers multiply and the per-bill cap still applies on top of slabs', async () => {
    const { owner, shopId } = await makeShop(admin);
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules({ maxPointsPerBill: 2000 })).expect(200);
    await http().post('/v1/shop/offers').set(auth(owner.token, shopId))
      .send({ name: 'Double', multiplier: 2, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
    const c = await makeCustomer();
    expect((await bill(owner.token, shopId, c.userId, 15000).expect(201)).body).toMatchObject({ basePoints: 750, points: 1500, capped: false });
    expect((await bill(owner.token, shopId, c.userId, 20000).expect(201)).body).toMatchObject({ basePoints: 1400, points: 2000, capped: true });
  });

  test('config is shown back with slabs; customers see them on the shop profile', async () => {
    const { owner, shopId } = await makeShop(admin);
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules()).expect(200);
    const shop = (await http().get('/v1/shop').set(auth(owner.token, shopId)).expect(200)).body;
    expect(shop.loyalty.rewardSlabs).toEqual(SLABS);
    expect(shop.loyalty.rewardPercent).toBe(2);
    const c = await makeCustomer();
    const pub = (await http().get(`/v1/discover/shops/${shopId}`).set(auth(c.token)).expect(200)).body;
    expect(pub.rewardSlabs).toEqual(SLABS);
    expect(pub.example).toEqual({ billRupees: 10000, points: 500, worthRupees: 500 });
    expect(pub.reward_slabs).toBeUndefined();
  });

  test('changing back to a flat % works; old bills keep the % they earned', async () => {
    const { owner, shopId } = await makeShop(admin);
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules()).expect(200);
    const c = await makeCustomer();
    await bill(owner.token, shopId, c.userId, 15000).expect(201);
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules({ rewardSlabs: null, rewardPercent: 3 })).expect(200);
    expect((await bill(owner.token, shopId, c.userId, 15000).expect(201)).body.points).toBe(450);
    const stored = (await pg.query('SELECT reward_bps FROM bills WHERE shop_id = $1 ORDER BY id', [shopId])).rows;
    expect(stored.map((b) => b.reward_bps)).toEqual([500, 300]);
  });

  test('bad ranges are refused with a clear message', async () => {
    const { owner, shopId } = await makeShop(admin);
    const put = (rewardSlabs: unknown) => http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules({ rewardSlabs }));
    expect((await put([{ fromRupees: 500, percent: 2 }, { fromRupees: 10000, percent: 5 }]).expect(400)).body.message).toMatch(/start at ₹0/);
    expect((await put([{ fromRupees: 0, percent: 2 }, { fromRupees: 10000, percent: 5 }, { fromRupees: 8000, percent: 7 }]).expect(400)).body.message).toMatch(/start above/);
    await put([{ fromRupees: 0, percent: 2 }]).expect(400);
    await put([{ fromRupees: 0, percent: 2 }, { fromRupees: 10000, percent: 80 }]).expect(400);
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send(rules({ rewardSlabs: null })).expect(400); // neither slabs nor %
  });

  test('shop sign-up can set slabs straight away', async () => {
    const { shopBody, login } = await import('./helpers');
    const o = await login();
    const body = shopBody();
    (body as any).loyalty = rules();
    const r = await http().post('/v1/shops').set(auth(o.token)).send(body).expect(201);
    const cfg = (await pg.query('SELECT lc.reward_slabs FROM shops s JOIN loyalty_configs lc ON lc.id = s.current_config_id WHERE s.id = $1', [r.body.id])).rows[0];
    expect(cfg.reward_slabs).toEqual([{ from_paise: 0, bps: 200 }, { from_paise: 1000000, bps: 500 }, { from_paise: 2000000, bps: 700 }]);
  });
});
