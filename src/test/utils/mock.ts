/**
 * Test utilities for mocking LanceDB and embeddings.
 * Provides helper functions to create mock Table instances for testing.
 */

import type { Table } from "@lancedb/lancedb";
import type { Embeddings } from "@langchain/core/embeddings";

/**
 * Mock embeddings instance for testing.
 * Returns predictable vectors based on input text.
 */
export function createMockEmbeddings(): Embeddings {
  return {
    embedQuery: async (text: string): Promise<number[]> => {
      // Return a simple hash-based vector for testing
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
 * Create a mock LanceDB table with test data.
 * @param testData - Array of test documents to return from queries
 */
export function createMockTable(testData: MockTableData[]): Table {
  return {
    search: (_queryVector: number[]) => ({
      limit: (_n: number) => ({
        toArray: async () => {
          // Return first n results, sorted by a simple distance calculation
          return testData
            .map((data) => ({
              ...data,
              _distance: Math.random() * 0.5, // Random distance for testing
            }))
            .slice(0, _n);
        },
      }),
    }),
    query: () => ({
      where: (condition: string) => ({
        limit: (_n: number) => ({
          toArray: async () => {
            // Parse sectionid from condition like "sectionid = 'sec-xxx'"
            const match = condition.match(/sectionid = ['"]([^'"]+)['"]/);
            const sectionId = match ? match[1] : null;

            if (sectionId) {
              return testData
                .filter((data) => data.sectionid === sectionId)
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
 * Default test data for spec sections
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
