-- Super Admin can switch a customer off (cannot log in, cannot earn) and add/deduct points by hand.
ALTER TABLE users ADD COLUMN deactivated_at TIMESTAMPTZ;
ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'admin_add';
ALTER TYPE ledger_type ADD VALUE IF NOT EXISTS 'admin_deduct';
