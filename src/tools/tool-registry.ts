import { createSearchAmazonTool } from "./search-amazon.tool";
import { createFetchProductsTool } from "./fetch-products.tool";
import { createFetchVariantDetailsTool } from "./fetch-variant-details.tool";
import { createRankProductsTool } from "./rank-products.tool";
import { createWriteProductsTool } from "./write-products.tool";
import { createProductBriefsTool } from "./product-briefs.tool";
import { createWritePageCopyTool } from "./write-page-copy.tool";
import { createWriteProductCopyTool } from "./write-product-copy.tool";
import type { ToolDependencies } from "./tool-dependencies";

export class ToolRegistry {
    readonly searchAmazon;
    readonly fetchProducts;
    readonly fetchVariantDetails;
    readonly rankProducts;
    readonly writeProducts;
    readonly productBriefs;
    readonly writePageCopy;
    readonly writeProductCopy;

    constructor(dependencies: ToolDependencies) {
        this.searchAmazon = createSearchAmazonTool(dependencies);
        this.fetchProducts = createFetchProductsTool(dependencies);
        this.fetchVariantDetails = createFetchVariantDetailsTool(dependencies);
        this.rankProducts = createRankProductsTool(dependencies);
        this.writeProducts = createWriteProductsTool(dependencies);
        this.productBriefs = createProductBriefsTool(dependencies);
        this.writePageCopy = createWritePageCopyTool(dependencies);
        this.writeProductCopy = createWriteProductCopyTool(dependencies);
    }

    get harvestTools() {
        return [
            this.searchAmazon,
            this.fetchProducts,
            this.fetchVariantDetails,
            this.rankProducts,
            this.writeProducts,
        ];
    }

    get writerTools() {
        return [this.productBriefs, this.writePageCopy, this.writeProductCopy];
    }
}
