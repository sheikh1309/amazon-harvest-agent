CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword TEXT NOT NULL UNIQUE,
    search_volume VARCHAR(255),
    competition VARCHAR(255),
    source VARCHAR(255),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_keywords_keyword ON keywords(keyword);
CREATE INDEX idx_keywords_category_id ON keywords(category_id);
