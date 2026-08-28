-- Pages table: stores SEO pages with all content
-- Each page belongs to a website and contains products with buying guides and FAQs

CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

    -- Slug and categorization
    slug VARCHAR(255) NOT NULL,
    parent_category VARCHAR(100) NOT NULL, -- e.g., "Electronics", "Automotive", "Home & Kitchen"

    -- SEO fields
    page_title VARCHAR(500) NOT NULL,
    meta_description TEXT NOT NULL,
    h1_title VARCHAR(500) NOT NULL,

    -- Content sections
    introduction TEXT NOT NULL,
    conclusion TEXT NOT NULL,

    -- Structured data (JSONB for flexible querying)
    -- buying_guide format: { "title": "...", "sections": [{ "heading": "...", "content": "..." }] }
    buying_guide JSONB NOT NULL DEFAULT '{"title": "", "sections": []}',

    -- faq format: [{ "question": "...", "answer": "..." }]
    faq JSONB NOT NULL DEFAULT '[]',

    -- Navigation and display
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_nav_link BOOLEAN NOT NULL DEFAULT false, -- whether to show in navigation
    nav_display_order INTEGER DEFAULT 0, -- order in navigation (lower = first)

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Unique constraint: one slug per website
    UNIQUE(website_id, slug)
);

-- Indexes for fast queries
CREATE INDEX idx_pages_website_id ON pages(website_id);
CREATE INDEX idx_pages_slug ON pages(slug);
CREATE INDEX idx_pages_parent_category ON pages(parent_category);
CREATE INDEX idx_pages_is_active ON pages(is_active);
CREATE INDEX idx_pages_is_nav_link ON pages(is_nav_link);

-- Combined index for nav links query (website + nav_link + active + order)
CREATE INDEX idx_pages_nav_links ON pages(website_id, is_nav_link, is_active, nav_display_order)
    WHERE is_nav_link = true AND is_active = true;

-- GIN index for full-text search on title and introduction
CREATE INDEX idx_pages_title_gin ON pages USING gin(to_tsvector('english', h1_title));
CREATE INDEX idx_pages_intro_gin ON pages USING gin(to_tsvector('english', introduction));

-- GIN indexes for JSONB querying
CREATE INDEX idx_pages_buying_guide_gin ON pages USING gin(buying_guide);
CREATE INDEX idx_pages_faq_gin ON pages USING gin(faq);
