# amazon-harvest-agent

A deep agent that harvests ranked Amazon products with images and full variant data.

## Architecture rule

The LLM orchestrates; it does not parse HTML. All scraping is deterministic code inside tools
(`src/browser/`), which keeps runs reproducible and cheap. If you find yourself asking the model to
read page content and extract fields, that belongs in a page function instead.

## Working on the scrapers

- Page functions in `src/browser/page-fns/` run **inside the browser**. Playwright serializes the
  function source, so they must be self-contained — no imports, no closure over module scope.
- Never use an unscoped `.a-price` selector. Amazon pages carry sponsored carousels and
  "compare with similar items" tables, so an unscoped price selector silently returns another
  product's price. Scope to the buybox or `#centerCol`.
- A dead selector fails silently as a `null` field, not an error. Run `pnpm check` after touching
  anything in `page-fns/`.
- Variant data needs **both** the inline twister JSON (full matrix) and the rendered DOM (images,
  text, prices). Neither is complete on its own. See the table in the README.

## Working on the agent

- Tools return one line per item and write payloads to the workspace. Never return full product
  JSON from a tool — it blows the context window at ~30 products.
- Paths in tool arguments are workspace-relative (`/products/x.json`), not host paths. The
  filesystem backend is rooted at `workspace/`.
- Subagents inherit filesystem tools from middleware; the `tools` array in `subagents.ts` is what
  they get *on top*.

## Conventions

- snake_case for functions and variables, matching the existing code.
- Comments explain *why* — a non-obvious constraint or a trap — not what the next line does.
