import { auth, boot, http, login, shutdown } from './helpers';

beforeAll(boot);
afterAll(shutdown);

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('photo uploads (local fallback)', () => {
  test('slot → PUT → served back; tampering and wrong type refused', async () => {
    const u = await login();
    const slot = (await http().post('/v1/uploads').set(auth(u.token)).send({ purpose: 'product', contentType: 'image/png', size: PNG.length }).expect(201)).body;
    expect(slot.method).toBe('PUT');
    const path = new URL(slot.uploadUrl).pathname + new URL(slot.uploadUrl).search;
    await http().put(path).set('Content-Type', 'image/jpeg').send(PNG).expect(400);
    await http().put(path.replace(/sig=[^&]+/, 'sig=nope')).set('Content-Type', 'image/png').send(PNG).expect(403);
    await http().put(path).set('Content-Type', 'image/png').send(PNG).expect(200);
    const got = await http().get(new URL(slot.url).pathname).expect(200);
    expect(got.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(got.body).equals(PNG)).toBe(true);
    expect([400, 404]).toContain((await http().get('/v1/files/product/2020-01-01/..%2F..%2Fetc%2Fpasswd.png')).status);
    await http().post('/v1/uploads').set(auth(u.token)).send({ purpose: 'product', contentType: 'image/gif', size: 10 }).expect(400);
    await http().post('/v1/uploads').set(auth(u.token)).send({ purpose: 'product', contentType: 'image/png', size: 5_000_000 }).expect(400);
    await http().post('/v1/uploads').send({ purpose: 'product', contentType: 'image/png', size: 10 }).expect(401);
  });
});
