import type { Logger } from "./logger";

type StreamUpdate = Record<string, unknown>;

type StreamMessage = {
    content?: unknown;
    tool_calls?: { name: string; args?: Record<string, any> }[];
    getType?: () => string;
    _getType?: () => string;
};

export class StreamRenderer {
    private lastProse = "";

    constructor(
        private readonly logger: Logger,
        private readonly indent = "  ",
    ) {}

    render(update: StreamUpdate): void {
        for (const message of StreamRenderer.messagesOf(update)) {
            const type = StreamRenderer.typeOf(message);

            if (type === "ai") {
                this.renderAssistant(message);
            } else if (type === "tool") {
                const text = StreamRenderer.textOf(message);
                if (text.trim()) this.logger.info(`${this.indent}  ${StreamRenderer.preview(text, 3)}`);
            }
        }
    }

    get closingSummary(): string {
        return this.lastProse;
    }

    private renderAssistant(message: StreamMessage): void {
        for (const call of message.tool_calls ?? []) {
            this.logger.info(`${this.indent}⚙ ${call.name} ${StreamRenderer.describeCall(call)}`);
        }

        const text = StreamRenderer.textOf(message).trim();
        if (!text) return;

        this.logger.info(`${this.indent}· ${StreamRenderer.preview(text)}`);
        if (!message.tool_calls?.length) this.lastProse = text;
    }

    private static describeCall(call: { name: string; args?: Record<string, any> }): string {
        if (call.name === "task") return `→ ${call.args?.subagent_type}`;
        if (call.name === "write_todos") return `${call.args?.todos?.length ?? 0} todos`;
        return StreamRenderer.preview(JSON.stringify(call.args ?? {}), 1);
    }

    private static messagesOf(update: StreamUpdate): StreamMessage[] {
        return Object.values(update ?? {}).flatMap(
            (node) => ((node as { messages?: StreamMessage[] })?.messages ?? []) as StreamMessage[],
        );
    }

    private static typeOf(message: StreamMessage): string | undefined {
        return message?.getType?.() ?? message?._getType?.();
    }

    static textOf(message: StreamMessage): string {
        const content = message?.content;
        if (typeof content === "string") return content;

        if (Array.isArray(content)) {
            return content
                .filter((block: any) => block?.type === "text" && typeof block.text === "string")
                .map((block: any) => block.text)
                .join("");
        }
        return "";
    }

    static preview(text: string, lines = 2): string {
        return text.split("\n").filter(Boolean).slice(0, lines).join(" · ").slice(0, 160);
    }
}
