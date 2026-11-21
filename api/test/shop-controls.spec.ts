import { assertLedgerInvariants, auth, bill, boot, http, login, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(async () => { await assertLedgerInvariants(); await shutdown(); });

describe('customer block / unblock', () => {
  it('blocked customer cannot earn or redeem; unblock restores; audited; owner only', async () => {
    const { owner, shopId } = await makeShop(admin);
    const c = await makeCustomer();
    await bill(owner.token, shopId, c.userId, 30000, 'B-1').expect(201);

    await http().post(`/v1/shop/customers/${c.userId}/block`).set(auth(owner.token, shopId)).send({ blocked: true, reason: 'Fraud' }).expect(201);
    const b = await bill(owner.token, shopId, c.userId, 30000, 'B-2');
    expect(b.body.code).toBe('CUSTOMER_BLOCKED');
    const red = await http().post('/v1/shop/redemptions').set(auth(owner.token, shopId)).send({ customerId: c.userId, method: 'cash', points: 500 });
    expect(red.body.code).toBe('CUSTOMER_BLOCKED');
    const detail = (await http().get(`/v1/shop/customers/${c.userId}`).set(auth(owner.token, shopId)).expect(200)).body;
    expect(detail.customer.blocked).toBe(true);

    await http().post(`/v1/shop/customers/${c.userId}/block`).set(auth(owner.token, shopId)).send({ blocked: false }).expect(201);
    await bill(owner.token, shopId, c.userId, 30000, 'B-3').expect(201);

    const audits = (await pg.query(`SELECT action FROM audit_log WHERE shop_id = $1 AND action LIKE 'customer.%' ORDER BY id`, [shopId])).rows.map((r) => r.action);
    expect(audits).toEqual(['customer.block', 'customer.unblock']);
  });

  it('is owner-only and scoped to own shop', async () => {
    const { owner, shopId } = await makeShop(admin);
    const other = await makeShop(admin);
    const c = await makeCustomer();
    await bill(owner.token, shopId, c.userId, 30000, 'S-1').expect(201);
    const staff = await login();
    await http().post('/v1/shop/staff').set(auth(owner.token, shopId)).send({ mobile: staff.mobile, name: 'Staff One' }).expect(201);
    const r = await http().post(`/v1/shop/customers/${c.userId}/block`).set(auth(staff.token, shopId)).send({ blocked: true });
    expect(r.body.code).toBe('OWNER_ONLY');
    // customer has no wallet at the other shop
    await http().post(`/v1/shop/customers/${c.userId}/block`).set(auth(other.owner.token, other.shopId)).send({ blocked: true }).expect(404);
  });
});

describe('staff permission edits', () => {
  it('edits permissions, deactivates and reactivates; owner row untouchable', async () => {
    const { owner, shopId } = await makeShop(admin);
    const staff = await login();
    await http().post('/v1/shop/staff').set(auth(owner.token, shopId)).send({ mobile: staff.mobile, name: 'Staff One' }).expect(201);
    const list = (await http().get('/v1/shop/staff').set(auth(owner.token, shopId)).expect(200)).body;
    const row = list.find((x: any) => x.mobile === staff.mobile || x.name === 'Staff One');
    const uid = row.userId ?? row.user_id ?? row.id;

    await http().patch(`/v1/shop/staff/${uid}`).set(auth(owner.token, shopId)).send({ canManual: true, manualDailyLimit: 750, canRedeem: true }).expect(200);
    const m = (await pg.query('SELECT * FROM shop_members WHERE shop_id = $1 AND user_id = $2', [shopId, uid])).rows[0];
    expect(m).toMatchObject({ can_manual: true, can_redeem: true });
    expect(Number(m.manual_daily_limit)).toBe(750);

    // staff cannot edit staff
    const denied = await http().patch(`/v1/shop/staff/${uid}`).set(auth(staff.token, shopId)).send({ canManual: false });
    expect(denied.body.code).toBe('OWNER_ONLY');

    // deactivate -> locked out immediately; reactivate -> back
    await http().patch(`/v1/shop/staff/${uid}`).set(auth(owner.token, shopId)).send({ active: false }).expect(200);
    const out = await http().get('/v1/shop/config').set(auth(staff.token, shopId));
    expect(out.body.code).toBe('NOT_SHOP_MEMBER');
    await http().patch(`/v1/shop/staff/${uid}`).set(auth(owner.token, shopId)).send({ active: true }).expect(200);
    await http().get('/v1/shop/config').set(auth(staff.token, shopId)).expect(200);

    // owner's own row can't be edited through the staff route
    const ownerId = (await pg.query(`SELECT user_id FROM shop_members WHERE shop_id = $1 AND role = 'owner'`, [shopId])).rows[0].user_id;
    await http().patch(`/v1/shop/staff/${ownerId}`).set(auth(owner.token, shopId)).send({ active: false }).expect(404);
  });
});

describe('loyalty rules history', () => {
  it('lists versions newest first with change lines; owner only', async () => {
    const { owner, shopId } = await makeShop(admin);
    const cfg = (await http().get('/v1/shop/config').set(auth(owner.token, shopId)).expect(200)).body;
    await http().put('/v1/shop/config').set(auth(owner.token, shopId)).send({ ...cfg, rewardPercent: 7, expiryDays: 180 }).expect(200);

    const h = (await http().get('/v1/shop/config/history').set(auth(owner.token, shopId)).expect(200)).body;
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ version: 2, current: true });
    expect(h[0].config.rewardPercent).toBe(7);
    expect(h[0].changes.some((c: string) => c.startsWith('Reward %'))).toBe(true);
    expect(h[0].changes.some((c: string) => c.startsWith('Expiry'))).toBe(true);
    expect(h[1]).toMatchObject({ version: 1, current: false, changes: [] });

    const staff = await login();
    await http().post('/v1/shop/staff').set(auth(owner.token, shopId)).send({ mobile: staff.mobile, name: 'Staff Two' }).expect(201);
    const r = await http().get('/v1/shop/config/history').set(auth(staff.token, shopId));
    expect(r.body.code).toBe('OWNER_ONLY');
  });
});
