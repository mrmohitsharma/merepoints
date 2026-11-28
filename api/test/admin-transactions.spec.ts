import { assertLedgerInvariants, auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, pg, shutdown, wallet } from './helpers';

let owner: { token: string };
beforeAll(async () => { await boot(); owner = await makeAdmin('owner'); });
afterAll(async () => { await assertLedgerInvariants(); await shutdown(); });

const list = (q: Record<string, unknown>, token = owner.token) => http().get('/v1/admin/transactions').query(q).set(auth(token));

describe('Super Admin transactions', () => {
  it('shows every type in one list with totals, filters and role rules', async () => {
    const shop = await makeShop(owner);
    const c = await makeCustomer({ name: 'Tx Customer' });
    const sh = auth(shop.owner.token, shop.shopId);
    await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'visits', target: 2, periodDays: 30, bonusPoints: 200 }).expect(201);
    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'T-1').expect(201); // 50
    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'T-2').expect(201); // 50 + goal 200
    await http().post(`/v1/admin/customers/${c.userId}/points`).set(auth(owner.token)).send({ shopId: shop.shopId, action: 'add', points: 10, reason: 'Goodwill add' }).expect(201);
    const r = (await http().post('/v1/shop/redemptions').set(sh).send({ customerId: c.userId, method: 'upi', points: 1000 }));
    // 310 points only, below min: use cash redemption after top up
    expect(r.status).toBe(400);

    const all = (await list({ shopId: shop.shopId }).expect(200)).body;
    expect(all.rows.map((x: any) => x.kind).sort()).toEqual(['admin_add', 'bill', 'bill', 'goal_bonus']);
    expect(all.summary).toMatchObject({ pointsGiven: 100, goalBonusPoints: 200, adminNet: 10, pointsRedeemed: 0, reversedPoints: 0 });
    expect(all.rows.find((x: any) => x.kind === 'goal_bonus')).toMatchObject({ points: 200, note: expect.stringContaining('Goal reached') });
    expect((await list({ shopId: shop.shopId, group: 'bonus' }).expect(200)).body.rows.map((x: any) => x.kind)).toEqual(['goal_bonus']);
    expect((await list({ shopId: shop.shopId, group: 'given' }).expect(200)).body.total).toBe(2);
    expect((await list({ customerId: c.userId, q: 'Tx Customer' }).expect(200)).body.total).toBe(4);
    expect((await list({ shopId: shop.shopId, q: 'nobody-matches' }).expect(200)).body.total).toBe(0);

    const support = await makeAdmin('support');
    expect((await list({ shopId: shop.shopId }, support.token)).status).toBe(200);
    const id = all.rows.find((x: any) => x.kind === 'bill').id;
    await http().post(`/v1/admin/transactions/${id}/revert`).set(auth(support.token)).send({ reason: 'Not allowed' }).expect(403);
  });

  it('reverting a bill takes back its goal bonus too, and the goal can be earned again', async () => {
    const shop = await makeShop(owner);
    const c = await makeCustomer();
    const sh = auth(shop.owner.token, shop.shopId);
    await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'visits', target: 2, periodDays: 30, bonusPoints: 200 }).expect(201);
    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'V-1').expect(201);
    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'V-2').expect(201); // balance 300
    const rows = (await list({ shopId: shop.shopId }).expect(200)).body.rows;
    const second = rows.filter((x: any) => x.kind === 'bill').find((x: any) => x.invoiceNo === 'V-2');
    expect(second.canRevert).toBe(true);

    expect((await http().post(`/v1/admin/transactions/${second.id}/revert`).set(auth(owner.token)).send({ reason: 'x' })).status).toBe(400); // reason too short
    const out = (await http().post(`/v1/admin/transactions/${second.id}/revert`).set(auth(owner.token)).send({ reason: 'Fake bill found' }).expect(201)).body;
    expect(out).toMatchObject({ kind: 'points', points: -250, balance: 50 });
    expect(out.bonusReversalIds).toHaveLength(1);
    expect((await wallet(c.userId, shop.shopId)).balance_points).toBe(50);
    expect((await pg.query('SELECT 1 FROM goal_awards WHERE customer_id = $1', [c.userId])).rowCount).toBe(0);

    const after = (await list({ shopId: shop.shopId }).expect(200)).body;
    expect(after.summary).toMatchObject({ pointsGiven: 50, goalBonusPoints: 0, reversedPoints: 250 });
    expect(after.rows.find((x: any) => x.id === second.id)).toMatchObject({ status: 'reversed', canRevert: false, blockedReason: 'Already reversed' });
    expect((await http().post(`/v1/admin/transactions/${second.id}/revert`).set(auth(owner.token)).send({ reason: 'Again please' })).status).toBe(409);

    // goal comes back after a fresh second visit
    const again = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'V-2b').expect(201)).body;
    expect(again.goalBonuses).toHaveLength(1);
    const audit = (await pg.query(`SELECT 1 FROM audit_log WHERE action = 'admin.points.reverse' AND shop_id = $1`, [shop.shopId])).rowCount;
    expect(audit).toBeGreaterThanOrEqual(2);
  });

  it('points already spent cannot be reverted; unpaid redemption can, paid cannot', async () => {
    const shop = await makeShop(owner);
    const c = await makeCustomer();
    const sh = auth(shop.owner.token, shop.shopId);
    await bill(shop.owner.token, shop.shopId, c.userId, 30000, 'S-1').expect(201); // 1500
    const earn = (await list({ shopId: shop.shopId }).expect(200)).body.rows[0];

    const r1 = (await http().post('/v1/shop/redemptions').set(sh).send({ customerId: c.userId, method: 'cash', points: 1000 }).expect(201)).body;
    const held = (await list({ shopId: shop.shopId, group: 'redeemed' }).expect(200)).body;
    expect(held.rows[0]).toMatchObject({ id: r1.redemptionId, status: 'held', points: -1000, canRevert: true });
    expect(held.summary.pointsRedeemed).toBe(1000);
    // Points are on hold, so the earn entry cannot be reverted now
    expect((await http().post(`/v1/admin/transactions/${earn.id}/revert`).set(auth(owner.token)).send({ reason: 'Try it' })).body.code).toBe('POINTS_ALREADY_USED');

    // unpaid: revert releases the points
    const back = (await http().post(`/v1/admin/transactions/${r1.redemptionId}/revert`).set(auth(owner.token)).send({ reason: 'Customer asked to cancel' }).expect(201)).body;
    expect(back).toMatchObject({ kind: 'redemption', status: 'cancelled', balance: 1500 });
    expect((await list({ shopId: shop.shopId, group: 'redeemed' }).expect(200)).body.summary.pointsRedeemed).toBe(0);

    // paid: refused
    const r2 = (await http().post('/v1/shop/redemptions').set(sh).send({ customerId: c.userId, method: 'cash', points: 1000 }).expect(201)).body;
    await http().post(`/v1/shop/redemptions/${r2.redemptionId}/paid`).set(sh).send({ paymentRef: 'cash given' }).expect(201);
    const row = (await list({ shopId: shop.shopId, group: 'redeemed' }).expect(200)).body.rows.find((x: any) => x.id === r2.redemptionId);
    expect(row).toMatchObject({ status: 'paid', canRevert: false, blockedReason: 'Already paid out, so it cannot be reverted' });
    const no = await http().post(`/v1/admin/transactions/${r2.redemptionId}/revert`).set(auth(owner.token)).send({ reason: 'Try to undo' });
    expect(no.status).toBe(409);
    expect(no.body.code).toBe('NOT_REVERTIBLE');
    expect((await http().post('/v1/admin/transactions/VP-ER-NOPE123/revert').set(auth(owner.token)).send({ reason: 'Missing one' })).status).toBe(404);
  });
});
