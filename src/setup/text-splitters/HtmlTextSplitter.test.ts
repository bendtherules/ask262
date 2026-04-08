import { describe, expect, test } from "bun:test";
import { Document } from "@langchain/core/documents";
import { HTMLTextSplitter } from "./index";

describe("HTMLTextSplitter", () => {
  test("keeps small HTML in a single chunk", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 64,
      separators: ["h2"],
    });

    const chunks = await splitter.splitText(
      "<section><h2>Title</h2><p>Short body text</p></section>",
    );

    expect(chunks).toEqual(["Title\nShort body text"]);
  });

  test("does not add synthetic spaces between inline tags", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 64,
    });

    const chunks = await splitter.splitText(
      "<p><span>Hello</span><span>World</span></p>",
    );

    expect(chunks).toEqual(["HelloWorld"]);
  });

  test("preserves authored whitespace between inline tags", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 64,
    });

    const chunks = await splitter.splitText(
      "<p><span>Hello </span><span>World</span></p>",
    );

    expect(chunks).toEqual(["Hello World"]);
  });

  test("adds spacing between adjacent block-ish tags", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 64,
    });

    const chunks = await splitter.splitText("<div>Hello</div><div>World</div>");

    expect(chunks).toEqual(["Hello\nWorld"]);
  });

  test("preserves whitespace as-is from HTML text content", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 64,
    });

    const chunks = await splitter.splitText(
      "<div>  Hello\n\n   World  </div><div>Again</div>",
    );

    expect(chunks).toEqual(["Hello\n\n   World  \nAgain"]);
  });

  test("treats separators as soft hints until size pressure exists", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 18,
      separators: ["h2"],
    });

    const chunks = await splitter.splitText(
      [
        "<section>",
        "<p>Intro text</p>",
        "<h2>Section Title</h2>",
        "<p>Body text</p>",
        "</section>",
      ].join(""),
    );

    expect(chunks).toEqual(["Intro text", "Section Title\nBody text"]);
  });

  test("groups consecutive separators into later section boundaries", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 4,
      separators: ["h2", "h3"],
    });

    const chunks = await splitter.splitText(
      "<section><h2>A</h2><h3>B</h3><p>Body</p></section>",
    );

    expect(chunks).toEqual(["A", "B\nBody"]);
  });

  test("keeps protected content intact up to maxChunkSize", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 10,
      maxChunkSize: 32,
      neverBreakWithin: ["pre"],
    });

    const chunks = await splitter.splitText(
      "<div><pre>12345678901234567890</pre></div>",
    );

    expect(chunks).toEqual(["12345678901234567890"]);
  });

  test("recurses into protected nodes once maxChunkSize is exceeded", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 12,
      maxChunkSize: 18,
      neverBreakWithin: [".keep"],
      separators: ["p"],
    });

    const chunks = await splitter.splitText(
      [
        '<div class="keep">',
        "<p>Alpha beta</p>",
        "<p>Gamma delta</p>",
        "</div>",
      ].join(""),
    );

    expect(chunks).toEqual(["Alpha beta", "Gamma delta"]);
  });

  test("ignores separators inside protected subtrees until forced open", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 10,
      maxChunkSize: 40,
      neverBreakWithin: [".keep"],
      separators: ["h2"],
    });

    const chunks = await splitter.splitText(
      '<div class="keep"><h2>Title</h2><p>Body text</p></div>',
    );

    expect(chunks).toEqual(["Title\nBody text"]);
  });

  test("force-splits oversized leaf text when maxChunkSize is finite", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 12,
      maxChunkSize: 15,
    });

    const chunks = await splitter.splitText(`<pre>${"a".repeat(35)}</pre>`);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(15);
    }
  });

  test("force-splits protected oversized leaf text when maxChunkSize is finite", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 12,
      maxChunkSize: 15,
      neverBreakWithin: ["pre"],
    });

    const chunks = await splitter.splitText(`<pre>${"x".repeat(35)}</pre>`);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(15);
    }
  });

  test("does not enforce a hard cap when maxChunkSize is omitted", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 12,
      neverBreakWithin: ["pre"],
    });

    const chunks = await splitter.splitText(`<pre>${"a".repeat(35)}</pre>`);

    expect(chunks).toEqual(["a".repeat(35)]);
  });

  test("splits plain text input without HTML structure", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 8,
      maxChunkSize: 8,
    });

    const chunks = await splitter.splitText("alpha beta gamma");

    expect(chunks).toEqual(["alpha", "beta", "gamma"]);
  });

  test("preserves metadata and adds per-document part indexes", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 18,
      separators: ["h2"],
    });

    const documents = await splitter.splitDocuments([
      new Document({
        pageContent:
          "<section><p>Intro text</p><h2>Section Title</h2><p>Body text</p></section>",
        metadata: { source: "sample.html" },
      }),
    ]);

    expect(documents).toHaveLength(2);
    expect(documents[0].pageContent).toBe("Intro text");
    expect(documents[0].metadata).toMatchObject({
      source: "sample.html",
      partindex: 0,
      totalparts: 2,
    });
    expect(documents[1].pageContent).toBe("Section Title\nBody text");
    expect(documents[1].metadata).toMatchObject({
      source: "sample.html",
      partindex: 1,
      totalparts: 2,
    });
  });

  test("prepends chunkHeader in splitDocuments output", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 18,
      separators: ["h2"],
    });

    const documents = await splitter.splitDocuments(
      [
        new Document({
          pageContent:
            "<section><p>Intro text</p><h2>Section Title</h2><p>Body text</p></section>",
          metadata: { source: "sample.html" },
        }),
      ],
      {
        chunkHeader: "Header: ",
      },
    );

    expect(documents).toHaveLength(2);
    expect(documents[0].pageContent).toBe("Header: Intro text");
    expect(documents[1].pageContent).toBe("Header: Section Title\nBody text");
  });

  test("returns no documents when source content produces no chunks", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 18,
    });

    const documents = await splitter.splitDocuments([
      new Document({
        pageContent: "<div>   </div>",
        metadata: { source: "empty.html" },
      }),
    ]);

    expect(documents).toEqual([]);
  });

  test("resets part metadata per input document", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 18,
      separators: ["h2"],
    });

    const documents = await splitter.splitDocuments([
      new Document({
        pageContent:
          "<section><p>Intro text</p><h2>Section Title</h2><p>Body text</p></section>",
        metadata: { source: "first.html" },
      }),
      new Document({
        pageContent:
          "<section><p>Lead text</p><h2>Second Title</h2><p>More text</p></section>",
        metadata: { source: "second.html" },
      }),
    ]);

    expect(documents).toHaveLength(4);
    expect(documents[0].metadata).toMatchObject({
      source: "first.html",
      partindex: 0,
      totalparts: 2,
    });
    expect(documents[1].metadata).toMatchObject({
      source: "first.html",
      partindex: 1,
      totalparts: 2,
    });
    expect(documents[2].metadata).toMatchObject({
      source: "second.html",
      partindex: 0,
      totalparts: 2,
    });
    expect(documents[3].metadata).toMatchObject({
      source: "second.html",
      partindex: 1,
      totalparts: 2,
    });
  });

  test("rejects chunkOverlap", () => {
    expect(
      () =>
        new HTMLTextSplitter({
          chunkSize: 32,
          chunkOverlap: 4,
        }),
    ).toThrow("does not support chunkOverlap");
  });

  test("keeps adjacent inline text contiguous when no whitespace exists", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 100,
    });

    const chunks = await splitter.splitText(
      "<span>alpha</span><span>bet</span><span>gamma</span>",
    );

    expect(chunks).toEqual(["alphabetgamma"]);
  });

  test("preserves nested list indentation from formatForIngestion output", async () => {
    const splitter = new HTMLTextSplitter({
      chunkSize: 200,
    });

    const html = [
      '<pre class="list-markdown">',
      "1. First",
      "  A. Nested 1",
      "  B. Nested 2",
      "2. Second",
      "</pre>",
    ].join("\n");

    const chunks = await splitter.splitText(html);

    expect(chunks).toEqual([
      "1. First\n  A. Nested 1\n  B. Nested 2\n2. Second",
    ]);
  });
});
