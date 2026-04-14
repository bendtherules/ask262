/**
 * Test timeout functionality for evaluateInEngine262 tool
 * Tests that code execution properly times out after the specified duration
 */

import { createEvaluateInEngine262Tool } from "../../agent-tools/evaluateInEngine262.js";

async function testTimeout() {
  console.log("=== Testing evaluateInEngine262 Timeout ===\n");

  // Test 1: Quick code should complete before timeout
  console.log("Test 1: Quick code (should succeed)...");
  const quickTool = createEvaluateInEngine262Tool(5000); // 5 second timeout
  const start1 = Date.now();
  const quickResult = await quickTool({ code: "console.log('hello'); 1 + 1" });
  const elapsed1 = Date.now() - start1;

  if (quickResult.error) {
    throw new Error(`Quick code failed: ${quickResult.error}`);
  }
  console.log(`✓ Completed in ${elapsed1}ms`);
  console.log(
    `  Console output: ${JSON.stringify(quickResult.consoleOutput)}\n`,
  );

  // Test 2: Long-running code should timeout
  console.log("Test 2: Long-running code (should timeout after 500ms)...");
  const slowTool = createEvaluateInEngine262Tool(500); // 500ms timeout
  const start2 = Date.now();
  const slowResult = await slowTool({
    code: `
      // Busy-wait loop that takes ~5 seconds
      const start = Date.now();
      while (Date.now() - start < 5000) {
        // Busy wait - no yielding
        for (let i = 0; i < 1000; i++) {
          Math.sqrt(i);
        }
      }
      console.log("completed");
    `,
  });
  const elapsed2 = Date.now() - start2;

  if (!slowResult.error) {
    throw new Error("Expected timeout error but code completed successfully");
  }
  if (!slowResult.error.includes("timeout")) {
    throw new Error(`Expected timeout error but got: ${slowResult.error}`);
  }
  console.log(`✓ Timed out in ${elapsed2}ms`);
  console.log(`  Error message: ${slowResult.error}\n`);

  // Note: worker.terminate() sends signal but CPU-bound loops may not stop immediately.
  // The important thing is that we got a timeout error before the 5-second loop completed.
  if (elapsed2 > 5000) {
    throw new Error(`Timeout took too long: ${elapsed2}ms (expected < 5000ms)`);
  }

  console.log(`  (Note: Total time includes worker termination cleanup)`);
  console.log("=== All timeout tests passed! ✓ ===");
}

testTimeout().catch((error) => {
  console.error("\nTest failed:", error);
  process.exit(1);
});
