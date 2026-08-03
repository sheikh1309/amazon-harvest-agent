import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { config } from "./config";

export const workspace_root = resolve(config.workspace);

/**
 * Resolve a path the agent gave us against the workspace root.
 *
 * The deep agent addresses files as `/products/x.json` (its filesystem backend is
 * rooted at the workspace), so a leading slash means "workspace root", not "/".
 */
export function workspace_path(relative: string) {
    const cleaned = relative.replace(/^\/+/, "");
    const target = isAbsolute(relative) ? resolve(workspace_root, cleaned) : resolve(workspace_root, cleaned);

    if (!target.startsWith(workspace_root)) {
        throw new Error(`path escapes the workspace: ${relative}`);
    }
    return target;
}

export async function write_json(relative: string, data: unknown) {
    const target = workspace_path(relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(data, null, 2), "utf8");
    return target;
}

export async function read_json<T>(relative: string): Promise<T> {
    return JSON.parse(await readFile(workspace_path(relative), "utf8")) as T;
}
