import { describe, expect, it } from "vitest";
import { DEMO_BLOCK_TYPES } from "@/server/wordpress/pages/demo-registry";
import { checkMarkup, railProblems, shortcodesIn, typeOk } from "./check";
import type { BlockTypeSpec, PageIssue } from "./types";

const REGISTRY: BlockTypeSpec[] = DEMO_BLOCK_TYPES;
const check = (markup: string, reg: BlockTypeSpec[] | null = REGISTRY) => checkMarkup(markup, { registry: reg });
const errors = (issues: PageIssue[]) => issues.filter((i) => i.level === "error");
const kinds = (issues: PageIssue[]) => issues.map((i) => `${i.level}:${i.problem.kind}`);

/** A page as golden-hive-blocks' docs/pages.md builds it: Golden Hive blocks, a group of rails, WordPress's own blocks. */
const VALID = `<!-- wp:golden-hive/hero-carousel {"slides":[{"image":"https://example.com/1.jpg","title":"DROP","buttonUrl":"/drop/"}]} /-->

<!-- wp:golden-hive/trust-badges /-->

<!-- wp:group {"layout":{"type":"constrained","contentSize":"1600px"}} -->
<div class="wp-block-group"><!-- wp:golden-hive/shortcode-wrapper {"eyebrow":"Selezione","title":"IN TENDENZA","shortcode":"[gh_product_rail category='in-tendenza' limit='12' columns='4' ratio='3/4']"} /-->

<!-- wp:golden-hive/shortcode-wrapper {"title":"Nella tua taglia","shortcode":"[gh_size_rail limit='12']"} /--></div>
<!-- /wp:group -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Guida</h2>
<!-- /wp:heading -->

<!-- wp:golden-hive/faq-schema {"items":[{"question":"Reso?","answer":"<p>Sì, entro 14 giorni: \\u0022gratis\\u0022.</p>"}],"className":"is-style-compact"} /-->

<!-- wp:golden-hive/whatsapp-button {"phoneNumber":"390000000000","iconOnly":true} /-->
`;

describe("checkMarkup", () => {
  it("passes a valid page: no errors, no warnings", () => {
    expect(check(VALID)).toEqual([]);
  });

  it("a bare quote inside a value breaks the JSON: an error on that block, with its line", () => {
    const markup = `<!-- wp:paragraph -->\n<p>Ciao</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:golden-hive/cta-banner {"title":"Il "drop" di sabato","buttonText":"Vai"} /-->\n`;
    const issues = check(markup);
    expect(kinds(issues)).toEqual(["error:badJson"]);
    expect(issues[0].at).toMatchObject({ path: [2], name: "golden-hive/cta-banner", line: 5 });
    if (issues[0].problem.kind !== "badJson") throw new Error();
    expect(issues[0].problem.excerpt).toContain('"Il "drop"');
  });

  it("the same value escaped as \\u0022 passes", () => {
    expect(check(`<!-- wp:golden-hive/cta-banner {"title":"Il \\u0022drop\\u0022 di sabato"} /-->`)).toEqual([]);
  });

  it("a golden-hive block the site does not have is an error", () => {
    const issues = check(`<!-- wp:golden-hive/mega-banner {"title":"x"} /-->`);
    expect(kinds(issues)).toEqual(["error:unknownBlock"]);
    expect(issues[0].at?.name).toBe("golden-hive/mega-banner");
  });

  it("an attribute the block does not have is an error, naming the ones it has", () => {
    const issues = check(`<!-- wp:golden-hive/cta-banner {"title":"Saldi","subtitle":"fino al 50%"} /-->`);
    expect(kinds(issues)).toEqual(["error:unknownAttr"]);
    const p = issues[0].problem;
    if (p.kind !== "unknownAttr") throw new Error();
    expect(p.attr).toBe("subtitle");
    expect(p.known).toContain("buttonText");
    expect(p.known).not.toContain("lock");
  });

  it("WordPress's own block supports (className, align, style…) are never unknown", () => {
    expect(check(`<!-- wp:golden-hive/cta-banner {"title":"x","className":"a","align":"full","style":{"spacing":{}},"anchor":"saldi"} /-->`)).toEqual([]);
  });

  it("a value of the wrong type is an error: the number given as text, the boolean as text", () => {
    const issues = check(`<!-- wp:golden-hive/drop-calendar {"limit":"6","showReleased":"true"} /-->`);
    expect(issues.map((i) => i.problem)).toEqual([
      { kind: "wrongType", attr: "limit", expected: ["number"], got: "text" },
      { kind: "wrongType", attr: "showReleased", expected: ["boolean"], got: "text" },
    ]);
  });

  it("a value outside the declared ones is an error", () => {
    const blockWithEnum = REGISTRY.find((b) => Object.values(b.attributes).some((a) => a.enum))!;
    const [attr, spec] = Object.entries(blockWithEnum.attributes).find(([, a]) => a.enum)!;
    const issues = check(`<!-- wp:${blockWithEnum.name} {"${attr}":"nope"} /-->`);
    expect(issues.map((i) => i.problem)).toEqual([{ kind: "notAllowed", attr, allowed: spec.enum!.map((v) => JSON.stringify(v)) }]);
  });

  it("HTML outside any block is a warning (a Classic block), not an error", () => {
    const issues = check(`<p>Benvenuti</p>\n<!-- wp:golden-hive/trust-badges /-->\n`);
    expect(kinds(issues)).toEqual(["warning:freeform"]);
    expect(issues[0].at?.line).toBe(1);
    expect(errors(issues)).toEqual([]);
  });

  it("a closing comment with nothing open: everything after it becomes one Classic block", () => {
    const issues = check(`<!-- wp:golden-hive/trust-badges /-->\n<!-- /wp:group -->\n<!-- wp:golden-hive/store-visit /-->`);
    expect(kinds(issues)).toEqual(["error:strayCloser"]);
    expect(issues[0].at?.line).toBe(2);
  });

  it("a closer naming another block, and a block never closed", () => {
    expect(kinds(check(`<!-- wp:group -->\n<div><!-- wp:paragraph --><p>x</p><!-- /wp:group --></div>\n<!-- /wp:paragraph -->`))).toEqual([
      "error:wrongCloser",
      "error:wrongCloser",
    ]);
    expect(kinds(check(`<!-- wp:group -->\n<div class="wp-block-group"></div>`))).toEqual(["warning:unclosed"]);
  });

  it("HTML written inside a server-drawn block is a warning", () => {
    expect(kinds(check(`<!-- wp:golden-hive/cta-banner {"title":"x"} --><div>Saldi</div><!-- /wp:golden-hive/cta-banner -->`))).toEqual(["warning:innerHtml"]);
  });

  it("without the registry, golden-hive blocks cannot be checked: one error, the rest still checked", () => {
    expect(kinds(check(`<!-- wp:golden-hive/cta-banner {"nope":1} /-->\n<!-- wp:golden-hive/trust-badges {"x":"a"b"} /-->`, null))).toEqual([
      "error:registryUnavailable",
      "error:badJson",
    ]);
    expect(check(`<!-- wp:paragraph -->\n<p>x</p>\n<!-- /wp:paragraph -->`, null)).toEqual([]);
  });

  it("an empty page is refused", () => {
    expect(kinds(check("  \n "))).toEqual(["error:empty"]);
  });

  it("rails: unknown attributes and values are errors; a rail outside a wrapper is a warning", () => {
    const issues = check(
      `<!-- wp:golden-hive/shortcode-wrapper {"shortcode":"[gh_product_rail category='Nike Dunk' colums='4' type='nuovi' limit='0']"} /-->\n` +
        `<!-- wp:shortcode -->\n[gh_product_rail category="saldi"]\n<!-- /wp:shortcode -->`,
    );
    expect(issues.map((i) => i.problem)).toEqual([
      { kind: "railValue", attr: "category", value: "Nike Dunk", rule: "slugs" },
      { kind: "railAttr", shortcode: "gh_product_rail", attr: "colums", known: expect.any(Array) },
      { kind: "railValue", attr: "type", value: "nuovi", rule: "type" },
      { kind: "railValue", attr: "limit", value: "0", rule: "limit" },
      { kind: "railOutsideWrapper" },
    ]);
  });

  it("motion hooks in an HTML block: values the scripts know", () => {
    const issues = check(`<!-- wp:html -->\n<div data-gh-reveal="fade" data-gh-split="lines"><h2 data-gh-reveal>x</h2></div>\n<!-- /wp:html -->`);
    expect(issues.map((i) => i.problem)).toEqual([{ kind: "motion", attr: "data-gh-reveal", value: "fade" }]);
  });

  it("orders errors before warnings, each in page order", () => {
    const issues = check(`<p>loose</p>\n<!-- wp:golden-hive/nope /-->\n<!-- wp:golden-hive/cta-banner {"x":1} /-->`);
    expect(kinds(issues)).toEqual(["error:unknownBlock", "error:unknownAttr", "warning:freeform"]);
    expect(issues.map((i) => i.at?.line)).toEqual([2, 3, 1]);
  });
});

describe("pieces", () => {
  it("typeOk follows JSON schema types", () => {
    expect(typeOk("integer", 3)).toBe(true);
    expect(typeOk("integer", 3.5)).toBe(false);
    expect(typeOk("number", 3.5)).toBe(true);
    expect(typeOk(["string", "null"], null)).toBe(true);
    expect(typeOk("object", [])).toBe(true);
    expect(typeOk("object", [1])).toBe(false);
    expect(typeOk(undefined, "anything")).toBe(true);
  });

  it("shortcodesIn reads quotes of every kind, entities included", () => {
    expect(shortcodesIn("[gh_product_rail category=&quot;saldi&quot; limit=&#8217;6&#8217; fit=cover]")).toEqual([
      { name: "gh_product_rail", atts: { category: "saldi", limit: "6", fit: "cover" } },
    ]);
  });

  it("railProblems accepts what the rail understands", () => {
    expect(railProblems({ ratio: "portrait", fit: "contain", columns_mobile: "2", pin: "12, 13", fallback: "price-desc", brand: "nike,adidas" })).toEqual([]);
  });
});
