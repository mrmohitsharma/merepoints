-- Bill-amount slabs: e.g. ₹0+ 2%, ₹10,000+ 5%, ₹20,000+ 7%.
-- The slab a bill falls in sets the % for the whole bill. NULL = one flat % (reward_bps).
-- Stored as [{"from_paise":0,"bps":200},{"from_paise":1000000,"bps":500},...], sorted, first from 0.
ALTER TABLE loyalty_configs ADD COLUMN reward_slabs JSONB
  CHECK (reward_slabs IS NULL OR (jsonb_typeof(reward_slabs) = 'array' AND jsonb_array_length(reward_slabs) BETWEEN 2 AND 10));

-- The % actually applied to each bill, for reports and disputes ("why 750 points?").
ALTER TABLE bills ADD COLUMN reward_bps INTEGER;
UPDATE bills b SET reward_bps = lc.reward_bps FROM loyalty_configs lc WHERE lc.id = b.config_id AND b.reward_bps IS NULL;
