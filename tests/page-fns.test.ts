/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { extractProduct } from "../src/browser/page-fns/product";
import { extractSearchCards } from "../src/browser/page-fns/search";
import { extractVariants } from "../src/browser/page-fns/variants";

function render(html: string) {
    document.body.innerHTML = html;
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("extractSearchCards", () => {
    it("reads asin, rating and review count off a card", () => {
        render(`
            <div class="s-main-slot">
              <div data-component-type="s-search-result" data-asin="B00006JSUA">
                <h2><span>Lodge 10.25 Inch Cast Iron Skillet</span></h2>
                <span aria-label="4.7 out of 5 stars"></span>
                <span aria-label="144,790 ratings"></span>
                <span class="a-price"><span class="a-offscreen">$24.90</span></span>
                <img class="s-image" src="https://m.media-amazon.com/images/I/71abc._AC_UL320_.jpg">
              </div>
            </div>`);

        const { rendered, cards } = extractSearchCards();

        expect(rendered).toBe(true);
        expect(cards).toHaveLength(1);
        expect(cards[0]).toMatchObject({
            asin: "B00006JSUA",
            title: "Lodge 10.25 Inch Cast Iron Skillet",
            rating: 4.7,
            review_count: 144790,
            price: 24.9,
            sponsored: false,
        });
    });

    it("flags sponsored placements however amazon labels them", () => {
        render(`
            <div class="s-main-slot">
              <div data-component-type="s-search-result" data-asin="B00000001">
                <span class="puis-sponsored-label-text">Sponsored</span>
                <h2><span>A paid listing</span></h2>
              </div>
              <div data-component-type="s-search-result" data-asin="B00000002">
                <h2><a aria-label="Sponsored Ad - Another paid listing"><span>Another paid listing</span></a></h2>
              </div>
              <div data-component-type="s-search-result" data-asin="B00000003">
                <h2><span>Sponsored Ad - A third one</span></h2>
              </div>
            </div>`);

        const { cards } = extractSearchCards();

        expect(cards.map((card) => card.sponsored)).toEqual([true, true, true]);
        expect(cards[2].title).toBe("A third one");
    });

    it("distinguishes a throttled response from a genuinely empty result page", () => {
        render(`<div class="s-main-slot"></div>`);
        expect(extractSearchCards()).toMatchObject({ rendered: true, cards: [] });

        render(`<div></div>`);
        expect(extractSearchCards()).toMatchObject({ rendered: false, cards: [] });
    });
});

describe("extractProduct", () => {
    it("reads the core fields off a detail page", () => {
        render(`
            <div id="centerCol">
              <span id="productTitle">Lodge 10.25 Inch Cast Iron Skillet</span>
              <a id="bylineInfo">Visit the Lodge Store</a>
              <div id="corePrice_feature_div">
                <span class="a-price"><span class="a-offscreen">$24.90</span></span>
              </div>
              <span id="acrPopover" title="4.7 out of 5 stars"></span>
              <span id="acrCustomerReviewText">144,790 ratings</span>
              <div id="availability">In Stock</div>
              <i class="a-icon-prime"></i>
            </div>
            <div id="feature-bullets">
              <li><span class="a-list-item">Pre-seasoned and ready to use</span></li>
              <li><span class="a-list-item">Made in the USA</span></li>
            </div>`);

        const d = extractProduct();

        expect(d.title).toBe("Lodge 10.25 Inch Cast Iron Skillet");
        expect(d.brand).toBe("Visit the Lodge Store");
        expect(d.priceText).toBe("$24.90");
        expect(d.rating).toBe(4.7);
        expect(d.reviewCount).toBe(144790);
        expect(d.availability).toBe("In Stock");
        expect(d.isPrime).toBe(true);
        expect(d.bullets).toEqual(["Pre-seasoned and ready to use", "Made in the USA"]);
    });

    it("never takes a price from a sponsored carousel", () => {
        render(`
            <div id="centerCol">
              <span id="productTitle">An unbuyable product</span>
              <div id="availability">Currently unavailable</div>
            </div>
            <div id="sponsoredProducts">
              <span class="a-price"><span class="a-offscreen">$999.00</span></span>
            </div>
            <table id="HLCXComparisonTable">
              <span class="a-price"><span class="a-offscreen">$888.00</span></span>
            </table>`);

        const d = extractProduct();

        expect(d.priceText).toBeNull();
        expect(d.availability).toBe("Currently unavailable");
    });

    it("picks the largest image out of the gallery map", () => {
        render(`
            <img id="landingImage" src="https://m.media-amazon.com/images/I/small.jpg"
                 data-a-dynamic-image='{"https://m.media-amazon.com/images/I/big.jpg":[1500,1500],"https://m.media-amazon.com/images/I/mid.jpg":[500,500]}'>
            <div id="altImages">
              <img src="https://m.media-amazon.com/images/I/alt1._SS40_.jpg">
              <img src="https://m.media-amazon.com/images/I/play-button.png">
            </div>`);

        const d = extractProduct();

        expect(d.primaryImage).toBe("https://m.media-amazon.com/images/I/big.jpg");
        expect(d.alternateImages).toEqual(["https://m.media-amazon.com/images/I/alt1._SS40_.jpg"]);
    });

    it("survives a malformed gallery map rather than throwing", () => {
        render(`<img id="landingImage" src="https://m.media-amazon.com/images/I/fallback.jpg"
                     data-a-dynamic-image='{not json'>`);

        expect(extractProduct().primaryImage).toBe("https://m.media-amazon.com/images/I/fallback.jpg");
    });

    it("does not return inline script source as availability text", () => {
        render(`<div id="availability"><script>var x = "Out of Stock";</script><span>In Stock</span></div>`);
        expect(extractProduct().availability).not.toMatch(/var x/);
    });
});

describe("extractVariants", () => {
    const twister_script = `
        P.register('twister-js-init-mason-dp', function() {
          var dataToReturn = {
            "parentAsin": "B0000CF3RS",
            "dimensions": ["color_name", "size_name"],
            "variationDisplayLabels": {"color_name": "Colour", "size_name": "Size"},
            "variationValues": {"color_name": ["Black", "Deep Sea Blue"], "size_name": ["8 inch", "10.25 inch"]},
            "selectedVariationValues": {"color_name": 0, "size_name": 1},
            "dimensionValuesDisplayData": {
              "B00006JSUA": ["Black", "8 inch"],
              "B00006JSUB": ["Black", "10.25 inch"],
              "B00006JSUC": ["Deep Sea Blue", "8 inch"]
            }
          };
          return dataToReturn;
        });`;

    it("merges the inline matrix with the rendered swatches", () => {
        render(`
            <script>${twister_script}</script>
            <div id="inline-twister-row-color_name">
              <ul>
                <li data-asin="B00006JSUA" data-initiallyselected="true">
                  <img src="https://m.media-amazon.com/images/I/black._SS64_.jpg" alt="Black">
                  <span class="dimension-slot-info"><span class="a-offscreen">$24.90</span></span>
                </li>
                <li data-asin="B00006JSUC">
                  <img src="https://m.media-amazon.com/images/I/blue._SS64_.jpg" alt="Deep Sea Blue">
                </li>
              </ul>
            </div>`);

        const v = extractVariants();

        expect(v.parentAsin).toBe("B0000CF3RS");
        expect(v.dimensions.map((dimension) => dimension.key)).toEqual(["color_name", "size_name"]);
        expect(v.dimensions[0].label).toBe("Colour");

        const black = v.dimensions[0].values[0];
        expect(black).toMatchObject({
            label: "Black",
            asin: "B00006JSUA",
            price: 24.9,
            thumb: "https://m.media-amazon.com/images/I/black._SS64_.jpg",
            selected: true,
        });
        expect(v.dimensions[0].values[1].price).toBeNull();
    });

    it("expands every child asin with its coordinate on each axis", () => {
        render(`<script>${twister_script}</script>`);

        const v = extractVariants();

        expect(v.combinations).toHaveLength(3);
        expect(v.combinations[0]).toEqual({
            asin: "B00006JSUA",
            values: { color_name: "Black", size_name: "8 inch" },
        });
    });

    it("parses a payload whose values contain braces and escaped quotes", () => {
        render(`<script>
            var d = {
              "dimensions": ["style_name"],
              "variationValues": {"style_name": ["A {weird} \\" name", "Plain"]},
              "dimensionValuesDisplayData": {"B00000001": ["Plain"]}
            };
        </script>`);

        const v = extractVariants();

        expect(v.dimensions[0].values.map((value) => value.label)).toEqual(['A {weird} " name', "Plain"]);
        expect(v.combinations).toHaveLength(1);
    });

    it("returns empty structures for a product with no variants at all", () => {
        render(`<div id="centerCol"><span id="productTitle">A single-variant product</span></div>`);

        const v = extractVariants();

        expect(v.parentAsin).toBeNull();
        expect(v.dimensions).toEqual([]);
        expect(v.combinations).toEqual([]);
    });

    it("falls back to the rendered DOM when the inline payload is missing", () => {
        render(`
            <div id="twister">
              <div id="variation_color_name">
                <span class="a-form-label">Colour:</span>
                <ul>
                  <li data-asin="B00000001"><img src="https://x/red._SS64_.jpg" alt="Red"></li>
                </ul>
              </div>
            </div>`);

        const v = extractVariants();

        expect(v.dimensions).toHaveLength(1);
        expect(v.dimensions[0].key).toBe("color_name");
        expect(v.dimensions[0].values[0].label).toBe("Red");
    });
});
