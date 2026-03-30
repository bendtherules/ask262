#!/usr/bin/env bun
import type { CheerioAPI } from "cheerio";
import * as cheerio from "cheerio";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

// Resolve the path to the HTML file (relative to repo root)
const htmlUrl = new URL(
  "../spec-built/multipage/ecmascript-data-types-and-values.html",
  import.meta.url,
);
const htmlPath = fileURLToPath(htmlUrl);

// Load and parse the HTML
const htmlString = readFileSync(htmlPath, "utf-8");
const htmlCheerioApi = cheerio.load(htmlString);

/**
 * Script to add unique `id` attributes to internal method links.
 *
 * It scans the ECMA spec HTML tables `#table-essential-internal-methods`
 * and `#table-additional-essential-internal-methods-of-function-objects`
 * and adds an `id` to the first `<var class="field">` element found in
 * the first `<td>` of each row. The generated id follows the pattern:
 * `ask262-internal-method-<methodName>` where `<methodName>` is the text
 * content of the `<var>` element with surrounding brackets stripped.
 * 
 * @param $ - The Cheerio parsing instance.
 */
function addInternalMethodIds($: CheerioAPI): void {
  // Find the first <var class="field"> inside the first <td> of each row
  // in the two internal‑method tables and add a unique `id` attribute.
  $(
    "#table-essential-internal-methods tr > td:first-child, " +
      "#table-additional-essential-internal-methods-of-function-objects tr > td:first-child",
  ).each((_, td: any) => {
    const $td = $(td);
    const $var = $td.find("var.field").first();
    if ($var.length) {
      const rawText = $var.text().trim();
      // Remove any square brackets from the extracted text
      const text = rawText.replace(/[[\]]/g, "");
      const id = `ask262-internal-method-${text}`;
      $var.attr("id", id);
    }
  });
}

// Execute core logic
addInternalMethodIds(htmlCheerioApi);

// Write the updated HTML back
writeFileSync(htmlPath, htmlCheerioApi.html(), "utf-8");
console.log(
  `Updated ${htmlPath} – added id attributes to <var class="field"> elements.`,
);
