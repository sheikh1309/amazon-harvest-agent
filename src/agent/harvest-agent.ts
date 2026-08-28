import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { Config } from "../lib/config";
import type { Logger } from "../lib/logger";
import type { ModelFactory } from "../lib/model-factory";
import type { Workspace } from "../lib/workspace";
import { StreamRenderer } from "../lib/stream-renderer";
import type { ToolRegistry } from "../tools/tool-registry";
import type { PromptLibrary } from "./prompt-library";
import type { SubagentCatalog } from "./subagent-catalog";

const RECURSION_LIMIT = 200;

export class HarvestAgent {
    constructor(
        private readonly config: Config,
        private readonly logger: Logger,
        private readonly models: ModelFactory,
        private readonly workspace: Workspace,
        private readonly tools: ToolRegistry,
        private readonly subagents: SubagentCatalog,
        private readonly prompts: PromptLibrary,
    ) {}

    async run(keyword: string, signal: AbortSignal | undefined, onUpdate: () => void): Promise<string> {
        await this.workspace.ensureExists();

        const agent = createDeepAgent({
            model: this.models.create(),
            systemPrompt: this.prompts.orchestrator(),
            tools: this.tools.harvestTools,
            subagents: this.subagents.all(),
            backend: new FilesystemBackend({ rootDir: this.workspace.root, virtualMode: true }),
        });

        const stream = await agent.stream(
            { messages: [{ role: "user", content: this.prompts.harvestInstruction(keyword) }] },
            { streamMode: "updates", recursionLimit: RECURSION_LIMIT, signal },
        );

        const renderer = new StreamRenderer(this.logger);

        for await (const update of stream) {
            onUpdate();
            renderer.render(update as Record<string, unknown>);
        }

        return renderer.closingSummary;
    }
}
