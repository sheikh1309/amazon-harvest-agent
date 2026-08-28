import "dotenv/config";
import { Config } from "../lib/config";
import { Logger } from "../lib/logger";
import { Database } from "../db/database";
import { Migrator } from "../db/migrator";

async function main(): Promise<void> {
    const config = Config.load();
    if (!config.databaseEnabled) throw new Error("DATABASE_URL is not set");

    const logger = new Logger({ runId: "migrate", format: config.logFormat, level: config.logLevel });
    const database = new Database(config, logger);

    try {
        console.log(`migrations: ${config.migrationsDir}`);

        const { applied, skipped, drifted } = await new Migrator(database, config.migrationsDir).run();

        for (const migration of applied) {
            console.log(`  applied  v${migration.version}  ${migration.description}`);
        }
        if (skipped) console.log(`  skipped  ${skipped} already applied`);

        for (const migration of drifted) {
            console.warn(
                `  ! v${migration.version} (${migration.description}) has been edited since it was ` +
                    "applied — the database and the file no longer agree",
            );
        }

        console.log(applied.length ? `\n${applied.length} migration(s) applied.` : "\nup to date.");
        if (drifted.length) process.exitCode = 1;
    } finally {
        await database.close();
    }
}

main().catch((error: Error) => {
    console.error(`\nmigrate failed: ${error.message}`);
    process.exitCode = 1;
});
