import type * as cheerio from "cheerio";

/**
 * List of block-level HTML elements that should have newlines added after them
 * to preserve document structure during text extraction.
 */
export const BLOCK_ELEMENTS = [
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "th",
  "pre",
  "blockquote",
  "section",
  "emu-clause",
  "emu-note",
  "emu-example",
  "emu-table",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
];

/**
 * Converts HTML tables to markdown table format.
 * This preserves table structure when extracting text from HTML.
 * Replaces the original table with a <pre> element containing the markdown.
 *
 * @param $ - Cheerio API instance
 */
export function convertTablesToMarkdown($: cheerio.CheerioAPI): void {
  $("table, emu-table").each((_, tableElem) => {
    const $table = $(tableElem);
    const rows: string[][] = [];

    // Extract header rows
    $table.find("thead tr").each((_, rowElem) => {
      const row: string[] = [];
      $(rowElem)
        .find("th, td")
        .each((_, cellElem) => {
          row.push($(cellElem).text().trim().replace(/\|/g, "\\|"));
        });
      if (row.length > 0) rows.push(row);
    });

    // Extract body rows
    $table.find("tbody tr, tr").each((_, rowElem) => {
      // Skip if already processed as header
      if ($(rowElem).parent("thead").length > 0) return;

      const row: string[] = [];
      $(rowElem)
        .find("td, th")
        .each((_, cellElem) => {
          row.push($(cellElem).text().trim().replace(/\|/g, "\\|"));
        });
      if (row.length > 0) rows.push(row);
    });

    if (rows.length === 0) return;

    // Determine max columns
    const maxCols = Math.max(...rows.map((r) => r.length));

    // Build markdown table
    const mdLines: string[] = [];

    // Header row
    if (rows.length > 0) {
      const header = rows[0].concat(Array(maxCols - rows[0].length).fill(""));
      mdLines.push("| " + header.join(" | ") + " |");
    }

    // Separator
    mdLines.push("|" + Array(maxCols).fill(" --- ").join("|") + "|");

    // Data rows (skip header if we have more rows)
    const dataRows = rows.length > 1 ? rows.slice(1) : [];
    for (const row of dataRows) {
      const padded = row.concat(Array(maxCols - row.length).fill(""));
      mdLines.push("| " + padded.join(" | ") + " |");
    }

    // Replace table with markdown
    const markdown = mdLines.join("\n");
    $table.replaceWith($(`<pre class="table-markdown">${markdown}</pre>`));
  });
}

/**
 * Adds newlines after specified block elements to preserve document structure.
 * This helps text splitters maintain paragraph/section boundaries.
 *
 * @param $ - Cheerio API instance
 * @param elements - Array of element tag names to add newlines after
 */
export function addNewlinesAfterBlocks(
  $: cheerio.CheerioAPI,
  elements: string[] = BLOCK_ELEMENTS,
): void {
  for (const tag of elements) {
    $.root()
      .find(tag)
      .each((_, el) => {
        $(el).append("\n");
      });
  }
}
