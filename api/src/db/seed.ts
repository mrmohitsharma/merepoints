/**
 * Demo data for trying the apps and web portals (never run against production):
 *   npm run seed            (API must be running, OTP_DEV_ECHO on)
 * Creates an admin owner (mohit / Merepoints-admin-2026), 6 shops, ~40 customers, bills, offers,
 * gifts, redemptions (one disputed), a paid plan, and 60 days of history for the charts.
 */
import { Pool } from 'pg';
import { config } from '../config';
import { hashPassword } from '../common/password';

const API = process.env.API_URL ?? `http://localhost:${config.port}/v1`;
const pool = new Pool({ connectionString: config.databaseUrl });

async function call(method: string, path: string, body?: unknown, token?: string, shopId?: number) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(shopId ? { 'X-Shop-Id': String(shopId) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.code}: ${json.message}`);
  return json;
}

async function login(mobile: string) {
  const otp = await call('POST', '/auth/otp', { mobile });
  if (!otp.devCode) throw new Error('Seed needs OTP_DEV_ECHO (development mode)');
  const v = await call('POST', '/auth/verify', { mobile, code: otp.devCode });
  return { token: v.token as string, userId: v.user.id as number, mobile };
}

const SHOPS = [
  { name: 'Sharma Hardware & Ply', owner: 'Rajesh Sharma', city: 'Gurugram', state: 'Haryana', pincode: '122001', lat: 28.4721, lng: 77.0436, cats: ['plywood', 'hardware'], pct: 5 },
  { name: 'Gupta Laminates', owner: 'Anil Gupta', city: 'Gurugram', state: 'Haryana', pincode: '122015', lat: 28.4595, lng: 77.0266, cats: ['laminates', 'adhesives'], pct: 4 },
  { name: 'Shree Balaji Paints', owner: 'Mukesh Agarwal', city: 'Delhi', state: 'Delhi', pincode: '110085', lat: 28.7041, lng: 77.1025, cats: ['paints'], pct: 3 },
  { name: 'Jain Sanitary Store', owner: 'Vikas Jain', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301', lat: 28.5355, lng: 77.391, cats: ['sanitary', 'hardware'], pct: 4 },
  { name: 'New Ply Centre', owner: 'Harpreet Singh', city: 'Faridabad', state: 'Haryana', pincode: '121001', lat: 28.4089, lng: 77.3178, cats: ['plywood'], pct: 5 },
  { name: 'Kumar Electricals', owner: 'Deepak Kumar', city: 'Jaipur', state: 'Rajasthan', pincode: '302001', lat: 26.9124, lng: 75.7873, cats: ['electrical'], pct: 3 },
];
const NAMES = ['Ramesh Kumar', 'Suresh Yadav', 'Mohd. Salim', 'Pawan Verma', 'Rakesh Sharma', 'Sanjay Singh', 'Ashok Prajapati', 'Imran Khan',
  'Dinesh Vishwakarma', 'Manoj Pal', 'Raju Mistri', 'Sunil Saini', 'Ajay Rathore', 'Vinod Kumar', 'Naresh Lohar', 'Mahesh Jangid',
  'Rohit Tiwari', 'Gopal Das', 'Shyam Lal', 'Arjun Chauhan', 'Kamal Ansari', 'Bablu Mistry', 'Pradeep Saxena', 'Tarun Joshi',
  'Hari Om', 'Satish Rawat', 'Firoz Alam', 'Lalit Kumar', 'Mukesh Bhati', 'Jitender Singh', 'Sonu Kumar', 'Prem Chand',
  'Anand Mishra', 'Kishan Lal', 'Rajendra Meena', 'Om Prakash', 'Yusuf Qureshi', 'Ravi Shankar', 'Bhupender', 'Neeraj Thakur'];
const PROF = ['carpenter', 'carpenter', 'carpenter', 'painter', 'contractor', 'electrician', 'plumber', 'interior_designer', 'mason', 'tile_fitter', 'pop_ceiling', 'kitchen_installer'];
const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));

async function main() {
  // ---- admin owner
  await pool.query(
    `INSERT INTO admin_users (username, name, password_hash, role, must_change_password) VALUES ('mohit','Mohit Sharma',$1,'owner',FALSE)
     ON CONFLICT (username) DO NOTHING`, [await hashPassword('Merepoints-admin-2026')],
  );
  await pool.query(
    `INSERT INTO admin_users (username, name, password_hash, role, must_change_password) VALUES ('support1','Pooja (Support)',$1,'support',FALSE)
     ON CONFLICT (username) DO NOTHING`, [await hashPassword('Support-pass-2026')],
  );
  const admin = await call('POST', '/admin/auth/login', { username: 'mohit', password: 'Merepoints-admin-2026' });

  // ---- shops (last one stays pending for the approvals queue)
  const shops: { id: number; token: string }[] = [];
  for (const [i, s] of SHOPS.entries()) {
    const o = await login(String(9810000001 + i));
    const r = await call('POST', '/shops', {
      name: s.name, ownerName: s.owner, categories: s.cats,
      location: { lat: s.lat, lng: s.lng, accuracyM: rnd(4, 20) },
      address: { line: `Shop ${rnd(1, 80)}, Main Market`, city: s.city, state: s.state, pincode: s.pincode },
      loyalty: { rewardPercent: s.pct, pointValueRupees: 1, minBillRupees: 500, maxPointsPerBill: 5000, minRedeemPoints: 500, maxRedeemPoints: 5000, expiryDays: 365 },
    }, o.token);
    if (i < SHOPS.length - 1) await call('POST', `/admin/shops/${r.id}/status`, { status: 'approved' }, admin.token);
    shops.push({ id: r.id, token: o.token });
  }
  const live = shops.slice(0, -1);

  // ---- customers
  const customers: { userId: number; token: string }[] = [];
  for (const [i, name] of NAMES.entries()) {
    const c = await login(String(9870000001 + i));
    await call('POST', '/me/customer', { name, profession: PROF[i % PROF.length], city: SHOPS[i % 5].city, upiId: `${name.split(' ')[0].toLowerCase()}${i}@ybl` }, c.token);
    customers.push(c);
  }

  // ---- offer + gifts at the first shop
  const now = Date.now();
  await call('POST', '/shop/offers', { name: 'Diwali Dhamaka 1.5x', multiplier: 1.5, startsAt: new Date(now - 86_400_000).toISOString(), endsAt: new Date(now + 10 * 86_400_000).toISOString() }, live[0].token, live[0].id);
  // ---- products: gifts to redeem + "earn more" bonus items, at every live shop
  const REDEEM = [
    { name: 'Tool bag', brand: 'Stanley', category: 'Tools', mrpRupees: 899, pointsCost: 500, stock: 20 },
    { name: 'Electric kettle', brand: 'Prestige', category: 'Home', mrpRupees: 1295, pointsCost: 750, stock: 8 },
    { name: 'Measuring tape 5m', brand: 'Freemans', category: 'Tools', mrpRupees: 349, pointsCost: 250, stock: 40 },
    { name: 'Safety shoes', brand: 'Allen Cooper', category: 'Safety', mrpRupees: 1899, pointsCost: 1200, stock: 6 },
    { name: 'Cordless screwdriver', brand: 'Bosch', category: 'Tools', mrpRupees: 2999, pointsCost: 1800, stock: 4 },
    { name: 'Bosch drill machine', brand: 'Bosch', category: 'Tools', mrpRupees: 3499, pointsCost: 3000, stock: 3 },
    { name: 'Steel water bottle', brand: 'Milton', category: 'Home', mrpRupees: 499, pointsCost: 300, stock: 25 },
    { name: 'Mixer grinder', brand: 'Bajaj', category: 'Home', mrpRupees: 3299, pointsCost: 2500, stock: 2 },
  ];
  const EARN = [
    { name: 'Century ply 18mm', brand: 'Century', category: 'Plywood', bonusPoints: 40, unit: 'sheet' },
    { name: 'Fevicol SH 5kg', brand: 'Pidilite', category: 'Adhesives', bonusPoints: 60, unit: 'tin' },
    { name: 'Hettich soft-close hinge', brand: 'Hettich', category: 'Hardware', bonusPoints: 5, unit: 'pair' },
    { name: 'Asian Paints Apex 20L', brand: 'Asian Paints', category: 'Paint', bonusPoints: 150, unit: 'bucket' },
  ];
  for (const [si, s] of live.entries()) {
    for (const g of REDEEM.filter((_, k) => (k + si) % 3 !== 0)) await call('POST', '/shop/products', { kind: 'redeem', ...g }, s.token, s.id);
    for (const g of EARN.filter((_, k) => (k + si) % 2 === 0 || si === 0)) await call('POST', '/shop/products', { kind: 'earn', ...g }, s.token, s.id);
  }

  // ---- bills
  for (const [i, c] of customers.entries()) {
    const visits = [live[i % live.length], ...(i % 3 === 0 ? [live[(i + 1) % live.length]] : [])];
    for (const s of visits) {
      for (let k = 0; k < rnd(1, 4); k++) {
        await call('POST', '/shop/points/bill', { customerId: c.userId, amountRupees: rnd(8, 120) * 500, invoiceNo: `INV-${s.id}-${i}-${k}` }, s.token, s.id);
      }
    }
  }

  // ---- redemptions: confirmed, waiting, disputed
  const tryRedeem = async (ci: number, method: 'cash' | 'upi', end: 'received' | 'paid' | 'dispute') => {
    const s = live[ci % live.length], c = customers[ci];
    const r = await call('POST', '/shop/redemptions', { customerId: c.userId, method, points: 500 }, s.token, s.id).catch(() => null);
    if (!r) return;
    await call('POST', `/shop/redemptions/${r.redemptionId}/paid`, { paymentRef: method === 'upi' ? `UPI${rnd(100000, 999999)}` : undefined }, s.token, s.id);
    if (end === 'received') await call('POST', `/me/redemptions/${r.redemptionId}/received`, {}, c.token);
    if (end === 'dispute') await call('POST', `/me/redemptions/${r.redemptionId}/not-received`, { note: 'Shop said they paid but I did not get money in my UPI' }, c.token);
  };
  for (let i = 0; i < 10; i++) await tryRedeem(i, i % 2 ? 'upi' : 'cash', 'received');
  await tryRedeem(10, 'upi', 'paid');
  await tryRedeem(11, 'upi', 'dispute');

  // ---- home carousel: two admin ads + one shop request waiting for review
  await call('POST', '/admin/ads', { title: 'Century Ply — extra points on every sheet', subtitle: 'At Mere Points shops near you', bgColor: '#7C2D12',
    advertiserKind: 'brand', advertiserName: 'Century Ply', link: { kind: 'shop', shopId: live[0].id }, target: { mode: 'all' },
    startsAt: new Date(now - 86_400_000).toISOString(), endsAt: new Date(now + 30 * 86_400_000).toISOString(), sort: 10, amountRupees: 25000 }, admin.token);
  await call('POST', '/admin/ads', { title: 'Refer a shop, get 500 points', subtitle: 'Tell your shop about Mere Points', titleHi: 'दुकान जोड़ें, 500 पॉइंट पाएँ', bgColor: '#1D4ED8',
    advertiserKind: 'own', advertiserName: 'Mere Points', link: { kind: 'none' }, target: { mode: 'all' },
    startsAt: new Date(now - 86_400_000).toISOString(), endsAt: new Date(now + 60 * 86_400_000).toISOString(), sort: 20 }, admin.token);
  const req = await call('POST', '/shop/ads', { title: 'Diwali sale — Bosch tools 10% off', bgColor: '#15803D', packCode: 'ad7',
    startDate: new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10), link: { kind: 'shop' } }, live[1].token, live[1].id);
  const adOrd = await call('POST', `/shop/ads/${req.id}/pay`, {}, live[1].token, live[1].id);
  if (adOrd.testMode) await call('POST', '/shop/billing/verify', { orderId: adOrd.orderId, paymentId: 'pay_demo_ad', signature: 'test' }, live[1].token, live[1].id);

  // ---- one shop paid for Pro; one shop in grace
  const ord = await call('POST', '/shop/billing/orders', { kind: 'plan', planCode: 'pro' }, live[0].token, live[0].id);
  if (ord.testMode) await call('POST', '/shop/billing/verify', { orderId: ord.orderId, paymentId: 'pay_demo1', signature: 'test' }, live[0].token, live[0].id);
  await pool.query(`UPDATE shop_subscriptions SET trial_ends_at = now() - interval '3 days' WHERE shop_id = $1`, [live[3].id]);

  // ---- 60 days of history so the charts have shape (demo only: writes daily counters directly)
  for (const s of live) {
    await pool.query(
      `INSERT INTO shop_daily_stats (shop_id, day, bills, purchase_paise, points_issued, points_redeemed, value_redeemed_paise, new_customers)
       SELECT $1, d::date, b, b * (800000 + (random() * 2000000)::int), b * (300 + (random() * 900)::int),
              CASE WHEN random() < 0.3 THEN 500 ELSE 0 END, CASE WHEN random() < 0.3 THEN 50000 ELSE 0 END, (random() * 3)::int
         FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 60, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, interval '1 day') d,
              LATERAL (SELECT (2 + random() * 10)::int AS b) x
       ON CONFLICT (shop_id, day) DO NOTHING`, [s.id],
    );
  }
  console.log(`Seeded ${shops.length} shops (1 pending), ${customers.length} customers.`);
  console.log('Super Admin login: mohit / Merepoints-admin-2026   (support: support1 / Support-pass-2026)');
  console.log('Merchant login (OTP shown on screen in dev): 98100 00001 … 98100 00005');
  await pool.end();
}
main().catch(async (e) => { console.error(e.message ?? e); await pool.end(); process.exit(1); });
