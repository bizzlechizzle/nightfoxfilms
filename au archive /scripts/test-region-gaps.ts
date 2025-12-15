/**
 * Test Script: Region Gap Coverage
 *
 * Generates test locations across all 50 states + DC + territories
 * Validates that all 8 region fields are populated (no gaps)
 *
 * Usage: npx ts-node scripts/test-region-gaps.ts
 */

import {
  calculateCompleteRegionFields,
  type CompleteRegionFields,
} from '../packages/desktop/electron/services/region-service';

import {
  STATE_CENTERS,
  STATE_CULTURAL_REGIONS,
  COUNTY_TO_CULTURAL_REGION,
} from '../packages/desktop/src/lib/census-regions';

// All states + DC + territories to test
const ALL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU',
];

// Test scenarios
const TestScenario = {
  FULL_DATA: 'Full GPS + Address',
  GPS_ONLY: 'GPS Only',
  ADDRESS_ONLY: 'Address Only',
  STATE_ONLY: 'State Only',
  MINIMAL: 'Name Only',
} as const;
type TestScenario = typeof TestScenario[keyof typeof TestScenario];

interface TestLocation {
  state: string;
  scenario: TestScenario;
  input: {
    state?: string;
    addressState?: string;
    county?: string;
    addressCounty?: string;
    lat?: number;
    lng?: number;
  };
}

interface TestResult {
  location: TestLocation;
  result: CompleteRegionFields;
  passed: boolean;
  gapFields: string[];
}

/**
 * Generate test locations for a state
 */
function generateTestLocations(stateCode: string): TestLocation[] {
  const center = STATE_CENTERS[stateCode];
  const countyMapping = COUNTY_TO_CULTURAL_REGION[stateCode];
  const firstCounty = countyMapping ? Object.keys(countyMapping)[0] : null;

  const locations: TestLocation[] = [];

  // Scenario 1: Full data (GPS + address)
  if (center) {
    locations.push({
      state: stateCode,
      scenario: TestScenario.FULL_DATA,
      input: {
        state: stateCode,
        addressState: stateCode,
        county: firstCounty || undefined,
        addressCounty: firstCounty || undefined,
        lat: center.lat,
        lng: center.lng,
      },
    });
  }

  // Scenario 2: GPS only
  if (center) {
    locations.push({
      state: stateCode,
      scenario: TestScenario.GPS_ONLY,
      input: {
        lat: center.lat,
        lng: center.lng,
      },
    });
  }

  // Scenario 3: Address only (state + county)
  locations.push({
    state: stateCode,
    scenario: TestScenario.ADDRESS_ONLY,
    input: {
      state: stateCode,
      addressState: stateCode,
      county: firstCounty || undefined,
      addressCounty: firstCounty || undefined,
    },
  });

  // Scenario 4: State only
  locations.push({
    state: stateCode,
    scenario: TestScenario.STATE_ONLY,
    input: {
      state: stateCode,
      addressState: stateCode,
    },
  });

  // Scenario 5: Minimal (name only - no data)
  locations.push({
    state: stateCode,
    scenario: TestScenario.MINIMAL,
    input: {},
  });

  return locations;
}

/**
 * Run test for a single location
 */
function testLocation(location: TestLocation): TestResult {
  const result = calculateCompleteRegionFields(location.input);

  // Check for gaps (fields with placeholder "—")
  const gapFields: string[] = [];
  if (result.county === '—') gapFields.push('county');
  if (result.culturalRegion === '—') gapFields.push('culturalRegion');
  if (result.stateDirection === '—') gapFields.push('stateDirection');
  if (result.stateName === '—') gapFields.push('stateName');
  if (result.countryCulturalRegion === '—') gapFields.push('countryCulturalRegion');
  if (result.censusRegion === '—') gapFields.push('censusRegion');
  if (result.country === '—') gapFields.push('country');
  if (result.continent === '—') gapFields.push('continent');

  // For minimal scenario, some gaps are expected
  const passed = location.scenario === TestScenario.MINIMAL
    ? true // We allow gaps for minimal scenario
    : gapFields.length === 0;

  return {
    location,
    result,
    passed,
    gapFields,
  };
}

/**
 * Main test runner
 */
function runTests() {
  console.log('='.repeat(80));
  console.log('REGION GAP COVERAGE TEST');
  console.log('='.repeat(80));
  console.log(`Testing ${ALL_STATES.length} states/territories × 5 scenarios = ${ALL_STATES.length * 5} test cases\n`);

  const allResults: TestResult[] = [];
  const failedTests: TestResult[] = [];
  const stateSummary: Record<string, { passed: number; failed: number }> = {};

  for (const state of ALL_STATES) {
    const locations = generateTestLocations(state);
    stateSummary[state] = { passed: 0, failed: 0 };

    for (const location of locations) {
      const result = testLocation(location);
      allResults.push(result);

      if (result.passed) {
        stateSummary[state].passed++;
      } else {
        stateSummary[state].failed++;
        failedTests.push(result);
      }
    }
  }

  // Print state summary
  console.log('STATE SUMMARY:');
  console.log('-'.repeat(60));
  const statesWithFailures = Object.entries(stateSummary)
    .filter(([_, s]) => s.failed > 0)
    .sort((a, b) => b[1].failed - a[1].failed);

  if (statesWithFailures.length === 0) {
    console.log('✓ All states passed all tests!\n');
  } else {
    for (const [state, summary] of statesWithFailures) {
      console.log(`  ${state}: ${summary.passed} passed, ${summary.failed} FAILED`);
    }
    console.log();
  }

  // Print failed test details
  if (failedTests.length > 0) {
    console.log('FAILED TESTS:');
    console.log('-'.repeat(60));
    for (const test of failedTests.slice(0, 20)) { // Limit to first 20
      console.log(`  ${test.location.state} - ${test.location.scenario}`);
      console.log(`    Gap fields: ${test.gapFields.join(', ')}`);
      console.log(`    Input: ${JSON.stringify(test.location.input)}`);
    }
    if (failedTests.length > 20) {
      console.log(`  ... and ${failedTests.length - 20} more failures\n`);
    }
  }

  // Print overall summary
  console.log('\n' + '='.repeat(60));
  console.log('OVERALL SUMMARY:');
  console.log('='.repeat(60));
  const totalPassed = allResults.filter(r => r.passed).length;
  const totalFailed = allResults.filter(r => !r.passed).length;
  console.log(`  Total tests: ${allResults.length}`);
  console.log(`  Passed: ${totalPassed}`);
  console.log(`  Failed: ${totalFailed}`);
  console.log(`  Pass rate: ${((totalPassed / allResults.length) * 100).toFixed(1)}%`);

  // Print gap field frequency
  const gapFieldCounts: Record<string, number> = {};
  for (const test of allResults) {
    for (const field of test.gapFields) {
      gapFieldCounts[field] = (gapFieldCounts[field] || 0) + 1;
    }
  }

  if (Object.keys(gapFieldCounts).length > 0) {
    console.log('\nGAP FIELD FREQUENCY:');
    console.log('-'.repeat(40));
    for (const [field, count] of Object.entries(gapFieldCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field}: ${count} gaps`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(totalFailed === 0 ? '✓ ALL TESTS PASSED' : `✗ ${totalFailed} TESTS FAILED`);
  console.log('='.repeat(60));

  // Return exit code
  return totalFailed === 0 ? 0 : 1;
}

// Run tests
const exitCode = runTests();
process.exit(exitCode);
