import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],

        // Default to node. The page-function tests opt into jsdom per file with a
        // `@vitest-environment jsdom` docblock — spinning up a DOM for the pure
        // arithmetic tests would triple the suite's runtime for nothing.
        environment: "node",

        // jsdom has no layout and therefore no innerText; the page functions depend on
        // it. See tests/setup-jsdom.ts.
        setupFiles: ["tests/setup-jsdom.ts"],

        // Nothing here talks to amazon, postgres or openrouter. If a test ever takes
        // longer than this it has started doing something it should not.
        testTimeout: 10_000,
    },
});
