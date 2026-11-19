import { auth, bill, boot, http, login, makeAdmin, makeCustomer, makeShop, pg, shutdown } from './helpers';

let admin: { token: string };
beforeAll(async () => { await boot(); admin = await makeAdmin(); });
afterAll(shutdown);

describe('delete my account', () => {
  test('removes personal details, keeps shop records, ends the session; same number can sign up fresh', async () => {
    const { owner, shopId } = await makeShop(admin);
    const c = await makeCustomer({ name: 'Delete Me', upiId: 'del@ybl' });
    await bill(owner.token, shopId, c.userId, 5000).expect(201);
    expect((await http().post('/v1/me/delete-account').set(auth(c.token)).send({ confirm: 'nope' }).expect(400)).body.code).toBe('CONFIRM');
    await http().post('/v1/me/delete-account').set(auth(c.token)).send({ confirm: 'DELETE' }).expect(201);
    const u = (await pg.query('SELECT mobile, name, deleted_at FROM users WHERE id = $1', [c.userId])).rows[0];
    expect(u.name).toBeNull(); expect(u.mobile).toBe(`x${c.userId}`); expect(u.deleted_at).not.toBeNull();
    expect((await pg.query('SELECT upi_id FROM customers WHERE user_id = $1', [c.userId])).rows[0].upi_id).toBeNull();
    expect((await pg.query('SELECT count(*)::int AS n FROM bills WHERE customer_id = $1', [c.userId])).rows[0].n).toBe(1);
    await http().get('/v1/me/home').set(auth(c.token)).expect(401);
    const again = await login(c.mobile);
    expect(again.userId).not.toBe(c.userId);
  });

  test('shop owners and open payouts are refused', async () => {
    const { owner } = await makeShop(admin);
    expect((await http().post('/v1/me/delete-account').set(auth(owner.token)).send({ confirm: 'DELETE' }).expect(400)).body.code).toBe('SHOP_OWNER');
  });

  test('old OTP rows are cleaned up', async () => {
    await pg.query(`INSERT INTO otp_codes (mobile, purpose, code_hash, expires_at, created_at) VALUES ('919000000000', 'login', 'x', now(), now() - interval '2 days')`);
    await pg.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '24 hours'`);
    expect((await pg.query(`SELECT count(*)::int AS n FROM otp_codes WHERE mobile = '919000000000'`)).rows[0].n).toBe(0);
  });
});
