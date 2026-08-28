import type { Config } from "../lib/config";
import type { Workspace } from "../lib/workspace";
import type { AmazonScraper } from "../browser/amazon-scraper";
import type { ProductRanker } from "../lib/product-ranker";
import type { RunArtifacts } from "../app/run-artifacts";

export type ToolDependencies = {
    config: Config;
    workspace: Workspace;
    scraper: AmazonScraper;
    ranker: ProductRanker;
    artifacts: RunArtifacts;
};
