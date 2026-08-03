import { mkdir } from "node:fs/promises";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { ChatAnthropic } from "@langchain/anthropic";
import { config } from "../lib/config";
import { workspace_root } from "../lib/workspace";
import { system_prompt } from "./prompts";
import { subagents } from "./subagents";
import { search_amazon } from "../tools/search_amazon";
import { fetch_products } from "../tools/fetch_products";
import { fetch_variant_details } from "../tools/fetch_variant_details";
import { rank_products } from "../tools/rank_products";
import { write_products } from "../tools/write_products";

export async function build_agent() {
    await mkdir(workspace_root, { recursive: true });

    return createDeepAgent({
        model: new ChatAnthropic({ model: config.model, maxTokens: 16_000 }),
        systemPrompt: system_prompt,

        // The orchestrator keeps the same tools its subagents have, so it can finish a
        // one-off itself rather than paying for a delegation round trip.
        tools: [search_amazon, fetch_products, fetch_variant_details, rank_products, write_products],
        subagents,

        /*
         * A real directory, not the in-memory state backend, for two reasons:
         *
         *  - Parallel subagents each return a state update from the `task` tool. With the
         *    state backend those updates all write the same `files` key and race; on disk
         *    they simply do not collide.
         *  - A crash mid-run leaves the scraped products behind, so a rerun resumes
         *    instead of starting over.
         */
        backend: new FilesystemBackend({ rootDir: workspace_root, virtualMode: true }),
    });
}
