import { assertLedgerInvariants, auth, bill, boot, http, login, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(async () => { await assertLedgerInvariants(); await shutdown(); });

describe('customer app', () => {
  it('home: total across shops, per-shop value, milestones window (3 tiles), crossing reported', async () => {
    const A = await makeShop(admin);
    const B = await makeShop(admin, { name: 'Gupta Paints', loyalty: { rewardPercent: 10, pointValueRupees: 0.5, minRedeemPoints: 1000 } });
    const c = await makeCustomer();
    await bill(A.owner.token, A.shopId, c.userId, 30000, 'H-1').expect(201);              // 1500
    const crossing = await bill(B.owner.token, B.shopId, c.userId, 7000, 'H-2').expect(201); // 700 → lifetime 2200, crosses Silver (2000)
    expect(crossing.body.milestoneCrossed).toMatchObject({ name: 'Silver' });

    const home = (await http().get('/v1/me/home').set(auth(c.token)).expect(200)).body;
    expect(home.totalPoints).toBe(2200);
    expect(home.shopsCount).toBe(2);
    const gupta = home.cards.find((x: any) => x.name === 'Gupta Paints');
    expect(gupta).toMatchObject({ points: 700, pointValueRupees: 0.5, valueRupees: 350, canRedeem: false, toRedeem: 300 });
    expect(home.milestones.current).toBe('Silver');
    expect(home.milestones.tiles.map((t: any) => [t.name, t.state])).toEqual([['Silver', 'crossed'], ['Gold', 'next'], ['Platinum', 'locked']]);
    expect(home.milestones.tiles[1]).toMatchObject({ toGo: 2800 });
  });

  it('admin switches milestone basis to rupee value; thresholds in rupees', async () => {
    await http().put('/v1/admin/milestones/basis').set(auth(admin.token)).send({ basis: 'value' }).expect(200);
    const c = await makeCustomer();
    const A = await makeShop(admin, { loyalty: { rewardPercent: 10, pointValueRupees: 0.25 } });
    await bill(A.owner.token, A.shopId, c.userId, 100000, 'MV-1').expect(201); // 10,000 pts × ₹0.25 = ₹2,500
    const home = (await http().get('/v1/me/home').set(auth(c.token)).expect(200)).body;
    expect(home.milestones.basis).toBe('rupees');
    expect(home.milestones.earnedSoFar).toBe(2500);
    await http().put('/v1/admin/milestones/basis').set(auth(admin.token)).send({ basis: 'points' }).expect(200);
  });

  it('QR rotates and resolves at the counter; old QR rejected', async () => {
    const A = await makeShop(admin);
    const c = await makeCustomer();
    const { qr } = (await http().get('/v1/me/qr').set(auth(c.token)).expect(200)).body;
    const r = await http().post('/v1/shop/customers/resolve').set(auth(A.owner.token, A.shopId)).send({ qr }).expect(201);
    expect(r.body).toMatchObject({ found: true, customer: { id: c.userId, upiId: 'ramesh@ybl', atThisShop: { firstVisit: true } } });
    const parts = qr.split('.');
    const stale = `VP1.${parts[1]}.${Number(parts[2]) - 5}.${parts[3]}`;
    expect((await http().post('/v1/shop/customers/resolve').set(auth(A.owner.token, A.shopId)).send({ qr: stale })).body.code).toBe('QR_EXPIRED');
    const forged = `VP1.${Number(parts[1]) + 1}.${parts[2]}.${parts[3]}`;
    expect((await http().post('/v1/shop/customers/resolve').set(auth(A.owner.token, A.shopId)).send({ qr: forged })).body.code).toBe('QR_INVALID');
  });

  it('counter quick-add by mobile, invite SMS on first points', async () => {
    const A = await makeShop(admin);
    const r = await http().post('/v1/shop/customers').set(auth(A.owner.token, A.shopId)).send({ mobile: '9123456780', name: 'Mohan Singh', profession: 'electrician' }).expect(201);
    await bill(A.owner.token, A.shopId, r.body.customerId, 2000, 'QA-1').expect(201);
    const sms = (await pg.query(`SELECT template FROM sms_outbox WHERE mobile = '919123456780' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(sms.template).toBe('invite');
    const found = await http().post('/v1/shop/customers/resolve').set(auth(A.owner.token, A.shopId)).send({ mobile: '9123456780' }).expect(201);
    expect(found.body.customer.atThisShop.balance).toBe(100);
  });

  it('history: keyset pagination, filters, bill details and offer flag', async () => {
    const A = await makeShop(admin);
    const c = await makeCustomer();
    for (let i = 0; i < 7; i++) await bill(A.owner.token, A.shopId, c.userId, 1000 + i * 100, `HS-${i}`).expect(201);
    const p1 = (await http().get('/v1/me/history?limit=5').set(auth(c.token)).expect(200)).body;
    expect(p1.items).toHaveLength(5);
    expect(p1.next).toBeTruthy();
    const p2 = (await http().get(`/v1/me/history?limit=5&before=${encodeURIComponent(p1.next)}`).set(auth(c.token)).expect(200)).body;
    expect(p2.items).toHaveLength(2);
    expect(p2.next).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((x: any) => x.id)).size).toBe(7);
    expect(p1.items[0].bill).toMatchObject({ amountRupees: 1600, invoiceNo: 'HS-6' });
  });

  it('nearby: only approved shops within radius, sorted by distance, category filter, my points', async () => {
    const near = await makeShop(admin, { name: 'Near Ply', location: { lat: 12.9716, lng: 77.5946, accuracyM: 5 }, categories: ['plywood'] });
    await makeShop(admin, { name: 'Mid Tiles', location: { lat: 12.9900, lng: 77.5946, accuracyM: 5 }, categories: ['tiles'] });
    await makeShop(admin, { name: 'Far Paints', location: { lat: 13.2, lng: 77.5946, accuracyM: 5 }, categories: ['paints'] });
    const pendingOwner = await login();
    await http().post('/v1/shops').set(auth(pendingOwner.token)).send({ ...require('./helpers').shopBody(), name: 'Pending Shop', location: { lat: 12.9717, lng: 77.5946, accuracyM: 5 } }).expect(201);
    const c = await makeCustomer();
    await bill(near.owner.token, near.shopId, c.userId, 2000, 'NB-1').expect(201);

    const all = (await http().get('/v1/discover/shops?lat=12.9716&lng=77.5946&radiusKm=5').set(auth(c.token)).expect(200)).body;
    expect(all.map((s: any) => s.name)).toEqual(['Near Ply', 'Mid Tiles']);
    expect(all[0]).toMatchObject({ myPoints: 100, rewardPercent: 5, pointValueRupees: 1 });
    expect(all[1].km).toBeCloseTo(2.0, 0);
    const tiles = (await http().get('/v1/discover/shops?lat=12.9716&lng=77.5946&radiusKm=5&category=tiles').set(auth(c.token)).expect(200)).body;
    expect(tiles.map((s: any) => s.name)).toEqual(['Mid Tiles']);
  });

  it('shop reports: dashboard from daily stats, outstanding, CSV export', async () => {
    const A = await makeShop(admin);
    const c = await makeCustomer();
    await bill(A.owner.token, A.shopId, c.userId, 10000, 'RP-1').expect(201);
    await bill(A.owner.token, A.shopId, c.userId, 20000, 'RP-2').expect(201);
    const r = await http().post('/v1/shop/redemptions').set(auth(A.owner.token, A.shopId)).send({ customerId: c.userId, method: 'cash', points: 500 }).expect(201);
    await http().post(`/v1/shop/redemptions/${r.body.redemptionId}/paid`).set(auth(A.owner.token, A.shopId)).send({}).expect(201);
    await http().post(`/v1/me/redemptions/${r.body.redemptionId}/received`).set(auth(c.token)).expect(201);

    const d = (await http().get('/v1/shop/reports/dashboard').set(auth(A.owner.token, A.shopId)).expect(200)).body;
    expect(d).toMatchObject({ customers: 1, newCustomers: 1, bills: 2, purchaseRupees: 30000, pointsIssued: 1500, pointsRedeemed: 500, valueRedeemedRupees: 500, outstanding: { points: 1000, rupees: 1000 }, repeatRate: 100 });
    const csv = await http().get('/v1/shop/reports/transactions.csv').set(auth(A.owner.token, A.shopId)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('public_id,created_at,type');
    expect(csv.text.split('\n').length).toBe(1 + 4); // 2 earns + hold + confirm
  });

  it('SMS to a customer group charges the shop balance', async () => {
    const A = await makeShop(admin);
    const c = await makeCustomer();
    await bill(A.owner.token, A.shopId, c.userId, 2000, 'SM-1').expect(201);
    const low = await http().post('/v1/shop/messages').set(auth(A.owner.token, A.shopId)).send({ segment: 'all', text: 'Namaste {name}, you have {points} pts at our shop.' });
    expect(low.body.code).toBe('SMS_BALANCE_LOW');
    await http().post(`/v1/admin/shops/${A.shopId}/sms-credits`).set(auth(admin.token)).send({ count: 10 }).expect(201);
    const ok = await http().post('/v1/shop/messages').set(auth(A.owner.token, A.shopId)).send({ segment: 'profession:carpenter', text: 'Namaste {name}, you have {points} pts at our shop.' }).expect(201);
    expect(ok.body).toEqual({ sent: 1, smsBalance: 9 });
    const body = (await pg.query(`SELECT body FROM sms_outbox WHERE template = 'shop_broadcast' ORDER BY id DESC LIMIT 1`)).rows[0].body;
    expect(body).toBe('Namaste Ramesh, you have 100 pts at our shop. -Vyapar Point');
  });
});
