-- Customer accounts and their loyalty balance.
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  loyalty_points INTEGER NOT NULL DEFAULT 0
);

-- Orders placed by customers, with the shipping address snapshot.
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  shipping_address TEXT NOT NULL,
  placed_at TEXT NOT NULL
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
