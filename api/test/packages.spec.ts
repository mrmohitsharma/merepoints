import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, setPlan, shutdown } from './helpers';

let admin: Awaited<ReturnType<typeof makeAdmin>>;
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const notify = (A: { owner: { token: string }; shopId: number }) =>
  http().post('/v1/shop/notifications').set(auth(A.owner.token, A.shopId)).send({ title: 'Offer', body: 'Namaste {name}' });
const product = (A: { owner: { token: string }; shopId: number }, n: number) =>
  http().post('/v1/shop/products').set(auth(A.owner.token, A.shopId)).send({ kind: 'earn', name: `Ply ${n}`, bonusPoints: 10, unit: 'sheet' });
const buyPack = async (A: { owner: { token: string }; shopId: number }, packCode: string) => {
  const o = await http().post('/v1/shop/billing/orders').set(auth(A.owner.token, A.shopId)).send({ kind: 'addon', packCode }).expect(201);
  await http().post('/v1/shop/billing/verify').set(auth(A.owner.token, A.shopId)).send({ orderId: o.body.orderId, signature: 'test' }).expect(201);
};

describe('package features', () => {
  test('Basic has none of the paid features; Business has some; Advanced has all', async () => {
    const basic = await makeShop(admin, {}, { plan: 'basic' });
    const biz = await makeShop(admin, {}, { plan: 'business' });
    const c = await makeCustomer();
    for (const [method, path] of [['get', 'reports/daily'], ['get', 'staff'], ['get', 'notifications'], ['get', 'ads'], ['get', 'dues/customers'], ['get', 'config/history']] as const) {
      const r = await http()[method](`/v1/shop/${path}`).set(auth(basic.owner.token, basic.shopId));
      expect([path, r.status, r.body.code]).toEqual([path, 402, 'FEATURE_LOCKED']);
    }
    // Business: dues + products + offers yes, reports + notifications no
    await http().get('/v1/shop/dues/customers').set(auth(biz.owner.token, biz.shopId)).expect(200);
    await product(biz, 1).expect(201);
    expect((await http().get('/v1/shop/reports/daily').set(auth(biz.owner.token, biz.shopId))).body.code).toBe('FEATURE_LOCKED');
    expect((await notify(biz)).body.code).toBe('FEATURE_LOCKED');
    // Basic still does the core job
    await bill(basic.owner.token, basic.shopId, c.userId, 10000).expect(201);
    // bill photos are a Business feature
    const photo = await http().post('/v1/shop/points/bill').set(auth(basic.owner.token, basic.shopId)).send({ customerId: c.userId, amountRupees: 1000, photoUrls: ['https://x.test/a.jpg'] });
    expect(photo.body.code).toBe('FEATURE_LOCKED');
  });

  test('admin edits a package: ticking a feature switches it on for shops on that package', async () => {
    const A = await makeShop(admin, {}, { plan: 'business' });
    expect((await http().get('/v1/shop/reports/daily').set(auth(A.owner.token, A.shopId))).status).toBe(402);
    const plans = (await http().get('/v1/admin/plans').set(auth(admin.token)).expect(200)).body;
    const biz = plans.plans.find((p: any) => p.code === 'business');
    expect(plans.featureCatalogue.map((f: any) => f.key)).toContain('reports');
    const body = { id: biz.id, code: 'business', name: 'Business', priceRupees: 999, yearlyPriceRupees: 9990, maxStaff: 0, featureKeys: [...biz.feature_keys, 'reports'],
      limits: { notifications: biz.limit_notifications, products: biz.limit_products, offers: biz.limit_offers, ads: biz.limit_ads }, sort: 2 };
    try {
      await http().post('/v1/admin/plans').set(auth(admin.token)).send(body).expect(201);
      await http().get('/v1/shop/reports/daily').set(auth(A.owner.token, A.shopId)).expect(200);
      await http().post('/v1/admin/plans').set(auth(admin.token)).send({ ...body, featureKeys: ['nonsense'] }).expect(400);
    } finally {
      await http().post('/v1/admin/plans').set(auth(admin.token)).send({ ...body, featureKeys: biz.feature_keys }).expect(201);
    }
    expect((await http().get('/v1/shop/reports/daily').set(auth(A.owner.token, A.shopId))).status).toBe(402);
    // only the owner admin role edits packages
    const ops = await makeAdmin('ops');
    await http().post('/v1/admin/plans').set(auth(ops.token)).send(body).expect(403);
  });

  test('super admin can override one shop: extra feature, lower limit', async () => {
    const A = await makeShop(admin, {}, { plan: 'basic' });
    expect((await http().get('/v1/shop/reports/daily').set(auth(A.owner.token, A.shopId))).status).toBe(402);
    await http().put(`/v1/admin/shops/${A.shopId}/overrides`).set(auth(admin.token)).send({ featuresAdd: ['reports'], limits: { products: 1 } }).expect(200);
    await http().get('/v1/shop/reports/daily').set(auth(A.owner.token, A.shopId)).expect(200);
    const b = (await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body;
    expect(b.features).toContain('reports');
    await http().put(`/v1/admin/shops/${A.shopId}/overrides`).set(auth(admin.token)).send({ featuresAdd: ['bogus'] }).expect(400);
    await http().put(`/v1/admin/shops/${A.shopId}/overrides`).set(auth(admin.token)).send({}).expect(200);
    expect((await http().get('/v1/shop/reports/daily').set(auth(A.owner.token, A.shopId))).status).toBe(402);
  });
});

describe('limits and extra packs', () => {
  test('notifications: monthly quota, then a bought pack, then blocked again', async () => {
    const A = await makeShop(admin, {}, { plan: 'advanced' });
    await setPlan(A.shopId, 'advanced', { limits: { notifications: 2, ads: 0 } });
    const c = await makeCustomer();
    await bill(A.owner.token, A.shopId, c.userId, 10000).expect(201);
    await notify(A).expect(201);
    await notify(A).expect(201);
    const over = await notify(A);
    expect([over.status, over.body.code]).toEqual([402, 'LIMIT_REACHED']);
    expect((await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body.usage.notifications).toBe(2);

    await buyPack(A, 'notif100');
    expect((await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body.extras.notifications).toBe(100);
    await notify(A).expect(201);
    expect((await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body.extras.notifications).toBe(99);
    // payment reminders from the dues book never use the quota
    await http().post('/v1/shop/dues').set(auth(A.owner.token, A.shopId)).send({ customerId: c.userId, amountRupees: 500 }).expect(201);
    await http().post(`/v1/shop/dues/customer/${c.userId}/remind`).set(auth(A.owner.token, A.shopId)).expect(201);
  });

  test('extra packs expire with the package period they were bought in', async () => {
    const A = await makeShop(admin, {}, { plan: 'advanced' });
    await setPlan(A.shopId, 'advanced', { limits: { notifications: 0, ads: 0 } });
    await buyPack(A, 'notif100');
    expect((await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body.extras.notifications).toBe(100);
    await pg.query(`UPDATE shop_addon_credits SET expires_at = now() - interval '1 day' WHERE shop_id = $1`, [A.shopId]);
    expect((await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body.extras.notifications).toBe(0);
  });

  test('products: package cap, then extra product pack raises it', async () => {
    const A = await makeShop(admin, {}, { plan: 'advanced' });
    await setPlan(A.shopId, 'advanced', { limits: { products: 2, ads: 0 } });
    await product(A, 1).expect(201);
    await product(A, 2).expect(201);
    expect((await product(A, 3)).body.code).toBe('LIMIT_REACHED');
    await buyPack(A, 'prod50');
    await product(A, 3).expect(201);
  });

  test('offers: running-offer cap, extra offer pack raises it', async () => {
    const A = await makeShop(admin, {}, { plan: 'advanced' });
    await setPlan(A.shopId, 'advanced', { limits: { offers: 1, ads: 0 } });
    const offer = (i: number) => http().post('/v1/shop/offers').set(auth(A.owner.token, A.shopId))
      .send({ name: `O${i}`, multiplier: 1.5, startsAt: iso(now + i * 10 * 86400_000), endsAt: iso(now + i * 10 * 86400_000 + 86400_000) });
    await offer(1).expect(201);
    expect((await offer(2)).body.code).toBe('LIMIT_REACHED');
    await buyPack(A, 'offer5');
    await offer(2).expect(201);
  });

  test('ads: ads inside the package quota are free, extra ones are paid', async () => {
    const A = await makeShop(admin, {}, { plan: 'advanced' });
    await setPlan(A.shopId, 'advanced', { limits: { ads: 1 } });
    const d = new Date(Date.now() + 86400_000);
    const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    const ad = () => http().post('/v1/shop/ads').set(auth(A.owner.token, A.shopId))
      .send({ title: 'Sale on ply', bgColor: '#C2410C', packCode: 'ad7', startDate, link: { kind: 'shop' } });
    const first = (await ad().expect(201)).body;
    expect(first).toMatchObject({ amountRupees: 0, needsPayment: false, includedInPackage: true });
    const second = (await ad().expect(201)).body;
    expect(second).toMatchObject({ amountRupees: 499, needsPayment: true });
    expect((await http().get('/v1/shop/billing').set(auth(A.owner.token, A.shopId))).body.usage.ads).toBe(2);
  });

  test('extra packs need a paid package; unlimited (null) limits never block', async () => {
    const free = await makeShop(admin, {}, { plan: null });
    const r = await http().post('/v1/shop/billing/orders').set(auth(free.owner.token, free.shopId)).send({ kind: 'addon', packCode: 'notif100' });
    expect([r.status, r.body.code]).toEqual([402, 'PLAN_REQUIRED']);
    const A = await makeShop(admin, {}, { plan: 'advanced' });
    await setPlan(A.shopId, 'advanced', { limits: { notifications: null, ads: 0 } });
    const c = await makeCustomer();
    await bill(A.owner.token, A.shopId, c.userId, 10000).expect(201);
    for (let i = 0; i < 3; i++) await notify(A).expect(201);
  });
});
