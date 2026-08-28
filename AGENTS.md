# amazon-harvest-agent

A deep agent that harvests ranked Amazon products with images and full variant data, and publishes
them to Postgres as SEO pages. Read `ARCHITECTURE.md` first — it traces the whole execution path with
file:line references.

## Conventions

- **No comments.** Names carry the meaning. If a line needs explaining, extract it into a method
  whose name is the explanation, or document the constraint here and in `ARCHITECTURE.md`.
- Idiomatic TypeScript: `PascalCase` classes, `camelCase` members, `kebab-case` files.
- **Except in `src/schema/`**, whose Zod field names are `snake_case` because they describe the
  *persisted* shape. `products.specifications` and the `pages` JSONB columns are read by the Next.js
  site; renaming those fields breaks it silently. `src/db/product-mapper.ts` is the translation point.
- Constructor injection everywhere. No module-level mutable state — that is why tools are factory
  functions rather than exported constants.
- `Logger`, never `console`, outside `src/dev/`. `LOG_FORMAT=json` has to stay honest.
- `pnpm run verify` (typecheck + tests) before pushing. `strict` is on; keep it passing.

## Architecture rules

**The LLM orchestrates; it does not parse HTML.** All scraping is deterministic code inside tools. If
you find yourself asking the model to read page content and extract fields, that belongs in a page
function instead.

**The model does not decide whether durable work happens.** The page write, the run record and the
workspace cleanup all run from `HarvestRunner` after the stream drains, because a weaker model will
otherwise finish `qa`, report success, and never call the save tool. If you are adding a step whose
absence would silently lose the run, it goes in `src/app/`, not in a tool.

## Traps

These are the things that have already gone wrong. Each has a test.

**Never use an unscoped `.a-price` selector.** Amazon pages carry sponsored carousels and "compare
with similar items" tables, so an unscoped price selector silently returns *another product's* price
on a page that has none of its own. Scope to `#centerCol` or the buybox.

**Page functions in `src/browser/page-fns/` must stay self-contained.** Playwright serializes their
source to run inside the browser — no imports, no closure over module scope, no classes.

**A dead selector fails silently as `null`, not as an error.** Run `pnpm check` after touching
anything in `page-fns/`. It exercises the real DOM; the jsdom tests cannot replace it.

**Variant data needs both sources.** The inline twister JSON has the full dimension matrix and every
child ASIN but no images, text or prices; the rendered DOM has those but omits axes Amazon chose not
to render. Parse both and join by label. The JSON must be extracted by walking for a balanced
literal — `"key"\s*:\s*(\{[^}]*\})` truncates at the first nested brace.

**`ProductMapper.brand` strips `\s+store$`, not `\s*store$`.** The looser pattern turns a brand
genuinely called "Bookstore" into "Book". A byline of "Visit the Store" carries no brand at all and
must map to `null`, never to the bare word "Store".

**The keyword claim must stay atomic.** `KeywordRepository.claimNext` uses `for update skip locked`
inside an `UPDATE`. Without it every worker that starts in the same window takes the same row —
`processed_at` is only set minutes later, at commit.

**A run only ever touches `workspace/<its own keyword-slug>/`.** Cleanup at the end of one harvest
must not be able to reach a scrape another worker is halfway through.

**Models pass a directory where a file path is expected.** `/output` is the exact path the prompt
names. `resolveOutputPath` absorbs that; do the same in any new tool taking a path.

**jsdom has no `innerText`.** `tests/setup-jsdom.ts` supplies a script-stripping approximation,
because `#availability` carries an inline `<script>` that `textContent` would return as text.

## Adding things

**A tool** — a `create<Name>Tool(deps: ToolDependencies)` factory in `src/tools/`, registered in
`ToolRegistry`. Return one line per item and write payloads to the workspace; never return full
product JSON, it blows the context window at ~30 products. Paths in tool arguments are
workspace-relative (`/products/x.json`), never host paths.

**A migration** — numbered SQL in `migrations/`, applied with `pnpm run migrate`.
Never edit one that has already run; `Migrator` reports that as drift and exits 1.

**A repository** — one class per table in `src/db/`, taking `Database`. Keep multi-table writes in a
single `Database.transaction`, and keep them idempotent: re-running a keyword must refresh its page,
not duplicate it.
