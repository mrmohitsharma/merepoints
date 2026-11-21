-- Packages: admin-editable features + limits + monthly/yearly price per plan, add-on packs, per-shop overrides.
ALTER TABLE plans
  ADD COLUMN yearly_price_paise  INTEGER CHECK (yearly_price_paise >= 0),   -- NULL = no yearly option
  ADD COLUMN feature_keys        TEXT[] NOT NULL DEFAULT '{}',              -- entitlements, see src/billing/entitlements.ts
  ADD COLUMN limit_notifications INTEGER CHECK (limit_notifications >= 0),  -- per calendar month; NULL = unlimited
  ADD COLUMN limit_products      INTEGER CHECK (limit_products >= 0),       -- active products + gifts in total
  ADD COLUMN limit_offers        INTEGER CHECK (limit_offers >= 0),         -- offers that have not ended yet
  ADD COLUMN limit_ads           INTEGER CHECK (limit_ads >= 0);            -- ads per month included free; more are paid

-- Names asked for: Basic (free) / Business / Advanced. Old 'business' becomes 'advanced', old 'pro' becomes 'business'.
UPDATE plans SET code = 'advanced', name = 'Advanced', sort = 3 WHERE code = 'business';
UPDATE plans SET code = 'business', name = 'Business', sort = 2 WHERE code = 'pro';
UPDATE plans SET price_paise = 0, sort = 1, max_staff = 0, sms_included = 0 WHERE code = 'basic';
UPDATE plans SET max_staff = 0, sms_included = 0 WHERE code = 'business';
UPDATE plans SET max_staff = 10, sms_included = 0 WHERE code = 'advanced';
UPDATE plans SET features = '{}';
UPDATE plans SET price_paise = 99900, yearly_price_paise = 999000 WHERE code = 'business';
UPDATE plans SET price_paise = 199900, yearly_price_paise = 1999000 WHERE code = 'advanced';

UPDATE plans SET feature_keys = '{}', limit_notifications = 0, limit_products = 0, limit_offers = 0, limit_ads = 0 WHERE code = 'basic';
UPDATE plans SET feature_keys = '{products_gifts,offers,reward_slabs,dues_book,bill_photos,customer_block}',
                 limit_notifications = 0, limit_products = 100, limit_offers = 3, limit_ads = 0 WHERE code = 'business';
UPDATE plans SET feature_keys = '{products_gifts,offers,reward_slabs,dues_book,bill_photos,customer_block,reports,staff_roles,notifications,ads,rules_history}',
                 limit_notifications = 100, limit_products = 300, limit_offers = 10, limit_ads = 1 WHERE code = 'advanced';

-- Extra units a shop can buy once a package limit is used up.
CREATE TABLE addon_packs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         VARCHAR(30) NOT NULL UNIQUE,
  kind         VARCHAR(20) NOT NULL CHECK (kind IN ('notifications', 'products', 'offers', 'ads')),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  price_paise  INTEGER NOT NULL CHECK (price_paise > 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO addon_packs (code, kind, quantity, price_paise) VALUES
 ('notif100', 'notifications', 100, 29900),
 ('prod50',   'products',      50,  19900),
 ('offer5',   'offers',        5,   14900),
 ('ads1',     'ads',           1,   49900);

-- Bought extras. They expire with the package period the shop was on when it bought them.
CREATE TABLE shop_addon_credits (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id     BIGINT NOT NULL REFERENCES shops(id),
  kind        VARCHAR(20) NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  used        INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= quantity),
  expires_at  TIMESTAMPTZ NOT NULL,
  payment_id  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_addon_credits_shop ON shop_addon_credits (shop_id, kind, expires_at);

ALTER TYPE payment_kind ADD VALUE IF NOT EXISTS 'addon';
ALTER TABLE payments
  ADD COLUMN addon_pack_id BIGINT REFERENCES addon_packs(id),
  ADD COLUMN billing_period VARCHAR(8) NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly', 'yearly'));

-- Per-shop exceptions from the super admin: {"featuresAdd":[], "featuresRemove":[], "limits":{"notifications":500}}
ALTER TABLE shop_subscriptions ADD COLUMN overrides JSONB NOT NULL DEFAULT '{}';

-- Everyone lands on Basic. New shops start on the free plan with no trial.
UPDATE shop_subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'basic');
INSERT INTO platform_settings (key, value) VALUES ('free_plan', '"basic"') ON CONFLICT (key) DO UPDATE SET value = '"basic"';
UPDATE platform_settings SET value = '"basic"' WHERE key = 'default_plan';
UPDATE platform_settings SET value = '0' WHERE key = 'trial_days';
