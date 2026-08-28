/**
 * jsdom does not implement `HTMLElement.innerText` — it is a rendered-layout property
 * and jsdom has no layout. It returns `undefined`, which quietly turns every
 * `innerText`-based extraction into a null field under test while working fine in a
 * real browser.
 *
 * page-fns/product.ts reads `#availability` through innerText specifically because that
 * container carries an inline <script> on some layouts, and textContent would hand the
 * whole function body to the availability regex. So the property has to exist here, and
 * it has to be the script-stripping variant rather than an alias for textContent —
 * otherwise the test that guards exactly that distinction would pass either way.
 *
 * This is an approximation of innerText's real semantics: it ignores `display: none`
 * and does not collapse whitespace the way a layout engine would. It is enough for
 * these tests and it is not a substitute for `pnpm check`, which runs the same
 * selectors against live amazon pages.
 */
if (typeof globalThis.HTMLElement !== "undefined") {
    Object.defineProperty(globalThis.HTMLElement.prototype, "innerText", {
        configurable: true,
        get(this: HTMLElement): string {
            const clone = this.cloneNode(true) as HTMLElement;
            for (const el of Array.from(clone.querySelectorAll("script, style, template"))) {
                el.remove();
            }
            // block-level children start a new line in a real browser; the extractors
            // that split on "\n" depend on that
            for (const el of Array.from(clone.querySelectorAll("div, p, li, br, tr"))) {
                el.insertAdjacentText("beforebegin", "\n");
            }
            return (clone.textContent ?? "")
                .split("\n")
                .map((line) => line.replace(/[ \t]+/g, " ").trim())
                .filter(Boolean)
                .join("\n");
        },
    });
}
