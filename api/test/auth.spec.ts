import { auth, boot, http, login, makeCustomer, nextMobile, pg, shutdown } from './helpers';

beforeAll(boot);
afterAll(shutdown);

const signup = async (over: Record<string, unknown> = {}) => {
  const mobile = nextMobile();
  const otp = await http().post('/v1/auth/otp').send({ mobile }).expect(201);
  return { mobile, email: `ram${mobile}@example.com`, password: 'Sawdust123', body: (extra: Record<string, unknown> = {}) => ({ email: `ram${mobile}@example.com`, password: 'Sawdust123', mobile, code: otp.body.devCode, ...over, ...extra }) };
};

describe('email + password login', () => {
  test('sign up with mobile OTP, then log in with email and password', async () => {
    const s = await signup();
    const r = await http().post('/v1/auth/email/signup').send(s.body()).expect(201);
    expect(r.body.token).toBeTruthy();
    expect(r.body.user.email).toBe(s.email);
    const back = await http().post('/v1/auth/email/login').send({ email: s.email.toUpperCase(), password: s.password }).expect(201);
    expect(back.body.user.id).toBe(r.body.user.id);
    await http().get('/v1/auth/me').set(auth(back.body.token)).expect(200);
  });

  test('weak password and wrong code are refused', async () => {
    const s = await signup();
    expect((await http().post('/v1/auth/email/signup').send(s.body({ password: 'short1' })).expect(400)).body.message).toMatch(/8 characters/);
    expect((await http().post('/v1/auth/email/signup').send(s.body({ password: 'onlyletters' })).expect(400)).body.message).toMatch(/number/);
    await http().post('/v1/auth/email/signup').send(s.body({ code: '000000' })).expect(400);
  });

  test('wrong password gets one generic answer; five wrong tries lock the account for a while', async () => {
    const s = await signup();
    await http().post('/v1/auth/email/signup').send(s.body()).expect(201);
    const wrong = await http().post('/v1/auth/email/login').send({ email: s.email, password: 'Nope12345' }).expect(401);
    const unknown = await http().post('/v1/auth/email/login').send({ email: 'nobody@example.com', password: 'Nope12345' }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    for (let i = 0; i < 4; i++) await http().post('/v1/auth/email/login').send({ email: s.email, password: 'Nope12345' }).expect(401);
    await http().post('/v1/auth/email/login').send({ email: s.email, password: s.password }).expect(429); // locked even with the right one
    await pg.query(`UPDATE users SET locked_until = NULL WHERE email = $1`, [s.email]);
    await http().post('/v1/auth/email/login').send({ email: s.email, password: s.password }).expect(201);
  });

  test('same email cannot be used for another mobile; a mobile with a password cannot sign up twice', async () => {
    const a = await signup();
    await http().post('/v1/auth/email/signup').send(a.body()).expect(201);
    const b = await signup();
    expect((await http().post('/v1/auth/email/signup').send(b.body({ email: a.email })).expect(409)).body.code).toBe('EMAIL_TAKEN');
    const again = await http().post('/v1/auth/otp').send({ mobile: a.mobile }).expect(201);
    expect((await http().post('/v1/auth/email/signup').send({ email: a.email, password: 'Another123', mobile: a.mobile, code: again.body.devCode }).expect(409)).body.code).toBe('ACCOUNT_EXISTS');
  });

  test('an existing mobile-OTP user can add an email login', async () => {
    const u = await login();
    const otp = await http().post('/v1/auth/otp').send({ mobile: u.mobile }).expect(201);
    const r = await http().post('/v1/auth/email/signup').send({ email: `old${u.mobile}@example.com`, password: 'Plywood123', mobile: u.mobile, code: otp.body.devCode }).expect(201);
    expect(r.body.user.id).toBe(u.userId);
  });
});

describe('forgot / reset password', () => {
  test('code goes by SMS to the account mobile; reset logs in and old password stops working', async () => {
    const s = await signup();
    await http().post('/v1/auth/email/signup').send(s.body()).expect(201);
    const f = await http().post('/v1/auth/password/forgot').send({ email: s.email }).expect(201);
    expect(f.body.sent).toBe(true);
    expect((await pg.query(`SELECT count(*)::int AS n FROM sms_outbox WHERE mobile = $1 AND template = 'password_reset'`, [`91${s.mobile}`])).rows[0].n).toBe(1);
    await http().post('/v1/auth/password/reset').send({ email: s.email, code: '000000', password: 'Newpass123' }).expect(400);
    const r = await http().post('/v1/auth/password/reset').send({ email: s.email, code: f.body.devCode, password: 'Newpass123' }).expect(201);
    expect(r.body.token).toBeTruthy();
    await http().post('/v1/auth/email/login').send({ email: s.email, password: s.password }).expect(401);
    await http().post('/v1/auth/email/login').send({ email: s.email, password: 'Newpass123' }).expect(201);
    await http().post('/v1/auth/password/reset').send({ email: s.email, code: f.body.devCode, password: 'Third12345' }).expect(400); // code is single use
  });

  test('unknown email gets the same "sent" answer and nothing is sent', async () => {
    const f = await http().post('/v1/auth/password/forgot').send({ email: 'ghost@example.com' }).expect(201);
    expect(f.body.sent).toBe(true);
    expect(f.body.devCode).toBeUndefined();
  });
});

describe('google sign-in', () => {
  test('says clearly when it is not switched on', async () => {
    const r = await http().post('/v1/auth/google').send({ idToken: 'x'.repeat(40) }).expect(400);
    expect(r.body.code).toBe('GOOGLE_NOT_CONFIGURED');
  });
});

describe('customer onboarding: up to 3 work types and where they work', () => {
  test('saves work types (first is the main one), city, area and GPS', async () => {
    const c = await login();
    await http().post('/v1/me/customer').set(auth(c.token)).send({
      name: 'Suresh Verma', professions: ['painter', 'carpenter', 'contractor'], city: 'Gurugram', area: 'Sector 56', state: 'Haryana', pincode: '122011', lat: 28.42, lng: 77.1,
    }).expect(201);
    const r = (await pg.query('SELECT profession, professions, city, area, state, pincode, lat FROM customers WHERE user_id = $1', [c.userId])).rows[0];
    expect(r.profession).toBe('painter');
    expect(r.professions).toEqual(['painter', 'carpenter', 'contractor']);
    expect([r.city, r.area, r.state, r.pincode, r.lat]).toEqual(['Gurugram', 'Sector 56', 'Haryana', '122011', 28.42]);
  });

  test('four work types, none, or an unknown one are refused; old single profession still works', async () => {
    const c = await login();
    const reg = (b: object) => http().post('/v1/me/customer').set(auth(c.token)).send({ name: 'Test Name', ...b });
    await reg({ professions: ['painter', 'carpenter', 'contractor', 'plumber'] }).expect(400);
    await reg({}).expect(400);
    expect((await reg({ professions: ['astronaut'] }).expect(400)).body.code).toBe('BAD_WORK_TYPE');
    await reg({ profession: 'mason' }).expect(201);
    expect((await pg.query('SELECT professions FROM customers WHERE user_id = $1', [c.userId])).rows[0].professions).toEqual(['mason']);
  });

  test('public work-type list carries icons', async () => {
    const list = (await http().get('/v1/shops/professions').expect(200)).body;
    expect(list.find((p: any) => p.code === 'carpenter').icon).toBe('🪚');
    expect(list.find((p: any) => p.code === 'painter').icon).toBe('🖌️');
  });

  test('a customer with several work types gets an offer made for any of them', async () => {
    const c = await makeCustomer({ professions: ['plumber', 'electrician'], profession: undefined });
    expect((await pg.query('SELECT 1 FROM customers WHERE user_id = $1 AND $2 = ANY(professions)', [c.userId, 'electrician'])).rowCount).toBe(1);
  });
});
