import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export class WorkspacePathError extends Error {
    constructor(requestedPath: string) {
        super(`path escapes the workspace: ${requestedPath}`);
        this.name = "WorkspacePathError";
    }
}

export class Workspace {
    readonly root: string;

    constructor(
        baseDirectory: string,
        runSlug: string,
        private readonly outputDirectory: string,
    ) {
        this.root = resolve(baseDirectory, runSlug);
    }

    resolve(relativePath: string): string {
        const target = resolve(this.root, relativePath.replace(/^\/+/, ""));

        if (target !== this.root && !target.startsWith(this.root + sep)) {
            throw new WorkspacePathError(relativePath);
        }
        return target;
    }

    async ensureExists(): Promise<void> {
        await mkdir(this.root, { recursive: true });
    }

    async writeJson(relativePath: string, data: unknown): Promise<string> {
        const target = this.resolve(relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(data, null, 2), "utf8");
        return target;
    }

    async writeText(relativePath: string, contents: string): Promise<string> {
        const target = this.resolve(relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents, "utf8");
        return target;
    }

    async readJson<T>(relativePath: string): Promise<T> {
        return JSON.parse(await readFile(this.resolve(relativePath), "utf8")) as T;
    }

    async readJsonOrNull<T>(relativePath: string): Promise<T | null> {
        return this.readJson<T>(relativePath).catch(() => null);
    }

    async readText(relativePath: string): Promise<string> {
        return readFile(this.resolve(relativePath), "utf8");
    }

    async readTextOrNull(relativePath: string): Promise<string | null> {
        return this.readText(relativePath).catch(() => null);
    }

    async scrapedAsins(): Promise<string[]> {
        try {
            const files = await readdir(this.resolve("products"));
            return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
        } catch {
            return [];
        }
    }

    async newestOutput(keywordSlug: string): Promise<string | null> {
        const directory = this.resolve(this.outputDirectory);

        let files: string[];
        try {
            files = await readdir(directory);
        } catch {
            return null;
        }

        const prefix = `products_${keywordSlug}_`;
        const matches = files.filter((file) => file.startsWith(prefix) && file.endsWith(".json"));
        if (!matches.length) return null;

        const timestamped = await Promise.all(
            matches.map(async (file) => ({
                file,
                modifiedAt: (await stat(join(directory, file))).mtimeMs,
            })),
        );
        timestamped.sort((a, b) => b.modifiedAt - a.modifiedAt);

        return `${this.outputDirectory}/${timestamped[0].file}`;
    }

    async removeDirectory(relativePath: string): Promise<void> {
        await rm(this.resolve(relativePath), { recursive: true, force: true });
    }

    async destroy(): Promise<void> {
        await rm(this.root, { recursive: true, force: true });
    }
}
