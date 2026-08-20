import { ChatOpenRouter } from "@langchain/openrouter";
import { usage_tracker } from "./usage";

/**
 * Every agent in the run — orchestrator and subagents — is built here.
 *
 * Subagents may also be given a bare model *name*, but deepagents resolves those
 * through `initChatModel`, which infers the provider from the string. It knows
 * `claude-*` and `gpt-*`; it does not recognise openrouter slugs like
 * `inclusionai/ling-2.6-flash` and fails with
 * "Unable to infer model provider". Handing out instances skips the inference
 * entirely, and keeps client settings identical across agents.
 */
export function make_model(model: string, max_tokens = 16_000) {
    return new ChatOpenRouter({
        model,
        apiKey: process.env.OPENROUTER_API_KEY,
        temperature: 1.0,
        maxTokens: max_tokens,
        provider: { require_parameters: true, allow_fallbacks: true },
        modelKwargs: {
            models: ["mistralai/mistral-nemo", "openai/gpt-oss-20b"],
            route: "fallback",
        },

        // attached here, not at the call site, so subagent calls are counted too
        callbacks: [usage_tracker],
    });
}