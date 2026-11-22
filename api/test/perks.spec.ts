import { auth, bill, boot, http, makeAdmin, makeCustomer, makeShop, setPlan, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

describe('shop levels', () => {
  it('higher reward % once a customer has spent enough in the last 12 months', async () => {
    const shop = await makeShop(admin); // 5% normal
    const c = await makeCustomer();
    const sh = auth(shop.owner.token, shop.shopId);

    // rules: higher than the normal %, and each level above the one before
    expect((await http().put('/v1/shop/perks/levels').set(sh).send({ levels: [{ rank: 1, minSpendRupees: 10000, rewardPercent: 5 }] })).body.code).toBe('BAD_LEVELS');
    expect((await http().put('/v1/shop/perks/levels').set(sh).send({ levels: [{ rank: 1, minSpendRupees: 10000, rewardPercent: 6 }, { rank: 2, minSpendRupees: 5000, rewardPercent: 8 }] })).body.code).toBe('BAD_LEVELS');
    await http().put('/v1/shop/perks/levels').set(sh).send({ levels: [{ rank: 1, minSpendRupees: 10000, rewardPercent: 6 }, { rank: 2, minSpendRupees: 50000, rewardPercent: 8 }] }).expect(200);

    const first = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'L-1').expect(201)).body;
    expect(first).toMatchObject({ points: 50, rate: { rewardPercent: 5, levelName: null } });
    await bill(shop.owner.token, shop.shopId, c.userId, 9000, 'L-2').expect(201); // total ₹10,000 now
    const next = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'L-3').expect(201)).body;
    expect(next).toMatchObject({ points: 60, rate: { rewardPercent: 6, levelName: 'Silver' } });

    const card = (await http().get(`/v1/me/cards/${shop.shopId}`).set(auth(c.token)).expect(200)).body;
    expect(card.perks.my).toMatchObject({ spendRupees: 11000, level: { name: 'Silver', rewardPercent: 6 }, next: { name: 'Gold', needRupees: 39000 } });
    expect(card.perks.levels.map((l: any) => l.name)).toEqual(['Silver', 'Gold']);
  });

  it('needs the package feature', async () => {
    const shop = await makeShop(admin);
    await setPlan(shop.shopId, 'basic');
    const r = await http().put('/v1/shop/perks/levels').set(auth(shop.owner.token, shop.shopId)).send({ levels: [] });
    expect(r.status).toBe(402);
    expect(r.body.code).toBe('FEATURE_LOCKED');
    const o = (await http().get('/v1/shop/perks').set(auth(shop.owner.token, shop.shopId)).expect(200)).body;
    expect(o.features).toEqual({ levels: false, goals: false });
  });
});

describe('loyalty goals', () => {
  it('visits goal: bonus once per period, shown with progress, not paid twice', async () => {
    const shop = await makeShop(admin);
    const c = await makeCustomer();
    const sh = auth(shop.owner.token, shop.shopId);
    expect((await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'visits', target: 1, periodDays: 30, bonusPoints: 100 })).status).toBe(400);
    await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'visits', target: 3, periodDays: 30, bonusPoints: 200 }).expect(201);

    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'G-1').expect(201);
    const mid = (await http().get(`/v1/me/cards/${shop.shopId}`).set(auth(c.token)).expect(200)).body.perks.goals[0];
    expect(mid).toMatchObject({ label: '3 visits in 30 days', bonusPoints: 200, progress: { done: 1, target: 3, achieved: false } });

    await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'G-2').expect(201);
    const third = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'G-3', 'goal-key-3').expect(201)).body;
    expect(third.goalBonuses).toHaveLength(1);
    expect(third.goalBonuses[0]).toMatchObject({ points: 200 });
    expect(third.balance).toBe(50 * 3 + 200);
    const again = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'G-3', 'goal-key-3').expect(201)).body; // retry
    expect(again.balance).toBe(350);
    const fourth = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'G-4').expect(201)).body;
    expect(fourth.goalBonuses).toHaveLength(0); // same period: already paid
    expect(fourth.balance).toBe(400);

    const done = (await http().get(`/v1/me/cards/${shop.shopId}`).set(auth(c.token)).expect(200)).body.perks.goals[0];
    expect(done.progress.achieved).toBe(true);
    // customer gets one message for the bill and one for the goal, per bill
    const inbox = (await http().get('/v1/me/notifications').set(auth(c.token)).expect(200)).body.items.map((i: any) => i.title);
    expect(inbox.filter((t: string) => t.startsWith('Goal reached'))).toHaveLength(1);
  });

  it('spend goal, limits and stopping a goal', async () => {
    const shop = await makeShop(admin);
    const c = await makeCustomer();
    const sh = auth(shop.owner.token, shop.shopId);
    const g = (await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'spend', target: 3000, periodDays: 7, bonusPoints: 75 }).expect(201)).body;
    await bill(shop.owner.token, shop.shopId, c.userId, 2000, 'S-1').expect(201);
    const r = (await bill(shop.owner.token, shop.shopId, c.userId, 1000, 'S-2').expect(201)).body;
    expect(r.goalBonuses).toEqual([expect.objectContaining({ points: 75 })]);

    for (let i = 0; i < 4; i++) await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'visits', target: 5 + i, periodDays: 30, bonusPoints: 10 }).expect(201);
    expect((await http().post('/v1/shop/perks/goals').set(sh).send({ kind: 'visits', target: 20, periodDays: 30, bonusPoints: 10 })).body.code).toBe('TOO_MANY_GOALS');
    await http().post(`/v1/shop/perks/goals/${g.id}/stop`).set(sh).expect(201);
    expect((await http().get('/v1/shop/perks').set(sh).expect(200)).body.goals).toHaveLength(4);
  });
});

describe('what the customer sees', () => {
  it('home shows a few shops, See all lists the rest, own shops first', async () => {
    const c = await makeCustomer({ city: 'Pune' });
    const shops = [];
    for (let i = 0; i < 4; i++) {
      const s = await makeShop(admin, { name: `Perk Shop ${i}`, address: { line: '1 Main Rd', city: 'Pune', state: 'Maharashtra', pincode: '411001' } });
      await http().post('/v1/shop/perks/goals').set(auth(s.owner.token, s.shopId)).send({ kind: 'visits', target: 4, periodDays: 30, bonusPoints: 100 }).expect(201);
      shops.push(s);
    }
    const home = (await http().get('/v1/me/home').set(auth(c.token)).expect(200)).body;
    expect(home.rewards.items).toHaveLength(3);
    expect(home.rewards.hasMore).toBe(true);
    const all = (await http().get('/v1/me/rewards').query({ limit: 20 }).set(auth(c.token)).expect(200)).body;
    expect(all.items.length).toBeGreaterThanOrEqual(4);
    expect(all.hasMore).toBe(false);
    const page2 = (await http().get('/v1/me/rewards').query({ limit: 3, offset: 3 }).set(auth(c.token)).expect(200)).body;
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
  });
});
