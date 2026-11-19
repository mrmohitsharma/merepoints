import { auth, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { process.env.PAYMENTS_TEST_MODE = 'true'; await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const adminAd = (over: Record<string, unknown> = {}) => ({
  title: 'Century Ply — 2x points', subtitle: 'At your nearby shops', bgColor: '#1F6FEB',
  advertiserKind: 'brand', advertiserName: 'Century Ply', link: { kind: 'none' }, target: { mode: 'all' },
  startsAt: iso(now - 60_000), endsAt: iso(now + 7 * 86_400_000), sort: 10, ...over,
});
const home = (token: string, q = '') => http().get(`/v1/me/home${q}`).set(auth(token)).expect(200).then((r) => r.body.ads);
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe('home carousel ads', () => {
  test('admin ad reaches everyone; no "ad" label in payload; order follows sort', async () => {
    const a1 = (await http().post('/v1/admin/ads').set(auth(admin.token)).send(adminAd({ sort: 20, title: 'Second' })).expect(201)).body.id;
    const a2 = (await http().post('/v1/admin/ads').set(auth(admin.token)).send(adminAd({ sort: 5, title: 'First', advertiserKind: 'own', advertiserName: 'Vyapar Point' })).expect(201)).body.id;
    await http().post('/v1/admin/ads').set(auth(admin.token)).send(adminAd({ title: 'Future', startsAt: iso(now + 86_400_000), endsAt: iso(now + 2 * 86_400_000) })).expect(201);
    const c = await makeCustomer();
    const ads = await home(c.token);
    expect(ads.map((a: any) => a.id)).toEqual([a2, a1]);
    expect(Object.keys(ads[0])).not.toContain('advertiser');
    const counts = (await http().get('/v1/admin/ads/counts').set(auth(admin.token)).expect(200)).body;
    expect(counts).toMatchObject({ live: 2, scheduled: 1 });
    await http().post(`/v1/admin/ads/${a1}/pause`).set(auth(admin.token)).send({ paused: true }).expect(201);
    expect((await home(c.token)).map((a: any) => a.id)).toEqual([a2]);
    await http().post(`/v1/admin/ads/${a1}/pause`).set(auth(admin.token)).send({ paused: false }).expect(201);
    await pg.query(`UPDATE ads SET status = 'paused'`); // keep later tests clean
  });

  test('targeting by city and work type', async () => {
    const id = (await http().post('/v1/admin/ads').set(auth(admin.token))
      .send(adminAd({ title: 'Painters in Jaipur', target: { mode: 'cities', cities: ['Jaipur'] }, professions: ['painter'] })).expect(201)).body.id;
    const yes = await makeCustomer({ profession: 'painter', city: 'jaipur' });
    const wrongCity = await makeCustomer({ profession: 'painter', city: 'Gurugram' });
    const wrongWork = await makeCustomer({ profession: 'carpenter', city: 'Jaipur' });
    expect((await home(yes.token)).map((a: any) => a.id)).toEqual([id]);
    expect(await home(wrongCity.token)).toEqual([]);
    expect(await home(wrongWork.token)).toEqual([]);
    const aud = (await http().post('/v1/admin/ads/audience').set(auth(admin.token)).send({ mode: 'cities', cities: ['Jaipur'], professions: ['painter'] }).expect(201)).body;
    expect(aud.customers).toBe(1);
    await pg.query(`UPDATE ads SET status = 'paused'`);
  });

  test('tap target opens a shop or product; events are counted per day', async () => {
    const { owner, shopId } = await makeShop(admin);
    const pid = (await http().post('/v1/shop/products').set(auth(owner.token, shopId)).send({ kind: 'earn', name: 'Fevicol 5kg', bonusPoints: 50 }).expect(201)).body.id;
    const id = (await http().post('/v1/admin/ads').set(auth(admin.token)).send(adminAd({ link: { kind: 'product', productId: pid } })).expect(201)).body.id;
    const c = await makeCustomer();
    const [ad] = await home(c.token);
    expect(ad.opens).toEqual({ kind: 'product', productId: pid, shopId });
    await http().post('/v1/me/ads/events').set(auth(c.token)).send({ views: [id, id], taps: [id] }).expect(201);
    await http().post('/v1/me/ads/events').set(auth(c.token)).send({ views: [id] }).expect(201);
    const st = (await http().get(`/v1/admin/ads/${id}`).set(auth(admin.token)).expect(200)).body;
    expect(st.ad).toMatchObject({ views: 2, taps: 1, tapRate: 50 });
    await http().post('/v1/admin/ads').set(auth(admin.token)).send(adminAd({ link: { kind: 'product', productId: 999999 } })).expect(400);
    await pg.query(`UPDATE ads SET status = 'paused'`);
  });

  test('shop requests → pays → admin approves → shows near the shop only', async () => {
    const { owner, shopId } = await makeShop(admin);
    const packs = (await http().get('/v1/shop/ads/packs').set(auth(owner.token, shopId)).expect(200)).body;
    expect(packs.map((p: any) => p.code)).toEqual(['ad7', 'ad15', 'ad30']);
    const req = (await http().post('/v1/shop/ads').set(auth(owner.token, shopId))
      .send({ title: 'Diwali sale on ply', bgColor: '#C2410C', packCode: 'ad7', startDate: istDate(), link: { kind: 'shop' } }).expect(201)).body;
    expect(req).toMatchObject({ amountRupees: 499, needsPayment: true });

    // not visible before payment + review
    const near = await makeCustomer({ city: 'Gurugram' });
    expect(await home(near.token, '?lat=28.4725&lng=77.044')).toEqual([]);
    // review before payment is refused
    await http().post(`/v1/admin/ads/${req.id}/review`).set(auth(admin.token)).send({ approve: true }).expect(400);

    const order = (await http().post(`/v1/shop/ads/${req.id}/pay`).set(auth(owner.token, shopId)).expect(201)).body;
    expect(order.amountPaise).toBe(49900);
    const paid = (await http().post('/v1/shop/billing/verify').set(auth(owner.token, shopId)).send({ orderId: order.orderId, paymentId: 'pay_test_1', signature: 'test' }).expect(201)).body;
    expect(paid).toMatchObject({ kind: 'ad', adId: req.id });
    // paying twice is a no-op; paying again for a paid ad is refused
    await http().post('/v1/shop/billing/verify').set(auth(owner.token, shopId)).send({ orderId: order.orderId, paymentId: 'pay_test_1', signature: 'test' }).expect(201);
    await http().post(`/v1/shop/ads/${req.id}/pay`).set(auth(owner.token, shopId)).expect(400);

    const review = (await http().get('/v1/admin/ads?phase=pending_review').set(auth(admin.token)).expect(200)).body;
    expect(review.map((a: any) => a.id)).toContain(req.id);
    const support = await makeAdmin('support');
    await http().post(`/v1/admin/ads/${req.id}/review`).set(auth(support.token)).send({ approve: true }).expect(403);
    await http().post(`/v1/admin/ads/${req.id}/review`).set(auth(admin.token)).send({ approve: true }).expect(201);

    expect((await home(near.token, '?lat=28.4725&lng=77.044')).map((a: any) => a.id)).toEqual([req.id]);
    expect((await home(near.token, '?lat=19.07&lng=72.87'))).toEqual([]);          // far away right now
    expect((await home(near.token)).map((a: any) => a.id)).toEqual([req.id]);       // no location: same city
    const far = await makeCustomer({ city: 'Mumbai' });
    expect(await home(far.token)).toEqual([]);

    const mine = (await http().get('/v1/shop/ads').set(auth(owner.token, shopId)).expect(200)).body;
    expect(mine[0]).toMatchObject({ id: req.id, phase: 'live', paymentStatus: 'paid' });
    const sms = (await pg.query(`SELECT template FROM sms_outbox WHERE template = 'ad_approved'`)).rows;
    expect(sms).toHaveLength(1);
  });

  test('shop rules: own product only, no past dates, reject needs a reason, cancel unpaid', async () => {
    const a = await makeShop(admin);
    const b = await makeShop(admin);
    const foreign = (await http().post('/v1/shop/products').set(auth(b.owner.token, b.shopId)).send({ kind: 'earn', name: 'Their ply', bonusPoints: 5 }).expect(201)).body.id;
    const base = { title: 'Big sale', bgColor: '#111111', packCode: 'ad7', startDate: istDate(), link: { kind: 'shop' } };
    expect((await http().post('/v1/shop/ads').set(auth(a.owner.token, a.shopId)).send({ ...base, link: { kind: 'product', productId: foreign } }).expect(400)).body.code).toBe('BAD_PRODUCT');
    expect((await http().post('/v1/shop/ads').set(auth(a.owner.token, a.shopId)).send({ ...base, startDate: istDate(-2) }).expect(400)).body.code).toBe('BAD_START');
    const r = (await http().post('/v1/shop/ads').set(auth(a.owner.token, a.shopId)).send(base).expect(201)).body;
    await http().post(`/v1/shop/ads/${r.id}/cancel`).set(auth(a.owner.token, a.shopId)).expect(201);
    await http().post(`/v1/shop/ads/${r.id}/pay`).set(auth(a.owner.token, a.shopId)).expect(400);

    const r2 = (await http().post('/v1/shop/ads').set(auth(a.owner.token, a.shopId)).send(base).expect(201)).body;
    const o = (await http().post(`/v1/shop/ads/${r2.id}/pay`).set(auth(a.owner.token, a.shopId)).expect(201)).body;
    await http().post('/v1/shop/billing/verify').set(auth(a.owner.token, a.shopId)).send({ orderId: o.orderId, paymentId: 'pay_test_2', signature: 'test' }).expect(201);
    expect((await http().post(`/v1/admin/ads/${r2.id}/review`).set(auth(admin.token)).send({ approve: false }).expect(400)).body.code).toBe('REASON_NEEDED');
    await http().post(`/v1/admin/ads/${r2.id}/review`).set(auth(admin.token)).send({ approve: false, reason: 'Banner text too small' }).expect(201);
    const mine = (await http().get('/v1/shop/ads').set(auth(a.owner.token, a.shopId)).expect(200)).body;
    expect(mine.find((x: any) => x.id === r2.id)).toMatchObject({ phase: 'rejected', rejectReason: 'Banner text too small' });
    // staff cannot request ads
    await http().get('/v1/shop/ads').set(auth((await makeCustomer()).token, a.shopId)).expect(403);
  });
});
