/**
 * Test script for Ask262 MCP Server
 * Tests all available tools
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  EvaluateToolMCPOutput,
  GetSectionContentMCPOutput,
  SearchSpecMCPOutput,
} from "../../mcp-server-stdio.js";

async function testMCPServer() {
  console.log("Starting MCP Server tests...\n");

  // Create transport connecting to the server
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/mcp-server-stdio.ts"],
  });

  // Create client
  const client = new Client(
    {
      name: "test-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  try {
    // Connect to server
    await client.connect(transport);
    console.log("✓ Connected to MCP server\n");

    // Test 1: List tools
    console.log("Test 1: Listing available tools...");
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    for (const tool of tools.tools) {
      const desc = tool.description ?? "No description";
      console.log(`  - ${tool.name}: ${desc.substring(0, 60)}...`);
    }
    console.log("✓ Tools listed successfully\n");

    // Test 2: Search spec sections
    console.log("Test 2: Testing ask262_search_spec_sections...");
    const searchResult = (await client.callTool({
      name: "ask262_search_spec_sections",
      arguments: {
        query: "array map method",
      },
    })) as SearchSpecMCPOutput;
    if (searchResult.isError) {
      throw new Error(`Search failed: ${searchResult.content[0]?.text}`);
    }
    const searchData = searchResult.structuredContent;
    console.log(`Found ${searchData.results?.length ?? 0} sections`);
    if (searchData.results && searchData.results.length > 0) {
      console.log(
        `  First result: ${searchData.results[0].sectionId} - ${searchData.results[0].sectionTitle}`,
      );
    }
    console.log("✓ Search working (isError: false)\n");

    // Test 3: Get section content
    console.log("Test 3: Testing ask262_get_section_content...");
    const contentResult = (await client.callTool({
      name: "ask262_get_section_content",
      arguments: {
        sectionId: "sec-array.prototype.map",
        recursive: false,
      },
    })) as GetSectionContentMCPOutput;
    if (contentResult.isError) {
      throw new Error(`Get section failed: ${contentResult.content[0]?.text}`);
    }
    const contentData = contentResult.structuredContent;
    console.log(
      `Content length: ${contentData.content?.length ?? 0} characters`,
    );
    console.log(`Sections visited: ${contentData.sectionCount ?? 0}`);
    console.log("✓ Section content retrieved (isError: false)\n");

    // Test 4: Evaluate in engine262 - success case
    console.log("Test 4: Testing ask262_evaluate_in_engine262 (success)...");
    const evalResult = (await client.callTool({
      name: "ask262_evaluate_in_engine262",
      arguments: {
        code: "console.log('test'); let x = 1 + 2; console.log(x);",
      },
    })) as EvaluateToolMCPOutput;
    if (evalResult.isError) {
      throw new Error(`Evaluate failed: ${evalResult.content[0]?.text}`);
    }
    // Type guard: check for error in structuredContent
    const evalData = evalResult.structuredContent;
    if ("error" in evalData) {
      throw new Error(`Unexpected error: ${evalData.error}`);
    }
    console.log(
      `Important sections: ${evalData.importantSections?.length ?? 0}`,
    );
    console.log(`Other sections: ${evalData.otherSections?.length ?? 0}`);
    console.log(`Console output: ${JSON.stringify(evalData.consoleOutput)}`);
    console.log("✓ Code evaluation working (isError: false)\n");

    // Test 5: Evaluate in engine262 - error case
    console.log("Test 5: Testing ask262_evaluate_in_engine262 (error)...");
    const evalErrorResult = (await client.callTool({
      name: "ask262_evaluate_in_engine262",
      arguments: {
        code: "invalid syntax here @#$%",
      },
    })) as EvaluateToolMCPOutput;
    if (!evalErrorResult.isError) {
      throw new Error("Expected error but got success");
    }
    // Verify error is in structuredContent
    const errorData = evalErrorResult.structuredContent;
    if (!("error" in errorData)) {
      throw new Error("Expected error in structuredContent");
    }
    console.log(`Got expected error: ${errorData.error}`);
    console.log("✓ Error handling working (isError: true)\n");

    console.log("All tests passed! ✓");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

testMCPServer();
