#!/usr/bin/env node
// External, deterministic harness for the Playwright autonomous repair loop.
//
// This script does NOT fix code itself. It runs the e2e suite once, computes a
// normalized failure signature, and prints a mechanical verdict by comparing
// against state persisted from the previous iteration:
//   clean                  - all tests pass, no frozen test file was touched
//   test_mutation_detected - all tests pass, but a frozen e2e/**/*.spec.js file
//                            changed - never report this as clean, needs human review
//   blocked_dependency     - one or more tests were skipped (e.g. test.skip() in
//                            beforeAll because the Firebase emulator wasn't reachable) -
//                            not a code failure, don't feed this into the repair/
//                            stagnation logic
//   invalid_report         - the Playwright JSON report itself could not be read/parsed -
//                            an infrastructure problem, not a test failure; must not be
//                            counted as failing tests
//   needs_repair           - some tests genuinely failed; fix source code (never e2e/**)
//                            and re-run
//   stop_stagnant          - same failure signature(s) for 3 consecutive runs, no progress
//   stop_max_iterations    - hit the iteration cap without converging
//
// The calling agent (Claude) is responsible for reading this verdict, editing
// application source between iterations, and re-invoking `npm run test:e2e:repair`.
// Run `node scripts/repair-loop.mjs --reset` to clear iteration state and start over.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const STATE_FILE = '.repair-loop-state.json';
const FROZEN_MANIFEST_FILE = '.repair-loop-frozen-tests.json';
const RUN_REPORT_PREFIX = '.repair-loop-run-'; // one file per iteration, not shared/overwritten
const MAX_ITERATIONS = 10;
const STAGNATION_LIMIT = 3;
const E2E_DIR = 'e2e';

if (process.argv.includes('--reset')) {
  for (const f of [STATE_FILE, FROZEN_MANIFEST_FILE]) {
    if (existsSync(f)) unlinkSync(f);
  }
  console.log('[repair-loop] state and frozen manifest cleared.');
  process.exit(0);
}

// ---------- normalization: strip known nondeterministic noise before comparing failures ----------
// This list is a starting point, not exhaustive - extend it as new noise patterns show up.
function normalize(text) {
  return String(text)
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<timestamp>')
    .replace(/:\d{2,5}\b/g, ':<port>')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<path>')
    .replace(/\/(?:tmp|var)\/[^\s"']+/g, '<path>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/retry #\d+/gi, 'retry #<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function signatureFor(failure) {
  const raw = [failure.title, failure.errorType || '', normalize(failure.message || ''), normalize(failure.stackTopFrame || '')].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// ---------- frozen test-file manifest (mechanical diff check, not agent memory) ----------
function listTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'support') out.push(...listTestFiles(full));
    } else if (entry.name.endsWith('.spec.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function buildManifest() {
  const manifest = {};
  for (const f of listTestFiles(E2E_DIR)) manifest[f] = hashFile(f);
  return manifest;
}

function freezeIfNeeded() {
  if (!existsSync(FROZEN_MANIFEST_FILE)) {
    writeFileSync(FROZEN_MANIFEST_FILE, JSON.stringify(buildManifest(), null, 2));
    console.log(`[repair-loop] froze ${E2E_DIR}/**/*.spec.js manifest -> ${FROZEN_MANIFEST_FILE} (run with --reset to re-freeze)`);
  }
}

function checkTestMutation() {
  const frozen = JSON.parse(readFileSync(FROZEN_MANIFEST_FILE, 'utf-8'));
  const current = buildManifest();
  const changed = [];
  for (const file of Object.keys(frozen)) if (current[file] !== frozen[file]) changed.push(file);
  for (const file of Object.keys(current)) if (!(file in frozen)) changed.push(`${file} (new, not in frozen set)`);
  return changed;
}

// ---------- run playwright, parse JSON report ----------
// NOTE: field paths below follow Playwright's documented JSON reporter shape as of the
// @playwright/test version pinned in package.json. Verify against a real run's report file
// and adjust extractResults() if the shape has drifted.
function runTests(iteration) {
  const reportFile = `${RUN_REPORT_PREFIX}${iteration}.json`; // per-iteration, never shared/overwritten
  try {
    execSync(`npx playwright test --reporter=json > ${reportFile}`, { stdio: ['ignore', 'ignore', 'inherit'], shell: true });
  } catch {
    // non-zero exit just means some tests failed - the JSON report is still written
  }
  try {
    return { ok: true, report: JSON.parse(readFileSync(reportFile, 'utf-8')) };
  } catch (e) {
    // Malformed/truncated/missing report = infrastructure problem, not a test failure.
    return { ok: false, error: e.message, reportFile };
  }
}

function extractResults(report) {
  const failures = [];
  const skipped = [];
  for (const suite of report.suites || []) {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        for (const result of t.results || []) {
          const title = `${spec.title} > ${t.title}`;
          if (result.status === 'passed') continue;
          if (result.status === 'skipped') {
            skipped.push({ title });
            continue;
          }
          const err = (result.errors && result.errors[0]) || {};
          failures.push({
            title,
            errorType: (err.message || '').split(':')[0],
            message: err.message || '',
            stackTopFrame: (err.stack || '').split('\n')[1] || '',
          });
        }
      }
    }
  }
  return { failures, skipped };
}

function main() {
  freezeIfNeeded();

  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf-8')) : { iteration: 0, lastSignatures: [], stagnationCount: 0 };
  state.iteration += 1;

  if (state.iteration > MAX_ITERATIONS) {
    console.log(JSON.stringify({ verdict: 'stop_max_iterations', iteration: state.iteration }, null, 2));
    process.exit(1);
  }

  const runResult = runTests(state.iteration);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); // persist the incremented iteration regardless of outcome

  if (!runResult.ok) {
    console.log(JSON.stringify({
      verdict: 'invalid_report',
      iteration: state.iteration,
      reportFile: runResult.reportFile,
      error: runResult.error,
      note: 'The Playwright JSON report could not be read/parsed - this is an infrastructure problem, not a test failure. Do not count this iteration toward stagnation or repair progress.',
    }, null, 2));
    process.exit(1);
  }

  const { failures, skipped } = extractResults(runResult.report);

  if (skipped.length > 0 && failures.length === 0) {
    console.log(JSON.stringify({
      verdict: 'blocked_dependency',
      iteration: state.iteration,
      skipped,
      note: 'One or more tests were skipped (e.g. Firebase emulator unreachable) rather than run. Resolve the missing dependency, then re-run - this is not a code defect to repair.',
    }, null, 2));
    process.exit(1);
  }

  if (failures.length === 0) {
    const mutated = checkTestMutation();
    if (mutated.length > 0) {
      console.log(JSON.stringify({
        verdict: 'test_mutation_detected',
        changedFiles: mutated,
        note: 'All tests pass, but frozen e2e/**/*.spec.js file(s) changed during the repair loop. Do not report this as clean - a human must review and approve these changes first.',
      }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ verdict: 'clean', iteration: state.iteration }, null, 2));
    process.exit(0);
  }

  const currentSignatures = failures.map(signatureFor).sort();
  const sameAsLast = JSON.stringify(currentSignatures) === JSON.stringify(state.lastSignatures);
  state.stagnationCount = sameAsLast ? state.stagnationCount + 1 : 0;
  state.lastSignatures = currentSignatures;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  if (state.stagnationCount >= STAGNATION_LIMIT - 1) {
    console.log(JSON.stringify({
      verdict: 'stop_stagnant',
      iteration: state.iteration,
      failures,
      note: `Same failure signature(s) for ${STAGNATION_LIMIT} consecutive iterations without progress - stopping rather than burning the rest of the iteration budget.`,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ verdict: 'needs_repair', iteration: state.iteration, failures }, null, 2));
  process.exit(1);
}

main();
