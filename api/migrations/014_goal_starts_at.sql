-- Goals count only bills made after the goal was started (not earlier bills on the same day).
ALTER TABLE shop_goals ADD COLUMN starts_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE shop_goals SET starts_at = created_at;
