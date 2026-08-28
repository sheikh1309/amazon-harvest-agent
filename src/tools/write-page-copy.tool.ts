import { tool } from "@langchain/core/tools";
import { pageCopySchema } from "../schema/page";
import type { ToolDependencies } from "./tool-dependencies";

export const PAGE_COPY_PATH = "page/copy.json";

export function createWritePageCopyTool({ workspace }: ToolDependencies) {
    return tool(
        async (copy: unknown) => {
            const parsed = pageCopySchema.parse(copy);
            await workspace.writeJson(PAGE_COPY_PATH, parsed);

            return (
                `saved page copy: "${parsed.page_title}" under ${parsed.parent_category} ` +
                `(${parsed.buying_guide.sections.length} guide sections, ${parsed.faq.length} faqs). ` +
                "Now call write_product_copy for the products."
            );
        },
        {
            name: "write_page_copy",
            description:
                "Save the page-level copy: category, titles, meta description, introduction, buying guide, FAQ and " +
                "conclusion. No product data — the products go through write_product_copy. Call this once, first.",
            schema: pageCopySchema,
        },
    );
}
