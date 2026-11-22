import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, shopBody, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

describe('points keep the value they were earned at', () => {
  it('earn at ₹0.25, change to ₹0.50, earn again: every screen and the payout agree', async () => {
    const loyalty = { ...shopBody().loyalty, rewardPercent: 10, pointValueRupees: 0.25, minBillRupees: 0, maxPointsPerBill: null, minRedeemPoints: 100, maxRedeemPoints: null };
    const shop = await makeShop(admin, { loyalty });
    const c = await makeCustomer();
    const sh = auth(shop.owner.token, shop.shopId);

    await bill(shop.owner.token, shop.shopId, c.userId, 10000, 'M-1').expect(201); // 1,000 pts @ 0.25 = ₹250
    await http().put('/v1/shop/config').set(sh).send({ ...loyalty, pointValueRupees: 0.5 }).expect(200);
    await bill(shop.owner.token, shop.shopId, c.userId, 10000, 'M-2').expect(201); // 1,000 pts @ 0.50 = ₹500

    // customer app
    const home = (await http().get('/v1/me/home').set(auth(c.token)).expect(200)).body;
    expect(home.cards[0]).toMatchObject({ points: 2000, valueRupees: 750, mixedRates: true, pointValueRupees: 0.5 });
    const card = (await http().get(`/v1/me/cards/${shop.shopId}`).set(auth(c.token)).expect(200)).body;
    expect(card).toMatchObject({ points: 2000, valueRupees: 750, mixedRates: true });

    // shop counter
    const found = (await http().post('/v1/shop/customers/resolve').set(sh).send({ qr: (await http().get('/v1/me/qr').set(auth(c.token)).expect(200)).body.qr }).expect(201)).body;
    expect(found.customer.atThisShop).toMatchObject({ balance: 2000, worthRupees: 750, mixedRates: true });
    const list = (await http().get('/v1/shop/customers').set(sh).expect(200)).body;
    expect(list[0].worth_rupees).toBe(750);

    // preview and real payout across both rates: 1,200 pts = 1,000 × 0.25 + 200 × 0.50 = ₹350
    const pv = (await http().get('/v1/shop/redemptions/preview').query({ customerId: c.userId, points: 1200 }).set(sh).expect(200)).body;
    expect(pv).toEqual({ points: 1200, valueRupees: 350, mixedRates: true });
    const r = (await http().post('/v1/shop/redemptions').set(sh).send({ customerId: c.userId, method: 'cash', points: 1200 }).expect(201)).body;
    expect(r.valueRupees).toBe(350);

    // what is left is all ₹0.50 points: 800 × 0.50 = ₹400, single rate
    const after = (await http().get('/v1/me/home').set(auth(c.token)).expect(200)).body.cards[0];
    expect(after).toMatchObject({ points: 800, valueRupees: 400, mixedRates: false });

    expect((await http().get('/v1/shop/redemptions/preview').query({ customerId: c.userId, points: 5000 }).set(sh)).body.code).toBe('NOT_ENOUGH_POINTS');
  });
});
