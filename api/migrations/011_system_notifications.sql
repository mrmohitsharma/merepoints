-- 'system' notifications (e.g. "You earned 31 points") go to one customer's inbox and push,
-- but are not campaigns: they never show in the shop's Notifications list or count against its limits.
ALTER TABLE notifications ADD COLUMN kind TEXT NOT NULL DEFAULT 'campaign' CHECK (kind IN ('campaign', 'system'));
CREATE INDEX ledger_earn_by_customer ON ledger_entries (customer_id, id DESC) WHERE type IN ('earn_bill', 'earn_manual');
