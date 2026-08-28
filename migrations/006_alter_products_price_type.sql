-- Change price and rating columns from DECIMAL to DOUBLE PRECISION
-- This fixes the Rust type mismatch (f64 expects FLOAT8, not NUMERIC)

ALTER TABLE products
    ALTER COLUMN price TYPE DOUBLE PRECISION,
    ALTER COLUMN rating TYPE DOUBLE PRECISION;
