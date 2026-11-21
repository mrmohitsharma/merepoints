import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

describe('customer is told when points are added', () => {
  let shop: { owner: any; shopId: number };
  let cust: { token: string; userId: number };
  beforeAll(async () => { shop = await makeShop(admin); cust = await makeCustomer(); });

  it('earned poll: baseline first, then only new points', async () => {
    const base = (await http().get('/v1/me/earned').set(auth(cust.token)).expect(200)).body;
    expect(base).toEqual({ latestId: 0, items: [] });
    await bill(shop.owner.token, shop.shopId, cust.userId, 10000, 'EA-1').expect(201);
    const r = (await http().get('/v1/me/earned').query({ after: base.latestId }).set(auth(cust.token)).expect(200)).body;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ points: 500, balance: 500, shopId: shop.shopId });
    const again = (await http().get('/v1/me/earned').query({ after: r.latestId }).set(auth(cust.token)).expect(200)).body;
    expect(again.items).toHaveLength(0);
  });

  it('earning leaves one inbox message, hidden from the shop campaign list and its quota', async () => {
    const rows = (await pg.query(`SELECT n.kind, n.title, r.customer_id FROM notifications n JOIN notification_recipients r ON r.notification_id = n.id WHERE n.shop_id = $1`, [shop.shopId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'system', title: '+500 points at ' + (await pg.query('SELECT name FROM shops WHERE id=$1', [shop.shopId])).rows[0].name.slice(0, 32), customer_id: cust.userId });
    const list = (await http().get('/v1/shop/notifications').set(auth(shop.owner.token, shop.shopId)).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain('points at');
  });

  it('a retried request with the same key does not send a second message', async () => {
    await bill(shop.owner.token, shop.shopId, cust.userId, 1000, 'EA-2', 'key-ea-2').expect(201);
    await bill(shop.owner.token, shop.shopId, cust.userId, 1000, 'EA-2', 'key-ea-2').expect(201);
    const n = (await pg.query(`SELECT count(*)::int AS c FROM notifications WHERE shop_id = $1 AND kind = 'system'`, [shop.shopId])).rows[0].c;
    expect(n).toBe(2);
  });
});
