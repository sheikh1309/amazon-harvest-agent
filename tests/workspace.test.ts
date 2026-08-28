import { describe, expect, it } from "vitest";
import { sep } from "node:path";
import { Workspace, WorkspacePathError } from "../src/lib/workspace";
import { resolveOutputPath } from "../src/tools/write-products.tool";

const workspace = new Workspace("workspace", "cast-iron-skillet", "output");

describe("Workspace isolation", () => {
    it("roots the run in its own keyword directory", () => {
        expect(workspace.root.endsWith(`${sep}cast-iron-skillet`)).toBe(true);
    });

    it("puts a different keyword somewhere else entirely", () => {
        const other = new Workspace("workspace", "charcoal-grill", "output");
        expect(other.root).not.toBe(workspace.root);
    });
});

describe("Workspace.resolve", () => {
    it("treats a leading slash as the workspace root, not the filesystem root", () => {
        expect(workspace.resolve("/products/B01.json")).toBe(workspace.resolve("products/B01.json"));
        expect(workspace.resolve("/products/B01.json").startsWith(workspace.root + sep)).toBe(true);
    });

    it("rejects traversal out of the workspace", () => {
        expect(() => workspace.resolve("../../etc/passwd")).toThrow(WorkspacePathError);
        expect(() => workspace.resolve("products/../../../etc/passwd")).toThrow(WorkspacePathError);
    });

    it("rejects a sibling directory that merely shares the root's prefix", () => {
        expect(() => workspace.resolve("../cast-iron-skillet-evil/x.json")).toThrow(WorkspacePathError);
    });

    it("allows the root itself", () => {
        expect(workspace.resolve("")).toBe(workspace.root);
    });
});

describe("resolveOutputPath", () => {
    it("keeps a real .json path the model supplied", () => {
        expect(resolveOutputPath("output", "grill", "output/grill.json")).toBe("output/grill.json");
    });

    it("auto-names inside a directory, because models pass the directory constantly", () => {
        expect(resolveOutputPath("output", "grill", "/output")).toMatch(
            /^output\/products_grill_.+\.json$/,
        );
        expect(resolveOutputPath("output", "grill", "output/")).toMatch(
            /^output\/products_grill_.+\.json$/,
        );
    });

    it("auto-names when given nothing", () => {
        expect(resolveOutputPath("output", "cast iron skillet", null)).toMatch(
            /^output\/products_cast-iron-skillet_.+\.json$/,
        );
    });

    it("never returns an absolute path", () => {
        expect(resolveOutputPath("output", "grill", "/tmp/somewhere.json").startsWith("/")).toBe(false);
    });
});
