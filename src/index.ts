import { build_agent } from "./agent/agent";
import { pool } from "./browser/pool";
import { config } from "./lib/config";
import { print_usage } from "./lib/usage";

const keyword = process.argv.slice(2).join(" ").trim() || "grill";

/** Anthropic returns content as an array of blocks, not a bare string. */
function text_of(message: any): string {
    const content = message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .filter((b: any) => b?.type === "text" && typeof b.text === "string")
            .map((b: any) => b.text)
            .join("");
    }
    return "";
}

function preview(text: string, lines = 2) {
    return text
        .split("\n")
        .filter(Boolean)
        .slice(0, lines)
        .join(" · ")
        .slice(0, 160);
}

/** Print one line per step so a long run is watchable rather than silent. */
function render(update: Record<string, any>) {
    for (const node of Object.values(update ?? {})) {
        for (const message of node?.messages ?? []) {
            const type = message?.getType?.() ?? message?._getType?.();

            if (type === "ai") {
                for (const call of message.tool_calls ?? []) {
                    const detail =
                        call.name === "task"
                            ? `→ ${call.args?.subagent_type}`
                            : call.name === "write_todos"
                              ? `${call.args?.todos?.length ?? 0} todos`
                              : preview(JSON.stringify(call.args ?? {}), 1);
                    console.log(`  ⚙ ${call.name} ${detail}`);
                }
                const text = text_of(message).trim();
                if (text) console.log(`  · ${preview(text)}`);
            }

            if (type === "tool") {
                const text = text_of(message);
                if (text.trim()) console.log(`    ${preview(text, 3)}`);
            }
        }
    }
}

async function main() {
    console.log(`\nkeyword: ${keyword}`);
    console.log(`model:   ${config.model} (subagents: ${config.model})`);
    console.log(`browser: ${config.concurrency} parallel contexts\n`);

    const started = Date.now();
    const agent = await build_agent();

    const stream = await agent.stream(
        {
            messages: [
                {
                    role: "user",
                    content:
                        `Harvest the top ${config.final_count} products for the keyword "${keyword}". ` +
                        `Consider up to ${config.candidate_count} candidates. Capture every product image ` +
                        `and the full variant matrix (each dimension, and for every value its text label, ` +
                        `swatch image and price). Write the final JSON and the markdown report.`,
                },
            ],
        },
        { streamMode: "updates", recursionLimit: 200 },
    );

    let last = "";
    for await (const update of stream) {
        render(update as Record<string, any>);
        const values = Object.values((update ?? {}) as Record<string, any>);
        const messages = values.flatMap((v) => v?.messages ?? []);
        // keep the most recent assistant prose; the run ends on a tool result, so the
        // closing summary is not the final item in the stream
        for (const message of messages) {
            if ((message.getType?.() ?? message._getType?.()) !== "ai") continue;
            if (message.tool_calls?.length) continue;
            const text = text_of(message).trim();
            if (text) last = text;
        }
    }

    console.log(`\n${"-".repeat(60)}`);
    if (last.trim()) console.log(last.trim());
    console.log(`${"-".repeat(60)}`);
    console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
    .catch((e) => {
        console.error(`\nrun failed: ${(e as Error).message}`);
        process.exitCode = 1;
    })
    .finally(() => {
        // in the finally so a crashed run still reports what it spent
        print_usage();
        console.log();
        return pool.close();
    });
