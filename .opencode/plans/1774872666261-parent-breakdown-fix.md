# Fix: Parent Section Breakdown Awareness + Sequential Breakdown

**Model:** fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo  
**Date:** 2026-03-31  
**Parent Plan:** [1774872124705-glowing-river.md](./1774872124705-glowing-river.md)

## Summary

This plan addresses two issues in the spec ingestion process:
1. **Parent Awareness**: Parent sections now contain references to their subsections
2. **Sequential + Recursive Breakdown**: Large sections are broken down by trying tags sequentially, and extracted subsections are recursively checked and broken down if still large

**Key Features:**
- Always extract `emu-clause` with titles first
- Breakdown tags tried in order: `emu-table` → `emu-grammar` → `td` → `p`
- Continue to next tag only if previous didn't reduce size enough
- **Recursive check**: Each extracted subsection is also checked and can be further broken down
- **Hierarchical IDs**: Show full path like `sec-if-statement-emu-table-1-td-2`
- **Max depth**: 3 levels prevents excessive nesting
- **Metadata tracking**: `subsections` array lists children (breakdown type derived from IDs)
- **Parent references**: Agent can discover and fetch the full hierarchy

## Files to Modify

| File | Changes |
|------|---------|
| `setup/ingest.ts` | Add parent chunk with subsection awareness + recursive breakdown |

## Implementation Details

### Breakdown Strategy

**Phase 1: Extract emu-clause with titles**
- Parse all `emu-clause` elements
- Extract `id`, `title` (from `h1`), and content
- Always keep these as primary structure

**Phase 2: Recursive sequential breakdown**
For each section (emu-clause or subsection) > 5000 chars:
1. Try `emu-table` - Extract tables as subsections
2. If still large, try `emu-grammar` - Extract grammar productions  
3. If still large, try `td` - Break table cells
4. If still large, try `p` - Break paragraphs

**Phase 3: Recursive check on extracted subsections**
- Each extracted subsection is ALSO checked for size
- If still > 5000 chars, recursively apply breakdown starting from the NEXT tag
- Example: `sec-if-statement-emu-table-1` is 8000 chars → try `emu-grammar`, then `td`, then `p`

**Stop condition:** All chunks (at any level) are < threshold

### Configuration

```typescript
const LARGE_DOC_THRESHOLD = 5000;
const BREAKDOWN_TAGS = ["emu-table", "emu-grammar", "td", "p"] as const;
const MAX_RECURSION_DEPTH = 3;
```

### Breakdown Function

```typescript
interface BreakdownResult {
  parentDoc: {
    content: string;
    tagUsed: string | null;
    subsections: string[];
  };
  subsectionDocs: Document[];
}

function breakDownSection(
  html: string,
  baseId: string,
  baseTitle: string,
  sourceFile: string,
  parentId: string | null,
  depth: number = 0
): BreakdownResult {
  const $ = cheerio.load(`<div>${html}</div>`);
  const $section = $("div").first();
  
  const fullText = $section.text().trim();
  
  // Base case: small enough or max depth
  if (fullText.length <= LARGE_DOC_THRESHOLD || depth >= MAX_RECURSION_DEPTH) {
    return {
      parentDoc: {
        content: html,
        tagUsed: null,
        subsections: []
      },
      subsectionDocs: []
    };
  }
  
  // Try each breakdown tag sequentially
  const subsectionIds: string[] = [];
  const subsectionDocs: Document[] = [];
  let remainingHtml = html;
  let tagUsed: string | null = null;
  
  for (let i = 0; i < BREAKDOWN_TAGS.length; i++) {
    const tagName = BREAKDOWN_TAGS[i];
    const $temp = cheerio.load(`<div>${remainingHtml}</div>`);
    const $tempSection = $("div").first();
    
    // Check if this tag exists
    if ($tempSection.find(tagName).length === 0) {
      continue;
    }
    
    // Extract elements of this tag
    let counter = 1;
    $tempSection.find(tagName).each((_, elem) => {
      const elemHtml = $(elem).html() || "";
      const elemText = $(elem).text().trim();
      
      if (elemText) {
        const subId = `${baseId}-${tagName}-${counter}`;
        subsectionIds.push(subId);
        
        // Recursively check if this subsection needs further breakdown
        // Start from next tag in sequence (i+1)
        const subResult = breakDownSection(
          elemHtml,
          subId,
          `${baseTitle} [${tagName}]`,
          sourceFile,
          baseId,
          depth + 1
        );
        
        // If subsection was broken down further
        if (subResult.subsectionDocs.length > 0) {
          subsectionDocs.push(...subResult.subsectionDocs);
          
          // Also add the subsection's parent document
          if (subResult.parentDoc.subsections.length > 0) {
            subsectionDocs.push(new Document({
              pageContent: [
                `[Section ${subId}: ${baseTitle} [${tagName}]]`,
                "(Section content below - subsections marked inline)",
                "",
                "---",
                "",
                cheerio.load(subResult.parentDoc.content).text().trim()
              ].join("\n"),
              metadata: {
                source: sourceFile,
                sectionid: subId,
                sectiontitle: `${baseTitle} [${tagName}]`,
                type: "specification",
                parentsectionid: baseId,
                subsections: subResult.parentDoc.subsections,
              },
            }));
          }
        } else {
          // Subsection is small enough, create leaf document
          subsectionDocs.push(new Document({
            pageContent: elemText,
            metadata: {
              source: sourceFile,
              sectionid: subId,
              sectiontitle: `${baseTitle} [${tagName}]`,
              type: "specification",
              parentsectionid: baseId,
              subsections: [],
            },
          }));
        }
        
        counter++;
        // Extract title from element if available
        let elemTitle = "";
        if (tagName === "emu-table") {
          elemTitle = $(elem).find("caption").first().text().trim();
        } else if (tagName === "emu-clause") {
          elemTitle = $(elem).find("h1").first().text().trim();
        }
        
        // Replace with marker line in parent content
        const markerText = elemTitle 
          ? `[Subsection available: title "${elemTitle}" at sectionid: \`${subId}\`]`
          : `[Subsection available at sectionid: \`${subId}\`]`;
        $(elem).replaceWith(`<p>${markerText}</p>`);
      }
    });
    
    // Check if breakdown was effective
    remainingHtml = $tempSection.html() || "";
    const remainingText = $tempSection.text().trim();
    
    if (subsectionIds.length > 0) {
      tagUsed = tagName;
      
      // If remaining is small enough, stop here
      if (remainingText.length <= LARGE_DOC_THRESHOLD) {
        break;
      }
    }
  }
  
  return {
    parentDoc: {
      content: remainingHtml,
      tagUsed,
      subsections: subsectionIds
    },
    subsectionDocs
  };
}
```

### Document Creation with Subsections

```typescript
async function ingestSpec(): Promise<Document[]> {
  const htmlFiles = await glob(path.join(SPEC_DIR, "*.html"));
  const documents: Document[] = [];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const $ = cheerio.load(content);

    $("emu-clause").each((_i, elem) => {
      const id = $(elem).attr("id");
      const title = $(elem).find("h1").first().text().trim();
      const html = $(elem)
        .clone()
        .children("emu-clause")
        .remove()
        .end()
        .html() || "";

      if (!id || !title || !html.trim()) {
        return;
      }

      // Apply recursive breakdown
      const result = breakDownSection(html, id, title, file, null, 0);
      
      // Create parent document
      if (result.parentDoc.subsections.length > 0) {
        const parentContent = [
          `[Section ${id}: ${title}]`,
          "(Section content below - subsections marked inline)",
          "",
          "---",
          "",
          cheerio.load(result.parentDoc.content).text().trim()
        ].join("\n");
        
        documents.push(new Document({
          pageContent: parentContent,
          metadata: {
            source: file,
            sectionid: id,
            sectiontitle: title,
            type: "specification",
            parentsectionid: null,
            subsections: result.parentDoc.subsections,
          },
        }));
        
        // Add all subsection documents (including recursively broken ones)
        documents.push(...result.subsectionDocs);
      } else {
        // No breakdown needed - add as-is
        documents.push(new Document({
          pageContent: cheerio.load(html).text().trim(),
          metadata: {
            source: file,
            sectionid: id,
            sectiontitle: title,
            type: "specification",
            parentsectionid: null,
            subsections: [],
          },
        }));
      }
    });
  }
  return documents;
}
```

### Hierarchical Structure

Recursive breakdown creates nested hierarchy:

```
sec-if-statement (parent)
├── sec-if-statement-emu-table-1 (parent)
│   ├── sec-if-statement-emu-table-1-td-1
│   ├── sec-if-statement-emu-table-1-td-2
│   └── ...
├── sec-if-statement-emu-table-2 (leaf)
├── sec-if-statement-emu-grammar-1 (leaf)
└── ...
```

**Breakdown type derivation:** From subsection ID pattern:
- `sec-if-statement-emu-table-1` → broke down by `emu-table`
- `sec-if-statement-emu-table-1-td-2` → table-1 broke down by `td`

### Querying Strategy

**Get all chunks from a section (recursive):**

```typescript
async function getAllChunks(sectionId: string): Promise<Document[]> {
  const allDocs: Document[] = [];
  const queue: string[] = [sectionId];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    
    const results = await table
      .query()
      .where(`sectionid = '${currentId}'`)
      .limit(100)
      .toArray();
    
    for (const result of results) {
      allDocs.push(result);
      
      // If has subsections, add them to queue
      if (result.subsections && result.subsections.length > 0) {
        queue.push(...result.subsections);
      }
    }
  }
  
  return allDocs;
}
```

## Agent Usage

### Parent Discovery

When the agent retrieves a parent chunk (has `subsections` array with items), it will see inline markers where content was extracted:

```
[Section sec-if-statement: If Statement]
(Section content below - subsections marked inline)

---

The if statement evaluates a condition...

[Subsection available: title "Static Semantics: Early Errors" at sectionid: `sec-if-statement-emu-table-1`]

The result of the evaluation determines...

[Subsection available: title "IfStatement" at sectionid: `sec-if-statement-emu-grammar-1`]

Further text continues...
```

### Deep Breakdown Example

When a subsection (like a large table) is also broken down:

**Parent chunk:**
```
[Section sec-if-statement: If Statement]
(Section content below - subsections marked inline)

---

The if statement evaluates a condition...

[Subsection available: title "Static Semantics: Early Errors" at sectionid: `sec-if-statement-emu-table-1`]

[Subsection available: title "IfStatement" at sectionid: `sec-if-statement-emu-grammar-1`]

The result of the evaluation determines...
```

**Subsection parent (table-1 broken down further by td):**
```
[Section sec-if-statement-emu-table-1: If Statement [emu-table]]
(Section content below - subsections marked inline)

---

Table header row...

[Subsection available at sectionid: `sec-if-statement-emu-table-1-td-1`]

[Subsection available at sectionid: `sec-if-statement-emu-table-1-td-2`]

Table footer...
```
```

**Leaf chunk (table cell):**
```
[Section sec-if-statement-emu-table-1-td-1: If Statement [emu-table] [td]]
(Actual table cell content here)
```

### Agent Strategy

1. Retrieve emu-clause by semantic search
2. Check if `subsections?.length > 0` to detect parent
3. Derive breakdown type from subsection IDs (e.g., `*-emu-table-*` means table breakdown)
4. Recursively check fetched subsections - they may also have subsections!
5. Continue until reaching leaf nodes (no subsections)
6. Combine all retrieved chunks for complete answer

## Changes to agent.ts

### Enhanced fetch_section_chunks Tool

```typescript
const sectionRetrieverTool = new DynamicTool({
  name: "fetch_section_chunks",
  description: "Retrieves all text chunks from a specific specification section by sectionid. " +
               "Supports recursive fetching - if a section has subsections, it will fetch all descendants. " +
               "Use this to get complete content when you see 'Subsection available' references in parent chunks.",
  func: async (sectionId) => {
    const allDocs: string[] = [];
    const queue: string[] = [sectionId];
    const visited = new Set<string>();
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      
      const results = await table
        .query()
        .where(`sectionid = '${currentId}'`)
        .limit(100)
        .toArray();
      
      for (const result of results) {
        allDocs.push(result.text || "");
        
        // Add subsections to queue for recursive fetching
        if (result.subsections && Array.isArray(result.subsections)) {
          queue.push(...result.subsections);
        }
      }
    }
    
    return allDocs.join("\n\n---\n\n");
  }
});
```

### New Check for Breakdown Tool (Optional)

```typescript
const checkSubsectionsTool = new DynamicTool({
  name: "check_subsections",
  description: "Checks if a section has subsections and returns their IDs. " +
               "Use when you need to selectively fetch specific subsection types (tables, grammar, prose).",
  func: async (sectionId) => {
    const result = await table
      .query()
      .where(`sectionid = '${sectionId}'`)
      .limit(1)
      .toArray();
    
    if (result.length === 0) {
      return `No section found with id: ${sectionId}`;
    }
    
    const doc = result[0];
    if (!doc.subsections || doc.subsections.length === 0) {
      return `Section ${sectionId} has no subsections.`;
    }
    
    return [
      `Section ${sectionId} has ${doc.subsections.length} subsections:`,
      ...doc.subsections.map((id: string) => {
        const match = id.match(/-(table|grammar|prose)/);
        const type = match ? match[1] : 'subsection';
        return `  - ${type}: ${id}`;
      })
    ].join("\n");
  }
});
```

## Testing Checklist

### Basic Functionality
- [ ] Run `bun run setup/ingest.ts` completes without errors
- [ ] Verify parent chunks have `subsections` array with children
- [ ] Verify leaf chunks have empty/null `subsections`
- [ ] Verify subsection references are in parent chunk content
- [ ] Verify subsection IDs show correct breakdown path (e.g., `section-emu-table-1`)

### Sequential Breakdown
- [ ] Find a section with >5000 chars and tables, verify emu-table breakdown happens
- [ ] Find a section with large grammar block, verify emu-grammar breakdown happens
- [ ] Find a section where emu-table leaves large remainder, verify emu-grammar also extracted
- [ ] Derive breakdown type from subsection IDs (first tag in ID path)

### Recursive Breakdown
- [ ] Find a large table (section-emu-table-1 > 5000 chars), verify it gets further broken down
- [ ] Check that nested breakdown uses next tags in sequence (emu-grammar, td, p)
- [ ] Verify nested IDs: `sec-if-statement-emu-table-1-td-2` (table broken down by td)
- [ ] Test max depth limit (3): deeply nested sections stop at depth 3
- [ ] Verify all subsections have `parentsectionid` pointing to their immediate parent

### Query Testing
- [ ] Query for parent section, verify content includes subsection lines
- [ ] Query for subsection by ID (e.g., `sec-if-statement-emu-table-1`)
- [ ] Test `fetch_section_chunks` with parent ID returns all subsections
- [ ] Verify agent can discover and fetch subsections automatically
- [ ] Test agent query on large section to verify subsection discovery works

### Indexes
- [ ] Verify scalar indexes are created for: sectionid, type
- [ ] Test WHERE clause queries on indexed columns

## Limits & Edge Cases

### Sequential Breakdown Order
Tags are tried in strict order:
1. `emu-table` - Best semantic unit for spec tables
2. `emu-grammar` - Grammar productions are natural boundaries  
3. `td` - Table cells (only if tables couldn't reduce enough)
4. `p` - Paragraphs (last resort, breaks prose)

**Rationale:** Structure-aware breakdown preserves semantic meaning better than arbitrary text splitting.

### Recursive Breakdown Logic
- **Applied to every extracted subsection**: Each extracted chunk is also checked for size
- **Sequential tags continue**: If `sec-table-1` is large, try next tags (emu-grammar, td, p)
- **Depth tracking**: `depth` field shows nesting level (0 = emu-clause, max 3)
- **ID nesting**: IDs reflect full path: `section-table-1-td-2` means table 1 was broken down by td

### Content Size Threshold
- **Default**: 5000 characters (configurable via `LARGE_DOC_THRESHOLD`)
- **Applied at every level**: Parent and all subsections checked against threshold
- **Max depth safety**: Even if still large at depth 3, no further breakdown (prevents infinite recursion)

### Hierarchical Structure
- **Nested IDs**: IDs show full breakdown path like `sec-if-statement-emu-table-1-td-2`
- **Multi-level**: Subsections can be parents with their own children
- **Parent tracking**: `parentsectionid` always points to immediate parent (could be subsection or emu-clause)

### Large Remainders at Max Depth
If at depth 3 content is still > threshold:
- Keep it as-is (chunk may exceed threshold)
- Add warning in content: "(Content exceeds threshold - max depth reached)"
- This is rare - depth 3 with td/p breakdowns should handle most cases

## Migration Strategy

1. **Clean slate**: Delete existing `storage/` directory
2. **Re-ingest**: Run `bun run setup/ingest.ts` 
3. **Verify structure**: Check that large sections have hierarchical breakdowns
4. **Test breakdown types**: Look for examples of each breakdown type by ID pattern:
   ```typescript
   // Query to find emu-table breakdowns
   const tableBreakdowns = await table
     .query()
     .where(`sectionid LIKE '%-emu-table-%'`)
     .limit(10)
     .toArray();
   console.log(tableBreakdowns.map(s => s.sectionid));
   ```
5. **Test recursive breakdown**: Find deeply nested examples:
   ```typescript
   // Query for nested breakdowns (table cells broken down)
   const nested = await table
     .query()
     .where(`sectionid LIKE '%-td-%'`)
     .limit(10)
     .toArray();
   console.log(nested.map(s => ({id: s.sectionid, parent: s.parentsectionid})));
   ```
6. **Test agent**: Run queries on large sections like "sec-globaldeclarationinstantiation"
7. **Verify hierarchy**: Confirm parent-child chain is correct (e.g., `td` → `table` → `section`)
