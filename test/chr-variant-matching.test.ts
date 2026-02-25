/**
 * Test CHR variant matching fix
 * Verifies that C-HR / C HR / CHR variants match correctly
 */

import { matchesBrandModel } from '../src/lib/study-core/business-logic';

console.log('Testing CHR variant matching...\n');

// Test cases that should PASS with compaction fallback
const shouldPass = [
  { title: 'Toyota C-HR 2025', brand: 'Toyota', model: 'CHR', desc: 'C-HR with hyphen' },
  { title: 'Toyota C HR Hybrid', brand: 'Toyota', model: 'CHR', desc: 'C HR with space' },
  { title: 'Toyota c-hr GR Sport', brand: 'Toyota', model: 'C-HR', desc: 'lowercase c-hr' },
  { title: 'TOYOTA C-HR 1.8 HEV', brand: 'Toyota', model: 'CHR', desc: 'uppercase with hyphen' },
  { title: 'Toyota CHR Dynamic', brand: 'Toyota', model: 'C-HR', desc: 'CHR without hyphen' },
];

// Test cases that should STILL FAIL (not C-HR)
const shouldFail = [
  { title: 'Toyota Corolla', brand: 'Toyota', model: 'CHR', desc: 'Wrong model' },
  { title: 'Honda CR-V', brand: 'Honda', model: 'CHR', desc: 'Different brand and model' },
  { title: 'Volkswagen Golf', brand: 'Volkswagen', model: 'CHR', desc: 'Completely different' },
  { title: 'Toyota Camry', brand: 'Toyota', model: 'C-HR', desc: 'Wrong Toyota model' },
];

// Test cases that should PASS with existing token logic (unchanged)
const existingPass = [
  { title: 'Volkswagen Tiguan R-Line', brand: 'Volkswagen', model: 'Tiguan', desc: 'Token match' },
  { title: 'BMW X3 M Sport', brand: 'BMW', model: 'X3', desc: 'Simple token' },
  { title: 'Audi A4 Avant', brand: 'Audi', model: 'A4', desc: 'Alphanumeric token' },
];

let passCount = 0;
let failCount = 0;

console.log('✅ Testing CHR variants (should PASS via compaction fallback):');
for (const test of shouldPass) {
  const result = matchesBrandModel(test.title, test.brand, test.model);
  if (result.matches) {
    console.log(`  ✓ ${test.desc}: "${test.title}"`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: ${test.desc}: "${test.title}" - ${result.reason}`);
    failCount++;
  }
}

console.log('\n❌ Testing non-CHR listings (should FAIL):');
for (const test of shouldFail) {
  const result = matchesBrandModel(test.title, test.brand, test.model);
  if (!result.matches) {
    console.log(`  ✓ ${test.desc}: "${test.title}" - Correctly rejected`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: ${test.desc}: "${test.title}" - Should have been rejected!`);
    failCount++;
  }
}

console.log('\n✅ Testing existing token logic (should PASS unchanged):');
for (const test of existingPass) {
  const result = matchesBrandModel(test.title, test.brand, test.model);
  if (result.matches) {
    console.log(`  ✓ ${test.desc}: "${test.title}"`);
    passCount++;
  } else {
    console.log(`  ✗ FAIL: ${test.desc}: "${test.title}" - ${result.reason}`);
    failCount++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failCount > 0) {
  process.exit(1);
}
