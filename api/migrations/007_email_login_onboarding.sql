-- Email + password login (with reset by mobile code), up to 3 work types per customer,
-- work-type icons, and where the customer works (GPS + city + area).

ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'password_reset';

ALTER TABLE users
  ADD COLUMN password_hash  TEXT,
  ADD COLUMN failed_logins  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until   TIMESTAMPTZ;

ALTER TABLE professions ADD COLUMN icon TEXT;
UPDATE professions SET icon = CASE code
  WHEN 'carpenter' THEN '🪚'          WHEN 'painter' THEN '🖌️'          WHEN 'contractor' THEN '👷'
  WHEN 'interior_designer' THEN '🛋️'  WHEN 'architect' THEN '📐'        WHEN 'plumber' THEN '🔧'
  WHEN 'electrician' THEN '⚡'        WHEN 'mason' THEN '🧱'             WHEN 'tile_fitter' THEN '🔲'
  WHEN 'pop_ceiling' THEN '🏠'        WHEN 'fabricator' THEN '🔥'        WHEN 'kitchen_installer' THEN '🍳'
  WHEN 'builder' THEN '🏗️'            ELSE '➕' END;

-- profession stays as the first (main) work type, so reports and filters keep working.
ALTER TABLE customers
  ADD COLUMN professions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN area        TEXT,
  ADD COLUMN state       TEXT,
  ADD COLUMN pincode     VARCHAR(6),
  ADD COLUMN lat         DOUBLE PRECISION,
  ADD COLUMN lng         DOUBLE PRECISION;
UPDATE customers SET professions = ARRAY[profession];
ALTER TABLE customers ADD CONSTRAINT customers_professions_max3 CHECK (cardinality(professions) <= 3);
CREATE INDEX customers_professions_gin ON customers USING gin (professions);
