-- Super admin team, shop billing (plans, trials, SMS packs, Razorpay payments).

-- ---------------------------------------------------------------- admin team (separate from app users)
CREATE TYPE admin_role AS ENUM ('owner', 'ops', 'support');

CREATE TABLE admin_users (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username         CITEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  password_hash    TEXT NOT NULL,                 -- scrypt$N$r$p$salt$hash
  role             admin_role NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts  SMALLINT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_version    INTEGER NOT NULL DEFAULT 0,      -- +1 on password change/reset/deactivate: old sessions end
  last_login_at    TIMESTAMPTZ,
  created_by       BIGINT REFERENCES admin_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin actions are audited against admin_users, app actions against users.
ALTER TABLE audit_log ADD COLUMN admin_id BIGINT REFERENCES admin_users(id);
CREATE INDEX audit_by_time ON audit_log (created_at DESC);

-- ---------------------------------------------------------------- plans & SMS packs (prices editable by admin)
CREATE TABLE plans (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           VARCHAR(20) NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  price_paise    INTEGER NOT NULL CHECK (price_paise >= 0),     -- per month, GST included
  max_staff      INTEGER NOT NULL CHECK (max_staff >= 0),        -- staff besides the owner
  sms_included   INTEGER NOT NULL DEFAULT 0 CHECK (sms_included >= 0),   -- added each paid month
  features       TEXT[] NOT NULL DEFAULT '{}',
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort           SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE sms_packs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         VARCHAR(20) NOT NULL UNIQUE,
  sms_count    INTEGER NOT NULL CHECK (sms_count > 0),
  price_paise  INTEGER NOT NULL CHECK (price_paise > 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Billing state is derived from dates (no cron needed to flip states):
--   now <= period_end                 -> trial / active
--   now <= period_end + grace days    -> grace (full access, reminders)
--   otherwise                         -> read_only (no new points / SMS; redeeming still works)
CREATE TABLE shop_subscriptions (
  shop_id             BIGINT PRIMARY KEY REFERENCES shops(id),
  plan_id             BIGINT NOT NULL REFERENCES plans(id),
  trial_ends_at       TIMESTAMPTZ NOT NULL,
  current_period_end  TIMESTAMPTZ,                -- NULL until the first payment
  cancelled           BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_subscriptions_due ON shop_subscriptions ((COALESCE(current_period_end, trial_ends_at)));

CREATE TYPE payment_kind   AS ENUM ('plan', 'sms_pack', 'manual_extension');
CREATE TYPE payment_status AS ENUM ('created', 'paid', 'failed');

CREATE TABLE payments (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id           VARCHAR(20) NOT NULL UNIQUE,         -- receipt no. shown to shop
  shop_id             BIGINT NOT NULL REFERENCES shops(id),
  kind                payment_kind NOT NULL,
  plan_id             BIGINT REFERENCES plans(id),
  sms_pack_id         BIGINT REFERENCES sms_packs(id),
  amount_paise        INTEGER NOT NULL CHECK (amount_paise >= 0),
  status              payment_status NOT NULL DEFAULT 'created',
  provider            TEXT NOT NULL,                        -- razorpay | test | admin
  order_id            TEXT UNIQUE,
  provider_payment_id TEXT UNIQUE,
  period_start        TIMESTAMPTZ,
  period_end          TIMESTAMPTZ,
  sms_added           INTEGER NOT NULL DEFAULT 0,
  created_by          BIGINT REFERENCES users(id),
  admin_id            BIGINT REFERENCES admin_users(id),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);
CREATE INDEX payments_shop ON payments (shop_id, created_at DESC);
CREATE INDEX payments_paid ON payments (paid_at DESC) WHERE status = 'paid';

-- Placeholder prices; change them in Super Admin › Plans.
INSERT INTO plans (code, name, price_paise, max_staff, sms_included, features, sort) VALUES
 ('basic',    'Basic',    49900,  1,  100, '{"1 staff login","100 SMS a month","Reports & CSV"}', 1),
 ('pro',      'Pro',      99900,  3,  300, '{"3 staff logins","300 SMS a month","Offers & gifts","Reports & CSV"}', 2),
 ('business', 'Business', 199900, 10, 1000, '{"10 staff logins","1,000 SMS a month","Offers & gifts","Priority support"}', 3);

INSERT INTO sms_packs (code, sms_count, price_paise) VALUES
 ('sms500', 500, 15000), ('sms1000', 1000, 25000), ('sms5000', 5000, 100000);

INSERT INTO platform_settings (key, value) VALUES
 ('trial_days', '30'), ('grace_days', '7'), ('default_plan', '"pro"')
ON CONFLICT (key) DO NOTHING;

-- Shops already approved before billing existed get a fresh trial.
INSERT INTO shop_subscriptions (shop_id, plan_id, trial_ends_at)
SELECT s.id, (SELECT id FROM plans WHERE code = 'pro'), now() + interval '30 days'
  FROM shops s WHERE s.status = 'approved'
ON CONFLICT DO NOTHING;

-- Admin can hide a category from sign-up without breaking shops that already use it.
ALTER TABLE categories ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
-- Admin customer lookup by part of a name or mobile.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX users_mobile_trgm ON users USING gin (mobile gin_trgm_ops);
