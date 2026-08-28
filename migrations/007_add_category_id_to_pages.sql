-- Add category_id foreign key to pages table
ALTER TABLE pages
ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- Create index for category lookups
CREATE INDEX idx_pages_category_id ON pages(category_id);
