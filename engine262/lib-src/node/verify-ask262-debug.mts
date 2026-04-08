#!/usr/bin/env node
/**
 * Verification script for ask262Debug module.
 * Tests that the module is properly exported and captures spec section marks.
 */
import {
  ask262Debug, Agent, ManagedRealm, setSurroundingAgent,
  OrdinaryObjectCreate, CreateBuiltinFunction, CreateDataProperty, Value, skipDebugger,
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

realm.scope(() => {
  const debugObj = OrdinaryObjectCreate(agent.intrinsic('%Object.prototype%'));
  skipDebugger(CreateDataProperty(realm.GlobalObject, Value('ask262Debug'), debugObj));

  const startImportant = CreateBuiltinFunction(() => {
    ask262Debug.startImportant();
    return Value.undefined;
  }, 0, Value('startImportant'), []);
  skipDebugger(CreateDataProperty(debugObj, Value('startImportant'), startImportant));

  const stopImportant = CreateBuiltinFunction(() => {
    ask262Debug.stopImportant();
    return Value.undefined;
  }, 0, Value('stopImportant'), []);
  skipDebugger(CreateDataProperty(debugObj, Value('stopImportant'), stopImportant));
});

realm.evaluateScript(`
  // Array.prototype.every - should hit sec-array.prototype.every
  ask262Debug.startImportant();
  [1, 2, 3].every(x => x > 0);
  ask262Debug.stopImportant();
  
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
