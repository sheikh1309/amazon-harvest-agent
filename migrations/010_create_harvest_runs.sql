-- Harvest run ledger + a safe claim column for the keyword queue.
--
-- Replaces the S3 DEEP_ARCHIVE step in amazon-harvest-agent. That archive was
-- write-only by construction (a GetObject on DEEP_ARCHIVE fails until a 12-48h
-- restore completes, and every object bills a 180-day minimum), so the harvest's
-- own output was the one artifact nobody could actually look at. It lives here
-- instead, queryable, next to the pages it produced.

create table harvest_runs (
    id uuid primary key default uuid_generate_v4(),

    -- Nullable FKs throughout: a run is a historical record and must survive the
    -- deletion of anything it referenced. Losing a page must not erase the evidence
    -- of the run that built it.
    website_id uuid references websites(id) on delete set null,
    keyword_id uuid references keywords(id) on delete set null,
    page_id uuid references pages(id) on delete set null,

    -- Denormalised on purpose: keyword_id goes null if the keyword row is deleted,
    -- and a run with no record of what it searched for is worthless.
    keyword text not null,

    status varchar(20) not null check (status in ('succeeded', 'partial', 'failed')),
    error text,

    -- The harvest output that used to go to S3: the full ranked product payload and
    -- the markdown report written alongside it.
    --
    -- Roughly 60-120KB of JSON for a ten-product run. Postgres TOASTs and compresses
    -- any value over ~2KB, so the on-disk cost is closer to 10-20KB. At the current
    -- 660k-keyword queue that is still ~10GB if every keyword is harvested — see the
    -- retention note in the agent README before running the full backlog.
    output jsonb,
    report text,

    -- Run metrics. Cheap to store, and the only way to answer "is the scraper still
    -- working" without re-reading every payload.
    candidates_found integer not null default 0,
    products_scraped integer not null default 0,
    products_published integer not null default 0,
    llm_calls integer not null default 0,
    input_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    duration_ms bigint,

    created_at timestamp with time zone not null default now()
);

create index idx_harvest_runs_keyword_id on harvest_runs(keyword_id, created_at desc);
create index idx_harvest_runs_created_at on harvest_runs(created_at desc);
create index idx_harvest_runs_status on harvest_runs(status) where status <> 'succeeded';

-- Latest run for a page, which is the lookup the dashboard does.
create index idx_harvest_runs_page_id on harvest_runs(page_id) where page_id is not null;

/* ------------------------------------------------------------------ queue claim */

-- Worker claim marker for the keyword queue.
--
-- `processed_at` is only set once a page has committed, which is minutes after a
-- worker picks a keyword up. Until now the "next unprocessed keyword" query had no
-- locking and no claim, so every worker started at the same moment selected the
-- same row and harvested it in parallel. With 660k keywords queued and 0 processed
-- that is not a corner case, it is the first thing that happens when a second
-- worker starts.
--
-- Nullable and advisory: a crashed worker leaves a stale claim behind, and the
-- agent reclaims anything older than KEYWORD_CLAIM_TIMEOUT_MINUTES rather than
-- requiring a janitor process.
alter table keywords
    add column claimed_at timestamp with time zone;

-- Supports the claim query's `where processed_at is null order by created_at, id`.
-- Partial so it indexes only the queue, not the 660k rows that will eventually be
-- done; it shrinks as the backlog drains instead of growing.
create index idx_keywords_queue on keywords (created_at, id)
    where processed_at is null;
