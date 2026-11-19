// Load test: N bill entries at concurrency C against the running API (seeded DB).
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
const N = Number(process.env.N ?? 3000), C = Number(process.env.C ?? 40);
(async () => {
  const pg = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/merepoints' });
  const pairs = (await pg.query(`SELECT w.customer_id, w.shop_id, s.owner_user_id FROM wallets w JOIN shops s ON s.id = w.shop_id
                                  WHERE s.status = 'approved' ORDER BY random() LIMIT $1`, [N])).rows;
  const jwt = new JwtService({ secret: 'dev-only-change-me' });
  const tokens = new Map<number, string>();
  for (const p of pairs) if (!tokens.has(p.owner_user_id)) tokens.set(p.owner_user_id, jwt.sign({ sub: p.owner_user_id, kind: 'access' }));
  const before = (await pg.query('SELECT count(*)::int n FROM ledger_entries')).rows[0].n;
  const lat: number[] = []; let ok = 0, fail = 0, i = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: C }, async () => {
    while (i < pairs.length) {
      const p = pairs[i++]; const s = performance.now();
      const r = await fetch('http://localhost:3000/v1/shop/points/bill', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.get(p.owner_user_id)}`, 'x-shop-id': String(p.shop_id) },
        body: JSON.stringify({ customerId: Number(p.customer_id), amountRupees: 1000 + Math.floor(Math.random() * 20000), invoiceNo: `LOAD-${p.shop_id}-${p.customer_id}-${Math.random().toString(36).slice(2, 8)}` }),
      });
      lat.push(performance.now() - s); r.status === 201 ? ok++ : (fail++, fail < 4 && console.log(r.status, await r.text()));
    }
  }));
  const secs = (Date.now() - t0) / 1000; lat.sort((a, b) => a - b);
  const after = (await pg.query('SELECT count(*)::int n FROM ledger_entries')).rows[0].n;
  console.log(JSON.stringify({ requests: N, concurrency: C, ok, fail, seconds: secs, perSecond: Math.round(N / secs),
    p50ms: Math.round(lat[Math.floor(lat.length * 0.5)]), p95ms: Math.round(lat[Math.floor(lat.length * 0.95)]), p99ms: Math.round(lat[Math.floor(lat.length * 0.99)]),
    ledgerRowsAdded: after - before }));
  await pg.end();
})();
