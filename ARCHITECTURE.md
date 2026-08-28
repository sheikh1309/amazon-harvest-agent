# Architecture

## 1. Overview

`amazon-harvest-agent` turns one search keyword into a published SEO buyer's-guide page: it claims a
keyword from a Postgres queue, drives an LLM agent that scrapes Amazon through Playwright for ranked
product detail, images and the full variant matrix, then has a second agent write the page copy and
commits page, products and ranking to Postgres in a single transaction. Each process handles exactly
one keyword and exits with a status code, so restarts are the scheduling mechanism and many workers
can run in parallel against the same queue. Every run is recorded in `harvest_runs` with its status,
metrics and — optionally — its full output payload.

## 2. Entrypoint

`src/index.ts:4` — `main()`, invoked at `src/index.ts:25` via `void main()`.

It does four things and holds no business logic: construct `Application`, register signal handlers,
call `Application.execute()` with the CLI keyword, and set `process.exitCode` in a `finally` block
that always reports token usage and closes the browser and database.

The CLI argument is read at `src/index.ts:8`: `process.argv.slice(2).join(" ").trim() || null`. With
no argument the keyword comes from the database queue.

## 3. Execution flow

### 3.1 Bootstrap

**`src/index.ts:5`** — `new Application()` runs the composition root at `src/app/application.ts:45`.
The constructor calls `Config.load()` (`src/lib/config.ts:80`), builds the `Logger`, `UsageTracker`,
`BrowserPool`, `Database`, the four repositories, `KeywordQueue` and `ShutdownSignal`. Nothing
connects to Postgres or launches Chromium here — both are lazy.

**`src/index.ts:6`** — `application.listenForShutdown(process)` delegates to
`ShutdownSignal.listenToProcess` (`src/app/shutdown-signal.ts:38`). It registers `SIGINT`/`SIGTERM`
handlers that record a shutdown reason, and a second signal calls `process.exit(130)`
(`src/app/shutdown-signal.ts:41`). An `unhandledRejection` handler (`src/app/shutdown-signal.ts:48`)
logs and requests shutdown rather than letting the process die with Chromium still running.

**`src/index.ts:13`** — `application.execute(requestedKeyword)`.

### 3.2 Configuration gate

**`src/app/application.ts:71`** — `this.config.validate()` (`src/lib/config.ts:92`) returns a list of
problems: missing `OPENROUTER_API_KEY`, empty `AGENT_MODEL`, `CONCURRENCY` outside 1–12,
`FINAL_COUNT` below 1, `CANDIDATE_COUNT` below `FINAL_COUNT`, or a claim timeout shorter than the run
timeout.

**Branch:** if non-empty, each problem is logged at error level and `execute` returns
`ExitCode.Misconfigured` (`2`) at `src/app/application.ts:74`. Nothing is claimed and no browser
launches.

### 3.3 Claiming a keyword

**`src/app/application.ts:77`** — `this.queue.claim(requestedKeyword)` → `KeywordQueue.claim`
(`src/app/keyword-queue.ts:12`). Three branches:

- **No database** (`src/app/keyword-queue.ts:13`) → `adHoc()` (`src/app/keyword-queue.ts:23`).
  Returns `{ id: null, keyword, category_id: "" }`, or **throws** if no CLI keyword was given.
- **CLI keyword given** (`src/app/keyword-queue.ts:14`) → `claimNamed()`
  (`src/app/keyword-queue.ts:30`) → `KeywordRepository.claimByName`
  (`src/db/keyword-repository.ts:34`), an `update … where lower(keyword) = lower($1) returning …`.
  If no row matches and `CATEGORY_ID` is unset it **throws**, because `products.category_id` is
  `NOT NULL` and there is nothing to infer it from.
- **No CLI keyword** (`src/app/keyword-queue.ts:15`) → `KeywordRepository.claimNext`
  (`src/db/keyword-repository.ts:16`). This is the queue read:

  ```sql
  update keywords set claimed_at = now()
  where id = (select id from keywords
              where processed_at is null
                and (claimed_at is null or claimed_at < now() - make_interval(mins => $1))
              order by created_at, id
              for update skip locked
              limit 1)
  returning id, keyword, category_id
  ```

  `for update skip locked` is what makes parallel workers safe: each takes a different row or none.
  Stale claims expire after `KEYWORD_CLAIM_TIMEOUT_MINUTES`, so a worker killed mid-run releases its
  keyword without a janitor process.

**Branch:** a `null` return means the queue is drained. `execute` logs `queue: no unclaimed keywords
left` and returns `ExitCode.QueueEmpty` (`3`) at `src/app/application.ts:80`.

### 3.4 Building the run

**`src/app/application.ts:85`** — `new RunContext(keyword, this.runId)`
(`src/app/run-context.ts:11`) derives the run slug via `slugify` (`src/lib/text.ts:1`).

**Error path:** a keyword with no alphanumeric characters produces an empty slug and the constructor
**throws** (`src/app/run-context.ts:14`), because that slug becomes both the workspace directory name
and the page's public URL.

**`src/app/application.ts:88`** — `buildRunner(context)` constructs the per-run object graph:
`Workspace` rooted at `<WORKSPACE>/<slug>` (`src/lib/workspace.ts:19`), `RunArtifacts`, `AmazonUrls`,
`AmazonScraper` over a `PageNavigator` over the shared `BrowserPool`, `ModelFactory`,
`PromptLibrary`, `ToolRegistry`, `HarvestAgent`, `PageWriterAgent` and `RunRecorder`.

The per-run `Workspace` is the isolation boundary: cleanup at the end of one run cannot reach another
worker's files.

### 3.5 The run

**`src/app/harvest-runner.ts:38`** — `HarvestRunner.run()`. Header is logged
(`src/app/harvest-runner.ts:64`), then a `try`/`catch` wraps two steps.

#### 3.5.1 Harvest — `src/app/harvest-runner.ts:83`

Calls `HarvestAgent.run()` (`src/agent/harvest-agent.ts:24`) with three arguments: the keyword, an
abort signal from `ShutdownSignal.deadline(config.runTimeoutMs)` (`src/app/shutdown-signal.ts:25`),
and a per-update callback that calls `ShutdownSignal.throwIfRequested()`
(`src/app/shutdown-signal.ts:21`).

`HarvestAgent.run` creates the workspace directory, builds a `createDeepAgent` with
`PromptLibrary.orchestrator()`, `ToolRegistry.harvestTools` and `SubagentCatalog.all()`, backed by a
`FilesystemBackend` rooted at the run workspace (`src/agent/harvest-agent.ts:30`). It streams with
`recursionLimit: 200` (`src/agent/harvest-agent.ts:40`), feeding each update to `StreamRenderer` and
returning the closing prose summary.

The five subagents (`src/agent/subagent-catalog.ts:24`–`115`) are `discovery`, `extractor`,
`variant-hunter`, `curator` and `qa`. They share one model instance built in
`SubagentCatalog.all()` (`src/agent/subagent-catalog.ts:13`) — construction is deferred to call time
so `Config.validate()` runs before any client is instantiated.

**Error paths inside the agent loop:**
- `UsageTracker.handleLLMStart` (`src/lib/usage-tracker.ts:34`) **throws**
  `TokenBudgetExceededError` before a call that would exceed `TOKEN_BUDGET`. This aborts the chain
  including from inside a subagent.
- The run deadline aborts the stream and records a shutdown reason
  (`src/app/shutdown-signal.ts:30`).
- `throwIfRequested` turns a received `SIGTERM` into `aborted: SIGTERM`.

After the stream drains, `assertPricingIsTrustworthy()` (`src/app/harvest-runner.ts:98`) **throws**
when `REQUIRE_US_PRICING=1` and `BrowserPool.deliveryLocation.isUnitedStates` is false.

#### 3.5.2 Publish the page — `src/app/harvest-runner.ts:109`

**Branch:** with no database, logs `page: skipped` and returns `0`.

Reads the output path from `RunRecorder.outputPath` (`src/app/run-recorder.ts:87`), which prefers the
path the `write_products` tool recorded in `RunArtifacts` and falls back to the newest matching file
by mtime (`src/lib/workspace.ts:74`). The fallback matters because the `qa` subagent may rewrite the
output after the `curator`.

**Branch:** no output file → logs a warning and returns `0`.

Otherwise it extracts the ranked ASINs from that file and calls `PageWriterAgent.write`
(`src/agent/page-writer-agent.ts:33`), passing navigation categories from
`WebsiteRepository.navigationCategories` (`src/db/website-repository.ts:29`), which falls back to
`[]` on error.

`PageWriterAgent.write` clears `page/`, then loops up to `MAX_ATTEMPTS = 2`
(`src/agent/page-writer-agent.ts:37`):

1. `generateCopy` (`src/agent/page-writer-agent.ts:53`) runs a second deep agent with
   `writerTools` and `recursionLimit: 40`.
2. Reads `page/copy.json`. **Branch:** absent → warn and retry; after both attempts **throw**
   `writer produced no page copy after 2 attempts` (`src/agent/page-writer-agent.ts:50`).
3. `commit` (`src/agent/page-writer-agent.ts:74`) assembles items in the curator's ranked order.
   For any ASIN the model never wrote copy for, `DerivedPageCopy.from`
   (`src/agent/derived-page-copy.ts:13`) synthesises it from the scrape, guaranteeing the 3–6
   `key_features` that `pageProductSchema` requires (`src/schema/page.ts:18`).
   **Branch:** no scraped product matches any ranked ASIN → **throws**.

`PageRepository.save` (`src/db/page-repository.ts:50`) runs one transaction via
`Database.transaction` (`src/db/database.ts:49`), with `rollback: dryRun`:

1. Upsert the category (`src/db/page-repository.ts:103`).
2. Upsert each product (`src/db/page-repository.ts:113`) through `ProductMapper.toColumns`
   (`src/db/product-mapper.ts:36`). **Error path:** a product with no title **throws** inside the
   mapper (`src/db/product-mapper.ts:38`) and is caught per-product, landing in `skipped` rather than
   failing the page.
3. **Branch:** zero saved products → **throws** `refusing to write an empty page`
   (`src/db/page-repository.ts:71`).
4. Upsert the page (`src/db/page-repository.ts:74`, implemented at `src/db/page-repository.ts:160`) — updated in place when the keyword already has
   one so the URL survives, otherwise inserted with `on conflict (website_id, slug) do update`.
5. Delete and re-insert `page_products` (`src/db/page-repository.ts:83`, implemented at `src/db/page-repository.ts:217`) rather than upserting,
   because the table has both `UNIQUE(page_id, rank)` and `UNIQUE(page_id, product_id)`.
6. Mark the keyword processed — only when not a dry run (`src/db/page-repository.ts:87`).

`commit` records the committed page in `RunArtifacts` **only when `rolledBack` is false**
(`src/agent/page-writer-agent.ts:109`), so a dry run is never mistaken for a saved page.

**Error path:** any throw from `PageWriterAgent` is caught at `src/app/harvest-runner.ts:130`, logged
as `page: FAILED`, and returns `0` — the run continues to recording rather than dying.

#### 3.5.3 Verify — `src/app/harvest-runner.ts:136`

Three branches, in order:
- no database → logs `db: skipped`, returns `true`;
- `RunArtifacts.pageWasCommitted` → returns `true`;
- otherwise, if the keyword has an id, `PageRepository.findSlugForKeyword`
  (`src/db/page-repository.ts:42`) checks the database directly (a prior run may have produced it).

Falling through all three logs `db: FAILED` and returns `false`. This is deliberately evidence from
the database rather than trust in the model having called a tool.

#### 3.5.4 Status, record, release — `src/app/harvest-runner.ts:51`

Status is `failed` if anything threw, else `succeeded` if verified, else `partial`.

`RunRecorder.record` (`src/app/run-recorder.ts:29`) has two early exits: no database
(`src/app/run-recorder.ts:31`) and `PAGE_DRY_RUN=1` (`src/app/run-recorder.ts:36`) — both leave the
workspace intact.

`payload()` (`src/app/run-recorder.ts:77`) returns `{ null, null }` unless `RECORD_RUN_PAYLOAD=1`.
`HarvestRunRepository.save` (`src/db/harvest-run-repository.ts:27`) then inserts one row.

**Error path:** an insert failure is logged and `record` returns early
(`src/app/run-recorder.ts:66`) **without** cleaning the workspace, so an unrecorded run keeps the only
copy of its payload on disk.

`cleanUp` (`src/app/run-recorder.ts:98`) skips when `KEEP_WORKSPACE=1` and skips when status is not
`succeeded`, so a failed run's scrape survives for the retry.

**`src/app/harvest-runner.ts:56`** — if the page was not saved, `KeywordQueue.release`
(`src/app/keyword-queue.ts:18`) clears `claimed_at`, returning the keyword to the queue immediately
instead of waiting out the timeout.

Returns `ExitCode.Ok` when status is `succeeded`, otherwise `ExitCode.Failed`
(`src/app/harvest-runner.ts:62`).

### 3.6 Termination

**`src/index.ts:16`** — the `finally` block always runs `reportUsage()`
(`src/app/application.ts:155`) and `shutdownResources()` (`src/app/application.ts:186`), which closes
the browser and the connection pool with `Promise.allSettled`. `process.exitCode` is assigned last
(`src/index.ts:22`).

| Exit code | Constant | Meaning |
|---|---|---|
| `0` | `ExitCode.Ok` | page saved and verified |
| `1` | `ExitCode.Failed` | run failed or page unverified; keyword released |
| `2` | `ExitCode.Misconfigured` | config invalid; nothing attempted |
| `3` | `ExitCode.QueueEmpty` | queue drained; stop looping |
| `130` | `ExitCode.Interrupted` | second `SIGINT`/`SIGTERM` |

Defined at `src/app/exit-code.ts:1`.

## 4. Modules

**`src/app/`** — the run lifecycle. `Application` (`src/app/application.ts:30`) is the composition
root: it owns everything process-scoped (config, logger, browser pool, database, repositories) and
builds the per-run graph in `buildRunner`. `HarvestRunner` (`src/app/harvest-runner.ts:20`) is the
sequence: harvest, publish, verify, record, release. `KeywordQueue`, `RunRecorder`, `RunContext`,
`RunArtifacts`, `ShutdownSignal` and `ExitCode` are the supporting pieces. This directory is where
the steps the model is *not* allowed to decide live.

**`src/agent/`** — LLM orchestration. `HarvestAgent` (`src/agent/harvest-agent.ts:13`) drives the
scraping agent; `PageWriterAgent` (`src/agent/page-writer-agent.ts:21`) drives the copy agent and
commits its output. `SubagentCatalog` (`src/agent/subagent-catalog.ts:7`) defines the five subagents,
`PromptLibrary` (`src/agent/prompt-library.ts:15`) holds every prompt string, and `DerivedPageCopy`
(`src/agent/derived-page-copy.ts:12`) is the non-LLM fallback for products the writer missed.

**`src/browser/`** — Playwright. `BrowserPool` (`src/browser/browser-pool.ts:13`) is one Chromium
process with N contexts behind a semaphore; `concurrency` is therefore a hard ceiling on simultaneous
requests to Amazon regardless of how many subagents are calling tools. `PageNavigator`
(`src/browser/page-navigator.ts:14`) adds retry with jittered backoff and block detection.
`AmazonScraper` (`src/browser/amazon-scraper.ts:26`) turns raw page data into `Product` records.

**`src/browser/page-fns/`** — plain functions, deliberately *not* classes. Playwright serializes
their source to run inside the page, so they cannot import or close over anything. They are the most
breakage-prone code in the repo: a dead selector fails silently as a `null` field rather than an
error. Every price selector is scoped to `#centerCol` or the buybox, because an unscoped
`.a-price .a-offscreen` matches the sponsored carousel and returns *another product's* price on a
page that has none. `variants.ts` walks for a balanced `{}`/`[]` literal rather than using a regex,
because `"key"\s*:\s*(\{[^}]*\})` truncates at the first nested brace.

**`src/db/`** — one class per concern. `Database` (`src/db/database.ts:5`) owns the pool and the
transaction helper; `KeywordRepository`, `WebsiteRepository`, `PageRepository` and
`HarvestRunRepository` own their tables. `ProductMapper` (`src/db/product-mapper.ts:35`) is the
boundary between the scrape and the column constraints. `Migrator` (`src/db/migrator.ts:23`) applies
SQL files while writing the same `_sqlx_migrations` ledger `sqlx-cli` writes.

**`src/tools/`** — LangChain tools as factory functions taking `ToolDependencies`
(`src/tools/tool-dependencies.ts:7`), assembled by `ToolRegistry` (`src/tools/tool-registry.ts:11`).
Factories rather than module constants so each run gets tools bound to its own workspace and
artifacts, with no module-level mutable state.

**`src/lib/`** — reusable, dependency-light pieces: `Config`, `Logger`, `Workspace`, `AmazonUrls`,
`ProductRanker`, `UsageTracker`, `ModelFactory`, `StreamRenderer` and the pure helpers in `text.ts`.

**`src/schema/`** — Zod schemas. Their field names are `snake_case` because they describe the
**persisted** shape, not the code's naming convention. `products.specifications` and the `pages`
JSONB columns are read by the Next.js site, so renaming these fields would silently break it. Every
other identifier in the codebase is `camelCase`; `src/db/product-mapper.ts` is the translation point.

**`src/dev/`** — operator scripts: `migrate`, `check-selectors` (live DOM), `check-db` (dry-run SQL),
`check-writer` (writer only), `db-size` (storage headroom).

## 5. Data flow

```
keywords table ──claim──▶ RunContext ──▶ workspace/<slug>/
                                              │
   search_amazon ──▶ candidates/<slug>.json   │  (rating/reviews/price from the search card)
   fetch_products ──▶ products/<asin>.json    │  (one file per product, full detail)
   fetch_variant_details ──▶ merged into parent products/<asin>.json
   rank_products ──▶ reads products/, returns a table (no file)
   write_products ──▶ output/products_<slug>_<ts>.json + .md
                                              │
   product_briefs ──▶ compact text from products/
   write_page_copy ──▶ page/copy.json
   write_product_copy ──▶ page/products.json  (accumulates across calls)
                                              │
                          PageWriterAgent.commit
                                              ▼
              pages · products · page_products · keywords.processed_at
                                              │
                            RunRecorder ──▶ harvest_runs
                                              │
                                      workspace destroyed
```

**In:** a keyword row (or CLI string); Amazon HTML via Playwright; LLM completions via OpenRouter.

**Out:** rows in `pages`, `products`, `page_products`, `harvest_runs`; `keywords.processed_at` and
`keywords.claimed_at`; log lines on stdout/stderr; a process exit code.

The central discipline is that payloads never travel through the conversation. Tools write files and
return one line per item; subagents pass ASINs and paths, not JSON. `product_briefs` exists solely
because a product record is several KB and ten of them would crowd out the copy the writer is meant
to produce.

The output file rather than the conversation is treated as the record of the shortlist, because it is
what the `curator` ranked and the `qa` subagent corrected.

## 6. External dependencies

**PostgreSQL** — the only datastore. Tables used: `keywords` (queue), `websites`, `categories`,
`pages`, `page_products`, `products`, `harvest_runs`, `_sqlx_migrations`. The schema is owned by
`migrations/` and applied by `pnpm run migrate` here or by `sqlx-cli` against the same database;
both write the same ledger, keyed by version with a SHA-384 checksum of the file bytes
(`src/db/migrator.ts:45`). That shared ledger is why there is a migrator here instead of a
migration package — every one of those keeps its own table and would not see these as applied.
TLS is derived from the connection URL — `sslmode` when set, otherwise off for localhost and
verified everywhere else (`src/db/database.ts:69`); pool max is 2.

**OpenRouter** — every LLM call, via `@langchain/openrouter` (`src/lib/model-factory.ts:12`).
`maxRetries: 3`. Fallback models are opt-in and empty by default.

**Amazon** — scraped with Playwright Chromium. No API. Image, media, font and stylesheet requests are
aborted (`src/browser/browser-pool.ts:6`); only image URLs are stored, never bytes.

**Environment variables** — all read in `src/lib/config.ts:40`–`74`.

| Variable | Default | Used at |
|---|---|---|
| `OPENROUTER_API_KEY` | — (required) | `src/lib/config.ts:74` |
| `DATABASE_URL` | — | `src/lib/config.ts:64` |
| `AGENT_MODEL` | `anthropic/claude-sonnet-4.5` | `src/lib/config.ts:41` |
| `AGENT_FALLBACK_MODELS` | *(empty)* | `src/lib/config.ts:42` |
| `MODEL_TEMPERATURE` / `MAX_OUTPUT_TOKENS` | `0.2` / `16000` | `src/lib/config.ts:43` |
| `TOKEN_BUDGET` / `RUN_TIMEOUT_MINUTES` | `2000000` / `30` | `src/lib/config.ts:45` |
| `CONCURRENCY` / `HEADFUL` | `6` / unset | `src/lib/config.ts:48` |
| `AMAZON_ZIP` / `PROXY_SERVER` | `10001` / — | `src/lib/config.ts:50` |
| `REQUIRE_US_PRICING` | `0` | `src/lib/config.ts:52` |
| `MAX_PAGES` / `CANDIDATE_COUNT` / `FINAL_COUNT` | `3` / `30` / `10` | `src/lib/config.ts:54` |
| `MIN_RATING` / `MIN_REVIEWS` | `4.0` / `100` | `src/lib/config.ts:57` |
| `WORKSPACE` / `OUTPUT_DIR` / `KEEP_WORKSPACE` | `workspace` / `output` / unset | `src/lib/config.ts:60` |
| `MIGRATIONS_DIR` | `migrations` | `src/lib/config.ts:65` |
| `KEYWORD_CLAIM_TIMEOUT_MINUTES` | `60` | `src/lib/config.ts:66` |
| `RECORD_RUN_PAYLOAD` | `0` | `src/lib/config.ts:67` |
| `PAGE_DRY_RUN` | `0` | `src/lib/config.ts:68` |
| `SITE_DOMAIN` / `CATEGORY_ID` | `best10deals.com` / — | `src/lib/config.ts:69` |
| `LOG_FORMAT` / `LOG_LEVEL` | `text` / `info` | `src/lib/config.ts:72` |
| `DB_SIZE_LIMIT_BYTES` | `536870912` | `src/dev/db-size.ts:21` |

**No queue, cache or message broker.** The `keywords` table is the queue; `for update skip locked` is
the whole mechanism.

## 7. Operational constraints

Two facts about the deployed environment are not visible in the code and change how it behaves.

**Storage.** The Postgres instance is a 512 MB Neon tier holding roughly 501 MB. Writes fail with
`could not extend file because project size limit has been exceeded`, which reads like an application
bug and is not one. This is why `RECORD_RUN_PAYLOAD` defaults to `0`. `pnpm run db:size` reports
headroom and reclaimable indexes.

**Pricing locale.** Amazon resolves the delivery *country* from the request IP; the glow endpoint at
`src/browser/browser-pool.ts:144` only moves the ZIP within that country. From a non-US host, prices
land in `products.price` looking exactly like USD figures. `REQUIRE_US_PRICING=1` turns that into a
failed run instead.
