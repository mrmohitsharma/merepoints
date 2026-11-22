-- Shop levels (Silver / Gold / Platinum by spend in the last 12 months, higher reward % on every bill)
-- and loyalty goals (visits or spend inside a period earn bonus points; repeats every period).
CREATE TABLE shop_levels (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id          BIGINT NOT NULL REFERENCES shops(id),
  rank             SMALLINT NOT NULL CHECK (rank BETWEEN 1 AND 3),          -- 1 Silver, 2 Gold, 3 Platinum
  min_spend_paise  BIGINT NOT NULL CHECK (min_spend_paise > 0),             -- spend at this shop in the last 12 months
  reward_bps       INTEGER NOT NULL CHECK (reward_bps BETWEEN 1 AND 5000),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, rank)
);

CREATE TABLE shop_goals (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id       BIGINT NOT NULL REFERENCES shops(id),
  kind          TEXT NOT NULL CHECK (kind IN ('visits','spend')),
  target        BIGINT NOT NULL CHECK (target > 0),                         -- number of visits, or spend in paise
  period_days   SMALLINT NOT NULL CHECK (period_days BETWEEN 7 AND 90),
  bonus_points  INTEGER NOT NULL CHECK (bonus_points BETWEEN 1 AND 100000),
  starts_on     DATE NOT NULL,                                              -- periods are counted from this day (IST)
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    BIGINT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_goals_active ON shop_goals (shop_id) WHERE active;

-- One bonus per customer per goal per period.
CREATE TABLE goal_awards (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  goal_id     BIGINT NOT NULL REFERENCES shop_goals(id),
  shop_id     BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  window_no   INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (goal_id, customer_id, window_no)
);
CREATE INDEX bills_customer_shop_time ON bills (customer_id, shop_id, created_at) WHERE reversed_at IS NULL;

-- Both features come with the Advanced package; Super Admin can switch them per package.
UPDATE plans SET feature_keys = feature_keys || ARRAY['shop_levels','loyalty_goals']
 WHERE code = 'advanced' AND NOT (feature_keys @> ARRAY['shop_levels']);
