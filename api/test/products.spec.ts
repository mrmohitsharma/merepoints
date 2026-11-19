import { assertLedgerInvariants, auth, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown, wallet } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(async () => { await assertLedgerInvariants(); await shutdown(); });

const redeem = (over: Record<string, unknown> = {}) => ({ kind: 'redeem', name: 'Bosch drill machine', brand: 'Bosch', category: 'Tools', mrpRupees: 3499, pointsCost: 1500, stock: 4, ...over });
const earn = (over: Record<string, unknown> = {}) => ({ kind: 'earn', name: 'Century ply 18mm', brand: 'Century', category: 'Plywood', bonusPoints: 40, unit: 'sheet', ...over });

describe('products: redeem + earn more', () => {
  test('owner adds both kinds; validation is per kind and readable', async () => {
    const { owner, shopId } = await makeShop(admin);
    const r = await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(redeem({ pointsCost: undefined })).expect(400);
    expect(r.body.message).toMatch(/points needed/i);
    const e = await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(earn({ bonusPoints: undefined })).expect(400);
    expect(e.body.message).toMatch(/bonus points/i);
    await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(redeem()).expect(201);
    await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(earn()).expect(201);
    const list = (await http().get('/v1/shop/products').set(auth(owner.token, shopId)).expect(200)).body;
    expect(list.map((p: any) => p.kind)).toEqual(['redeem', 'earn']);
    const onlyEarn = (await http().get('/v1/shop/products?kind=earn').set(auth(owner.token, shopId)).expect(200)).body;
    expect(onlyEarn).toHaveLength(1);
    // old gifts route still lists redeem items
    expect((await http().get('/v1/shop/gifts').set(auth(owner.token, shopId)).expect(200)).body).toHaveLength(1);
  });

  test('bonus at the counter: fixed, on top, outside offer multiplier and per-bill cap', async () => {
    const { owner, shopId } = await makeShop(admin, { loyalty: { rewardPercent: 5, pointValueRupees: 1, minBillRupees: 0, maxPointsPerBill: 600, minRedeemPoints: 500, expiryDays: 365 } });
    await http().post('/v1/shop/offers').set(auth(owner.token, shopId))
      .send({ name: 'Double', multiplier: 2, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
    const ply = (await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(earn()).expect(201)).body.id;
    const fevicol = (await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(earn({ name: 'Fevicol SH 5kg', bonusPoints: 60, unit: 'tin' })).expect(201)).body.id;
    const counter = (await http().get('/v1/shop/products/bonus').set(auth(owner.token, shopId)).expect(200)).body;
    expect(counter.map((p: any) => p.name).sort()).toEqual(['Century ply 18mm', 'Fevicol SH 5kg']);

    const c = await makeCustomer();
    // ₹12,000 × 5% = 600 → ×2 offer = 1200 → capped to 600. Bonus 3×40 + 2×60 = 240 on top → 840.
    const r = await http().post('/v1/shop/points/bill').set(auth(owner.token, shopId))
      .send({ customerId: c.userId, amountRupees: 12000, items: [{ productId: ply, qty: 3 }, { productId: fevicol, qty: 2 }] }).expect(201);
    expect(r.body).toMatchObject({ billPoints: 600, capped: true, bonusPoints: 240, points: 840, balance: 840 });
    expect(r.body.bonusItems).toHaveLength(2);
    const b = (await pg.query('SELECT points, bonus_points FROM bills WHERE shop_id = $1', [shopId])).rows[0];
    expect(b).toEqual({ points: 600, bonus_points: 240 });
    expect((await pg.query('SELECT sum(qty)::int AS q FROM bill_items')).rows[0].q).toBeGreaterThanOrEqual(5);
    expect(Number((await wallet(c.userId, shopId)).balance_points)).toBe(840);

    // reversing the bill takes back bill points and bonus
    await http().post(`/v1/shop/points/${r.body.entryId}/reverse`).set(auth(owner.token, shopId)).send({ reason: 'wrong customer' }).expect(201);
    expect(Number((await wallet(c.userId, shopId)).balance_points)).toBe(0);
  });

  test('bonus rejects products from another shop, redeem items, and duplicates', async () => {
    const a = await makeShop(admin);
    const b = await makeShop(admin);
    const foreign = (await http().post('/v1/shop/products').set(auth(b.owner.token, b.shopId)).send(earn()).expect(201)).body.id;
    const gift = (await http().post('/v1/shop/products').set(auth(a.owner.token, a.shopId)).send(redeem()).expect(201)).body.id;
    const mine = (await http().post('/v1/shop/products').set(auth(a.owner.token, a.shopId)).send(earn()).expect(201)).body.id;
    const c = await makeCustomer();
    const send = (items: any[]) => http().post('/v1/shop/points/bill').set(auth(a.owner.token, a.shopId)).send({ customerId: c.userId, amountRupees: 2000, items });
    expect((await send([{ productId: foreign, qty: 1 }]).expect(400)).body.code).toBe('BAD_PRODUCT');
    expect((await send([{ productId: gift, qty: 1 }]).expect(400)).body.code).toBe('BAD_PRODUCT');
    expect((await send([{ productId: mine, qty: 1 }, { productId: mine, qty: 2 }]).expect(400)).body.code).toBe('DUPLICATE_ITEM');
  });

  test('customer feed: my shops, can-take first, paging, categories, detail', async () => {
    const { owner, shopId } = await makeShop(admin, { loyalty: { rewardPercent: 5, pointValueRupees: 1, minBillRupees: 0, minRedeemPoints: 100, expiryDays: 365 } });
    const other = await makeShop(admin, { name: 'Other Ply House' });
    for (let i = 0; i < 8; i++) {
      await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(redeem({ name: `Gift ${i}`, pointsCost: 200 + i * 200, category: i % 2 ? 'Tools' : 'Home' })).expect(201);
    }
    await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(redeem({ name: 'Sold out', pointsCost: 100, stock: 0 })).expect(201);
    await http().post('/v1/shop/products').set(auth(other.owner.token, other.shopId)).send(redeem({ name: 'Not my shop' })).expect(201);

    const c = await makeCustomer();
    await http().post('/v1/shop/points/bill').set(auth(owner.token, shopId)).send({ customerId: c.userId, amountRupees: 13000 }).expect(201); // 650 pts

    const p1 = (await http().get('/v1/me/products').set(auth(c.token)).expect(200)).body;
    expect(p1.items).toHaveLength(6);
    expect(p1.next).toBe(6);
    expect(p1.items.slice(0, 3).map((i: any) => i.canTake)).toEqual([true, true, true]); // 200, 400, 600 ≤ 650
    expect(p1.items[3]).toMatchObject({ canTake: false, needMore: 150 });
    expect(p1.items.every((i: any) => i.shop.id === shopId)).toBe(true);
    expect(p1.items.find((i: any) => i.name === 'Sold out')).toBeUndefined();
    expect(p1.categories.map((x: any) => x.name).sort()).toEqual(['Home', 'Tools']);
    expect(p1.summary).toEqual({ total: 8, shops: 1, canTake: 3 });

    const p2 = (await http().get('/v1/me/products?offset=6').set(auth(c.token)).expect(200)).body;
    expect(p2.items).toHaveLength(2);
    expect(p2.next).toBeNull();
    expect(p2.categories).toBeUndefined();

    const canTake = (await http().get('/v1/me/products?canTake=true&limit=20').set(auth(c.token)).expect(200)).body;
    expect(canTake.items).toHaveLength(3);
    const tools = (await http().get('/v1/me/products?category=Tools&limit=20').set(auth(c.token)).expect(200)).body;
    expect(tools.items).toHaveLength(4);

    const d = (await http().get(`/v1/me/products/${p1.items[3].id}`).set(auth(c.token)).expect(200)).body;
    // 150 more points at 5% → ₹3,000 of shopping (rounded up to ₹100)
    expect(d).toMatchObject({ needMore: 150, shoppingForNeedRupees: 3000, shop: { id: shopId } });

    const card = (await http().get(`/v1/me/cards/${shopId}`).set(auth(c.token)).expect(200)).body;
    expect(card.products.redeem.length).toBe(8);
  });

  test('nearby scope needs location and finds shops around it', async () => {
    const { owner, shopId } = await makeShop(admin);
    await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send(earn({ name: 'Nearby ply' })).expect(201);
    const c = await makeCustomer();
    expect((await http().get('/v1/me/products?scope=nearby&kind=earn').set(auth(c.token)).expect(400)).body.code).toBe('LOCATION_NEEDED');
    const near = (await http().get('/v1/me/products?scope=nearby&kind=earn&lat=28.4725&lng=77.044&limit=60').set(auth(c.token)).expect(200)).body;
    expect(near.items.find((i: any) => i.name === 'Nearby ply')).toMatchObject({ kind: 'earn', bonusPoints: 40, unit: 'sheet' });
    const far = (await http().get('/v1/me/products?scope=nearby&kind=earn&lat=19.07&lng=72.87').set(auth(c.token)).expect(200)).body;
    expect(far.items).toHaveLength(0);
  });
});

describe('work types', () => {
  test('public list has the new types; admin can add one; unknown codes are rejected', async () => {
    const list = (await http().get('/v1/shops/professions').expect(200)).body;
    expect(list.map((p: any) => p.code)).toEqual(expect.arrayContaining(['mason', 'tile_fitter', 'pop_ceiling', 'fabricator', 'kitchen_installer', 'builder']));
    expect(list[list.length - 1].code).toBe('other');

    expect((await makeCustomer({ profession: 'mason' }))).toBeTruthy();
    const c = await (await import('./helpers')).login();
    const bad = await http().post('/v1/me/customer').set(auth(c.token)).send({ name: 'Test', profession: 'astronaut' }).expect(400);
    expect(bad.body.code).toBe('BAD_WORK_TYPE');

    await http().post('/v1/admin/professions').set(auth(admin.token)).send({ code: 'glass_fitter', name: 'Glass fitter', nameHi: 'काँच फिटर', sort: 60 }).expect(201);
    await http().post('/v1/me/customer').set(auth(c.token)).send({ name: 'Test', profession: 'glass_fitter' }).expect(201);
    const adm = (await http().get('/v1/admin/professions').set(auth(admin.token)).expect(200)).body;
    expect(adm.find((p: any) => p.code === 'glass_fitter')).toMatchObject({ customers: 1 });
    expect((await http().post('/v1/admin/professions').set(auth(admin.token)).send({ code: 'other', name: 'Other', active: false }).expect(400)).body.code).toBe('KEEP_OTHER');

    const support = await makeAdmin('support');
    await http().post('/v1/admin/professions').set(auth(support.token)).send({ code: 'x_y', name: 'XY' }).expect(403);
  });
});

describe('public pricing', () => {
  test('website can read plans without login', async () => {
    const r = (await http().get('/v1/shops/plans').expect(200)).body;
    expect(r.plans.map((p: any) => p.code)).toEqual(['basic', 'pro', 'business']);
    expect(r.plans[0].price_rupees).toBe(499);
    expect(r.trialDays).toBeGreaterThan(0);
  });
});
