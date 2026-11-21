-- Up to 3 photos per bill, and a dues book (udhaar): what a Site Expert owes the shop.

ALTER TABLE bills ADD COLUMN photo_urls TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE bills ADD CONSTRAINT bills_photos_max3 CHECK (cardinality(photo_urls) <= 3);
UPDATE bills SET photo_urls = ARRAY[photo_url] WHERE photo_url IS NOT NULL;

-- Append-only book. Balance = dues - payments (entries not undone). Undo marks reversed_at; nothing is deleted.
CREATE TABLE due_entries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id       BIGINT NOT NULL,
  customer_id   BIGINT NOT NULL,
  kind          TEXT   NOT NULL CHECK (kind IN ('due','payment')),
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  note          TEXT   CHECK (char_length(note) <= 200),
  due_date      DATE,                                              -- 'due' only: when the customer promised to pay
  method        TEXT   CHECK (method IN ('cash','upi','cheque','other')),   -- 'payment' only
  photo_urls    TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 3),
  points        INTEGER,                                           -- 'payment' only: points earned on it
  created_by    BIGINT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at   TIMESTAMPTZ,
  reversed_by   BIGINT REFERENCES users(id),
  FOREIGN KEY (customer_id, shop_id) REFERENCES wallets (customer_id, shop_id)
);
CREATE INDEX due_entries_customer ON due_entries (shop_id, customer_id, created_at DESC);
CREATE INDEX due_entries_open ON due_entries (shop_id) WHERE reversed_at IS NULL;
