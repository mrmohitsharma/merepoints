import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: Awaited<ReturnType<typeof makeAdmin>>;
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

const send = (A: { owner: { token: string }; shopId: number }, over: Record<string, unknown> = {}) =>
  http().post('/v1/shop/notifications').set(auth(A.owner.token, A.shopId)).send({ title: 'Diwali offer', body: 'Namaste {name}, you have {points} pts.', ...over });
const ago = (shopId: number, customerId: number, days: number) =>
  pg.query(`UPDATE wallets SET last_visit_at = now() - make_interval(days => $3) WHERE shop_id = $1 AND customer_id = $2`, [shopId, customerId, days]);

describe('shop notifications', () => {
  test('audience filters: recency, work type, combined, and one customer', async () => {
    const A = await makeShop(admin);
    const carp = await makeCustomer({ name: 'Ramesh Kumar', profession: 'carpenter' });
    const paint = await makeCustomer({ name: 'Suresh Lal', profession: 'painter' });
    await bill(A.owner.token, A.shopId, carp.userId, 2000, 'N-1').expect(201);
    await bill(A.owner.token, A.shopId, paint.userId, 1000, 'N-2').expect(201);
    await ago(A.shopId, paint.userId, 40);
    const count = async (f: object) => (await http().post('/v1/shop/notifications/audience').set(auth(A.owner.token, A.shopId)).send(f).expect(201)).body.count;
    expect(await count({})).toBe(2);
    expect(await count({ visitedWithinDays: 7 })).toBe(1);
    expect(await count({ notVisitedDays: 30 })).toBe(1);
    expect(await count({ notVisitedDays: 60 })).toBe(0);
    expect(await count({ professions: ['painter'] })).toBe(1);
    expect(await count({ professions: ['painter'], visitedWithinDays: 7 })).toBe(0);
    expect(await count({ spend: 'new_customers' })).toBe(2);
    expect(await count({ mobile: carp.mobile })).toBe(1);
    await http().post('/v1/shop/notifications/audience').set(auth(A.owner.token, A.shopId)).send({ visitedWithinDays: 7, notVisitedDays: 30 }).expect(400);
    await http().post('/v1/shop/notifications/audience').set(auth(A.owner.token, A.shopId)).send({ visitedWithinDays: 5 }).expect(400);
  });

  test('send, inbox, delivered/opened/clicked and bought insights', async () => {
    const A = await makeShop(admin);
    const c1 = await makeCustomer({ name: 'Ramesh Kumar' });
    const c2 = await makeCustomer({ name: 'Suresh Lal' });
    await bill(A.owner.token, A.shopId, c1.userId, 2000, 'I-1').expect(201);
    await bill(A.owner.token, A.shopId, c2.userId, 2000, 'I-2').expect(201);
    const made = (await send(A).expect(201)).body;
    expect(made).toMatchObject({ scheduled: false, recipients: 2 });

    const inbox = (await http().get('/v1/me/notifications').set(auth(c1.token)).expect(200)).body;
    expect(inbox.unread).toBe(2); // the earn message + the campaign
    expect(inbox.items.find((i: any) => i.title === 'Diwali offer')).toMatchObject({ title: 'Diwali offer', body: 'Namaste Ramesh, you have 100 pts.', shop_id: A.shopId, opened: false });

    await http().post(`/v1/me/notifications/${made.id}/open`).set(auth(c1.token)).expect(201);
    await http().post(`/v1/me/notifications/${made.id}/open`).set(auth(c1.token)).expect(201); // second open does not double count
    await http().post(`/v1/me/notifications/${made.id}/click`).set(auth(c1.token)).expect(201);
    expect((await http().get('/v1/me/notifications/unread-count').set(auth(c1.token)).expect(200)).body.unread).toBe(1); // only the earn message left

    await bill(A.owner.token, A.shopId, c1.userId, 1500, 'I-3').expect(201); // bought after the notification
    const d = (await http().get(`/v1/shop/notifications/${made.id}`).set(auth(A.owner.token, A.shopId)).expect(200)).body;
    expect(d).toMatchObject({ sent: 2, delivered: 1, opened: 1, clicked: 1, bought: 1 });
    expect(d.people.find((p: any) => p.customer_id === c1.userId)).toMatchObject({ bought: true });
    expect(d.people.find((p: any) => p.customer_id === c2.userId).opened_at).toBeNull();

    const list = (await http().get('/v1/shop/notifications').set(auth(A.owner.token, A.shopId)).expect(200)).body;
    expect(list[0]).toMatchObject({ id: made.id, sent: 2, opened: 1, clicked: 1 });
    // Another customer cannot touch it, and another shop cannot see it.
    const other = await makeCustomer();
    await http().post(`/v1/me/notifications/${made.id}/open`).set(auth(other.token)).expect(404);
    const B = await makeShop(admin);
    await http().get(`/v1/shop/notifications/${made.id}`).set(auth(B.owner.token, B.shopId)).expect(404);
  });

  test('only matching people get it; empty audience, bad button and daily limit are refused', async () => {
    const A = await makeShop(admin);
    const carp = await makeCustomer({ profession: 'carpenter' });
    await makeCustomer({ profession: 'painter' });
    await bill(A.owner.token, A.shopId, carp.userId, 2000, 'F-1').expect(201);
    expect((await send(A, { filters: { professions: ['painter'] } }).expect(400)).body.code).toBe('NO_RECIPIENTS');
    expect((await send(A, { action: { type: 'product' } }).expect(400)).body.code).toBe('PRODUCT_REQUIRED');
    expect((await send(A, { action: { type: 'call' } }).expect(400)).body.code).toBe('NO_PHONE');
    await pg.query(`UPDATE shops SET phone = '9876543210' WHERE id = $1`, [A.shopId]);
    const ok = (await send(A, { action: { type: 'call' }, filters: { professions: ['carpenter'] } }).expect(201)).body;
    const inbox = (await http().get('/v1/me/notifications').set(auth(carp.token)).expect(200)).body.items[0];
    expect(inbox).toMatchObject({ action_type: 'call', action_label: 'Call shop', phone: '9876543210' });
    expect(ok.recipients).toBe(1);
    for (let i = 0; i < 4; i++) await send(A, { title: `Offer ${i}` }).expect(201);
    expect((await send(A).expect(403)).body.code).toBe('DAILY_LIMIT');
  });

  test('scheduled notifications wait, can be cancelled, and go out when due', async () => {
    const A = await makeShop(admin);
    const c = await makeCustomer();
    await bill(A.owner.token, A.shopId, c.userId, 2000, 'S-1').expect(201);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const a = (await send(A, { scheduledAt: at }).expect(201)).body;
    const b = (await send(A, { title: 'Second', scheduledAt: at }).expect(201)).body;
    expect(a.scheduled).toBe(true);
    expect((await http().get('/v1/me/notifications').set(auth(c.token)).expect(200)).body.items.filter((i: any) => !i.title.startsWith('+'))).toHaveLength(0);
    await http().post(`/v1/shop/notifications/${b.id}/cancel`).set(auth(A.owner.token, A.shopId)).expect(201);
    await pg.query(`UPDATE notifications SET scheduled_at = now() - interval '1 minute' WHERE id = ANY($1)`, [[a.id, b.id]]);
    await app().sendDue();
    const items = (await http().get('/v1/me/notifications').set(auth(c.token)).expect(200)).body.items;
    expect(items.map((i: any) => i.title).filter((t: string) => !t.startsWith('+'))).toEqual(['Diwali offer']); // cancelled one never sent
    await http().post(`/v1/shop/notifications/${a.id}/cancel`).set(auth(A.owner.token, A.shopId)).expect(400); // already sent
  });

  test('device tokens: register, move to another user, remove', async () => {
    const c1 = await makeCustomer(), c2 = await makeCustomer();
    const token = 'x'.repeat(40);
    await http().post('/v1/me/devices').set(auth(c1.token)).send({ token, platform: 'android' }).expect(201);
    await http().post('/v1/me/devices').set(auth(c2.token)).send({ token, platform: 'android' }).expect(201); // same phone, new login
    expect((await pg.query(`SELECT user_id FROM device_tokens WHERE token = $1`, [token])).rows).toEqual([{ user_id: c2.userId }]);
    await http().post('/v1/me/devices/remove').set(auth(c2.token)).send({ token }).expect(201);
    expect((await pg.query(`SELECT 1 FROM device_tokens WHERE token = $1`, [token])).rowCount).toBe(0);
  });
});

import { app as nest } from './helpers';
import { NotificationsService } from '../src/notifications/notifications.service';
const app = () => nest.get(NotificationsService);
