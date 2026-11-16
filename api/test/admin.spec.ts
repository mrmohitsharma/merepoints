import { createHmac } from 'crypto';
import { auth, bill, boot, http, login, makeAdmin, makeCustomer, makeShop, pg, shopBody, shutdown } from './helpers';

let owner: Awaited<ReturnType<typeof makeAdmin>>;
beforeAll(async () => {
  await boot();
  owner = await makeAdmin('owner');
});
afterAll(shutdown);

const shopMe = async (token: string, shopId: number) => (await http().get('/v1/shop').set(auth(token, shopId)).expect(200)).body;

describe('admin login', () => {
  test('wrong password 5 times locks the account for 15 minutes, even for the right password', async () => {
    const a = await makeAdmin('support');
    for (let i = 0; i < 4; i++) await http().post('/v1/admin/auth/login').send({ username: a.username, password: 'nope' }).expect(401);
    await http().post('/v1/admin/auth/login').send({ username: a.username, password: 'nope' }).expect(401);
    const locked = await http().post('/v1/admin/auth/login').send({ username: a.username, password: a.password }).expect(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    // Owner resets: unlocked, must change password at next login
    await http().post(`/v1/admin/team/${a.id}/reset-password`).set(auth(owner.token)).send({ password: 'Temporary-99x' }).expect(201);
    const r = await http().post('/v1/admin/auth/login').send({ username: a.username, password: 'Temporary-99x' }).expect(201);
    expect(r.body.admin.mustChangePassword).toBe(true);
  });

  test('unknown username gives the same answer as a wrong password', async () => {
    const r = await http().post('/v1/admin/auth/login').send({ username: 'nobody', password: 'x' }).expect(401);
    expect(r.body.message).toBe('Wrong username or password');
  });

  test('changing password kills old tokens; weak passwords refused', async () => {
    const a = await makeAdmin('ops');
    await http().post('/v1/admin/auth/password').set(auth(a.token)).send({ current: a.password, next: 'short1' }).expect(400);
    const r = await http().post('/v1/admin/auth/password').set(auth(a.token)).send({ current: a.password, next: 'New-strong-pass-1' }).expect(201);
    await http().get('/v1/admin/auth/me').set(auth(a.token)).expect(401);
    await http().get('/v1/admin/auth/me').set(auth(r.body.token)).expect(200);
  });

  test('admin tokens and app tokens are not interchangeable', async () => {
    const u = await login();
    await http().get('/v1/admin/stats').set(auth(u.token)).expect(403);
    await http().get('/v1/me/home').set(auth(owner.token)).expect(403);
  });

  test('roles: support resolves disputes but cannot approve shops; ops cannot edit plans', async () => {
    const support = await makeAdmin('support');
    const ops = await makeAdmin('ops');
    const o = await login();
    const s = await http().post('/v1/shops').set(auth(o.token)).send(shopBody()).expect(201);
    await http().post(`/v1/admin/shops/${s.body.id}/status`).set(auth(support.token)).send({ status: 'approved' }).expect(403);
    await http().get(`/v1/admin/shops/${s.body.id}`).set(auth(support.token)).expect(200);
    await http().get('/v1/admin/disputes').set(auth(support.token)).expect(200);
    await http().post(`/v1/admin/shops/${s.body.id}/status`).set(auth(ops.token)).send({ status: 'approved' }).expect(201);
    await http().post('/v1/admin/plans').set(auth(ops.token)).send({ code: 'x1', name: 'X', priceRupees: 1, maxStaff: 1, smsIncluded: 0, features: [] }).expect(403);
    await http().get('/v1/admin/revenue').set(auth(ops.token)).expect(403);
  });

  test('deactivating an admin ends their session; the last owner cannot be removed', async () => {
    const a = await makeAdmin('ops');
    await http().patch(`/v1/admin/team/${a.id}`).set(auth(owner.token)).send({ active: false }).expect(200);
    await http().get('/v1/admin/stats').set(auth(a.token)).expect(401);
    await http().patch(`/v1/admin/team/${owner.id}`).set(auth(owner.token)).send({ role: 'ops' }).expect(400);
  });
});

describe('billing', () => {
  test('approval starts a 30-day trial on the default plan', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    const b = (await http().get('/v1/shop/billing').set(auth(o.token, shopId)).expect(200)).body;
    expect(b.state).toBe('trial');
    expect(b.plan.code).toBe('pro');
    expect(b.daysLeft).toBe(30);
    expect(b.testMode).toBe(true);
    expect((await shopMe(o.token, shopId)).billing).toBe('trial');
  });

  test('after grace the shop is read-only: no points or SMS, but customers can still redeem', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    const c = await makeCustomer();
    await bill(o.token, shopId, c.userId, 20000).expect(201);
    // trial ended 3 days ago -> grace (7 days)
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '3 days' WHERE shop_id = $1`, [shopId]);
    expect((await shopMe(o.token, shopId)).billing).toBe('grace');
    await bill(o.token, shopId, c.userId, 1000).expect(201);
    // 10 days ago -> read-only
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '10 days' WHERE shop_id = $1`, [shopId]);
    const blocked = await bill(o.token, shopId, c.userId, 1000).expect(402);
    expect(blocked.body.code).toBe('PLAN_EXPIRED');
    await http().post('/v1/shop/messages').set(auth(o.token, shopId)).send({ segment: 'all', text: 'Diwali offer' }).expect(402);
    const r = await http().post('/v1/shop/redemptions').set(auth(o.token, shopId)).send({ customerId: c.userId, points: 500, method: 'cash' });
    expect(r.status).toBe(201);
  });

  test('paying a plan (test mode) activates it, adds included SMS, extends from the current end; replay is a no-op', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    const before = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    const ord = await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'plan', planCode: 'basic' }).expect(201);
    expect(ord.body.amountPaise).toBe(49900);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_x', signature: 'bad' }).expect(400);
    const v = await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_1', signature: 'test' }).expect(201);
    expect(v.body.smsAdded).toBe(100);
    const again = await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_1', signature: 'test' }).expect(201);
    expect(again.body.smsBalance).toBe(v.body.smsBalance);
    const after = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    expect(after.state).toBe('active');
    expect(after.plan.code).toBe('basic');
    // paid during a 30-day trial: about 30 + one month
    expect(after.daysLeft).toBeGreaterThanOrEqual(before.daysLeft + 28);
    expect(after.payments).toHaveLength(1);
  });

  test('a lapsed shop that pays is unblocked immediately; period starts today', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    const c = await makeCustomer();
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '40 days' WHERE shop_id = $1`, [shopId]);
    await bill(o.token, shopId, c.userId, 5000).expect(402);
    await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'sms_pack', packCode: 'sms500' }).expect(402);
    const ord = await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'plan', planCode: 'pro' }).expect(201);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_2', signature: 'test' }).expect(201);
    await bill(o.token, shopId, c.userId, 5000).expect(201);
    const b = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    expect(b.daysLeft).toBeGreaterThanOrEqual(28);
    expect(b.daysLeft).toBeLessThanOrEqual(31);
  });

  test('staff limit follows the plan', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    await pg.query(`UPDATE shop_subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'basic') WHERE shop_id = $1`, [shopId]);
    await http().post('/v1/shop/staff').set(auth(o.token, shopId)).send({ mobile: '9811100001', name: 'Amit' }).expect(201);
    const r = await http().post('/v1/shop/staff').set(auth(o.token, shopId)).send({ mobile: '9811100002', name: 'Sunil' }).expect(402);
    expect(r.body.code).toBe('STAFF_LIMIT');
  });

  test('admin can record an offline payment / free days', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '40 days' WHERE shop_id = $1`, [shopId]);
    await http().post(`/v1/admin/shops/${shopId}/extend`).set(auth(owner.token)).send({ days: 30, amountRupees: 999, note: 'Paid cash at office' }).expect(201);
    expect((await shopMe(o.token, shopId)).billing).toBe('active');
    const pays = (await http().get('/v1/admin/payments').set(auth(owner.token)).query({ shopId }).expect(200)).body;
    expect(pays[0]).toMatchObject({ kind: 'manual_extension', recorded_by: owner.username });
  });

  test('webhook is verified by signature and applies the payment once', async () => {
    const { BillingService } = await import('../src/billing/billing.service');
    const { config } = await import('../src/config');
    const { owner: o, shopId } = await makeShop(owner);
    const ord = await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'sms_pack', packCode: 'sms1000' }).expect(201);
    config.razorpay.webhookSecret = 'whsec_test';
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh1', order_id: ord.body.orderId } } } });
    const sig = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    await http().post('/v1/billing/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'bad').send(body).expect(400);
    const smsBefore = (await pg.query('SELECT sms_balance FROM shops WHERE id = $1', [shopId])).rows[0].sms_balance;
    for (let i = 0; i < 2; i++) await http().post('/v1/billing/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).send(body).expect(201);
    const smsAfter = (await pg.query('SELECT sms_balance FROM shops WHERE id = $1', [shopId])).rows[0].sms_balance;
    expect(smsAfter - smsBefore).toBe(1000);
    config.razorpay.webhookSecret = '';
    expect(BillingService).toBeDefined();
  });
});

describe('admin portal data', () => {
  test('analytics, shop detail with nearby duplicates, customer lookup, settings and audit', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    const { shopId: twin } = await makeShop(owner, { location: { lat: 28.47215, lng: 77.04365, accuracyM: 5 } });
    const c = await makeCustomer({ name: 'Suresh Lookup' });
    await bill(o.token, shopId, c.userId, 10000).expect(201);

    const a = (await http().get('/v1/admin/analytics?days=7').set(auth(owner.token)).expect(200)).body;
    expect(a.growth).toHaveLength(7);
    expect(a.growth[6].points_issued).toBeGreaterThanOrEqual(500);
    expect(a.cities.find((x: any) => x.city === 'Gurugram').shops).toBeGreaterThanOrEqual(2);

    const d = (await http().get(`/v1/admin/shops/${shopId}`).set(auth(owner.token)).expect(200)).body;
    expect(d.nearbyShops.map((n: any) => n.id)).toContain(twin);
    expect(d.billing.state).toBe('trial');
    expect(d.totals.points_issued).toBeGreaterThanOrEqual(500);

    const found = (await http().get('/v1/admin/customers?q=suresh').set(auth(owner.token)).expect(200)).body;
    expect(found[0].name).toBe('Suresh Lookup');
    const byMobile = (await http().get(`/v1/admin/customers?q=${c.mobile.slice(-6)}`).set(auth(owner.token)).expect(200)).body;
    expect(byMobile[0].id).toBe(c.userId);
    const cd = (await http().get(`/v1/admin/customers/${c.userId}`).set(auth(owner.token)).expect(200)).body;
    expect(cd.wallets[0].balance_points).toBe(500);

    await http().put('/v1/admin/settings').set(auth(owner.token)).send({ grace_days: 999 }).expect(400);
    const st = (await http().put('/v1/admin/settings').set(auth(owner.token)).send({ trial_days: 14, defaultPlan: 'basic' }).expect(200)).body;
    expect(st.editable.find((e: any) => e.key === 'trial_days').value).toBe(14);
    const { owner: o2, shopId: s2 } = await makeShop(owner);
    const b2 = (await http().get('/v1/shop/billing').set(auth(o2.token, s2))).body;
    expect([b2.daysLeft, b2.plan.code]).toEqual([14, 'basic']);
    await http().put('/v1/admin/settings').set(auth(owner.token)).send({ trial_days: 30, defaultPlan: 'pro' }).expect(200);

    const audit = (await http().get('/v1/admin/audit').set(auth(owner.token)).expect(200)).body;
    expect(audit.find((x: any) => x.action === 'settings.update').by_admin).toBe(owner.username);
  });
});

describe('plan reminders', () => {
  test('one SMS per shop when its plan enters grace, never twice for the same period', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '2 days' WHERE shop_id = $1`, [shopId]);
    const count = async () => Number((await pg.query(`SELECT count(*) FROM sms_outbox WHERE template = 'plan_due' AND mobile = $1`, ['91' + o.mobile])).rows[0].count);
    await http().post('/v1/admin/jobs/plan-reminders').set(auth(owner.token)).expect(201);
    await http().post('/v1/admin/jobs/plan-reminders').set(auth(owner.token)).expect(201);
    expect(await count()).toBe(1);
  });
});
