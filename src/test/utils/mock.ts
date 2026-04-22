/**
 * Test utilities for mocking LanceDB and embeddings.
 * Provides helper functions to create mock Table instances for testing.
 */

import type { Table } from "@lancedb/lancedb";
import type { Embeddings } from "@langchain/core/embeddings";
/**
 * Mock embeddings instance for testing.
 * Returns deterministic vectors based on input text hash.
 */
export function createMockEmbeddings(): Embeddings {
  return {
    embedQuery: async (text: string): Promise<number[]> => {
      const vector = new Array(128).fill(0);
      for (let i = 0; i < text.length; i++) {
        vector[i % 128] += text.charCodeAt(i) / 1000;
      }
      return vector;
    },
    embedDocuments: async (documents: string[]): Promise<number[][]> => {
      return Promise.all(
        documents.map((doc) => createMockEmbeddings().embedQuery(doc)),
      );
    },
  } as Embeddings;
}

/**
 * Mock embeddings that throws an error on embedQuery.
 */
export function createFailingEmbeddings(): Embeddings {
  return {
    embedQuery: async (_text: string): Promise<number[]> => {
      throw new Error("Embedding service unavailable");
    },
    embedDocuments: async (_documents: string[]): Promise<number[][]> => {
      throw new Error("Embedding service unavailable");
    },
  } as Embeddings;
}

/**
 * Mock table data structure
 */
export interface MockTableData {
  sectionid: string;
  sectiontitle: string;
  text: string;
  partindex?: number;
  totalparts?: number;
  childrensectionids?: string[];
}

/**
 * Create a mock LanceDB table with test data.
 * Uses deterministic distance (0.1) for all results.
 * @param testData - Array of test documents to return from queries
 */
export function createMockTable(testData: MockTableData[]): Table {
  return {
    search: (_queryVector: number[]) => ({
      limit: (n: number) => ({
        toArray: async () => {
          return testData
            .map((data) => ({
              ...data,
              _distance: 0.1,
            }))
            .slice(0, n);
        },
      }),
    }),
    query: () => ({
      where: (condition: string) => ({
        limit: (n: number) => ({
          toArray: async () => {
            const match = condition.match(/sectionid = ['"]([^'"]+)['"]/);
            const sectionId = match ? match[1] : null;

            if (sectionId) {
              return testData
                .filter((data) => data.sectionid === sectionId)
                .slice(0, n)
                .map((data) => ({
                  ...data,
                }));
            }
            return [];
          },
        }),
      }),
    }),
  } as unknown as Table;
}

/**
 * Create a mock table that throws on search.
 */
export function createFailingTable(): Table {
  return {
    search: () => ({
      limit: () => ({
        toArray: async () => {
          throw new Error("Database connection failed");
        },
      }),
    }),
    query: () => ({
      where: () => ({
        limit: () => ({
          toArray: async () => {
            throw new Error("Database connection failed");
          },
        }),
      }),
    }),
  } as unknown as Table;
}

/**
 * Default test data for spec sections.
 */
export const defaultTestData: MockTableData[] = [
  {
    sectionid: "sec-if-statement",
    sectiontitle: "The if Statement",
    text: "The if statement evaluates a condition and executes a block if true.",
    partindex: 0,
    totalparts: 1,
  },
  {
    sectionid: "sec-for-statement",
    sectiontitle: "The for Statement",
    text: "The for statement creates a loop with initialization, condition, and increment.",
    partindex: 0,
    totalparts: 1,
  },
  {
    sectionid: "sec-array.prototype.map",
    sectiontitle: "Array.prototype.map",
    text: "The map method creates a new array by applying a function to each element.",
    partindex: 0,
    totalparts: 1,
  },
  {
    sectionid: "sec-array.prototype.filter",
    sectiontitle: "Array.prototype.filter",
    text: "The filter method creates a new array with elements that pass the test.",
    partindex: 0,
    totalparts: 1,
  },
  {
    sectionid: "sec-try-statement",
    sectiontitle: "The try Statement",
    text: "The try statement marks a block of statements to try, with catch and finally clauses.",
    partindex: 0,
    totalparts: 2,
  },
  {
    sectionid: "sec-catch-clause",
    sectiontitle: "The catch Clause",
    text: "The catch clause provides exception handling for the try block.",
    partindex: 1,
    totalparts: 2,
    childrensectionids: ["sec-try-statement"],
  },
];

/**
 * Test data with multi-part sections for ordering tests.
 * Ordered by partindex so mock returns them sorted.
 */
export const multiPartTestData: MockTableData[] = [
  {
    sectionid: "sec-species-conformance",
    sectiontitle: "ECMAScript: Conformance",
    text: "Part 0 of conformance spec.",
    partindex: 0,
    totalparts: 3,
  },
  {
    sectionid: "sec-species-conformance",
    sectiontitle: "ECMAScript: Conformance",
    text: "Part 1 of conformance spec.",
    partindex: 1,
    totalparts: 3,
  },
  {
    sectionid: "sec-species-conformance",
    sectiontitle: "ECMAScript: Conformance",
    text: "Part 2 final of conformance spec.",
    partindex: 2,
    totalparts: 3,
  },
];

/**
 * Test data with nested children for recursive tests.
 */
export const recursiveTestData: MockTableData[] = [
  {
    sectionid: "sec-root",
    sectiontitle: "Root Section",
    text: "Root content.",
    childrensectionids: ["sec-child-a", "sec-child-b"],
  },
  {
    sectionid: "sec-child-a",
    sectiontitle: "Child A",
    text: "Child A content.",
    childrensectionids: ["sec-grandchild"],
  },
  {
    sectionid: "sec-child-b",
    sectiontitle: "Child B",
    text: "Child B content.",
  },
  {
    sectionid: "sec-grandchild",
    sectiontitle: "Grandchild",
    text: "Grandchild content.",
  },
];
