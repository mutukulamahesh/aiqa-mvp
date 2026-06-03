-- Northwind (minimal) — SQLite schema + seed data for EPIC-RWT integration tests.
-- Run via: npx ts-node scripts/setup-rwt-db.ts

CREATE TABLE IF NOT EXISTS categories (
  category_id   INTEGER PRIMARY KEY,
  category_name TEXT NOT NULL,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id   TEXT PRIMARY KEY,
  company_name  TEXT NOT NULL,
  country       TEXT
);

CREATE TABLE IF NOT EXISTS products (
  product_id      INTEGER PRIMARY KEY,
  product_name    TEXT NOT NULL,
  category_id     INTEGER REFERENCES categories(category_id),
  unit_price      REAL    NOT NULL DEFAULT 0,
  units_in_stock  INTEGER NOT NULL DEFAULT 0,
  discontinued    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  order_id    INTEGER PRIMARY KEY,
  customer_id TEXT REFERENCES customers(customer_id),
  order_date  TEXT NOT NULL,
  freight     REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_details (
  order_id   INTEGER NOT NULL REFERENCES orders(order_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  unit_price REAL    NOT NULL,
  quantity   INTEGER NOT NULL,
  discount   REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (order_id, product_id)
);

-- Categories
INSERT INTO categories VALUES (1, 'Beverages',    'Soft drinks, coffees, teas, beers');
INSERT INTO categories VALUES (2, 'Condiments',   'Sweet and savory sauces, relishes');
INSERT INTO categories VALUES (3, 'Confections',  'Desserts, candies, breads');
INSERT INTO categories VALUES (4, 'Dairy Products','Cheeses');
INSERT INTO categories VALUES (5, 'Grains/Cereals','Breads, crackers, pasta');

-- Customers
INSERT INTO customers VALUES ('ALFKI', 'Alfreds Futterkiste',   'Germany');
INSERT INTO customers VALUES ('ANATR', 'Ana Trujillo Emparedados', 'Mexico');
INSERT INTO customers VALUES ('BONAP', 'Bon app',               'France');
INSERT INTO customers VALUES ('CONSH', 'Consolidated Holdings', 'UK');
INSERT INTO customers VALUES ('EASTC', 'Eastern Connection',    'UK');

-- Products
INSERT INTO products VALUES (1,  'Chai',                    1, 18.00,  39, 0);
INSERT INTO products VALUES (2,  'Chang',                   1, 19.00,  17, 0);
INSERT INTO products VALUES (3,  'Aniseed Syrup',           2, 10.00,  13, 0);
INSERT INTO products VALUES (4,  'Chef Anton''s Mix',       2, 22.00,  53, 0);
INSERT INTO products VALUES (5,  'Grandma''s Boysen Jam',   2, 25.00,  12, 0);
INSERT INTO products VALUES (6,  'Uncle Bob''s Organic',    5,  4.50,  15, 0);
INSERT INTO products VALUES (7,  'Queso Cabrales',          4, 21.00,  22, 0);
INSERT INTO products VALUES (8,  'Queso Manchego',          4, 38.00,  86, 0);
INSERT INTO products VALUES (9,  'Konbu',                   3,  6.00,  24, 0);
INSERT INTO products VALUES (10, 'Tofu',                    5, 23.25,  35, 0);

-- Orders
INSERT INTO orders VALUES (10248, 'ALFKI', '2024-07-04', 32.38);
INSERT INTO orders VALUES (10249, 'ANATR', '2024-07-05', 11.61);
INSERT INTO orders VALUES (10250, 'BONAP', '2024-07-08', 65.83);
INSERT INTO orders VALUES (10251, 'CONSH', '2024-07-08', 41.34);
INSERT INTO orders VALUES (10252, 'EASTC', '2024-07-09', 51.30);

-- Order Details
INSERT INTO order_details VALUES (10248, 1,  14.00, 12, 0);
INSERT INTO order_details VALUES (10248, 2,   9.80, 10, 0);
INSERT INTO order_details VALUES (10249, 3,  34.80,  9, 0);
INSERT INTO order_details VALUES (10249, 4,  11.20, 40, 0);
INSERT INTO order_details VALUES (10250, 5,   7.70, 10, 0.05);
INSERT INTO order_details VALUES (10250, 6,  42.40, 35, 0.15);
INSERT INTO order_details VALUES (10251, 7,  16.80,  6, 0.05);
INSERT INTO order_details VALUES (10251, 8,  15.60, 15, 0.05);
INSERT INTO order_details VALUES (10252, 9,  64.80,  2, 0);
INSERT INTO order_details VALUES (10252, 10, 2.00,  40, 0);
