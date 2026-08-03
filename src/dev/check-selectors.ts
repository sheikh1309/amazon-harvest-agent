/**
 * Selector smoke test. Amazon changes its DOM without warning, and a broken
 * selector fails silently as a `null` field rather than an error — run this
 * (`pnpm check`) whenever fields start coming back empty.
 *
 *   pnpm check                 # default keyword
 *   pnpm check "coffee maker"  # your own
 */
import { pool } from "../browser/pool";
import { discover, fetch_product } from "../browser/scrape";

const keyword = process.argv[2] ?? "grill";

function report(label: string, ok: boolean, detail: string) {
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(16)} ${detail}`);
    return ok;
}

async function main() {
    let failures = 0;
    const fail = (ok: boolean) => {
        if (!ok) failures++;
    };

    console.log(`\nsearch: "${keyword}"`);
    const candidates = await discover(keyword, { pages: 1 });
    fail(report("cards", candidates.length > 0, `${candidates.length} organic`));
    fail(report("titles", candidates.some((c) => c.title), `${candidates.filter((c) => c.title).length} with title`));
    fail(report("ratings", candidates.some((c) => c.rating), `${candidates.filter((c) => c.rating).length} with rating`));
    fail(report("reviews", candidates.some((c) => c.review_count), `${candidates.filter((c) => c.review_count).length} with reviews`));
    fail(report("prices", candidates.some((c) => c.price), `${candidates.filter((c) => c.price).length} with price`));

    if (!candidates.length) return failures;

    // a known multi-dimension product, so the twister path is always exercised
    const targets = [candidates[0].asin, "B09B8V1LZ3"];

    for (const asin of targets) {
        console.log(`\ndetail: ${asin}`);
        try {
            const p = await fetch_product(asin);
            fail(report("title", !!p.title, p.title?.slice(0, 50) ?? "—"));

            // a missing price is correct, not a bug, when the item can't be bought
            // from the resolved delivery address — the buybox simply isn't rendered
            const unbuyable = /cannot be shipped|currently unavailable|out of stock/i.test(
                p.availability ?? "",
            );
            const price_ok = p.price != null || unbuyable;
            report(
                "price",
                price_ok,
                p.price != null
                    ? `${p.currency ?? ""}${p.price}`
                    : `— (${p.availability?.slice(0, 45) ?? "no buybox"})`,
            );
            fail(price_ok);
            fail(report("rating", p.rating != null, `${p.rating ?? "—"}★ / ${p.review_count ?? "—"} reviews`));
            fail(report("images", p.images.length > 0, `${p.images.length} images`));
            report("description", !!p.description, p.description ? `${p.description.length} chars` : "—");

            const v = p.variants;
            const with_image = v.dimensions.flatMap((d) => d.values).filter((x) => x.image).length;
            const with_label = v.dimensions.flatMap((d) => d.values).filter((x) => x.label).length;
            const with_price = v.dimensions.flatMap((d) => d.values).filter((x) => x.price != null).length;

            report("variants", true, `${v.dimensions.length} dimensions, ${v.combinations.length} combinations`);
            for (const d of v.dimensions) {
                console.log(
                    `      ${d.key} (${d.label ?? "?"}) = ${d.selected ?? "?"} → ${d.values
                        .map((x) => x.label)
                        .slice(0, 6)
                        .join(", ")}`,
                );
            }
            if (v.dimensions.length) {
                fail(report("variant labels", with_label > 0, `${with_label} labelled`));
                // images exist only on image swatches, prices only when the item is
                // shippable to the resolved address — informational, never fatal
                report("variant images", with_image > 0, `${with_image} with image`);
                report("variant prices", with_price > 0, `${with_price} with price`);
            }
        } catch (e) {
            fail(report("fetch", false, (e as Error).message.split("\n")[0]));
        }
    }

    return failures;
}

main()
    .then(async (failures) => {
        await pool.close();
        console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
        process.exit(failures ? 1 : 0);
    })
    .catch(async (e) => {
        console.error(e);
        await pool.close();
        process.exit(1);
    });
