import { Document } from "@langchain/core/documents";
import {
  RecursiveCharacterTextSplitter,
  TextSplitter,
  type TextSplitterChunkHeaderOptions,
  type TextSplitterParams,
} from "@langchain/textsplitters";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export interface HTMLTextSplitterParams extends TextSplitterParams {
  /**
   * CSS selectors that act as preferred structural split points.
   * They are only used when a subtree needs to be broken down.
   */
  separators?: string[];

  /**
   * CSS selectors for nodes that should stay atomic unless maxChunkSize forces recursion.
   */
  neverBreakWithin?: string[];

  /**
   * Absolute hard limit for chunk text length.
   * Defaults to Infinity if omitted.
   */
  maxChunkSize?: number;
}

interface Segment {
  text: string;
  isProtected: boolean;
  sourceKind: "node" | "forced-split";
}

const BLOCKISH_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "emu-clause",
  "emu-example",
  "emu-grammar",
  "emu-note",
  "emu-table",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

/**
 * Splits HTML input into normalized text chunks.
 *
 * Important: this splitter does not preserve HTML markup in output.
 * It uses parsed HTML structure for traversal and sizing, but emits text only.
 *
 * @example
 * ```ts
 * const splitter = new HTMLTextSplitter({
 *   chunkSize: 32,
 *   separators: ["h2"],
 *   neverBreakWithin: ["pre"],
 * });
 *
 * const chunks = await splitter.splitText(
 *   "<section><h2>Title</h2><p>Body</p></section>",
 * );
 * // => ["Title Body"]
 * ```
 */
export class HTMLTextSplitter extends TextSplitter {
  separators: string[];
  neverBreakWithin: string[];
  maxChunkSize: number;

  constructor(fields?: Partial<HTMLTextSplitterParams>) {
    if ((fields?.chunkOverlap ?? 0) !== 0) {
      throw new Error("HTMLTextSplitter does not support chunkOverlap.");
    }

    super({
      ...fields,
      chunkOverlap: 0,
      keepSeparator: false,
      lengthFunction: (text: string) => text.trim().length,
    });

    this.separators = fields?.separators ?? [];
    this.neverBreakWithin = fields?.neverBreakWithin ?? [];
    this.maxChunkSize = fields?.maxChunkSize ?? Number.POSITIVE_INFINITY;
  }

  /**
   * Splits HTML input into normalized text chunks.
   *
   * Important: this method emits text only. HTML markup is used for traversal
   * and sizing, but is not preserved in returned chunks.
   */
  async splitText(text: string): Promise<string[]> {
    const $ = cheerio.load(text);
    const rootNodes =
      $("body").length > 0
        ? $("body").contents().toArray()
        : $.root().contents().toArray();
    const roots = this.getMeaningfulNodes(rootNodes);

    if (roots.length === 0) {
      return [];
    }

    const rootGroups = this.groupChildrenForDecomposition($, roots, false);
    const segments: Segment[] = [];

    for (const group of rootGroups) {
      segments.push(...(await this.collectSegmentsFromNodes($, group, false)));
    }

    return this.mergeSegments(segments);
  }

  /**
   * Splits HTML documents into text-only child documents.
   *
   * Important: child document `pageContent` contains normalized text, not HTML.
   * Parent metadata is preserved and per-document part metadata is added.
   */
  async splitDocuments(
    documents: Document[],
    chunkHeaderOptions?: TextSplitterChunkHeaderOptions,
  ): Promise<Document[]> {
    const splitDocs: Document[] = [];
    const chunkHeader = chunkHeaderOptions?.chunkHeader ?? "";

    for (const document of documents) {
      const chunks = await this.splitText(document.pageContent);

      for (const [index, chunk] of chunks.entries()) {
        splitDocs.push(
          new Document({
            pageContent: `${chunkHeader}${chunk}`,
            metadata: {
              ...document.metadata,
              partindex: index,
              totalparts: chunks.length,
            },
          }),
        );
      }
    }

    return splitDocs;
  }

  /**
   * Returns true when a tag node matches any configured CSS selector.
   *
   * Needed so separator and protected-node checks share the same selector logic
   * and non-tag nodes are ignored safely.
   */
  private matchesAny(
    $: cheerio.CheerioAPI,
    node: AnyNode,
    selectors: string[],
  ): boolean {
    if (node.type !== "tag") {
      return false;
    }

    for (const selector of selectors) {
      if ($(node).is(selector)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extracts the canonical text value for a node.
   *
   * Needed so sizing and emitted output use the same trimmed text semantics for
   * both element nodes and raw text nodes.
   */
  private getNodeText($: cheerio.CheerioAPI, node: AnyNode): string {
    if (node.type === "text") {
      return node.data ?? "";
    }

    return $(node).text();
  }

  /**
   * Returns whether a node should introduce a visible boundary when adjacent
   * text is concatenated.
   *
   * Needed so inline elements such as `span` do not get synthetic spaces while
   * block-ish elements still remain readable in emitted text.
   */
  private isBlockishNode(node: AnyNode): boolean {
    return node.type === "tag" && BLOCKISH_TAGS.has(node.name);
  }

  /**
   * Joins multiple nodes into the normalized text the splitter actually emits.
   *
   * Needed so grouped nodes are measured and emitted with the same spacing rules
   * used later during chunk merging.
   */
  private getNodesText($: cheerio.CheerioAPI, nodes: AnyNode[]): string {
    let result = "";
    let previousNode: AnyNode | null = null;

    for (const node of nodes) {
      const text = this.getNodeText($, node);
      if (!text) {
        continue;
      }

      if (
        result.length > 0 &&
        previousNode &&
        (this.isBlockishNode(previousNode) || this.isBlockishNode(node))
      ) {
        result += "\n"; // Add newline between block elements for better structure
      }

      result += text;
      previousNode = node;
    }

    return result.trim();
  }

  /**
   * Filters child nodes down to the recursion units the splitter can handle.
   *
   * Needed to recurse through DOM structure without carrying empty whitespace-only
   * text nodes or unsupported node types through the algorithm.
   */
  private getMeaningfulNodes(nodes: AnyNode[]): AnyNode[] {
    return nodes.filter((node) => {
      if (node.type === "text") {
        return (node.data ?? "").trim().length > 0;
      }

      return node.type === "tag";
    });
  }

  /**
   * Returns the child nodes that are meaningful recursion units.
   *
   * Needed to recurse through DOM structure without carrying empty whitespace-only
   * text nodes or unsupported node types through the algorithm.
   */
  private getChildNodesForRecursion(node: AnyNode): AnyNode[] {
    if (!("children" in node) || !Array.isArray(node.children)) {
      return [];
    }

    return this.getMeaningfulNodes(node.children);
  }

  /**
   * Groups child nodes so separator nodes start a new group.
   *
   * Needed because separators represent preferred section boundaries. Grouping
   * makes "separator plus following content" explicit during recursion.
   */
  private groupChildrenForDecomposition(
    $: cheerio.CheerioAPI,
    childNodes: AnyNode[],
    inProtectedTree: boolean,
  ): AnyNode[][] {
    if (childNodes.length === 0) {
      return [];
    }

    if (inProtectedTree || this.separators.length === 0) {
      return [childNodes];
    }

    const groups: AnyNode[][] = [];
    let currentGroup: AnyNode[] = [];

    const flush = () => {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    };

    for (const child of childNodes) {
      if (this.matchesAny($, child, this.separators)) {
        flush();
      }

      currentGroup.push(child);
    }

    flush();

    return groups;
  }

  /**
   * Collects text segments for a single node or grouped sibling nodes.
   *
   * Needed so separator-led groups can be treated as one structural unit before
   * the splitter decides whether it must recurse deeper.
   */
  private async collectSegmentsFromNodes(
    $: cheerio.CheerioAPI,
    nodes: AnyNode[],
    inProtectedAncestor: boolean,
  ): Promise<Segment[]> {
    const text = this.getNodesText($, nodes);

    if (!text) {
      return [];
    }

    if (nodes.length > 1) {
      const startsWithSeparator = this.matchesAny($, nodes[0], this.separators);

      if (
        text.length <= this.chunkSize ||
        (startsWithSeparator && text.length <= this.maxChunkSize)
      ) {
        return [{ text, isProtected: false, sourceKind: "node" }];
      }

      const segments: Segment[] = [];
      for (const node of nodes) {
        segments.push(
          ...(await this.collectSegmentsFromNodes(
            $,
            [node],
            inProtectedAncestor,
          )),
        );
      }

      return segments.length > 0
        ? segments
        : await this.forceSplitText(text, false);
    }

    const [node] = nodes;
    const isProtected =
      !inProtectedAncestor && this.matchesAny($, node, this.neverBreakWithin);
    const childNodes = this.getChildNodesForRecursion(node);

    if (childNodes.length > 0) {
      const childGroups = this.groupChildrenForDecomposition(
        $,
        childNodes,
        isProtected || inProtectedAncestor,
      );
      const normalizedChildText = this.getNodesText($, childGroups.flat());

      if (normalizedChildText.length <= this.chunkSize) {
        return [{ text: normalizedChildText, isProtected, sourceKind: "node" }];
      }

      if (isProtected && normalizedChildText.length <= this.maxChunkSize) {
        return [{ text: normalizedChildText, isProtected, sourceKind: "node" }];
      }

      const segments: Segment[] = [];
      for (const group of childGroups) {
        segments.push(
          ...(await this.collectSegmentsFromNodes(
            $,
            group,
            isProtected || inProtectedAncestor,
          )),
        );
      }

      return segments.length > 0
        ? segments
        : await this.forceSplitText(normalizedChildText, isProtected);
    }

    if (text.length <= this.chunkSize) {
      return [{ text, isProtected, sourceKind: "node" }];
    }

    if (isProtected && text.length <= this.maxChunkSize) {
      return [{ text, isProtected, sourceKind: "node" }];
    }

    return this.forceSplitText(text, isProtected);
  }

  /**
   * Applies the final plain-text fallback when a node cannot be decomposed further.
   *
   * Needed to enforce a finite hard cap with `RecursiveCharacterTextSplitter`
   * once DOM structure is exhausted.
   */
  private async forceSplitText(
    text: string,
    isProtected: boolean,
  ): Promise<Segment[]> {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return [];
    }

    if (!Number.isFinite(this.maxChunkSize)) {
      return [
        {
          text: normalizedText,
          isProtected,
          sourceKind: "forced-split",
        },
      ];
    }

    const fallback = new RecursiveCharacterTextSplitter({
      chunkSize: this.maxChunkSize,
      chunkOverlap: 0,
      keepSeparator: false,
      lengthFunction: (value: string) => value.trim().length,
    });

    const chunks = await fallback.splitText(normalizedText);

    return chunks
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => ({
        text: chunk,
        isProtected,
        sourceKind: "forced-split" as const,
      }));
  }

  /**
   * Merges flat segments into final chunks using `chunkSize` as a soft target.
   *
   * Needed to keep chunk assembly separate from DOM traversal and to normalize the
   * final text output by joining segment text with single spaces.
   */
  private mergeSegments(segments: Segment[]): string[] {
    const chunks: string[] = [];
    let currentParts: string[] = [];
    let currentLength = 0;

    const flush = () => {
      if (currentParts.length === 0) {
        return;
      }

      chunks.push(currentParts.join(" "));
      currentParts = [];
      currentLength = 0;
    };

    for (const segment of segments) {
      const nextLength =
        currentLength === 0
          ? segment.text.length
          : currentLength + 1 + segment.text.length;

      if (currentParts.length > 0 && nextLength > this.chunkSize) {
        flush();
      }

      currentParts.push(segment.text);
      currentLength =
        currentLength === 0
          ? segment.text.length
          : currentLength + 1 + segment.text.length;
    }

    flush();

    return chunks;
  }
}
