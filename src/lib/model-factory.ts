import { ChatOpenRouter } from "@langchain/openrouter";
import type { Config } from "./config";
import type { UsageTracker } from "./usage-tracker";

export class ModelFactory {
    constructor(
        private readonly config: Config,
        private readonly usageTracker: UsageTracker,
    ) {}

    create(model: string = this.config.model, maxTokens: number = this.config.maxOutputTokens): ChatOpenRouter {
        return new ChatOpenRouter({
            model,
            apiKey: this.config.openRouterApiKey ?? undefined,
            temperature: this.config.temperature,
            maxTokens,
            // langchain already backs these off (p-retry, factor 2, 1s base, jittered) and
            // 429 is not in its no-retry list, so the retries were landing — 3 of them just
            // exhaust ~7s in, well before a provider rate limit clears. 6 stretches the same
            // curve to ~60s, which is the difference between riding out a burst and losing a
            // harvest that is minutes deep.
            maxRetries: 6,
            provider: { require_parameters: true, allow_fallbacks: true },
            ...(this.config.fallbackModels.length
                ? { modelKwargs: { models: this.config.fallbackModels, route: "fallback" } }
                : {}),
            callbacks: [this.usageTracker],
        });
    }
}
