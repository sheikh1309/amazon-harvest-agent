CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    asin VARCHAR(20) NOT NULL,
    title TEXT NOT NULL,
    brand VARCHAR(255),
    price DECIMAL(10, 2),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    image_url TEXT,
    image_s3_key VARCHAR(500),
    rating DECIMAL(3, 2),
    review_count INTEGER,
    features JSONB,
    specifications JSONB,
    description TEXT,
    affiliate_url TEXT NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT true,
    last_fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(asin)
);

CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_asin ON products(asin);
CREATE INDEX idx_products_is_available ON products(is_available);
CREATE INDEX idx_products_title_gin ON products USING gin(to_tsvector('english', title));
CREATE INDEX idx_products_brand ON products(brand);
