export function extractVariants() {
    const script =
        Array.from(document.querySelectorAll("script"))
            .map((element) => element.textContent || "")
            .find((source) => source.includes("dimensionValuesDisplayData")) || "";

    const balancedLiteral = (key: string): any => {
        const keyAt = script.indexOf('"' + key + '"');
        if (keyAt < 0) return null;

        const objectAt = script.indexOf("{", keyAt);
        const arrayAt = script.indexOf("[", keyAt);
        const start =
            objectAt >= 0 && (arrayAt < 0 || objectAt < arrayAt) ? objectAt : arrayAt >= 0 ? arrayAt : -1;
        if (start < 0) return null;

        const open = script[start];
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = start; index < script.length; index++) {
            const character = script[index];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === "\\") {
                escaped = true;
                continue;
            }
            if (character === '"') {
                inString = !inString;
                continue;
            }
            if (inString) continue;

            if (character === open) depth++;
            else if (character === close) {
                depth--;
                if (depth === 0) {
                    try {
                        return JSON.parse(script.slice(start, index + 1));
                    } catch {
                        return null;
                    }
                }
            }
        }
        return null;
    };

    const dimensionKeys: string[] = balancedLiteral("dimensions") || [];
    const dimensionLabels: Record<string, string> = balancedLiteral("variationDisplayLabels") || {};
    const dimensionValues: Record<string, string[]> = balancedLiteral("variationValues") || {};
    const asinCoordinates: Record<string, string[]> = balancedLiteral("dimensionValuesDisplayData") || {};
    const selectedIndexes: Record<string, number> = balancedLiteral("selectedVariationValues") || {};
    const parentAsin = /"parentAsin"\s*:\s*"([A-Z0-9]{10})"/.exec(script)?.[1] || null;

    const normalise = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();

    type Swatch = {
        asin: string | null;
        label: string;
        image: string | null;
        price: number | null;
        available: boolean;
        selected: boolean;
    };

    const swatchesByDimension: Record<string, Record<string, Swatch>> = {};

    const rows = Array.from(
        document.querySelectorAll(
            "[id^='inline-twister-row-'], #twister [id^='variation_'], #twisterContainer [id^='variation_']",
        ),
    );

    for (const row of rows) {
        const key = (row.id || "").replace("inline-twister-row-", "").replace("variation_", "");
        if (!key) continue;

        const items = Array.from(row.querySelectorAll("li[data-asin], li[data-defaultasin]"));
        if (!items.length) continue;

        const bucket = (swatchesByDimension[key] = swatchesByDimension[key] || {});

        for (const item of items) {
            const image = item.querySelector("img");
            const label = normalise(
                item.querySelector(".swatch-title-text-display")?.textContent ||
                    image?.getAttribute("alt") ||
                    item.querySelector(".twisterTextDiv")?.textContent ||
                    item.textContent?.split("\n")[0],
            );
            if (!label) continue;

            const priceText =
                item.querySelector(".dimension-slot-info .a-offscreen")?.textContent ||
                item.querySelector(".dimension-slot-info")?.textContent ||
                "";
            const priceMatch = priceText.replace(/,/g, "").match(/\d+(\.\d+)?/);

            bucket[label] = {
                asin: item.getAttribute("data-asin") || item.getAttribute("data-defaultasin"),
                label,
                image: image?.getAttribute("src") || null,
                price: priceMatch ? Number.parseFloat(priceMatch[0]) : null,
                available: item.getAttribute("data-initiallyunavailable") !== "true",
                selected:
                    item.getAttribute("data-initiallyselected") === "true" ||
                    !!item.querySelector(".a-button-selected") ||
                    item.classList.contains("swatchSelect"),
            };
        }
    }

    const keys = dimensionKeys.length ? dimensionKeys : Object.keys(swatchesByDimension);

    const dimensions = keys.map((key) => {
        const bucket = swatchesByDimension[key] || {};
        const declaredValues = dimensionValues[key] || [];
        const labels = declaredValues.length ? declaredValues : Object.keys(bucket);

        const domLabel =
            document
                .querySelector(`#inline-twister-dim-title-${key} .a-color-secondary`)
                ?.textContent?.replace(/:\s*$/, "") ||
            document.querySelector(`#${"variation_" + key} .a-form-label`)?.textContent;

        const selectedLabel =
            document
                .querySelector(`#inline-twister-expanded-dimension-text-${key}`)
                ?.textContent?.trim() ||
            (typeof selectedIndexes[key] === "number" ? declaredValues[selectedIndexes[key]] : null) ||
            null;

        return {
            key,
            label: dimensionLabels[key] || normalise(domLabel) || null,
            selected: selectedLabel,
            values: labels.map((label) => {
                const swatch = bucket[normalise(label)];
                return {
                    asin: swatch?.asin || null,
                    label,
                    thumb: swatch?.image || null,
                    price: swatch?.price ?? null,
                    available: swatch ? swatch.available : true,
                    selected: swatch ? swatch.selected : label === selectedLabel,
                };
            }),
        };
    });

    const combinations = Object.keys(asinCoordinates).map((asin) => {
        const coordinates = asinCoordinates[asin] || [];
        const values: Record<string, string> = {};
        keys.forEach((key, index) => {
            if (coordinates[index] != null) values[key] = coordinates[index];
        });
        return { asin, values };
    });

    return { parentAsin, dimensions, combinations };
}
