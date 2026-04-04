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
  "emu-production",
  "emu-rhs",
];

export interface FormatConfig {
  codeBlocks: {
    block: string[];
    inline: string[];
    grammar: string[];
  };
  links: string[];
  lists: {
    ordered: string[];
    unordered: string[];
  };
  tables: string[];
}

export const DEFAULT_CONFIG: FormatConfig = {
  codeBlocks: {
    block: ["pre>code", "emu-eqn:not([class*='inline'])"],
    inline: ["var", "emu-val", "emu-const", "emu-eqn.inline", "code"],
    grammar: ["emu-grammar"],
  },
  links: ["emu-xref a"],
  lists: {
    ordered: ["ol"],
    unordered: ["ul"],
  },
  tables: ["table", "emu-table"],
};

export function convertLinksToMarkdown(
  $: cheerio.CheerioAPI,
  selector: string = "emu-xref a[href]",
): void {
  $(selector).each((_, elem) => {
    const $a = $(elem);
    const href = $a.attr("href") ?? "";

    // Skip external links
    if (href.startsWith("http")) return;

    // Strip filename prefix: "abstract-operations.html#sec-tonumber" → "#sec-tonumber"
    const hash = href.includes("#") ? `#${href.split("#")[1]}` : href;
    const text = $a.text().trim();

    if (!text || !hash) return;

    $a.replaceWith($(`<span class="link-markdown">[${text}](${hash})</span>`));
  });
}

export function convertInlineCodeToMarkdown(
  $: cheerio.CheerioAPI,
  tags: string[],
): void {
  for (const tag of tags) {
    $(tag).each((_, elem) => {
      // Skip <code> inside <pre> (handled by block converter)
      if (
        "name" in elem &&
        elem.name === "code" &&
        $(elem).parent("pre").length > 0
      )
        return;

      const text = $(elem).text().trim();
      if (!text) return;
      $(elem).replaceWith($(`<span class="inline-code">\`${text}\`</span>`));
    });
  }
}

function extractLanguage(codeClass: string | undefined): string {
  // "javascript hljs" → "javascript", "python hljs" → "python"
  if (!codeClass) return "";
  const match = codeClass.match(/^(\w+)/);
  return match?.[1] ?? "";
}

export function convertBlockCodeToMarkdown(
  $: cheerio.CheerioAPI,
  tags: string[],
): void {
  const selectors = tags.join(", ");
  if (!selectors) return;

  $(selectors).each((_, elem) => {
    const $elem = $(elem);
    const lang = extractLanguage($elem.attr("class"));
    const text = $elem.text().trim();
    $elem.replaceWith(
      $(`<pre class="code-markdown">\`\`\`${lang}\n${text}\n\`\`\`</pre>`),
    );
  });
}

function listToMarkdown(
  $: cheerio.CheerioAPI,
  elem: any,
  depth: number = 0,
): string {
  const $elem = $(elem);
  const isOrdered = elem.name === "ol";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  $elem.children("li").each((i, li) => {
    const prefix = isOrdered ? `${i + 1}. ` : "- ";
    const $li = $(li);

    const nestedLists: string[] = [];

    // Recurse into nested lists first (depth-first)
    $li.children("ol, ul").each((_, nested) => {
      const nestedMarkdown = listToMarkdown($, nested, depth + 1);
      nestedLists.push(nestedMarkdown);
      $(nested).remove();
    });

    // Now get full text
    const itemText = $li.text().trim().replace(/\s+/g, " ");
    lines.push(`${indent}${prefix}${itemText}`);

    for (const nested of nestedLists) {
      lines.push(nested);
    }
  });

  return lines.join("\n");
}

export function convertListsToMarkdown(
  $: cheerio.CheerioAPI,
  ordered: string[] = ["ol"],
  unordered: string[] = ["ul"],
): void {
  const selectors = [...ordered, ...unordered].join(", ");
  if (!selectors) return;

  // Process from outermost — recursion handles depth-first nesting
  $(selectors).each((_, elem) => {
    // Skip if already processed (parent already handled this)
    if ($(elem).hasClass("list-markdown") || $(elem).hasClass("list-processed"))
      return;
    const markdown = listToMarkdown($, elem, 0);
    $(elem).replaceWith($(`<pre class="list-markdown">\n${markdown}\n</pre>`));
  });
}

export function convertGrammarToMarkdown(
  $: cheerio.CheerioAPI,
  selector: string = "emu-grammar",
): void {
  if (!selector) return;
  $(selector).each((_, grammar) => {
    const text = $(grammar).text().trim();
    $(grammar).replaceWith(
      $(`<pre class="code-markdown">\`\`\`bnf\n${text}\n\`\`\`</pre>`),
    );
  });
}

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
    $table.replaceWith($(`<pre class="table-markdown">\n${markdown}\n</pre>`));
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

export function formatForIngestion(
  $: cheerio.CheerioAPI,
  config: Partial<FormatConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 1. Inject newlines globally (affects li, p, pre, emu-production, emu-rhs, etc.)
  addNewlinesAfterBlocks($);

  // 2. Inline leaves (links first — must be before lists/code destroy DOM)
  convertLinksToMarkdown($, cfg.links.join(", "));

  // 3. Inline code
  convertInlineCodeToMarkdown($, cfg.codeBlocks.inline);

  // 4. Block leaves (fenced code)
  convertBlockCodeToMarkdown($, cfg.codeBlocks.block);

  // 5. Structural parents (grammar, lists, tables)
  convertGrammarToMarkdown($, cfg.codeBlocks.grammar.join(", "));
  convertListsToMarkdown($, cfg.lists.ordered, cfg.lists.unordered);
  convertTablesToMarkdown($);
}
