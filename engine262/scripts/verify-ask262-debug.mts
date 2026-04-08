#!/usr/bin/env node
/**
 * Verification script for ask262Debug module.
 * Tests that the module is properly exported and captures spec section marks.
 */
import {
  ask262Debug, Agent, ManagedRealm, setSurroundingAgent,
} from '#self';

console.log('=== ask262Debug Verification ===\n');

// 1. Check export exists
console.log('1. Checking export...');
if (!ask262Debug) {
  console.error('FAIL: ask262Debug not exported');
  process.exit(1);
}
console.log('   ✓ ask262Debug exported\n');

// 2. Run code that hits known spec sections
console.log('2. Executing test code...');
const agent = new Agent();
setSurroundingAgent(agent);
const realm = new ManagedRealm();

realm.evaluateScript(`
  // Array.prototype.every - should hit sec-array.prototype.every
  [1, 2, 3].every(x => x > 0);
  
  // Proxy creation - should hit sec-proxycreate or similar
  new Proxy({}, {});
`);

// 3. Verify marks were captured
console.log('3. Checking marks...');
const marks = ask262Debug.marks;
console.log(`   Captured ${marks.length} unique marks\n`);

if (marks.length === 0) {
  console.error('FAIL: No marks captured');
  process.exit(1);
}

// 4. Show sample marks
console.log('4. Sample marks:');
marks.slice(0, 5).forEach((m, i) => {
  console.log(`   [${i}] ${m.sectionIds.join(', ')} @ ${m.fileRelativePath}:${m.lineNumber}${m.important ? ' [important]' : ''}`);
});

console.log('=== All Checks Passed ===');
