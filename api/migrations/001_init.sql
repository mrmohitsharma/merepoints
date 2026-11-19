-- Mere Points: core schema
-- Conventions
--   * Money is stored in paise (BIGINT). Never floats.
--   * Percentages are basis points (500 = 5.00%). Multipliers are x100 (150 = 1.5x).
--   * Points are whole numbers (INTEGER/BIGINT).
--   * ledger_entries is append-only. Balances live in wallets and are only changed
--     in the same transaction that writes the ledger row.
--   * Every shop-scoped table carries shop_id so queries and future partitioning stay shop-local.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- for "one offer at a time" exclusion constraint

-- ---------------------------------------------------------------- enums
CREATE TYPE shop_status        AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE member_role        AS ENUM ('owner', 'staff');
CREATE TYPE profession         AS ENUM ('carpenter','painter','interior_designer','contractor','architect','plumber','electrician','other');
CREATE TYPE ledger_type        AS ENUM ('earn_bill','earn_manual','reversal','redeem_hold','redeem_release','redeem_confirm','expiry');
CREATE TYPE redemption_status  AS ENUM ('held','paid','confirmed','disputed','cancelled');
CREATE TYPE redemption_method  AS ENUM ('cash','upi','gift');
CREATE TYPE milestone_basis    AS ENUM ('points','value');
CREATE TYPE otp_purpose        AS ENUM ('login','redeem_confirm');

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mobile         VARCHAR(15) NOT NULL UNIQUE,           -- E.164 without +, e.g. 919876543210
  name           TEXT,
  email          CITEXT UNIQUE,
  google_sub     TEXT UNIQUE,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  user_id                 BIGINT PRIMARY KEY REFERENCES users(id),
  profession              profession NOT NULL DEFAULT 'other',
  city                    TEXT,
  upi_id                  TEXT,
  upi_verified_name       TEXT,
  language                VARCHAR(5) NOT NULL DEFAULT 'en',   -- en, hi, ta, bn, kn, ml, gu, pa
  photo_url               TEXT,
  sms_on_earn             BOOLEAN NOT NULL DEFAULT TRUE,
  -- platform-wide totals for milestones (never decrease on redeem)
  lifetime_points         BIGINT NOT NULL DEFAULT 0,
  lifetime_value_paise    BIGINT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- shops
CREATE TABLE categories (
  code  VARCHAR(20) PRIMARY KEY,         -- plywood, laminates, hardware, adhesives, paints ...
  name  TEXT NOT NULL,
  sort  SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE shops (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              TEXT NOT NULL,
  owner_user_id     BIGINT NOT NULL REFERENCES users(id),
  logo_url          TEXT,
  email             CITEXT,
  gst_number        VARCHAR(15),
  brands_note       TEXT,
  address_line      TEXT NOT NULL,
  landmark          TEXT,
  city              TEXT NOT NULL,
  state             TEXT NOT NULL,
  pincode           VARCHAR(6) NOT NULL,
  lat               DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng               DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  gps_accuracy_m    REAL,
  opening_hours     JSONB,
  phone             VARCHAR(15),
  status            shop_status NOT NULL DEFAULT 'pending',
  status_reason     TEXT,
  current_config_id BIGINT,                 -- FK added after loyalty_configs exists
  sms_balance       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ
);
-- Nearby search: bounding box on lat/lng, only approved shops. At 1,000 shops this is
-- an index range scan + haversine on a few dozen rows. Swap for PostGIS when > ~50k shops.
CREATE INDEX shops_geo_approved ON shops (lat, lng) WHERE status = 'approved';
CREATE INDEX shops_status_created ON shops (status, created_at DESC);
CREATE INDEX shops_name_prefix ON shops (lower(name) text_pattern_ops) WHERE status = 'approved';

CREATE TABLE shop_categories (
  shop_id  BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category VARCHAR(20) NOT NULL REFERENCES categories(code),
  PRIMARY KEY (shop_id, category)
);
CREATE INDEX shop_categories_by_cat ON shop_categories (category, shop_id);

CREATE TABLE shop_members (
  shop_id            BIGINT NOT NULL REFERENCES shops(id),
  user_id            BIGINT NOT NULL REFERENCES users(id),
  role               member_role NOT NULL,
  can_add_points     BOOLEAN NOT NULL DEFAULT TRUE,
  can_redeem         BOOLEAN NOT NULL DEFAULT TRUE,
  can_manual         BOOLEAN NOT NULL DEFAULT FALSE,
  manual_daily_limit INTEGER NOT NULL DEFAULT 500,       -- points/day for staff; owner unlimited
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, user_id)
);
CREATE INDEX shop_members_by_user ON shop_members (user_id) WHERE active;

-- Versioned loyalty rules. Bills point at the version used, so changing the % never
-- changes points already earned (business rule 8).
CREATE TABLE loyalty_configs (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id              BIGINT NOT NULL REFERENCES shops(id),
  version              INTEGER NOT NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  reward_bps           INTEGER NOT NULL CHECK (reward_bps BETWEEN 1 AND 5000),   -- 0.01%..50%
  point_value_paise    INTEGER NOT NULL CHECK (point_value_paise BETWEEN 1 AND 10000),
  min_bill_paise       BIGINT  NOT NULL DEFAULT 0 CHECK (min_bill_paise >= 0),
  max_points_per_bill  INTEGER          CHECK (max_points_per_bill > 0),
  min_redeem_points    INTEGER NOT NULL DEFAULT 500 CHECK (min_redeem_points > 0),
  max_redeem_points    INTEGER          CHECK (max_redeem_points > 0),
  expiry_days          INTEGER          CHECK (expiry_days > 0),                   -- NULL = never
  payout_cash          BOOLEAN NOT NULL DEFAULT TRUE,
  payout_upi           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by           BIGINT NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, version)
);
ALTER TABLE shops ADD CONSTRAINT shops_current_config_fk
  FOREIGN KEY (current_config_id) REFERENCES loyalty_configs(id);

-- One bonus offer at a time per shop: overlapping periods are rejected by the database.
CREATE TABLE offers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id         BIGINT NOT NULL REFERENCES shops(id),
  name            TEXT NOT NULL,
  multiplier_x100 INTEGER NOT NULL CHECK (multiplier_x100 BETWEEN 101 AND 1000),
  period          TSTZRANGE NOT NULL CHECK (NOT isempty(period)),
  professions     profession[],                      -- NULL = all customers
  cancelled       BOOLEAN NOT NULL DEFAULT FALSE,
  extra_points    BIGINT NOT NULL DEFAULT 0,          -- running total for the offer report
  created_by      BIGINT NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT offers_no_overlap EXCLUDE USING gist (shop_id WITH =, period WITH &&) WHERE (NOT cancelled)
);

CREATE TABLE gifts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id       BIGINT NOT NULL REFERENCES shops(id),
  name          TEXT NOT NULL,
  photo_url     TEXT,
  points_cost   INTEGER NOT NULL CHECK (points_cost > 0),
  stock         INTEGER NOT NULL CHECK (stock >= 0),       -- available (reserved units already removed)
  given_count   INTEGER NOT NULL DEFAULT 0,
  available_until DATE,
  visible       BOOLEAN NOT NULL DEFAULT TRUE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gifts_by_shop ON gifts (shop_id, points_cost) WHERE active;

-- ---------------------------------------------------------------- wallets & ledger
-- One wallet per (customer, shop). Points never cross shops (business rule 3).
CREATE TABLE wallets (
  customer_id        BIGINT NOT NULL REFERENCES customers(user_id),
  shop_id            BIGINT NOT NULL REFERENCES shops(id),
  balance_points     BIGINT NOT NULL DEFAULT 0 CHECK (balance_points >= 0),   -- available to redeem
  held_points        BIGINT NOT NULL DEFAULT 0 CHECK (held_points >= 0),      -- inside an open redemption
  earned_points      BIGINT NOT NULL DEFAULT 0,
  redeemed_points    BIGINT NOT NULL DEFAULT 0,
  purchase_paise     BIGINT NOT NULL DEFAULT 0,
  visits             INTEGER NOT NULL DEFAULT 0,
  first_visit_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_visit_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked            BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (customer_id, shop_id)
);
-- Shop's customer list, sorted by points or recency, without touching other shops' rows.
CREATE INDEX wallets_shop_balance ON wallets (shop_id, balance_points DESC);
CREATE INDEX wallets_shop_recent  ON wallets (shop_id, last_visit_at DESC);
CREATE INDEX wallets_shop_purchase ON wallets (shop_id, purchase_paise DESC);

-- Points are held in lots so each lot keeps the point value and expiry of the day it was earned.
-- Redemptions consume lots oldest-expiry-first (FIFO).
CREATE TABLE point_lots (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id       BIGINT NOT NULL,
  shop_id           BIGINT NOT NULL,
  points_original   INTEGER NOT NULL CHECK (points_original > 0),
  points_remaining  INTEGER NOT NULL CHECK (points_remaining >= 0 AND points_remaining <= points_original),
  point_value_paise INTEGER NOT NULL,
  expires_at        TIMESTAMPTZ,
  source_entry_id   BIGINT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (customer_id, shop_id) REFERENCES wallets(customer_id, shop_id)
);
-- FIFO pick and expiry job only ever read open lots.
CREATE INDEX point_lots_open_fifo ON point_lots (customer_id, shop_id, expires_at NULLS LAST, id) WHERE points_remaining > 0;
CREATE INDEX point_lots_expiring  ON point_lots (expires_at) WHERE points_remaining > 0 AND expires_at IS NOT NULL;
-- "You owe customers ₹X": index-only scan over a shop's open lots.
CREATE INDEX point_lots_shop_open ON point_lots (shop_id) INCLUDE (points_remaining, point_value_paise) WHERE points_remaining > 0;

CREATE TABLE bills (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id           BIGINT NOT NULL REFERENCES shops(id),
  customer_id       BIGINT NOT NULL REFERENCES customers(user_id),
  invoice_no        TEXT,
  amount_paise      BIGINT NOT NULL CHECK (amount_paise > 0),
  photo_url         TEXT,
  config_id         BIGINT NOT NULL REFERENCES loyalty_configs(id),
  offer_id          BIGINT REFERENCES offers(id),
  base_points       INTEGER NOT NULL,
  points            INTEGER NOT NULL,
  created_by        BIGINT NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at       TIMESTAMPTZ
);
-- Same invoice can never earn twice in a shop (business rule 10). A reversed bill frees
-- its invoice number so the corrected entry can be added.
CREATE UNIQUE INDEX bills_unique_invoice ON bills (shop_id, lower(invoice_no)) WHERE invoice_no IS NOT NULL AND reversed_at IS NULL;

CREATE TABLE redemptions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id        VARCHAR(20) NOT NULL UNIQUE,       -- VP-RD-xxxxxx shown to people
  shop_id          BIGINT NOT NULL REFERENCES shops(id),
  customer_id      BIGINT NOT NULL REFERENCES customers(user_id),
  method           redemption_method NOT NULL,
  gift_id          BIGINT REFERENCES gifts(id),
  points           INTEGER NOT NULL CHECK (points > 0),
  value_paise      BIGINT NOT NULL,                    -- sum over consumed lots
  upi_id           TEXT,
  status           redemption_status NOT NULL DEFAULT 'held',
  payment_ref      TEXT,                               -- UPI txn ref / note from shop
  otp_hash         TEXT,
  otp_expires_at   TIMESTAMPTZ,
  otp_attempts     SMALLINT NOT NULL DEFAULT 0,
  confirm_channel  TEXT,                               -- 'app' | 'sms_otp'
  dispute_note     TEXT,
  created_by       BIGINT NOT NULL REFERENCES users(id),
  paid_by          BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at          TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  CHECK ((method = 'gift') = (gift_id IS NOT NULL))
);
-- No duplicate redemption: one open redemption per customer per shop.
CREATE UNIQUE INDEX redemptions_one_open ON redemptions (shop_id, customer_id) WHERE status IN ('held','paid','disputed');
CREATE INDEX redemptions_customer_open ON redemptions (customer_id) WHERE status IN ('held','paid');
CREATE INDEX redemptions_shop_status ON redemptions (shop_id, status, created_at DESC);
CREATE INDEX redemptions_stale_paid ON redemptions (paid_at) WHERE status = 'paid';

-- Which lots a redemption took, so cancel/release can put points back exactly.
CREATE TABLE redemption_lots (
  redemption_id BIGINT NOT NULL REFERENCES redemptions(id),
  lot_id        BIGINT NOT NULL REFERENCES point_lots(id),
  points        INTEGER NOT NULL CHECK (points > 0),
  PRIMARY KEY (redemption_id, lot_id)
);

-- Append-only ledger. The only source of truth for history and audits.
CREATE TABLE ledger_entries (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id      VARCHAR(20) NOT NULL UNIQUE,          -- VP-ER-/VP-MN-/VP-RD-/VP-RV-
  shop_id        BIGINT NOT NULL,
  customer_id    BIGINT NOT NULL,
  type           ledger_type NOT NULL,
  points         INTEGER NOT NULL,                     -- signed effect on balance_points
  value_paise    BIGINT NOT NULL DEFAULT 0,
  balance_after  BIGINT NOT NULL,
  bill_id        BIGINT REFERENCES bills(id),
  redemption_id  BIGINT REFERENCES redemptions(id),
  reverses_id    BIGINT REFERENCES ledger_entries(id),
  reason         TEXT,
  remarks        TEXT,
  created_by     BIGINT REFERENCES users(id),          -- NULL for system jobs (expiry)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (customer_id, shop_id) REFERENCES wallets(customer_id, shop_id)
);
-- Shop transaction list / reports, customer history, customer-at-shop history,
-- staff manual-limit check. Each is an index range scan in time order.
CREATE INDEX ledger_shop_time      ON ledger_entries (shop_id, created_at DESC);
CREATE INDEX ledger_customer_time  ON ledger_entries (customer_id, created_at DESC);
CREATE INDEX ledger_cust_shop_time ON ledger_entries (customer_id, shop_id, created_at DESC);
CREATE INDEX ledger_staff_manual   ON ledger_entries (shop_id, created_by, created_at) WHERE type = 'earn_manual';
CREATE UNIQUE INDEX ledger_one_reversal ON ledger_entries (reverses_id) WHERE reverses_id IS NOT NULL;

-- Daily counters per shop, updated in the same transaction as the ledger.
-- Dashboards read 30 tiny rows instead of scanning the ledger.
CREATE TABLE shop_daily_stats (
  shop_id          BIGINT NOT NULL REFERENCES shops(id),
  day              DATE NOT NULL,
  bills            INTEGER NOT NULL DEFAULT 0,
  purchase_paise   BIGINT NOT NULL DEFAULT 0,
  points_issued    BIGINT NOT NULL DEFAULT 0,
  points_redeemed  BIGINT NOT NULL DEFAULT 0,
  value_redeemed_paise BIGINT NOT NULL DEFAULT 0,
  points_expired   BIGINT NOT NULL DEFAULT 0,
  new_customers    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, day)
);

-- ---------------------------------------------------------------- platform
CREATE TABLE milestones (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT NOT NULL,
  threshold      BIGINT NOT NULL CHECK (threshold >= 0),   -- points, or paise when basis = value
  color          VARCHAR(7) NOT NULL DEFAULT '#9AA6B4',
  perks          TEXT[] NOT NULL DEFAULT '{}',
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (threshold)
);
CREATE TABLE platform_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE otp_codes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mobile      VARCHAR(15) NOT NULL,
  purpose     otp_purpose NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX otp_lookup ON otp_codes (mobile, purpose, created_at DESC) WHERE NOT used;

-- Outbox pattern: SMS rows are written inside the business transaction and sent by a worker,
-- so a provider outage never loses or double-sends a message.
CREATE TABLE sms_outbox (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mobile      VARCHAR(15) NOT NULL,
  template    TEXT NOT NULL,
  body        TEXT NOT NULL,
  shop_id     BIGINT REFERENCES shops(id),          -- charged to shop when set
  status      TEXT NOT NULL DEFAULT 'queued',       -- queued | sent | failed
  attempts    SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX sms_outbox_queue ON sms_outbox (id) WHERE status = 'queued';

CREATE TABLE audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id),
  shop_id     BIGINT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_by_shop ON audit_log (shop_id, created_at DESC);

-- Safe retries from flaky counter networks: same key = same result, no double points.
CREATE TABLE idempotency_keys (
  user_id     BIGINT NOT NULL,
  key         VARCHAR(64) NOT NULL,
  request_hash TEXT NOT NULL,
  response    JSONB,
  status_code SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---------------------------------------------------------------- seed reference data
INSERT INTO categories (code, name, sort) VALUES
 ('plywood','Plywood & boards',1),('laminates','Laminates & veneer',2),('hardware','Hardware & fittings',3),
 ('adhesives','Adhesives',4),('paints','Paints',5),('tiles','Tiles & marble',6),('sanitary','Sanitary & bath',7),
 ('plumbing','Plumbing pipes',8),('electrical','Electrical',9),('lights','Lights & fans',10),
 ('furniture','Furniture & interiors',11),('other','Other',12);

INSERT INTO milestones (name, threshold, color, perks) VALUES
 ('Starter', 0, '#9AA6B4', '{}'),
 ('Silver', 2000, '#8E9AAB', '{"Silver badge on your QR"}'),
 ('Gold', 5000, '#E0A800', '{"Gold badge on your QR","Extra points at shops that give a Gold bonus","First to hear about new offers"}'),
 ('Platinum', 10000, '#5B6B8C', '{"Platinum badge on your QR","Priority help"}'),
 ('Diamond', 20000, '#3A8FB7', '{"Diamond badge on your QR"}');

INSERT INTO platform_settings (key, value) VALUES
 ('milestone_basis', '"points"'),
 ('reverse_window_minutes', '15'),
 ('redeem_confirm_timeout_hours', '24');

