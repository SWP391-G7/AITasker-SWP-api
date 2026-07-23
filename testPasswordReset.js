const app = require('./src/app');
const { pool } = require('./src/config/db');

const PORT = 5099;
const API_URL = `http://localhost:${PORT}/api`;

async function runPasswordResetTests() {
  console.log('==================================================');
  console.log('🧪 Running Password Reset Integration Tests');
  console.log('==================================================\n');

  const server = app.listen(PORT);
  const testEmail = `reset_test_${Date.now()}@example.com`;
  const initialPassword = 'InitialPassword123';
  const newPassword = 'NewSecurePassword2026';
  let userId = '';

  try {
    // ----------------------------------------------------
    // STEP 1: Register a test user
    // ----------------------------------------------------
    console.log('📋 Step 1: Registering a new user for password reset test...');
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Reset Tester',
        email: testEmail,
        password: initialPassword,
        role: 'client'
      })
    });

    const regData = await registerRes.json();
    if (registerRes.status !== 201 || !regData.user) {
      throw new Error(`Failed to register test user: ${JSON.stringify(regData)}`);
    }
    userId = regData.user.id;
    console.log(`✅ Step 1 Passed: User created with email: ${testEmail}\n`);

    // ----------------------------------------------------
    // STEP 2: Validation errors for forgot-password
    // ----------------------------------------------------
    console.log('📋 Step 2: Testing forgot-password input validation...');
    const invalidEmailRes = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' })
    });
    if (invalidEmailRes.status !== 400) {
      throw new Error('Expected 400 status for invalid email');
    }

    const nonExistentRes = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent_user_99999@example.com' })
    });
    if (nonExistentRes.status !== 404) {
      throw new Error('Expected 404 status for non-existent email');
    }
    console.log('✅ Step 2 Passed: Invalid and non-existent emails correctly blocked.\n');

    // ----------------------------------------------------
    // STEP 3: Successful forgot-password request
    // ----------------------------------------------------
    console.log('📋 Step 3: Requesting password reset code for valid user...');
    const forgotRes = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail })
    });
    const forgotData = await forgotRes.json();
    if (forgotRes.status !== 200 || !forgotData.success) {
      throw new Error(`forgot-password failed: ${JSON.stringify(forgotData)}`);
    }
    console.log('✅ Step 3 Passed: Reset code requested successfully.\n');

    // ----------------------------------------------------
    // STEP 4: Retrieve reset code from database
    // ----------------------------------------------------
    console.log('📋 Step 4: Fetching reset code from email_verification_codes table...');
    const codeDbRes = await pool.query(
      'SELECT code FROM email_verification_codes WHERE email = $1 AND is_used = false ORDER BY created_at DESC LIMIT 1',
      [testEmail]
    );
    if (codeDbRes.rows.length === 0) {
      throw new Error('No reset code found in database!');
    }
    const resetCode = codeDbRes.rows[0].code;
    console.log(`⚡ Reset code retrieved from DB: ${resetCode}`);
    console.log('✅ Step 4 Passed: Code found in database.\n');

    // ----------------------------------------------------
    // STEP 5: Verify code validation
    // ----------------------------------------------------
    console.log('📋 Step 5: Testing verify-reset-code endpoint...');
    
    // Wrong code test
    const wrongCodeRes = await fetch(`${API_URL}/auth/verify-reset-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: '000000' })
    });
    if (wrongCodeRes.status !== 400) {
      throw new Error('Expected 400 for wrong reset code');
    }

    // Correct code test
    const correctCodeRes = await fetch(`${API_URL}/auth/verify-reset-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: resetCode })
    });
    const correctCodeData = await correctCodeRes.json();
    if (correctCodeRes.status !== 200 || !correctCodeData.success) {
      throw new Error(`verify-reset-code failed: ${JSON.stringify(correctCodeData)}`);
    }
    console.log('✅ Step 5 Passed: Code verification working as expected.\n');

    // ----------------------------------------------------
    // STEP 6: Execute password reset
    // ----------------------------------------------------
    console.log('📋 Step 6: Testing reset-password endpoint...');

    // Short password validation
    const shortPwRes = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: resetCode, newPassword: '123' })
    });
    if (shortPwRes.status !== 400) {
      throw new Error('Expected 400 for password shorter than 6 characters');
    }

    // Successful reset
    const resetRes = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: resetCode, newPassword: newPassword })
    });
    const resetData = await resetRes.json();
    if (resetRes.status !== 200 || !resetData.success) {
      throw new Error(`reset-password failed: ${JSON.stringify(resetData)}`);
    }
    console.log('✅ Step 6 Passed: Password reset successful.\n');

    // ----------------------------------------------------
    // STEP 7: Verify login behavior with old and new password
    // ----------------------------------------------------
    console.log('📋 Step 7: Verifying login with old vs new password...');
    
    // Login with old password should fail (401)
    const oldLoginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: initialPassword })
    });
    if (oldLoginRes.status !== 401) {
      throw new Error('Expected 401 when logging in with old password');
    }

    // Login with new password should succeed (200)
    const newLoginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: newPassword })
    });
    const newLoginData = await newLoginRes.json();
    if (newLoginRes.status !== 200 || !newLoginData.token) {
      throw new Error(`Login with new password failed: ${JSON.stringify(newLoginData)}`);
    }
    console.log('✅ Step 7 Passed: Login with old password rejected (401) and new password accepted (200 OK).\n');

    // ----------------------------------------------------
    // STEP 8: Attempt reusing the reset code
    // ----------------------------------------------------
    console.log('📋 Step 8: Verifying that used reset code cannot be reused...');
    const reuseCodeRes = await fetch(`${API_URL}/auth/verify-reset-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, code: resetCode })
    });
    if (reuseCodeRes.status !== 400) {
      throw new Error('Expected 400 when attempting to reuse code');
    }
    console.log('✅ Step 8 Passed: Reusing used reset code blocked (400).\n');

    console.log('==================================================');
    console.log('🎉 ALL PASSWORD RESET TESTS PASSED SUCCESSFULLY!');
    console.log('==================================================');
  } catch (err) {
    console.error('❌ Password Reset Test Failed:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup database test data
    if (testEmail) {
      await pool.query('DELETE FROM email_verification_codes WHERE email = $1', [testEmail]);
      await pool.query('DELETE FROM client_profiles WHERE id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
    }
    await pool.end();
    server.close();
  }
}

runPasswordResetTests();
