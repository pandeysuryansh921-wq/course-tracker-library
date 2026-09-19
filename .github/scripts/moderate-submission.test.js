const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('--- RUNNING DETERMINISTIC MODERATOR TEST SUITE ---');

function runTest(name, env, expectedDecision) {
  process.stdout.write(`Testing: ${name}... `);
  try {
    execSync('node .github/scripts/moderate-submission.js', {
      env: { ...process.env, ...env },
      stdio: 'pipe'
    });
    const result = JSON.parse(fs.readFileSync('moderation-result.json', 'utf8'));
    if (result.decision === expectedDecision) {
      console.log(`✅ PASSED (${result.decision})`);
      return true;
    } else {
      console.log(`❌ FAILED: Expected ${expectedDecision}, got ${result.decision} (${result.reason})`);
      return false;
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
    return false;
  }
}

let passed = 0;
let total = 0;

// Test 1: Privacy Leak (notes)
total++;
if (runTest('Privacy Leak (personal notes)', {
  ISSUE_TITLE: '[RESOURCE] Leak test',
  ISSUE_BODY: '```json\n{"type":"resource","payload":{"title":"Privacy Leak","url":"https://example.com/test","notes":"my secret notes"}}\n```'
}, 'rejected')) passed++;

// Test 2: Privacy Leak (quizScore)
total++;
if (runTest('Privacy Leak (quizScore)', {
  ISSUE_TITLE: '[RESOURCE] Quiz leak',
  ISSUE_BODY: '```json\n{"type":"resource","payload":{"title":"Quiz Leak","url":"https://example.com/test","quizScore":95}}\n```'
}, 'rejected')) passed++;

// Test 3: Dangerous protocol (javascript:)
total++;
if (runTest('Dangerous Protocol (javascript:)', {
  ISSUE_TITLE: '[RESOURCE] XSS test',
  ISSUE_BODY: '```json\n{"type":"resource","payload":{"title":"XSS Attack","url":"javascript:alert(1)"}}\n```'
}, 'rejected')) passed++;

// Test 4: SSRF (localhost)
total++;
if (runTest('SSRF Attack (localhost)', {
  ISSUE_TITLE: '[RESOURCE] SSRF localhost',
  ISSUE_BODY: '```json\n{"type":"resource","payload":{"title":"SSRF Local","url":"http://localhost:8080/admin"}}\n```'
}, 'rejected')) passed++;

// Test 5: SSRF (169.254.169.254 cloud metadata)
total++;
if (runTest('SSRF Attack (169.254.169.254)', {
  ISSUE_TITLE: '[RESOURCE] SSRF Metadata',
  ISSUE_BODY: '```json\n{"type":"resource","payload":{"title":"Metadata Leak","url":"http://169.254.169.254/latest/meta-data/"}}\n```'
}, 'rejected')) passed++;

// Test 6: Duplicate Resource
total++;
if (runTest('Duplicate Resource Detection', {
  ISSUE_TITLE: '[RESOURCE] Duplicate 3B1B',
  ISSUE_BODY: '```json\n{"type":"resource","payload":{"title":"Essence of Linear Algebra","url":"https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab"}}\n```'
}, 'rejected')) passed++;

// Test 7: Malformed JSON
total++;
if (runTest('Malformed JSON in body', {
  ISSUE_TITLE: '[RESOURCE] Bad JSON',
  ISSUE_BODY: '```json\n{"title": "Broken\n```'
}, 'rejected')) passed++;

console.log(`\nResults: ${passed}/${total} test scenarios passed.`);
if (passed !== total) process.exit(1);
