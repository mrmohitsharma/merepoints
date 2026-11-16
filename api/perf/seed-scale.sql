-- Synthetic data at the year-1 target: 1,000 shops, 100,000 customers, ~300k wallets, ~1.5M ledger rows.
-- Bulk SQL (bypasses the API) purely to test query plans. Run on an EMPTY dev database after migrations.
SET synchronous_commit = off;

INSERT INTO users (mobile, name, is_super_admin)
SELECT '91' || (7000000000 + g)::text, 'User ' || g, FALSE FROM generate_series(1, 101000) g;

-- 1,000 shops spread over ~10 Indian metros
INSERT INTO shops (name, owner_user_id, address_line, city, state, pincode, lat, lng, status, approved_at)
SELECT 'Shop ' || g, 100000 + g, 'Market ' || g, c.city, c.state, '110001',
       c.lat + (random() - 0.5) * 0.3, c.lng + (random() - 0.5) * 0.3,
       CASE WHEN g % 20 = 0 THEN 'pending'::shop_status ELSE 'approved' END, now()
  FROM generate_series(1, 1000) g
  JOIN (VALUES (0,'Delhi','DL',28.61,77.21),(1,'Gurugram','HR',28.46,77.03),(2,'Mumbai','MH',19.08,72.88),(3,'Pune','MH',18.52,73.86),
               (4,'Bengaluru','KA',12.97,77.59),(5,'Chennai','TN',13.08,80.27),(6,'Hyderabad','TG',17.39,78.49),(7,'Kolkata','WB',22.57,88.36),
               (8,'Ahmedabad','GJ',23.02,72.57),(9,'Jaipur','RJ',26.91,75.79)) c(i, city, state, lat, lng) ON c.i = g % 10;

INSERT INTO shop_categories (shop_id, category)
SELECT s.id, (ARRAY['plywood','hardware','paints','tiles','electrical','sanitary'])[1 + (s.id % 6)] FROM shops s
UNION SELECT s.id, (ARRAY['laminates','adhesives','lights','plumbing'])[1 + (s.id % 4)] FROM shops s;

INSERT INTO shop_members (shop_id, user_id, role, can_manual) SELECT id, owner_user_id, 'owner', TRUE FROM shops;

INSERT INTO loyalty_configs (shop_id, version, reward_bps, point_value_paise, min_bill_paise, min_redeem_points, expiry_days, created_by)
SELECT id, 1, (ARRAY[200,300,500,1000])[1 + id % 4], (ARRAY[25,50,100])[1 + id % 3], 50000, 500, 365, owner_user_id FROM shops;
UPDATE shops s SET current_config_id = lc.id FROM loyalty_configs lc WHERE lc.shop_id = s.id;

INSERT INTO customers (user_id, profession, city)
SELECT id, (ARRAY['carpenter','painter','contractor','electrician','plumber','interior_designer','architect','other'])[1 + id % 8]::profession, 'City'
  FROM users WHERE id <= 100000;

-- ~3 shops per customer, shops chosen within the customer's "city bucket"
INSERT INTO wallets (customer_id, shop_id, first_visit_at, last_visit_at, visits)
SELECT DISTINCT ON (c.user_id, sh) c.user_id, sh, now() - interval '200 days', now() - (random() * 120) * interval '1 day', 5
  FROM customers c, LATERAL (SELECT 1 + ((c.user_id % 10) + 10 * floor(random() * 100))::int AS sh FROM generate_series(1, 3)) x
 WHERE sh <= 1000;

-- 5 earn entries per wallet, over the last 6 months
INSERT INTO ledger_entries (public_id, shop_id, customer_id, type, points, value_paise, balance_after, created_by, created_at)
SELECT 'VP-ER-' || lpad(to_hex(row_number() OVER ()), 7, '0'), w.shop_id, w.customer_id, 'earn_bill', 100 + (random() * 400)::int, 0, 0,
       100000 + w.shop_id, now() - (random() * 180) * interval '1 day'
  FROM wallets w, generate_series(1, 5);

INSERT INTO point_lots (customer_id, shop_id, points_original, points_remaining, point_value_paise, expires_at, source_entry_id, created_at)
SELECT customer_id, shop_id, points, CASE WHEN random() < 0.6 THEN points ELSE 0 END, 100, created_at + interval '365 days', id, created_at
  FROM ledger_entries;

UPDATE wallets w SET balance_points = l.rem, earned_points = l.orig, purchase_paise = l.orig * 2000
  FROM (SELECT customer_id, shop_id, sum(points_remaining) rem, sum(points_original) orig FROM point_lots GROUP BY 1, 2) l
 WHERE l.customer_id = w.customer_id AND l.shop_id = w.shop_id;

INSERT INTO shop_daily_stats (shop_id, day, bills, purchase_paise, points_issued)
SELECT shop_id, (created_at AT TIME ZONE 'Asia/Kolkata')::date, count(*), sum(points) * 2000, sum(points)
  FROM ledger_entries GROUP BY 1, 2;

VACUUM ANALYZE;
