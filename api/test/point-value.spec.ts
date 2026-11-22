import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, shopBody, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(async () => {
  await http().put('/v1/admin/settings').set(auth(admin.token)).send({ pointValueLocked: 0, defaultPointValueRupees: 0.25 });
  await shutdown();
});
const put = (body: any) => http().put('/v1/admin/settings').set(auth(admin.token)).send(body);

describe('default value of 1 point, set by Super Admin', () => {
  it('starts at ₹0.25 and unlocked; shops can read it', async () => {
    const s = (await http().get('/v1/admin/settings').set(auth(admin.token)).expect(200)).body;
    expect(s.pointValue).toEqual({ rupees: 0.25, locked: false });
    const c = await makeCustomer();
    expect((await http().get('/v1/platform/defaults').set(auth(c.token)).expect(200)).body).toEqual({ pointValueRupees: 0.25, pointValueLocked: false });
  });

  it('checks the value', async () => {
    expect((await put({ defaultPointValueRupees: 0 })).status).toBe(400);
    expect((await put({ defaultPointValueRupees: 0.255 })).status).toBe(400);
    expect((await put({ defaultPointValueRupees: 101 })).status).toBe(400);
  });

  it('unlocked: owners keep their own value; changing the default does not touch existing shops', async () => {
    const shop = await makeShop(admin, { loyalty: { ...shopBody().loyalty, pointValueRupees: 0.7 } });
    await put({ defaultPointValueRupees: 0.3 }).expect(200);
    const cfg = (await http().get('/v1/shop').set(auth(shop.owner.token, shop.shopId)).expect(200)).body;
    expect(cfg.loyalty.pointValueRupees).toBe(0.7);
    await http().put('/v1/shop/config').set(auth(shop.owner.token, shop.shopId)).send({ ...shopBody().loyalty, pointValueRupees: 0.6 }).expect(200);
    await put({ defaultPointValueRupees: 0.25 }).expect(200);
  });

  it('locked: every shop moves to the platform value, owners cannot change it, new shops get it, old points keep their value', async () => {
    const shop = await makeShop(admin, { loyalty: { ...shopBody().loyalty, rewardPercent: 10, pointValueRupees: 0.7, minBillRupees: 0, maxPointsPerBill: null } });
    const c = await makeCustomer();
    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'PV-1').expect(201); // 100 pts at ₹0.70 = ₹70

    await put({ pointValueLocked: 1 }).expect(200);
    const sh = auth(shop.owner.token, shop.shopId);
    expect((await http().get('/v1/shop').set(sh).expect(200)).body.loyalty.pointValueRupees).toBe(0.25);
    const bad = await http().put('/v1/shop/config').set(sh).send({ ...shopBody().loyalty, pointValueRupees: 0.9 });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe('POINT_VALUE_LOCKED');
    await http().put('/v1/shop/config').set(sh).send({ ...shopBody().loyalty, rewardPercent: 8, pointValueRupees: 0.25 }).expect(200); // other rules still editable

    const fresh = await makeShop(admin, { loyalty: { ...shopBody().loyalty, pointValueRupees: 0.9 } }); // sign-up value ignored while locked
    expect((await http().get('/v1/shop').set(auth(fresh.owner.token, fresh.shopId)).expect(200)).body.loyalty.pointValueRupees).toBe(0.25);

    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'PV-2').expect(201); // 80 pts at ₹0.25 = ₹20
    const card = (await http().get('/v1/me/home').set(auth(c.token)).expect(200)).body.cards[0];
    expect(card).toMatchObject({ points: 180, valueRupees: 90, mixedRates: true }); // ₹70 + ₹20: old points kept ₹0.70

    await put({ defaultPointValueRupees: 0.5 }).expect(200); // changing the value while locked moves everyone again
    expect((await http().get('/v1/shop').set(sh).expect(200)).body.loyalty.pointValueRupees).toBe(0.5);

    await put({ pointValueLocked: 0, defaultPointValueRupees: 0.25 }).expect(200);
    await http().put('/v1/shop/config').set(sh).send({ ...shopBody().loyalty, pointValueRupees: 0.9 }).expect(200); // unlocked again
  });
});
