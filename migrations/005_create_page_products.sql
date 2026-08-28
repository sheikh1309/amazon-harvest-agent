-- Page Products: join table linking pages to products with page-specific data
-- This allows the same product to appear on multiple pages with different titles/features

CREATE TABLE page_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

    -- Position in the page (1 = first/best, 10 = last)
    rank INTEGER NOT NULL,

    -- Page-specific product data (can override base product data)
    enhanced_title TEXT, -- custom title for this page, NULL = use product.title
    key_features JSONB NOT NULL DEFAULT '[]', -- array of feature strings

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Each product can only appear once per page
    UNIQUE(page_id, product_id),

    -- Ensure unique ranking within a page
    UNIQUE(page_id, rank)
);

-- Indexes for fast queries
CREATE INDEX idx_page_products_page_id ON page_products(page_id);
CREATE INDEX idx_page_products_product_id ON page_products(product_id);
CREATE INDEX idx_page_products_rank ON page_products(rank);

-- Combined index for getting page products in order
CREATE INDEX idx_page_products_page_rank ON page_products(page_id, rank);

-- GIN index for key_features search
CREATE INDEX idx_page_products_features_gin ON page_products USING gin(key_features);
