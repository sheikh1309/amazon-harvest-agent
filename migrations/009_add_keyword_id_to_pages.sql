-- Link each page to the keyword it was generated from.
--
-- Nullable on purpose: the 4,883 existing pages came from an earlier keyword batch
-- that is not in this table (0/4883 match by slug), so they cannot be backfilled.
-- ON DELETE SET NULL mirrors pages.category_id — dropping a keyword must not delete
-- a live page.
alter table pages
    add column keyword_id uuid references keywords(id) on delete set null;

create index idx_pages_keyword_id on pages(keyword_id);

-- One page per keyword per website. Partial so the existing NULL rows are excluded
-- entirely rather than relying on NULL-distinctness, and the index stays small.
create unique index idx_pages_website_keyword
    on pages(website_id, keyword_id)
    where keyword_id is not null;