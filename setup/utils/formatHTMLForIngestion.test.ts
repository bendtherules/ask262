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
  test("convertLinksToMarkdown converts emu-xref links to markdown and strips filenames", () => {
    const html = `<emu-xref href="abstract-operations.html#sec-tonumber"><a href="abstract-operations.html#sec-tonumber">ToNumber</a></emu-xref>`;
    const $ = cheerio.load(html);
    convertLinksToMarkdown($, DEFAULT_CONFIG.links.join(", "));
    expect($.html()).toContain(
      '<span class="link-markdown">[ToNumber](#sec-tonumber)</span>',
    );
  });

  test("convertLinksToMarkdown skips external links", () => {
    const html = `<emu-xref href="https://example.com"><a href="https://example.com">External</a></emu-xref>`;
    const $ = cheerio.load(html);
    convertLinksToMarkdown($, DEFAULT_CONFIG.links.join(", "));
    expect($.html()).toContain('<a href="https://example.com">External</a>');
  });

  test("convertInlineCodeToMarkdown converts var, emu-val, emu-const to inline code", () => {
    const html = `<div><var>x</var> <emu-val>y</emu-val> <emu-const>z</emu-const> <code>w</code></div>`;
    const $ = cheerio.load(html);
    convertInlineCodeToMarkdown($, DEFAULT_CONFIG.codeBlocks.inline);
    expect($.html()).toContain('<span class="inline-code">`x`</span>');
    expect($.html()).toContain('<span class="inline-code">`y`</span>');
    expect($.html()).toContain('<span class="inline-code">`z`</span>');
    expect($.html()).toContain('<span class="inline-code">`w`</span>');
  });

  test("convertInlineCodeToMarkdown skips code inside pre", () => {
    const html = `<pre><code>x</code></pre>`;
    const $ = cheerio.load(html);
    convertInlineCodeToMarkdown($, DEFAULT_CONFIG.codeBlocks.inline);
    expect($.html()).toContain("<pre><code>x</code></pre>"); // unchanged
  });

  test("convertBlockCodeToMarkdown converts pre>code and emu-eqn", () => {
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
    expect($.html()).toContain('<emu-eqn class="inline">z = 2</emu-eqn>'); // unchanged
  });

  test("convertGrammarToMarkdown converts emu-grammar to fenced bnf", () => {
    const html = `<emu-grammar>Statement :: BlockStatement</emu-grammar>`;
    const $ = cheerio.load(html);
    convertGrammarToMarkdown($, DEFAULT_CONFIG.codeBlocks.grammar.join(", "));
    expect($.html()).toContain(
      '<pre class="code-markdown">```bnf\nStatement :: BlockStatement\n```</pre>',
    );
  });

  test("convertListsToMarkdown converts ol and ul with nesting to markdown lists", () => {
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
    const result = $("pre.list-markdown").text();
    expect(result).toContain("- Item 1");
    expect(result).toContain("- Item 2");
    expect(result).toContain("  1. Subitem 1");
    expect(result).toContain("  2. Subitem 2");
  });

  test("convertTablesToMarkdown converts tables to markdown tables", () => {
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

  test("formatForIngestion runs the full pipeline", () => {
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

    // Check links
    expect($.html()).toContain(
      '<span class="link-markdown">[Example](#sec-example)</span>',
    );
    // Check inline code
    expect($.html()).toContain('<span class="inline-code">`x`</span>');
    // Check block code
    expect($.html()).toContain(
      '<pre class="code-markdown">```javascript\nlet y = x;\n```</pre>',
    );
    // Check lists
    expect($.html()).toContain(
      '<pre class="list-markdown">- One\n- Two\n</pre>',
    );
  });
});
