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
  test('a new shop starts on the free Basic package: nothing locked out, paid features off', async () => {
    const { owner: o, shopId } = await makeShop(owner, {}, { plan: null });
    const b = (await http().get('/v1/shop/billing').set(auth(o.token, shopId)).expect(200)).body;
    expect(b.state).toBe('free');
    expect(b.plan).toMatchObject({ code: 'basic', fellBack: false });
    expect(b.features).toEqual([]);
    expect(b.testMode).toBe(true);
    expect((await shopMe(o.token, shopId)).billing).toBe('free');
    const c = await makeCustomer();
    await bill(o.token, shopId, c.userId, 20000).expect(201); // points still work on Basic
    const locked = await http().get('/v1/shop/reports/daily').set(auth(o.token, shopId));
    expect(locked.status).toBe(402);
    expect(locked.body.code).toBe('FEATURE_LOCKED');
  });

  test('after grace a paid shop falls back to Basic: points and redeeming keep working, paid features switch off', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    const c = await makeCustomer();
    await bill(o.token, shopId, c.userId, 20000).expect(201);
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '3 days' WHERE shop_id = $1`, [shopId]);
    expect((await shopMe(o.token, shopId)).billing).toBe('grace');
    await http().get('/v1/shop/reports/daily').set(auth(o.token, shopId)).expect(200); // grace = full access
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '10 days' WHERE shop_id = $1`, [shopId]);
    await bill(o.token, shopId, c.userId, 1000).expect(201);
    const b = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    expect(b.plan).toMatchObject({ code: 'basic', fellBack: true });
    const locked = await http().post('/v1/shop/notifications/audience').set(auth(o.token, shopId)).send({});
    expect(locked.body.code).toBe('FEATURE_LOCKED');
    const r = await http().post('/v1/shop/redemptions').set(auth(o.token, shopId)).send({ customerId: c.userId, points: 500, method: 'cash' });
    expect(r.status).toBe(201);
  });

  test('paying a package (test mode) activates it with its features; replay is a no-op; yearly lasts a year', async () => {
    const { owner: o, shopId } = await makeShop(owner, {}, { plan: null });
    const ord = await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'plan', planCode: 'business' }).expect(201);
    expect(ord.body.amountPaise).toBe(99900);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_x', signature: 'bad' }).expect(400);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_1', signature: 'test' }).expect(201);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_1', signature: 'test' }).expect(201);
    const after = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    expect(after.state).toBe('active');
    expect(after.plan.code).toBe('business');
    expect(after.features).toContain('dues_book');
    expect(after.features).not.toContain('reports');
    expect(after.daysLeft).toBeGreaterThanOrEqual(28);
    expect(after.payments).toHaveLength(1);

    const yr = await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'plan', planCode: 'advanced', period: 'yearly' }).expect(201);
    expect(yr.body.amountPaise).toBe(1999000);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: yr.body.orderId, signature: 'test' }).expect(201);
    const y = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    expect(y.plan.code).toBe('advanced');
    expect(y.daysLeft).toBeGreaterThan(380); // rest of the month + a year
    // the free package cannot be "bought"
    await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'plan', planCode: 'basic' }).expect(400);
  });

  test('a lapsed shop that pays gets its features back; period starts today', async () => {
    const { owner: o, shopId } = await makeShop(owner);
    await pg.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '40 days' WHERE shop_id = $1`, [shopId]);
    await http().get('/v1/shop/reports/daily').set(auth(o.token, shopId)).expect(402);
    await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'sms_pack', packCode: 'sms500' }).expect(402);
    await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'addon', packCode: 'notif100' }).expect(402);
    const ord = await http().post('/v1/shop/billing/orders').set(auth(o.token, shopId)).send({ kind: 'plan', planCode: 'advanced' }).expect(201);
    await http().post('/v1/shop/billing/verify').set(auth(o.token, shopId)).send({ orderId: ord.body.orderId, paymentId: 'pay_2', signature: 'test' }).expect(201);
    await http().get('/v1/shop/reports/daily').set(auth(o.token, shopId)).expect(200);
    const b = (await http().get('/v1/shop/billing').set(auth(o.token, shopId))).body;
    expect(b.daysLeft).toBeGreaterThanOrEqual(28);
    expect(b.daysLeft).toBeLessThanOrEqual(31);
  });

  test('staff logins need the Staff feature and follow the package staff limit', async () => {
    const { owner: o, shopId } = await makeShop(owner, {}, { plan: 'business' });
    const locked = await http().post('/v1/shop/staff').set(auth(o.token, shopId)).send({ mobile: '9811100001', name: 'Amit' });
    expect(locked.body.code).toBe('FEATURE_LOCKED');
    await pg.query(`UPDATE plans SET max_staff = 1 WHERE code = 'advanced'`);
    try {
      await pg.query(`UPDATE shop_subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'advanced') WHERE shop_id = $1`, [shopId]);
      await http().post('/v1/shop/staff').set(auth(o.token, shopId)).send({ mobile: '9811100001', name: 'Amit' }).expect(201);
      const r = await http().post('/v1/shop/staff').set(auth(o.token, shopId)).send({ mobile: '9811100002', name: 'Sunil' }).expect(402);
      expect(r.body.code).toBe('STAFF_LIMIT');
    } finally {
      await pg.query(`UPDATE plans SET max_staff = 10 WHERE code = 'advanced'`);
    }
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
    config.cashfree.secretKey = 'cf_secret_test';
    const body = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: ord.body.orderId }, payment: { cf_payment_id: 'cfpay_1', payment_status: 'SUCCESS' } } });
    const ts = String(Date.now());
    const sig = createHmac('sha256', 'cf_secret_test').update(ts + body).digest('base64');
    await http().post('/v1/billing/cashfree/webhook').set('Content-Type', 'application/json').set('x-webhook-timestamp', ts).set('x-webhook-signature', 'bad').send(body).expect(400);
    const smsBefore = (await pg.query('SELECT sms_balance FROM shops WHERE id = $1', [shopId])).rows[0].sms_balance;
    for (let i = 0; i < 2; i++) await http().post('/v1/billing/cashfree/webhook').set('Content-Type', 'application/json').set('x-webhook-timestamp', ts).set('x-webhook-signature', sig).send(body).expect(201);
    const smsAfter = (await pg.query('SELECT sms_balance FROM shops WHERE id = $1', [shopId])).rows[0].sms_balance;
    expect(smsAfter - smsBefore).toBe(1000);
    config.cashfree.secretKey = '';
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
    const st = (await http().put('/v1/admin/settings').set(auth(owner.token)).send({ trial_days: 14, defaultPlan: 'business' }).expect(200)).body;
    expect(st.editable.find((e: any) => e.key === 'trial_days').value).toBe(14);
    const { owner: o2, shopId: s2 } = await makeShop(owner, {}, { plan: null });
    const b2 = (await http().get('/v1/shop/billing').set(auth(o2.token, s2))).body;
    expect([b2.daysLeft, b2.plan.code]).toEqual([14, 'business']);
    await http().put('/v1/admin/settings').set(auth(owner.token)).send({ trial_days: 0, defaultPlan: 'basic' }).expect(200);
    // download links for the WhatsApp invite
    await http().put('/v1/admin/settings').set(auth(owner.token)).send({ inviteAndroidUrl: 'not a link' }).expect(400);
    const inv = await http().put('/v1/admin/settings').set(auth(owner.token)).send({ inviteAndroidUrl: 'https://play.google.com/store/apps/details?id=in.merepoints', inviteIosUrl: '' }).expect(200);
    expect(inv.body.invite).toEqual({ androidUrl: 'https://play.google.com/store/apps/details?id=in.merepoints', iosUrl: '' });
    const anyone = await makeCustomer();
    expect((await http().get('/v1/invite/links').set(auth(anyone.token)).expect(200)).body).toEqual({ androidUrl: 'https://play.google.com/store/apps/details?id=in.merepoints', iosUrl: null });

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
