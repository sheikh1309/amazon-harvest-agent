import { Application } from "./app/application";
import { ExitCode } from "./app/exit-code";

async function main(): Promise<void> {
    const application = new Application();
    application.listenForShutdown(process);

    const requestedKeyword = process.argv.slice(2).join(" ").trim() || null;

    let exitCode: ExitCode = ExitCode.Failed;

    try {
        exitCode = await application.execute(requestedKeyword);
    } catch (error) {
        application.logger.error(`run failed: ${(error as Error).message}`);
    } finally {
        application.reportUsage();
        application.logger.blankLine();
        await application.shutdownResources();
    }

    process.exitCode = exitCode;
}

void main();
