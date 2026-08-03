# amazon-harvest-agent

A [deep agent](https://docs.langchain.com/oss/javascript/deepagents/overview) that turns a keyword
into a ranked shortlist of Amazon products — with every gallery image and the full variant matrix
(each dimension, and for every value its **text label**, **swatch image** and price) — written to
disk as JSON plus a markdown report.

```bash
pnpm install
pnpm exec playwright install chromium

pnpm start "coffee grinder"      # run a harvest
pnpm check                       # verify the scrapers still match Amazon's DOM
```

## How it works

The LLM orchestrates; it never parses HTML. Scraping is deterministic code inside tools, so results
are reproducible and cheap. The agent plans, shards the work, judges quality, and handles failures.

```
                    ┌──────────────── main agent (claude-opus-5) ─────────────┐
                    │  write_todos · ls/glob/grep/read_file/write_file · task  │
                    └───┬──────────────┬─────────────────┬───────────┬────────┘
        task()          │   task()×N   │      task()×N   │   task()  │  task()
   ┌────────────┐  ┌────┴─────────┐  ┌─┴──────────────┐  ┌┴────────┐ ┌┴──────┐
   │ discovery  │  │ extractor    │  │ variant-hunter │  │ curator │ │  qa   │
   │ search +   │  │ detail pages │  │ child variant  │  │ rank +  │ │ verify│
   │ pre-filter │  │ (batched)    │  │ prices/images  │  │ dedup   │ │ + fix │
   └─────┬──────┘  └──────┬───────┘  └───────┬────────┘  └────┬────┘ └───┬───┘
  /candidates/*.json  /products/*.json   (merged into parent)   /output/*.json + .md
```

Subagents exist for **context economy** as much as division of labour: one product record is a few
KB of JSON, so thirty of them will not fit alongside a working conversation. Each subagent writes
its payload to the workspace and reports back one line per item.

The filesystem backend is a **real directory**, not the in-memory state backend. Parallel subagents
each return a state update from the `task` tool; on disk those updates cannot collide, and a crash
mid-run leaves the scraped products behind so a rerun resumes instead of starting over.

## Speed

Roughly **25–60s** for 30 candidates, versus 3–5 minutes for the equivalent sequential scrape:

| | |
|---|---|
| **Browser pool** | one chromium, N contexts behind a semaphore, pages reused |
| **Batched tool calls** | `fetch_products([...])` fans out inside a single call |
| **Search-page pre-filter** | rating/reviews/price come off the results card, so unqualified products never get a detail visit |
| **Subresource blocking** | images, fonts, stylesheets and media are aborted — only image *URLs* are needed, never the bytes |
| **Parallel `task` dispatch** | the orchestrator emits several extractor tasks in one message, so they run concurrently |
| **Cheap model for mechanical work** | extractor/qa subagents run on `claude-haiku-4-5` |

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
`}`.

Per-variant prices come from the parent's swatches when Amazon renders them, and otherwise from the
`variant-hunter` subagent visiting each child page.

## Configuration

Copy `.env.example` to `.env`. Everything has a working default except `ANTHROPIC_API_KEY`.

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `AGENT_MODEL` | `claude-opus-5` | orchestrator + curator |
| `AGENT_FAST_MODEL` | `claude-haiku-4-5` | extractor / qa / discovery |
| `CONCURRENCY` | `6` | parallel browser contexts |
| `PROXY_SERVER` | — | see the pricing caveat below |
| `AMAZON_ZIP` | `10001` | delivery zip |
| `AFFILIATE_TAG` | `best10deals-20` | associates tag |
| `MAX_PAGES` / `CANDIDATE_COUNT` / `FINAL_COUNT` | `3` / `30` / `10` | run size |
| `MIN_RATING` / `MIN_REVIEWS` | `4.0` / `100` | quality bar |
| `HEADFUL=1` | — | watch the browser work |

`MODEL_NAME` is deliberately **not** used — that key already exists in `.env` pointing at a
non-Anthropic model.

## ⚠️ Prices depend on where you run this

Amazon resolves the delivery **country** from the request IP, and the glow endpoint only changes the
zip *within* that country. Run from outside the US and you get localised prices, and many items
report `"This item cannot be shipped to your selected delivery location"` — which means the page
carries **no price at all**.

The scraper reports this honestly rather than papering over it: it prints the detected delivery
country at startup, leaves `price` as `null`, and records the reason in `availability`. It will not
substitute a nearby number — an unscoped `.a-price` selector picks up the sponsored carousel and
returns *a different product's* price.

For trustworthy US pricing, set `PROXY_SERVER` to a US proxy.

## Layout

```
src/
  index.ts                     CLI entry — streams the run
  agent/
    agent.ts                   createDeepAgent wiring
    prompts.ts                 orchestrator system prompt
    subagents.ts               the five subagents
  browser/
    pool.ts                    browser pool, retry, location pinning
    scrape.ts                  search + product scraping
    page-fns/                  functions that run *inside* the page
      search.ts  product.ts  variants.ts
  tools/                       search_amazon, fetch_products,
                               fetch_variant_details, rank_products, write_products
  schema/product.ts            zod schemas — the contract for everything written
  lib/                         config, amazon helpers, workspace paths
  dev/check-selectors.ts       `pnpm check`
workspace/                     agent filesystem: /candidates /products /output
```

## When Amazon changes its DOM

It will, and a dead selector fails *silently* as a `null` field. Run `pnpm check` — it exercises the
search card, the detail page and a known multi-dimension product, and prints a pass/fail line per
field group.
