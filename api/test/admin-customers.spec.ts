import { assertLedgerInvariants, auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown, wallet } from './helpers';

let owner: { token: string };
beforeAll(async () => { await boot(); owner = await makeAdmin('owner'); });
afterAll(shutdown);

describe('Super Admin customer management', () => {
  it('lists all customers with filters and paging, no search needed', async () => {
    const a = await makeCustomer({ name: 'Listy Carpenter', profession: 'carpenter' });
    await makeCustomer({ name: 'Listy Painter', profession: 'painter' });
    const all = (await http().get('/v1/admin/customers').query({ limit: 100 }).set(auth(owner.token)).expect(200)).body;
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.rows.find((r: any) => r.id === a.userId)).toMatchObject({ name: 'Listy Carpenter', deactivated_at: null, shops: 0, balance: 0 });
    const p = (await http().get('/v1/admin/customers').query({ profession: 'painter', q: 'Listy' }).set(auth(owner.token)).expect(200)).body;
    expect(p.rows.map((r: any) => r.name)).toEqual(['Listy Painter']);
    const page = (await http().get('/v1/admin/customers').query({ limit: 1, offset: 0 }).set(auth(owner.token)).expect(200)).body;
    expect(page.rows).toHaveLength(1);
  });

  it('edits a customer; support role cannot', async () => {
    const c = await makeCustomer({ name: 'Old Name' });
    await http().patch(`/v1/admin/customers/${c.userId}`).set(auth(owner.token)).send({ name: 'New Name', city: 'Jaipur', professions: ['painter', 'contractor'] }).expect(200);
    const d = (await http().get(`/v1/admin/customers/${c.userId}`).set(auth(owner.token)).expect(200)).body.customer;
    expect(d).toMatchObject({ name: 'New Name', city: 'Jaipur', profession: 'painter', professions: ['painter', 'contractor'] });
    const other = await makeCustomer();
    const mob = (await pg.query('SELECT mobile FROM users WHERE id = $1', [other.userId])).rows[0].mobile;
    expect((await http().patch(`/v1/admin/customers/${c.userId}`).set(auth(owner.token)).send({ mobile: mob }).expect(409)).body.code).toBe('MOBILE_TAKEN');
    const support = await makeAdmin('support');
    await http().patch(`/v1/admin/customers/${c.userId}`).set(auth(support.token)).send({ name: 'Nope' }).expect(403);
  });

  it('add and deduct points on a card, ledger stays exact', async () => {
    const admin = await makeAdmin('ops');
    const shop = await makeShop(owner);
    const c = await makeCustomer();
    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'AC-1').expect(201); // 50 points
    const url = `/v1/admin/customers/${c.userId}/points`;
    expect((await http().post(url).set(auth(admin.token)).send({ shopId: shop.shopId, action: 'add', points: 100, reason: 'x' })).status).toBe(400); // reason too short
    const add = (await http().post(url).set(auth(admin.token)).send({ shopId: shop.shopId, action: 'add', points: 100, reason: 'Goodwill from support' }).expect(201)).body;
    expect(add.balance).toBe(150);
    const ded = (await http().post(url).set(auth(admin.token)).send({ shopId: shop.shopId, action: 'deduct', points: 120, reason: 'Wrong entry fixed' }).expect(201)).body;
    expect(ded.balance).toBe(30);
    expect((await http().post(url).set(auth(admin.token)).send({ shopId: shop.shopId, action: 'deduct', points: 31, reason: 'Too many' })).body.code).toBe('NOT_ENOUGH_POINTS');
    expect((await wallet(c.userId, shop.shopId)).balance_points).toBe(30);
    const types = (await pg.query(`SELECT type, points FROM ledger_entries WHERE customer_id = $1 ORDER BY id`, [c.userId])).rows;
    expect(types.map((t) => t.type)).toEqual(['earn_bill', 'admin_add', 'admin_deduct']);
    expect(types[2].points).toBe(-120);
    // a card the customer does not have
    const other = await makeShop(owner);
    expect((await http().post(url).set(auth(admin.token)).send({ shopId: other.shopId, action: 'add', points: 5, reason: 'No card here' })).status).toBe(404);
    await assertLedgerInvariants();
  });

  it('inactive customer cannot log in, use the app or earn; active again works', async () => {
    const shop = await makeShop(owner);
    const c = await makeCustomer();
    const mobile = (await pg.query('SELECT mobile FROM users WHERE id = $1', [c.userId])).rows[0].mobile;
    await http().post(`/v1/admin/customers/${c.userId}/active`).set(auth(owner.token)).send({ active: false, note: 'Misuse' }).expect(201);
    const me = await http().get('/v1/me/home').set(auth(c.token));
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('ACCOUNT_INACTIVE');
    const earn = await bill(shop.owner.token, shop.shopId, c.userId, 500, 'IN-1');
    expect(earn.status).toBe(403);
    expect(earn.body.code).toBe('CUSTOMER_INACTIVE');
    const row = (await http().get('/v1/admin/customers').query({ status: 'inactive', limit: 100 }).set(auth(owner.token)).expect(200)).body.rows.find((r: any) => r.id === c.userId);
    expect(row).toBeTruthy();
    await http().post(`/v1/admin/customers/${c.userId}/active`).set(auth(owner.token)).send({ active: true }).expect(201);
    await http().get('/v1/me/home').set(auth(c.token)).expect(200);
    await bill(shop.owner.token, shop.shopId, c.userId, 500, 'IN-2').expect(201);
    expect(mobile).toBeTruthy();
  });

  it('delete: owner only, customer disappears from the list and cannot log in', async () => {
    const c = await makeCustomer();
    const ops = await makeAdmin('ops');
    await http().delete(`/v1/admin/customers/${c.userId}`).set(auth(ops.token)).expect(403);
    await http().delete(`/v1/admin/customers/${c.userId}`).query({ note: 'Duplicate account' }).set(auth(owner.token)).expect(200);
    await http().get('/v1/me/home').set(auth(c.token)).expect(401);
    const list = (await http().get('/v1/admin/customers').query({ limit: 100 }).set(auth(owner.token)).expect(200)).body.rows;
    expect(list.find((r: any) => r.id === c.userId)).toBeUndefined();
  });
});
