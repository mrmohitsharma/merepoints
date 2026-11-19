-- Home-screen ad carousel. Created by Super Admin, or requested + paid by a shop and approved by Super Admin.
-- Live = status 'scheduled' and starts_at <= now() < ends_at. "Ended" is derived from ends_at.

CREATE TYPE ad_status     AS ENUM ('pending_payment', 'pending_review', 'scheduled', 'paused', 'rejected', 'cancelled');
CREATE TYPE ad_advertiser AS ENUM ('brand', 'shop', 'own');
CREATE TYPE ad_target     AS ENUM ('all', 'cities', 'near_shop');
CREATE TYPE ad_link       AS ENUM ('none', 'shop', 'product');

ALTER TYPE payment_kind ADD VALUE IF NOT EXISTS 'ad';

CREATE TABLE ad_packs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  days        INTEGER NOT NULL CHECK (days BETWEEN 1 AND 90),
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  radius_km   INTEGER NOT NULL DEFAULT 10 CHECK (radius_km BETWEEN 1 AND 50),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INTEGER NOT NULL DEFAULT 0
);
INSERT INTO ad_packs (code, name, days, price_paise, radius_km, sort) VALUES
  ('ad7',  '7 days',  7,  49900, 10, 1),
  ('ad15', '15 days', 15, 89900, 10, 2),
  ('ad30', '30 days', 30, 149900, 10, 3);

CREATE TABLE ads (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status          ad_status NOT NULL,
  advertiser_kind ad_advertiser NOT NULL,
  advertiser_name TEXT NOT NULL,
  shop_id         BIGINT REFERENCES shops(id),          -- the shop that requested / paid (advertiser 'shop')
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 60),
  subtitle        TEXT CHECK (length(subtitle) <= 90),
  title_hi        TEXT CHECK (length(title_hi) <= 60),
  subtitle_hi     TEXT CHECK (length(subtitle_hi) <= 90),
  image_url       TEXT,                                 -- 1080×450 banner; else bg_color + text
  bg_color        TEXT CHECK (bg_color ~ '^#[0-9A-Fa-f]{6}$'),
  link_kind       ad_link NOT NULL DEFAULT 'none',
  link_shop_id    BIGINT REFERENCES shops(id),
  link_product_id BIGINT REFERENCES products(id),
  target_mode     ad_target NOT NULL DEFAULT 'all',
  cities          TEXT[],
  radius_km       INTEGER CHECK (radius_km BETWEEN 1 AND 50),
  professions     TEXT[],                               -- NULL = all work types
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  sort            INTEGER NOT NULL DEFAULT 50,
  pack_id         BIGINT REFERENCES ad_packs(id),
  amount_paise    INTEGER NOT NULL DEFAULT 0,
  reject_reason   TEXT,
  created_by      BIGINT REFERENCES users(id),
  admin_id        BIGINT REFERENCES admin_users(id),
  reviewed_by     BIGINT REFERENCES admin_users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ads_period   CHECK (ends_at > starts_at),
  CONSTRAINT ads_visual   CHECK (image_url IS NOT NULL OR bg_color IS NOT NULL),
  CONSTRAINT ads_link     CHECK ((link_kind = 'none'    AND link_shop_id IS NULL AND link_product_id IS NULL)
                              OR (link_kind = 'shop'    AND link_shop_id IS NOT NULL AND link_product_id IS NULL)
                              OR (link_kind = 'product' AND link_product_id IS NOT NULL)),
  CONSTRAINT ads_target   CHECK ((target_mode = 'cities' AND cardinality(cities) > 0)
                              OR (target_mode = 'near_shop' AND shop_id IS NOT NULL AND radius_km IS NOT NULL)
                              OR target_mode = 'all'),
  CONSTRAINT ads_shop_own CHECK (advertiser_kind <> 'shop' OR shop_id IS NOT NULL)
);
CREATE INDEX ads_live ON ads (starts_at, ends_at) WHERE status = 'scheduled';
CREATE INDEX ads_shop ON ads (shop_id, created_at DESC) WHERE shop_id IS NOT NULL;
CREATE INDEX ads_review ON ads (created_at) WHERE status = 'pending_review';

ALTER TABLE payments ADD COLUMN ad_id BIGINT REFERENCES ads(id);

CREATE TABLE ad_daily_stats (
  ad_id BIGINT NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  day   DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  taps  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, day)
);
