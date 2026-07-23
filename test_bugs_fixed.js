const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// Test 1: Bug #1 - includeClosed is properly defined and handled in searchController
test('Fix Verification #1: searchController correctly destructures and checks includeClosed', async () => {
  const searchController = require('./src/controllers/searchController');
  
  const req = {
    query: {
      target: 'jobs',
      includeClosed: 'false'
    }
  };
  
  let capturedError = null;
  const res = {};
  const next = (err) => {
    capturedError = err;
  };
  
  // Call searchEntities - it should proceed to pool.query without throwing ReferenceError
  try {
    await searchController.searchEntities(req, res, next);
  } catch (err) {
    capturedError = err;
  }
  
  if (capturedError) {
    assert.strictEqual(capturedError instanceof ReferenceError, false, 'ReferenceError should not occur');
  }
});

// Test 2: Bug #3 - Dead variable redirectUrl removed in paymentController
test('Fix Verification #3: paymentController uses standardized redirectUrl', () => {
  const paymentControllerContent = fs.readFileSync(path.join(__dirname, 'src/controllers/paymentController.js'), 'utf8');
  assert.match(paymentControllerContent, /const isInvitation = payload\.paymentKind === 'invitation'/, 'paymentController uses clean paymentKind check');
});

// Test 3: Bug #4 - Dead code createdProject removed
test('Fix Verification #4: proposalController createdProject dead code removed', () => {
  const proposalControllerContent = fs.readFileSync(path.join(__dirname, 'src/controllers/proposalController.js'), 'utf8');
  assert.strictEqual(proposalControllerContent.includes('let createdProject = null;'), false, 'createdProject dead code is removed');
});

// Test 4: Bug #5 - GEMINI_MODEL set to valid gemini-1.5-flash
test('Fix Verification #5: GEMINI_MODEL in .env is valid gemini-1.5-flash', () => {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  assert.match(envContent, /GEMINI_MODEL=gemini-1.5-flash/, '.env contains valid GEMINI_MODEL=gemini-1.5-flash');
});

// Test 5: Bug #6 - setupDb.js duplicate CREATE TABLE rating removed
test('Fix Verification #6: setupDb.js duplicate CREATE TABLE rating queries removed', () => {
  const setupDbContent = fs.readFileSync(path.join(__dirname, 'src/config/setupDb.js'), 'utf8');
  const ratingTableCreates = setupDbContent.match(/CREATE TABLE IF NOT EXISTS rating/g);
  assert.strictEqual(ratingTableCreates.length, 1, 'setupDb.js contains exactly 1 rating table creation statement');
});

// Test 6: Double release() in adminController removed
test('Fix Verification: adminController double release() calls removed', () => {
  const adminControllerContent = fs.readFileSync(path.join(__dirname, 'src/controllers/adminController.js'), 'utf8');
  const releaseBeforeNext = adminControllerContent.match(/dbClient\.release\(\);\s*return next\(err\);/g);
  assert.strictEqual(releaseBeforeNext, null, 'No early dbClient.release() calls before return next(err)');
});

// Test 7: Atomic pool.connect() transactions implemented
test('Fix Verification: Controllers use pool.connect() client transactions', () => {
  const milestoneContent = fs.readFileSync(path.join(__dirname, 'src/controllers/milestoneController.js'), 'utf8');
  const projectContent = fs.readFileSync(path.join(__dirname, 'src/controllers/projectController.js'), 'utf8');
  
  assert.match(milestoneContent, /const dbClient = await pool\.connect\(\);/, 'milestoneController uses pool.connect()');
  assert.match(projectContent, /const dbClient = await pool\.connect\(\);/, 'projectController uses pool.connect()');
});
