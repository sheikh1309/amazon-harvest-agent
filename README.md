# amazon-harvest-agent

A [deep agent](https://docs.langchain.com/oss/javascript/deepagents/overview) that turns a keyword
into a published SEO page: a ranked, deduplicated shortlist of real Amazon products — with every
gallery image and the full variant matrix (each dimension, and for every value its **text label**,
**swatch image** and price) — written to Postgres as a page, its products, and a run record.

```bash
pnpm install
pnpm exec playwright install chromium
cp .env.example .env          # set OPENROUTER_API_KEY and DATABASE_URL
pnpm run migrate              # apply pending schema changes

pnpm start                    # claim the next keyword from the queue and harvest it
pnpm start "coffee grinder"   # or harvest one keyword on demand

pnpm run verify               # typecheck + tests
pnpm check                    # verify the scrapers still match Amazon's live DOM
pnpm run db:size              # storage headroom + reclaimable indexes
```

## How it works

The LLM orchestrates; it never parses HTML. Scraping is deterministic code inside tools, so results
are reproducible and cheap. The agent plans, shards the work, judges quality, and handles failures.

```
                    ┌──────────────── main agent ─────────────────────────────┐
                    │  write_todos · ls/glob/grep/read_file/write_file · task  │
                    └───┬──────────────┬─────────────────┬───────────┬────────┘
        task()          │   task()×N   │      task()×N   │   task()  │  task()
   ┌────────────┐  ┌────┴─────────┐  ┌─┴──────────────┐  ┌┴────────┐ ┌┴──────┐
   │ discovery  │  │ extractor    │  │ variant-hunter │  │ curator │ │  qa   │
   │ search +   │  │ detail pages │  │ child variant  │  │ rank +  │ │ verify│
   │ pre-filter │  │ (batched)    │  │ prices/images  │  │ dedup   │ │ + fix │
   └─────┬──────┘  └──────┬───────┘  └───────┬────────┘  └────┬────┘ └───┬───┘
  /candidates/*.json  /products/*.json   (merged into parent)   /output/*.json + .md
                                                                     │
                                              ┌──────────────────────┴───────────────┐
                                              │ writer  (CLI-driven, not delegated)  │
                                              │ product_briefs → write_page_copy →   │
                                              │ write_product_copy → save_page()     │
                                              └──────────────────┬───────────────────┘
                                                     postgres: pages · products ·
                                                     page_products · harvest_runs
```

Subagents exist for **context economy** as much as division of labour: one product record is a few
KB of JSON, so thirty of them will not fit alongside a working conversation. Each subagent writes
its payload to the workspace and reports back one line per item.

The filesystem backend is a **real directory**, not the in-memory state backend. Parallel subagents
each return a state update from the `task` tool; on disk those updates cannot collide, and a crash
mid-run leaves the scraped products behind so a rerun resumes instead of starting over.

### What the model is not allowed to decide

Three steps run from the CLI after the agent's stream drains, and deliberately not as tools:

- **the page write** — a run that scrapes for seven minutes and then declines to call a save tool is
  a failure mode this shape rules out entirely;
- **the run record** — so it happens exactly once, on the qa-corrected output, never on a draft;
- **the workspace cleanup** — so nothing is deleted before its payload is safely in Postgres.

The page **slug** is derived from the keyword, never taken from the model: it is the page's public
URL and its unique key, so it has to be reproducible across re-runs.

## Running the backlog

The `keywords` table is the queue — currently ~660k rows. One process handles one keyword and exits,
so restarts are the scheduling mechanism:

```bash
while pnpm start; do :; done        # or a Kubernetes Job with restartPolicy: OnFailure
```

| Exit code | Meaning |
|---|---|
| `0` | page saved |
| `1` | run failed — the keyword was released back to the queue |
| `2` | misconfigured — nothing was attempted |
| `3` | queue empty — stop looping |

**Workers are safe to run in parallel.** Each one claims its keyword with
`update … where id = (select … for update skip locked limit 1)`, so two workers starting at the same
instant take different rows. A worker killed mid-harvest cannot release its own claim, so claims
expire after `KEYWORD_CLAIM_TIMEOUT_MINUTES` rather than needing a janitor process. Each run also
works inside its own `workspace/<keyword-slug>/` directory, so cleanup at the end of one harvest can
never delete a scrape another worker is halfway through.

`SIGTERM` and `SIGINT` are handled: the run finishes its current step, records itself as failed,
releases its keyword and closes chromium. That is what makes this safe on spot capacity.

## Where the output goes

| | |
|---|---|
| `pages` | the SEO copy — title, meta, intro, buying guide, FAQ, conclusion |
| `products` | one upserted row per ASIN; images and the full variant matrix live in `specifications` |
| `page_products` | the ranked join, with the page-specific `enhanced_title` and `key_features` |
| `harvest_runs` | one row per run: status, error, metrics, and — opt-in — the full output payload and markdown report |

`harvest_runs` replaced an S3 `DEEP_ARCHIVE` upload. That archive was write-only by construction — a
`GetObject` fails until a 12–48h restore completes, and every object bills a 180-day minimum — so the
harvest's own output was the one artifact nobody could look at. It is a `jsonb` column now, and
actually queryable:

```sql
select keyword, status, products_published, input_tokens + output_tokens as tokens, duration_ms
from harvest_runs order by created_at desc limit 20;

select date_trunc('hour', created_at) h, count(*), count(*) filter (where status <> 'succeeded') failed
from harvest_runs group by 1 order by 1 desc;
```

### ⚠️ Storage: the payload is opt-in, and the instance is full

`RECORD_RUN_PAYLOAD` defaults to **0**. This is not a preference — run `pnpm run db:size`:

```
used: 501.4 MB of 512.0 MB  (98%)
keywords     366.2 MB total   (141.3 MB heap, 224.9 MB indexes)
```

At 98% of a 512MB Neon tier, writes fail with `could not extend file because project size limit has
been exceeded` — which looks like an agent bug and is not one. A ten-product payload is 60–120KB of
JSON (10–20KB TOASTed), so storing payloads at any volume is not available on this instance today.
Metrics are always recorded; they are a few hundred bytes.

`pnpm run db:size` also lists reclaimable indexes. It currently finds **117 MB**, of which 77 MB are
non-unique indexes that exactly duplicate a unique index on the same columns — Postgres can already
serve every query from the unique one:

```sql
drop index concurrently idx_keywords_keyword;              -- 74.6 MB, duplicate of keywords_keyword_key
drop index concurrently idx_page_products_page_rank;       --  1.9 MB, duplicate of page_products_page_id_rank_key
drop index concurrently idx_products_asin;                 --  0.8 MB, duplicate of products_asin_key
drop index concurrently idx_websites_domain;               --  0.0 MB, duplicate of websites_domain_key
```

The other 40 MB are GIN indexes that have never been scanned (`idx_page_products_features_gin` alone
is 28.9 MB) — review those before dropping, since "never scanned" can mean "the search feature has
not shipped yet".

**None of this makes the full backlog fit.** 4,883 pages currently occupy 41 MB, so 660k pages is on
the order of 5 GB before products or run records. Processing the whole queue needs a larger plan;
reclaiming indexes only buys enough room to start.

## Schema

The schema lives in [`migrations/`](migrations). `pnpm run migrate` applies anything pending,
writing the same `_sqlx_migrations` ledger `sqlx-cli` does — version and description from the filename, SHA-384 of the file
bytes as the checksum. Either tool can be the one that goes first; neither is confused by the other
having done so. It also reports **drift**: a migration already applied whose file has since changed.

## Speed

Roughly **25–60s** for 30 candidates, versus 3–5 minutes for the equivalent sequential scrape:

| | |
|---|---|
| **Browser pool** | one chromium, N contexts behind a semaphore, pages reused |
| **Batched tool calls** | `fetch_products([...])` fans out inside a single call |
| **Search-page pre-filter** | rating/reviews/price come off the results card, so unqualified products never get a detail visit |
| **Subresource blocking** | images, fonts, stylesheets and media are aborted — only image *URLs* are needed, never the bytes |
| **Parallel `task` dispatch** | the orchestrator emits several extractor tasks in one message, so they run concurrently |

`CONCURRENCY` is the dial. Above ~6 from a single IP Amazon starts serving throttled pages; going
higher needs proxies.

## Variant extraction

Amazon splits variant data across two sources and **neither is complete**, so `page-fns/variants.ts`
parses both and joins them by label:

| Source | Has | Missing |
|---|---|---|
| Inline `P.register` JSON (`dimensionValuesDisplayData`, `variationValues`, `dimensionToAsinMap`) | the full dimension matrix, every child ASIN | images, rendered text, prices |
| The rendered twister (`#twister-plus-inline-twister`) | swatch images, swatch text, per-swatch price | axes Amazon chose not to render |

A DOM-only scrape loses whole axes: the Echo Dot has both `color_name` and `configuration`, but only
one swatch row is rendered. A JSON-only scrape loses every image. Note the JSON must be extracted
with a brace-balancing scan — a regex like `"key"\s*:\s*(\{[^}]*\})` truncates at the first nested
`}`. There is a test for exactly that case.

Per-variant prices come from the parent's swatches when Amazon renders them, and otherwise from the
`variant-hunter` subagent visiting each child page.

## Configuration

Copy `.env.example` to `.env`. Everything has a working default except `OPENROUTER_API_KEY` and
`DATABASE_URL`. Bad configuration fails at startup with exit code 2, before the browser launches.

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **required** |
| `DATABASE_URL` | — | unset scrapes without saving anything |
| `AGENT_MODEL` | `anthropic/claude-sonnet-4.5` | an openrouter slug, not a bare model name |
| `AGENT_FALLBACK_MODELS` | *(empty)* | see the warning below |
| `TOKEN_BUDGET` / `RUN_TIMEOUT_MINUTES` | `2000000` / `30` | hard ceilings; `0` disables |
| `KEYWORD_CLAIM_TIMEOUT_MINUTES` | `60` | must exceed `RUN_TIMEOUT_MINUTES` |
| `CONCURRENCY` | `6` | parallel browser contexts |
| `PROXY_SERVER` | — | see the pricing caveat below |
| `REQUIRE_US_PRICING` | `0` | abort rather than publish localised prices |
| `AMAZON_ZIP` | `10001` | delivery zip |
| `AFFILIATE_TAG` | `best10deals-20` | associates tag |
| `MAX_PAGES` / `CANDIDATE_COUNT` / `FINAL_COUNT` | `3` / `30` / `10` | run size |
| `MIN_RATING` / `MIN_REVIEWS` | `4.0` / `100` | quality bar |
| `LOG_FORMAT` / `LOG_LEVEL` | `text` / `info` | `json` emits one object per line |
| `RECORD_RUN_PAYLOAD` | `0` | store the full payload in `harvest_runs.output` — see the storage warning |
| `PAGE_DRY_RUN=1` | — | run every page statement, then roll back |
| `KEEP_WORKSPACE=1` | — | do not clear the run directory afterwards |
| `HEADFUL=1` | — | watch the browser work |

`MODEL_NAME` is deliberately **not** used — that key already exists in `.env` pointing at a
different model, and silently inheriting it produces a 404 at run time.

### ⚠️ Fallback models write your published copy

`AGENT_FALLBACK_MODELS` is empty by default and that is the safe setting. Whatever answers a call
here writes the page copy that gets committed to `pages` and served publicly, so falling back to a
much weaker model converts an outage you would notice into bad content you would not.

### ⚠️ Prices depend on where you run this

Amazon resolves the delivery **country** from the request IP, and the glow endpoint only changes the
zip *within* that country. Run from outside the US and you get localised prices, and many items
report `"This item cannot be shipped to your selected delivery location"` — which means the page
carries **no price at all**.

The scraper reports this honestly rather than papering over it: it prints the detected delivery
country at startup, leaves `price` as `null`, and records the reason in `availability`. It will not
substitute a nearby number — an unscoped `.a-price` selector picks up the sponsored carousel and
returns *a different product's* price.

For trustworthy US pricing, set `PROXY_SERVER` to a US proxy. Set `REQUIRE_US_PRICING=1` to make the
run abort instead of publishing localised figures into `products.price`.

## Layout

```
src/
  index.ts                     bootstrap only — builds Application, sets the exit code
  app/                         run lifecycle: Application (composition root), HarvestRunner,
                               KeywordQueue, RunRecorder, RunContext, RunArtifacts,
                               ShutdownSignal, ExitCode
  agent/                       HarvestAgent, PageWriterAgent, SubagentCatalog,
                               PromptLibrary, DerivedPageCopy
  browser/                     BrowserPool, PageNavigator, AmazonScraper
    page-fns/                  plain functions that run *inside* the page
  db/                          Database, KeywordRepository, WebsiteRepository,
                               PageRepository, HarvestRunRepository, ProductMapper, Migrator
  tools/                       one factory per LangChain tool, assembled by ToolRegistry
  lib/                         Config, Logger, Workspace, AmazonUrls, ProductRanker,
                               UsageTracker, ModelFactory, StreamRenderer, text helpers
  schema/                      Zod schemas — the persisted contract
  dev/                         migrate, check-selectors, check-db, check-writer, db-size
tests/                         vitest — pure logic + page functions under jsdom
workspace/<keyword-slug>/      per-run agent filesystem: /candidates /products /output /page
```

`ARCHITECTURE.md` traces the full execution path with file:line references.

## Testing

```bash
pnpm run verify   # typecheck + 54 tests, no network, no database, no API key
pnpm check        # selectors against live Amazon — deliberately NOT in CI
```

The suite covers the ranking arithmetic, the dedup key, the database normalisers, the workspace
escape guard, the writer's derived-copy fallback, and the page functions themselves against a
fabricated DOM under jsdom — including the brace-balancing twister parser and the guarantee that a
price is never read from a sponsored carousel.

`pnpm check` is excluded from CI on purpose: Amazon changing its DOM is a real problem, but it is not
a reason to fail someone's pull request.

## When Amazon changes its DOM

It will, and a dead selector fails *silently* as a `null` field. Run `pnpm check` — it exercises the
search card, the detail page and a known multi-dimension product, and prints a pass/fail line per
field group.
