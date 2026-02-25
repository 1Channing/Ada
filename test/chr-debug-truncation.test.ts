/**
 * Test debug logging with long title truncation
 */

import { matchesBrandModel } from '../src/lib/study-core/business-logic';

// Set debug mode
process.env.STUDY_DEBUG = 'true';

console.log('Testing debug log truncation...\n');

// Test with a very long title (>80 chars)
const longTitle = 'Toyota C-HR 1.8 Hybrid Dynamic Plus with Premium Package and Navigation System and Leather Seats and Panoramic Sunroof';
console.log(`Original title length: ${longTitle.length} chars`);
console.log(`Title: "${longTitle}"\n`);

const result = matchesBrandModel(longTitle, 'Toyota', 'CHR');
console.log(`\nMatch result: ${result.matches ? 'PASS' : 'FAIL'}`);

if (longTitle.length > 80) {
  console.log('\n✓ Title was >80 chars, should be truncated in debug log above');
} else {
  console.log('\n✗ Test setup error: title should be >80 chars');
  process.exit(1);
}
