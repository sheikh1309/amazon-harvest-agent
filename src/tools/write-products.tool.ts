import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { slugify } from "../lib/text";
import type { Product } from "../schema/product";
import type { ToolDependencies } from "./tool-dependencies";

const schema = z.object({
    keyword: z.string().describe("the search keyword these products came from"),
    asins: z
        .array(z.string())
        .min(1)
        .describe("final ASINs in the order they should appear; each must already exist in /products"),
    path: z
        .string()
        .nullable()
        .default(null)
        .describe(
            "full output file path ending in .json, e.g. output/grill.json. Pass null to auto-name a " +
                "timestamped file under output/ — do not pass the bare directory.",
        ),
});

export function defaultOutputName(keyword: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `products_${slugify(keyword)}_${stamp}.json`;
}

export function resolveOutputPath(outputDir: string, keyword: string, path: string | null): string {
    const cleaned = (path ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!cleaned) return `${outputDir}/${defaultOutputName(keyword)}`;
    if (!cleaned.toLowerCase().endsWith(".json")) return `${cleaned}/${defaultOutputName(keyword)}`;
    return cleaned;
}

export function buildMarkdownReport(keyword: string, products: Product[]): string {
    const rows = products.map((product, index) => {
        const price = product.price !== null ? `${product.currency ?? ""}${product.price}` : "—";
        const variants = product.variants.dimensions.length
            ? product.variants.dimensions
                  .map((dimension) => `${dimension.label ?? dimension.key} ×${dimension.values.length}`)
                  .join(", ")
            : "—";
        const title = (product.title ?? product.asin).replace(/\|/g, "/").slice(0, 70);

        return (
            `| ${index + 1} | [${title}](${product.affiliate_url}) | ${product.rating ?? "—"}★ | ` +
            `${product.review_count ?? "—"} | ${price} | ${product.images.length} | ${variants} |`
        );
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

export function createWriteProductsTool({ config, workspace, artifacts }: ToolDependencies) {
    return tool(
        async ({ keyword, asins, path }: z.infer<typeof schema>) => {
            const products: Product[] = [];
            const missing: string[] = [];

            for (const asin of asins) {
                const product = await workspace.readJsonOrNull<Product>(`products/${asin}.json`);
                if (product) products.push(product);
                else missing.push(asin);
            }

            if (!products.length) {
                return `nothing written — none of those ASINs exist in /products (${asins.join(", ")})`;
            }

            const relativePath = resolveOutputPath(config.outputDir, keyword, path);
            const absolutePath = await workspace.writeJson(relativePath, {
                keyword,
                tag: config.affiliateTag,
                generated_at: new Date().toISOString(),
                count: products.length,
                products,
            });

            const reportPath = relativePath.replace(/\.json$/, ".md");
            await workspace.writeText(reportPath, buildMarkdownReport(keyword, products));

            artifacts.recordOutput(relativePath);

            const imageTotal = products.reduce((total, product) => total + product.images.length, 0);
            const variantTotal = products.reduce((total, product) => total + product.variants.count, 0);

            return [
                `wrote ${products.length} products to /${relativePath} (on disk: ${absolutePath})`,
                `wrote report to /${reportPath}`,
                `${imageTotal} images, ${variantTotal} variant combinations`,
                missing.length
                    ? `warning: ${missing.length} asin(s) had no scraped file: ${missing.join(", ")}`
                    : "",
            ]
                .filter(Boolean)
                .join("\n");
        },
        {
            name: "write_products",
            description:
                "Write the final ranked products to output/ as JSON plus a markdown report. Pass the ASINs in final order — " +
                "the full records are read from /products on disk, so do not paste product data into this call.",
            schema,
        },
    );
}
