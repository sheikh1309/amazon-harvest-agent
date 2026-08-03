/**
 * Runs inside the page. Must stay self-contained — see the note in search.ts.
 *
 * Amazon splits variant data across two sources and neither one is complete:
 *
 *   1. An inline `P.register` script holding the full dimension matrix
 *      (`dimensions`, `variationValues`, `dimensionValuesDisplayData`,
 *      `dimensionToAsinMap`). This is the only place every axis appears — a
 *      product with colour *and* configuration often renders just one swatch row.
 *   2. The rendered twister, which is the only place the swatch **images**,
 *      the human-readable swatch **text**, and per-swatch prices exist.
 *
 * So we parse the JSON for the matrix and join the DOM onto it by label.
 */
export function extract_variants() {
    // ---- source 1: the inline twister payload ------------------------------

    const script =
        Array.from(document.querySelectorAll("script"))
            .map((s) => s.textContent || "")
            .find((t) => t.includes("dimensionValuesDisplayData")) || "";

    /**
     * Pull one balanced `{...}` / `[...]` literal out of the blob.
     *
     * A regex can't do this: the values contain nested objects and quoted braces,
     * so `"key"\s*:\s*(\{[^}]*\})` truncates at the first inner `}`.
     */
    const literal = (key: string): any => {
        const at = script.indexOf('"' + key + '"');
        if (at < 0) return null;

        const obj = script.indexOf("{", at);
        const arr = script.indexOf("[", at);
        const start =
            obj >= 0 && (arr < 0 || obj < arr) ? obj : arr >= 0 ? arr : -1;
        if (start < 0) return null;

        const open = script[start];
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let in_string = false;
        let escaped = false;

        for (let i = start; i < script.length; i++) {
            const ch = script[i];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                in_string = !in_string;
                continue;
            }
            if (in_string) continue;

            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(script.slice(start, i + 1));
                    } catch {
                        return null;
                    }
                }
            }
        }
        return null;
    };

    const dimensions: string[] = literal("dimensions") || [];
    const labels: Record<string, string> = literal("variationDisplayLabels") || {};
    const values: Record<string, string[]> = literal("variationValues") || {};
    const display: Record<string, string[]> = literal("dimensionValuesDisplayData") || {};
    const selected_idx: Record<string, number> = literal("selectedVariationValues") || {};
    const parent = /"parentAsin"\s*:\s*"([A-Z0-9]{10})"/.exec(script)?.[1] || null;

    // ---- source 2: the rendered swatches -----------------------------------

    const norm = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();

    type Swatch = {
        asin: string | null;
        label: string;
        image: string | null;
        price: number | null;
        available: boolean;
        selected: boolean;
    };

    /** dimension key -> normalized label -> swatch */
    const swatches: Record<string, Record<string, Swatch>> = {};

    const rows = Array.from(
        document.querySelectorAll(
            "[id^='inline-twister-row-'], #twister [id^='variation_'], #twisterContainer [id^='variation_']",
        ),
    );

    for (const row of rows) {
        const key = (row.id || "")
            .replace("inline-twister-row-", "")
            .replace("variation_", "");
        if (!key) continue;

        const items = Array.from(row.querySelectorAll("li[data-asin], li[data-defaultasin]"));
        if (!items.length) continue;

        const bucket = (swatches[key] = swatches[key] || {});

        for (const li of items) {
            const img = li.querySelector("img");
            const label = norm(
                li.querySelector(".swatch-title-text-display")?.textContent ||
                    img?.getAttribute("alt") ||
                    li.querySelector(".twisterTextDiv")?.textContent ||
                    li.textContent?.split("\n")[0],
            );
            if (!label) continue;

            const price_text =
                li.querySelector(".dimension-slot-info .a-offscreen")?.textContent ||
                li.querySelector(".dimension-slot-info")?.textContent ||
                "";
            const price_match = price_text.replace(/,/g, "").match(/\d+(\.\d+)?/);

            bucket[label] = {
                asin: li.getAttribute("data-asin") || li.getAttribute("data-defaultasin"),
                label,
                image: img?.getAttribute("src") || null,
                price: price_match ? parseFloat(price_match[0]) : null,
                available: li.getAttribute("data-initiallyunavailable") !== "true",
                selected:
                    li.getAttribute("data-initiallyselected") === "true" ||
                    !!li.querySelector(".a-button-selected") ||
                    li.classList.contains("swatchSelect"),
            };
        }
    }

    // ---- merge -------------------------------------------------------------

    // the JSON knows every axis; fall back to whatever the DOM rendered
    const keys = dimensions.length ? dimensions : Object.keys(swatches);

    const merged = keys.map((key) => {
        const bucket = swatches[key] || {};
        const from_json = values[key] || [];
        const value_labels = from_json.length ? from_json : Object.keys(bucket);

        const dom_label =
            document
                .querySelector(`#inline-twister-dim-title-${key} .a-color-secondary`)
                ?.textContent?.replace(/:\s*$/, "") ||
            document.querySelector(`#${"variation_" + key} .a-form-label`)?.textContent;

        const selected_label =
            document
                .querySelector(`#inline-twister-expanded-dimension-text-${key}`)
                ?.textContent?.trim() ||
            (typeof selected_idx[key] === "number" ? from_json[selected_idx[key]] : null) ||
            null;

        return {
            key,
            label: labels[key] || norm(dom_label) || null,
            selected: selected_label,
            values: value_labels.map((label) => {
                const swatch = bucket[norm(label)];
                return {
                    asin: swatch?.asin || null,
                    label,
                    thumb: swatch?.image || null,
                    price: swatch?.price ?? null,
                    available: swatch ? swatch.available : true,
                    selected: swatch ? swatch.selected : label === selected_label,
                };
            }),
        };
    });

    // every child asin, with its coordinate on each axis
    const combinations = Object.keys(display).map((asin) => {
        const coords = display[asin] || [];
        const values_by_key: Record<string, string> = {};
        keys.forEach((key, i) => {
            if (coords[i] != null) values_by_key[key] = coords[i];
        });
        return { asin, values: values_by_key };
    });

    return { parent_asin: parent, dimensions: merged, combinations };
}
