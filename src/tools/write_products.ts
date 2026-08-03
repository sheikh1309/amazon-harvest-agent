import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { read_json, workspace_path } from "../lib/workspace";
import { config } from "../lib/config";
import { slug } from "../lib/amazon";
import type { product } from "../schema/product";

const schema = z.object({
    keyword: z.string().describe("the search keyword these products came from"),
    asins: z.array(z.string()).min(1)
        .describe("final ASINs in the order they should appear; each must already exist in /products"),
    path: z.string().nullable().default(null)
        .describe("output path; null auto-names one under output/"),
});

function default_path(keyword: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${config.output_dir}/products_${slug(keyword)}_${stamp}.json`;
}

function report(keyword: string, products: product[]) {
    const rows = products.map((p, i) => {
        const price = p.price != null ? `${p.currency ?? ""}${p.price}` : "—";
        const variants = p.variants.dimensions.length
            ? p.variants.dimensions.map((d) => `${d.label ?? d.key} ×${d.values.length}`).join(", ")
            : "—";
        return `| ${i + 1} | [${(p.title ?? p.asin).replace(/\|/g, "/").slice(0, 70)}](${p.affiliate_url}) | ${p.rating ?? "—"}★ | ${p.review_count ?? "—"} | ${price} | ${p.images.length} | ${variants} |`;
    });

    return [
        `# ${keyword}`,
        "",
        `${products.length} products · generated ${new Date().toISOString()}`,
        "",
        "| # | Product | Rating | Reviews | Price | Images | Variants |",
        "|---|---------|--------|---------|-------|--------|----------|",
        ...rows,
        "",
    ].join("\n");
}

async function run({ keyword, asins, path }: z.infer<typeof schema>) {
    const products: product[] = [];
    const missing: string[] = [];

    // read the payloads off disk rather than taking them as tool input — passing
    // full product JSON through the model would cost thousands of tokens per item
    for (const asin of asins) {
        try {
            products.push(await read_json<product>(`products/${asin}.json`));
        } catch {
            missing.push(asin);
        }
    }

    if (!products.length) {
        return `nothing written — none of those ASINs exist in /products (${asins.join(", ")})`;
    }

    // Resolve inside the workspace, which is also the agent's filesystem root. Writing
    // to a path outside it would produce a file the agent cannot read back — and an
    // agent-supplied "/output/x.json" would resolve to the real filesystem root.
    const relative = path ?? default_path(keyword);
    const target = workspace_path(relative);
    await mkdir(dirname(target), { recursive: true });

    await writeFile(
        target,
        JSON.stringify(
            {
                keyword,
                tag: config.affiliate_tag,
                generated_at: new Date().toISOString(),
                count: products.length,
                products,
            },
            null,
            2,
        ),
        "utf8",
    );

    const report_path = target.replace(/\.json$/, ".md");
    await writeFile(report_path, report(keyword, products), "utf8");

    const variant_total = products.reduce((n, p) => n + p.variants.count, 0);
    const image_total = products.reduce((n, p) => n + p.images.length, 0);

    // report the workspace-relative path, since that is what read_file expects
    const shown = "/" + relative.replace(/^\/+/, "");

    return [
        `wrote ${products.length} products to ${shown} (on disk: ${target})`,
        `wrote report to ${shown.replace(/\.json$/, ".md")}`,
        `${image_total} images, ${variant_total} variant combinations`,
        missing.length ? `warning: ${missing.length} asin(s) had no scraped file: ${missing.join(", ")}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export const write_products = tool(run, {
    name: "write_products",
    description:
        "Write the final ranked products to output/ as JSON plus a markdown report. Pass the ASINs in final order — " +
        "the full records are read from /products on disk, so do not paste product data into this call.",
    schema,
});
