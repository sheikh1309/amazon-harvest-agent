import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { LLMResult } from "@langchain/core/outputs";

/**
 * Run-wide token accounting.
 *
 * The counter is module state rather than something threaded through the graph
 * because subagent calls happen inside a nested `task` invocation — they never
 * appear in the stream the CLI iterates, so there is nowhere in index.ts to
 * observe them. Attaching the handler in `make_model` instead means every agent
 * built for the run reports here, orchestrator and subagents alike.
 */
type Bucket = { calls: number; input: number; output: number; cached: number; reasoning: number };

const totals: Bucket = { calls: 0, input: 0, output: 0, cached: 0, reasoning: 0 };

class UsageTracker extends BaseCallbackHandler {
    name = "usage-tracker";

    handleLLMEnd(output: LLMResult) {
        totals.calls += 1;

        for (const generation of output.generations.flat()) {
            // ChatGeneration carries the AIMessage; usage_metadata is the provider-neutral
            // shape langchain normalises every backend into.
            const usage = (generation as any).message?.usage_metadata;
            if (usage) {
                totals.input += usage.input_tokens ?? 0;
                totals.output += usage.output_tokens ?? 0;
                totals.cached += usage.input_token_details?.cache_read ?? 0;
                totals.reasoning += usage.output_token_details?.reasoning ?? 0;
                continue;
            }

            // Older/raw provider path: only llmOutput is filled in.
            const raw = output.llmOutput?.tokenUsage;
            if (raw) {
                totals.input += raw.promptTokens ?? 0;
                totals.output += raw.completionTokens ?? 0;
            }
        }
    }
}

/** One shared instance is enough — it only writes to module state. */
export const usage_tracker = new UsageTracker();

export function usage_totals(): Readonly<Bucket> {
    return totals;
}

export function print_usage() {
    const n = (v: number) => v.toLocaleString("en-US");
    const t = totals;

    if (t.calls === 0) {
        console.log("tokens:  no model calls recorded");
        return;
    }

    console.log(
        `tokens:  ${n(t.input)} in · ${n(t.output)} out · ${n(t.input + t.output)} total ` +
            `(${n(t.calls)} llm call${t.calls === 1 ? "" : "s"})`,
    );

    // Only worth the line when the provider actually reported them; a cached-read or
    // reasoning count of zero usually means the model does not bill for them separately.
    const extra = [
        t.cached ? `${n(t.cached)} cached in` : "",
        t.reasoning ? `${n(t.reasoning)} reasoning out` : "",
    ].filter(Boolean);
    if (extra.length) console.log(`         ${extra.join(" · ")}`);
}
