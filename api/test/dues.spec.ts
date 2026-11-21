import { assertLedgerInvariants, auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown, wallet } from './helpers';

let admin: Awaited<ReturnType<typeof makeAdmin>>;
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(async () => { await assertLedgerInvariants(); await shutdown(); });

type S = Awaited<ReturnType<typeof makeShop>>;
const dues = (A: S) => ({
  add: (b: Record<string, unknown>) => http().post('/v1/shop/dues').set(auth(A.owner.token, A.shopId)).send(b),
  pay: (b: Record<string, unknown>, key?: string) => { const r = http().post('/v1/shop/dues/pay').set(auth(A.owner.token, A.shopId)); if (key) r.set('Idempotency-Key', key); return r.send(b); },
  book: (id: number) => http().get(`/v1/shop/dues/customer/${id}`).set(auth(A.owner.token, A.shopId)),
});

describe('dues book', () => {
  test('add a due, part payment earns points, balance and history follow', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer();
    const added = (await D.add({ customerId: c.userId, amountRupees: 5000, note: '20 sheets ply', photoUrls: ['https://x.test/a.jpg'] }).expect(201)).body;
    expect(added.balanceRupees).toBe(5000);
    expect(await wallet(c.userId, A.shopId)).toBeTruthy(); // a due connects the customer to the shop
    expect((await wallet(c.userId, A.shopId)).earned_points).toBe(0); // no points on credit

    const paid = (await D.pay({ customerId: c.userId, amountRupees: 2000, method: 'upi' }).expect(201)).body;
    expect(paid).toMatchObject({ balanceRupees: 3000, points: 100 }); // 5% of 2000
    expect((await wallet(c.userId, A.shopId)).balance_points).toBe(100);

    const book = (await D.book(c.userId).expect(200)).body;
    expect(book).toMatchObject({ balanceRupees: 3000, overdue: false });
    expect(book.entries.map((e: any) => e.kind)).toEqual(['payment', 'due']);
    const list = (await http().get('/v1/shop/dues/customers').set(auth(A.owner.token, A.shopId)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ customer_id: c.userId, balance_rupees: 3000 });
  });

  test('payment rules: not more than due, small payment keeps the payment but no points, points can be switched off', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer();
    await D.add({ customerId: c.userId, amountRupees: 3000 }).expect(201);
    expect((await D.pay({ customerId: c.userId, amountRupees: 3500, method: 'cash' }).expect(400)).body.code).toBe('MORE_THAN_DUE');
    const small = (await D.pay({ customerId: c.userId, amountRupees: 300, method: 'cash' }).expect(201)).body; // below the ₹500 minimum bill
    expect(small.points).toBe(0);
    expect(small.pointsNote).toMatch(/Minimum bill/);
    const off = (await D.pay({ customerId: c.userId, amountRupees: 1000, method: 'cash', earnPoints: false }).expect(201)).body;
    expect(off).toMatchObject({ points: 0, pointsNote: null, balanceRupees: 1700 });
    expect((await D.pay({ customerId: c.userId, amountRupees: 1700, method: 'cheque' }).expect(201)).body.balanceRupees).toBe(0);
    expect((await D.pay({ customerId: c.userId, amountRupees: 100, method: 'cash' }).expect(400)).body.message).toMatch(/no dues/);
    expect((await http().get('/v1/shop/dues/customers').set(auth(A.owner.token, A.shopId)).expect(200)).body).toHaveLength(0);
  });

  test('retrying a payment with the same key records it and its points once', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer();
    await D.add({ customerId: c.userId, amountRupees: 4000 }).expect(201);
    await D.pay({ customerId: c.userId, amountRupees: 1000, method: 'upi' }, 'pay-key-1').expect(201);
    await D.pay({ customerId: c.userId, amountRupees: 1000, method: 'upi' }, 'pay-key-1').expect(201);
    expect((await D.book(c.userId).expect(200)).body.balanceRupees).toBe(3000);
    expect((await wallet(c.userId, A.shopId)).balance_points).toBe(50);
  });

  test('validation: 3 photos max, no past due date, unknown customer', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer();
    const u = (n: number) => Array.from({ length: n }, (_, i) => `https://x.test/${i}.jpg`);
    await D.add({ customerId: c.userId, amountRupees: 100, photoUrls: u(4) }).expect(400);
    await D.add({ customerId: c.userId, amountRupees: 100, photoUrls: u(3) }).expect(201);
    await D.add({ customerId: c.userId, amountRupees: 100, dueDate: '2020-01-01' }).expect(400);
    await D.add({ customerId: 99999999, amountRupees: 100 }).expect(404);
  });

  test('overdue is flagged once a promised date passes', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await D.add({ customerId: c.userId, amountRupees: 800, dueDate: tomorrow }).expect(201);
    expect((await D.book(c.userId).expect(200)).body).toMatchObject({ overdue: false, nextDueDate: tomorrow });
    await pg.query(`UPDATE due_entries SET due_date = current_date - 2 WHERE shop_id = $1`, [A.shopId]);
    expect((await D.book(c.userId).expect(200)).body.overdue).toBe(true);
  });

  test('undo: a due with payments against it and a payment that earned points are protected', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer();
    const due = (await D.add({ customerId: c.userId, amountRupees: 2000 }).expect(201)).body;
    const p1 = (await D.pay({ customerId: c.userId, amountRupees: 500, method: 'cash', earnPoints: false }).expect(201)).body;
    const p2 = (await D.pay({ customerId: c.userId, amountRupees: 1000, method: 'cash' }).expect(201)).body;
    const undo = (id: number) => http().post(`/v1/shop/dues/${id}/undo`).set(auth(A.owner.token, A.shopId));
    expect((await undo(due.id).expect(400)).body.code).toBe('PAYMENTS_EXIST');
    expect((await undo(p2.id).expect(400)).body.code).toBe('PAYMENT_HAS_POINTS');
    expect((await undo(p1.id).expect(201)).body.balanceRupees).toBe(1000);
    expect((await undo(p1.id).expect(400)).body.code).toBe('ALREADY_UNDONE');
  });

  test('customer sees only their own dues, read-only', async () => {
    const A = await makeShop(admin), B = await makeShop(admin);
    const c = await makeCustomer(), other = await makeCustomer();
    await dues(A).add({ customerId: c.userId, amountRupees: 1200, note: 'hinges' }).expect(201);
    await dues(B).add({ customerId: c.userId, amountRupees: 300 }).expect(201);
    const mine = (await http().get('/v1/me/dues').set(auth(c.token)).expect(200)).body;
    expect(mine.map((m: any) => [m.shop_id, m.balance_rupees])).toEqual([[A.shopId, 1200], [B.shopId, 300]]);
    const at = (await http().get(`/v1/me/dues/${A.shopId}`).set(auth(c.token)).expect(200)).body;
    expect(at.balanceRupees).toBe(1200);
    expect(at.entries[0]).toMatchObject({ kind: 'due', note: 'hinges' });
    expect(at.entries[0].by_name).toBeUndefined();
    expect((await http().get('/v1/me/dues').set(auth(other.token)).expect(200)).body).toEqual([]);
    await http().post('/v1/me/dues').set(auth(c.token)).send({ customerId: c.userId, amountRupees: 1 }).expect(404); // no way to write
    await http().get('/v1/shop/dues/customers').set(auth(c.token, A.shopId)).expect(403); // a customer is not shop staff
  });

  test('reminder reaches the customer inbox, once a day, outside the daily notification limit', async () => {
    const A = await makeShop(admin), D = dues(A);
    const c = await makeCustomer({ name: 'Ramesh Kumar' });
    const remind = () => http().post(`/v1/shop/dues/customer/${c.userId}/remind`).set(auth(A.owner.token, A.shopId));
    expect((await remind().expect(400)).body.code).toBe('NO_DUES');
    await D.add({ customerId: c.userId, amountRupees: 2500 }).expect(201);
    await remind().expect(201);
    expect((await remind().expect(429)).body.code).toBe('RATE_LIMITED');
    const item = (await http().get('/v1/me/notifications').set(auth(c.token)).expect(200)).body.items[0];
    expect(item.title).toMatch(/^Payment reminder/);
    expect(item.body).toMatch(/Namaste Ramesh, ₹2,500 is due/);
    for (let i = 0; i < 5; i++) {
      await http().post('/v1/shop/notifications').set(auth(A.owner.token, A.shopId)).send({ title: `Offer ${i}`, body: 'Hello there', filters: {} }).expect(201);
    }
  });
});

describe('bill photos', () => {
  test('a bill keeps up to 3 photos; the 4th is refused; uploads over 500 KB are refused', async () => {
    const A = await makeShop(admin);
    const c = await makeCustomer();
    const u = (n: number) => Array.from({ length: n }, (_, i) => `https://x.test/bill${i}.jpg`);
    await http().post('/v1/shop/points/bill').set(auth(A.owner.token, A.shopId)).send({ customerId: c.userId, amountRupees: 1000, photoUrls: u(4) }).expect(400);
    await bill(A.owner.token, A.shopId, c.userId, 1000, 'PH-1').expect(201);
    await http().post('/v1/shop/points/bill').set(auth(A.owner.token, A.shopId)).send({ customerId: c.userId, amountRupees: 1000, invoiceNo: 'PH-2', photoUrls: u(3) }).expect(201);
    const row = (await pg.query(`SELECT photo_urls, photo_url FROM bills WHERE invoice_no = 'PH-2'`)).rows[0];
    expect(row.photo_urls).toHaveLength(3);
    expect(row.photo_url).toBe(u(1)[0]);
    const slot = (size: number) => http().post('/v1/uploads').set(auth(A.owner.token)).send({ purpose: 'bill', contentType: 'image/jpeg', size });
    await slot(480 * 1024).expect(201);
    expect((await slot(600 * 1024).expect(400)).body.message).toMatch(/500 KB/);
  });
});
