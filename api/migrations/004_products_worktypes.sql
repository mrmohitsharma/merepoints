-- Work types become editable (Super Admin), and gifts become products with two kinds:
--   redeem: customer takes it for points (what gifts were)
--   earn:   fixed bonus points per unit when the customer buys it, added at the counter

-- ---------------------------------------------------------------- work types
CREATE TABLE professions (
  code     TEXT PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  name     TEXT NOT NULL,
  name_hi  TEXT,
  sort     SMALLINT NOT NULL DEFAULT 0,
  active   BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO professions (code, name, name_hi, sort) VALUES
 ('carpenter','Carpenter','बढ़ई',1), ('painter','Painter','पेंटर',2), ('contractor','Contractor','ठेकेदार',3),
 ('interior_designer','Interior designer','इंटीरियर डिज़ाइनर',4), ('architect','Architect','आर्किटेक्ट',5),
 ('plumber','Plumber','प्लंबर',6), ('electrician','Electrician','इलेक्ट्रीशियन',7),
 ('mason','Mason (raj mistri)','राज मिस्त्री',8), ('tile_fitter','Tile fitter','टाइल फिटर',9),
 ('pop_ceiling','POP / false ceiling','पीओपी / फॉल्स सीलिंग',10), ('fabricator','Welder / fabricator','वेल्डर / फैब्रिकेटर',11),
 ('kitchen_installer','Kitchen / wardrobe installer','किचन / वार्डरोब फिटर',12), ('builder','Builder / site supervisor','बिल्डर / साइट सुपरवाइज़र',13),
 ('other','Other','अन्य',99);

ALTER TABLE customers ALTER COLUMN profession DROP DEFAULT;
ALTER TABLE customers ALTER COLUMN profession TYPE TEXT USING profession::text;
ALTER TABLE customers ALTER COLUMN profession SET DEFAULT 'other';
ALTER TABLE customers ADD CONSTRAINT customers_profession_fk FOREIGN KEY (profession) REFERENCES professions(code);
ALTER TABLE offers ALTER COLUMN professions TYPE TEXT[] USING professions::text[];
DROP TYPE profession;
CREATE INDEX customers_profession ON customers (profession);

-- ---------------------------------------------------------------- products
ALTER TABLE gifts RENAME TO products;
DROP INDEX gifts_by_shop;
CREATE TYPE product_kind AS ENUM ('redeem', 'earn');
ALTER TABLE products
  ADD COLUMN kind         product_kind NOT NULL DEFAULT 'redeem',
  ADD COLUMN brand        TEXT,
  ADD COLUMN category     TEXT,
  ADD COLUMN mrp_paise    INTEGER CHECK (mrp_paise >= 0),
  ADD COLUMN bonus_points INTEGER CHECK (bonus_points > 0 AND bonus_points <= 100000),
  ADD COLUMN unit         TEXT,                     -- sheet, tin, pair, box, piece…
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE products ALTER COLUMN points_cost DROP NOT NULL;
ALTER TABLE products ALTER COLUMN stock DROP NOT NULL;
ALTER TABLE products ADD CONSTRAINT products_kind_fields CHECK (
  (kind = 'redeem' AND points_cost IS NOT NULL AND stock IS NOT NULL AND bonus_points IS NULL)
  OR (kind = 'earn' AND bonus_points IS NOT NULL AND points_cost IS NULL));
-- Customer feeds: by shop and kind, cheapest first; and search by name.
CREATE INDEX products_shop_kind ON products (shop_id, kind, points_cost) WHERE active;
CREATE INDEX products_name_trgm ON products USING gin (name gin_trgm_ops);

-- Bonus products ticked on a bill. The bonus is fixed: no offer multiplier, outside the per-bill cap.
ALTER TABLE bills ADD COLUMN bonus_points INTEGER NOT NULL DEFAULT 0 CHECK (bonus_points >= 0);
CREATE TABLE bill_items (
  bill_id     BIGINT NOT NULL REFERENCES bills(id),
  product_id  BIGINT NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 10000),
  bonus_each  INTEGER NOT NULL CHECK (bonus_each > 0),
  PRIMARY KEY (bill_id, product_id)
);
CREATE INDEX bill_items_product ON bill_items (product_id);
