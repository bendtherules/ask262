import { describe, expect, test } from "bun:test";
import * as cheerio from "cheerio";
import {
  convertBlockCodeToMarkdown,
  convertGrammarToMarkdown,
  convertInlineCodeToMarkdown,
  convertLinksToMarkdown,
  convertListsToMarkdown,
  convertTablesToMarkdown,
  DEFAULT_CONFIG,
  formatForIngestion,
} from "./formatHTMLForIngestion";

describe("formatHTMLForIngestion", () => {
  describe("convertLinksToMarkdown", () => {
    test("converts emu-xref links to markdown and strips filenames", () => {
      const html = `<emu-xref href="abstract-operations.html#sec-tonumber"><a href="abstract-operations.html#sec-tonumber">ToNumber</a></emu-xref>`;
      const $ = cheerio.load(html);
      convertLinksToMarkdown($, DEFAULT_CONFIG.links.join(", "));
      expect($.html()).toContain(
        '<span class="link-markdown">[ToNumber](#sec-tonumber)</span>',
      );
    });

    test("skips external links", () => {
      const html = `<emu-xref href="https://example.com"><a href="https://example.com">External</a></emu-xref>`;
      const $ = cheerio.load(html);
      convertLinksToMarkdown($, DEFAULT_CONFIG.links.join(", "));
      expect($.html()).toContain('<a href="https://example.com">External</a>');
    });
  });

  describe("convertInlineCodeToMarkdown", () => {
    test("converts var, emu-val, emu-const to inline code", () => {
      const html = `<div><var>x</var> <emu-val>y</emu-val> <emu-const>z</emu-const> <code>w</code></div>`;
      const $ = cheerio.load(html);
      convertInlineCodeToMarkdown($, DEFAULT_CONFIG.codeBlocks.inline);
      expect($.html()).toContain('<span class="inline-code">`x`</span>');
      expect($.html()).toContain('<span class="inline-code">`y`</span>');
      expect($.html()).toContain('<span class="inline-code">`z`</span>');
      expect($.html()).toContain('<span class="inline-code">`w`</span>');
    });

    test("skips code inside pre", () => {
      const html = `<pre><code>x</code></pre>`;
      const $ = cheerio.load(html);
      convertInlineCodeToMarkdown($, DEFAULT_CONFIG.codeBlocks.inline);
      expect($.html()).toContain("<pre><code>x</code></pre>");
    });
  });

  describe("convertBlockCodeToMarkdown", () => {
    test("converts pre>code and emu-eqn", () => {
      const html = `<div>
        <pre><code class="javascript hljs">const x = 1;</code></pre>
        <emu-eqn>y = x + 1</emu-eqn>
        <emu-eqn class="inline">z = 2</emu-eqn>
      </div>`;
      const $ = cheerio.load(html);
      convertBlockCodeToMarkdown($, DEFAULT_CONFIG.codeBlocks.block);
      expect($.html()).toContain(
        '<pre class="code-markdown">```javascript\nconst x = 1;\n```</pre>',
      );
      expect($.html()).toContain(
        '<pre class="code-markdown">```\ny = x + 1\n```</pre>',
      );
      expect($.html()).toContain('<emu-eqn class="inline">z = 2</emu-eqn>');
    });
  });

  describe("convertGrammarToMarkdown", () => {
    test("converts emu-grammar to fenced bnf", () => {
      const html = `<emu-grammar>Statement :: BlockStatement</emu-grammar>`;
      const $ = cheerio.load(html);
      convertGrammarToMarkdown($, DEFAULT_CONFIG.codeBlocks.grammar.join(", "));
      expect($.html()).toContain(
        '<pre class="code-markdown">```bnf\nStatement :: BlockStatement\n```</pre>',
      );
    });
  });

  describe("convertListsToMarkdown", () => {
    test("converts ul with nested ol", () => {
      const html = `
        <ul>
          <li>Item 1</li>
          <li>Item 2
            <ol>
              <li>Subitem 1</li>
              <li>Subitem 2</li>
            </ol>
          </li>
        </ul>
      `;
      const $ = cheerio.load(html);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual([
        "- Item 1",
        "- Item 2",
        "  A. Subitem 1",
        "  B. Subitem 2",
      ]);
    });

    test("handles 3-level deep nesting (ol > ul > ol)", () => {
      const html = `
        <ol>
          <li>First</li>
          <li>Second
            <ul>
              <li>Alpha
                <ol>
                  <li>Deep 1</li>
                  <li>Deep 2</li>
                </ol>
              </li>
              <li>Beta</li>
            </ul>
          </li>
        </ol>
      `;
      const $ = cheerio.load(html);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual([
        "1. First",
        "2. Second",
        "  * Alpha",
        "    1. Deep 1",
        "    2. Deep 2",
        "  * Beta",
      ]);
    });

    test("handles multiple sibling nested lists in one item", () => {
      const html = `
        <ul>
          <li>Item
            <ol>
              <li>Ordered sub</li>
            </ol>
            <ul>
              <li>Unordered sub</li>
            </ul>
          </li>
        </ul>
      `;
      const $ = cheerio.load(html);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual([
        "- Item",
        "  A. Ordered sub",
        "  * Unordered sub",
      ]);
    });

    test("handles consecutive top-level lists", () => {
      const html = `
        <ul>
          <li>UL item 1</li>
          <li>UL item 2</li>
        </ul>
        <ol>
          <li>OL item 1</li>
          <li>OL item 2</li>
        </ol>
      `;
      const $ = cheerio.load(html);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const results = $("pre.list-markdown");
      expect(results.length).toBe(2);

      const ulLines = results
        .eq(0)
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(ulLines).toEqual(["- UL item 1", "- UL item 2"]);

      const olLines = results
        .eq(1)
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(olLines).toEqual(["1. OL item 1", "2. OL item 2"]);
    });

    test("preserves inline code inside list items", () => {
      const html = `
        <ul>
          <li>Call <code>foo()</code></li>
          <li>Use <var>x</var></li>
        </ul>
      `;
      const $ = cheerio.load(html);
      convertInlineCodeToMarkdown($, DEFAULT_CONFIG.codeBlocks.inline);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual(["- Call `foo()`", "- Use `x`"]);
    });

    test("handles ol nested inside ol", () => {
      const html = `
        <ol>
          <li>First
            <ol>
              <li>Nested 1</li>
              <li>Nested 2</li>
            </ol>
          </li>
          <li>Second</li>
        </ol>
      `;
      const $ = cheerio.load(html);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual([
        "1. First",
        "  A. Nested 1",
        "  B. Nested 2",
        "2. Second",
      ]);
    });

    test("handles empty list", () => {
      const html = `<ul></ul>`;
      const $ = cheerio.load(html);
      convertListsToMarkdown(
        $,
        DEFAULT_CONFIG.lists.ordered,
        DEFAULT_CONFIG.lists.unordered,
      );
      const result = $("pre.list-markdown").text().trim();
      expect(result).toBe("");
    });
  });

  describe("convertTablesToMarkdown", () => {
    test("converts tables to markdown tables", () => {
      const html = `
        <table>
          <thead>
            <tr><th>Col 1</th><th>Col 2</th></tr>
          </thead>
          <tbody>
            <tr><td>Data 1</td><td>Data 2</td></tr>
          </tbody>
        </table>
      `;
      const $ = cheerio.load(html);
      convertTablesToMarkdown($);
      const result = $("pre.table-markdown").text();
      expect(result).toContain("| Col 1 | Col 2 |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Data 1 | Data 2 |");
    });
  });

  describe("formatForIngestion", () => {
    test("runs the full pipeline", () => {
      const html = `
        <div>
          <p>See <emu-xref href="#sec-example"><a href="#sec-example">Example</a></emu-xref> for <var>x</var></p>
          <pre><code class="javascript">let y = x;</code></pre>
          <ul>
            <li>One</li>
            <li>Two</li>
          </ul>
        </div>
      `;
      const $ = cheerio.load(html);
      formatForIngestion($);

      expect($.html()).toContain(
        '<span class="link-markdown">[Example](#sec-example)</span>',
      );
      expect($.html()).toContain('<span class="inline-code">`x`</span>');
      expect($.html()).toContain(
        '<pre class="code-markdown">```javascript\nlet y = x;\n```</pre>',
      );
      expect($.html()).toContain(
        '<pre class="list-markdown">- One\n- Two\n</pre>',
      );
    });

    test("preserves nested list indentation through the full pipeline", () => {
      const html = `
        <ol>
          <li>First</li>
          <li>Second
            <ul>
              <li>Alpha
                <ol>
                  <li>Deep 1</li>
                  <li>Deep 2</li>
                </ol>
              </li>
              <li>Beta</li>
            </ul>
          </li>
        </ol>
      `;
      const $ = cheerio.load(html);
      formatForIngestion($);

      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual([
        "1. First",
        "2. Second",
        "  * Alpha",
        "    1. Deep 1",
        "    2. Deep 2",
        "  * Beta",
      ]);
    });

    test("preserves ol nested inside ol through the full pipeline", () => {
      const html = `
        <ol>
          <li>First
            <ol>
              <li>Nested 1</li>
              <li>Nested 2</li>
            </ol>
          </li>
          <li>Second</li>
        </ol>
      `;
      const $ = cheerio.load(html);
      formatForIngestion($);

      const lines = $("pre.list-markdown")
        .text()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toEqual([
        "1. First",
        "  A. Nested 1",
        "  B. Nested 2",
        "2. Second",
      ]);
    });
  });
});
