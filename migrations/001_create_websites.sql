CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE websites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    default_tracking_id VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_websites_domain ON websites(domain);
CREATE INDEX idx_websites_is_active ON websites(is_active);
