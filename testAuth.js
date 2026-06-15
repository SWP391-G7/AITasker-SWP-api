const { pool } = require('./src/config/db');

const API_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Running AITasker Authentication Integration Tests');
  console.log('==================================================\n');

  const testEmail = `expert_${Date.now()}@example.com`;
  const testPassword = 'SecurePassword2026';
  const testName = 'Alex Expert';
  let authToken = '';
  let userId = '';

  try {
    // ----------------------------------------------------
    // TEST 1: Validation Failures (Registration)
    // ----------------------------------------------------
    console.log('📋 Test 1: Testing registration validation errors...');
    const registerFailRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: '',
        email: 'invalid-email',
        password: '123',
        role: 'invalid-role'
      })
    });
    
    const failData = await registerFailRes.json();
    console.log(`Status: ${registerFailRes.status}`);
    console.log('Response (Expected errors):', JSON.stringify(failData.errors, null, 2));
    
    if (registerFailRes.status === 400 && failData.errors) {
      console.log('✅ Test 1 Passed: Validation correctly blocked invalid registration.\n');
    } else {
      throw new Error('❌ Test 1 Failed: Validation did not block invalid input');
    }

    // ----------------------------------------------------
    // TEST 2: Successful Registration (as Expert)
    // ----------------------------------------------------
    console.log('📋 Test 2: Testing successful user registration (role: expert)...');
    const registerSuccessRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: testName,
        email: testEmail,
        password: testPassword,
        role: 'expert'
      })
    });

    const successData = await registerSuccessRes.json();
    console.log(`Status: ${registerSuccessRes.status}`);
    console.log(`Message: ${successData.message}`);
    
    if (registerSuccessRes.status === 201 && successData.token) {
      authToken = successData.token;
      userId = successData.user.id;
      console.log(`Token received: ${authToken.substring(0, 20)}...`);
      console.log(`User ID created: ${userId}`);
      console.log('✅ Test 2 Passed: User registered successfully and token issued.\n');
    } else {
      throw new Error(`❌ Test 2 Failed: Registration failed. Response: ${JSON.stringify(successData)}`);
    }

    // ----------------------------------------------------
    // TEST 3: Database Verification (Relational Integrity)
    // ----------------------------------------------------
    console.log('📋 Test 3: Querying database directly to verify relational profiles...');
    
    // Check users table
    const userDbRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userDbRes.rows.length === 1) {
      console.log('⚡ User record found in "users" table.');
      const user = userDbRes.rows[0];
      console.log(`   Email: ${user.email}, Role: ${user.role}, Password Hashed: ${user.password.startsWith('$2a$') || user.password.startsWith('$2b$')}`);
    } else {
      throw new Error('❌ Test 3 Failed: User was not inserted into "users" table');
    }

    // Check expert_profiles table (since registered as expert)
    const profileDbRes = await pool.query('SELECT * FROM expert_profiles WHERE id = $1', [userId]);
    if (profileDbRes.rows.length === 1) {
      console.log('⚡ Expert Profile record found in "expert_profiles" table. (Referential Integrity OK!)');
      console.log('✅ Test 3 Passed: Relational database records are correct.\n');
    } else {
      throw new Error('❌ Test 3 Failed: Expert profile was not created in "expert_profiles" table');
    }

    // ----------------------------------------------------
    // TEST 4: Duplicate Email Block
    // ----------------------------------------------------
    console.log('📋 Test 4: Testing duplicate email registration block...');
    const duplicateRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: testName,
        email: testEmail,
        password: testPassword,
        role: 'expert'
      })
    });

    const dupData = await duplicateRes.json();
    console.log(`Status: ${duplicateRes.status}`);
    console.log(`Response: ${dupData.message}`);
    
    if (duplicateRes.status === 400 && dupData.message.includes('already registered')) {
      console.log('✅ Test 4 Passed: Duplicate registration successfully blocked.\n');
    } else {
      throw new Error('❌ Test 4 Failed: Duplicate email was not blocked');
    }

    // ----------------------------------------------------
    // TEST 5: Login with Wrong Password
    // ----------------------------------------------------
    console.log('📋 Test 5: Testing login failure (wrong password)...');
    const wrongPasswordRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'IncorrectPassword'
      })
    });

    const wrongPwData = await wrongPasswordRes.json();
    console.log(`Status: ${wrongPasswordRes.status}`);
    console.log(`Response: ${wrongPwData.message}`);

    if (wrongPasswordRes.status === 401) {
      console.log('✅ Test 5 Passed: Invalid password rejected.\n');
    } else {
      throw new Error('❌ Test 5 Failed: Wrong password did not fail');
    }

    // ----------------------------------------------------
    // TEST 6: Successful Login
    // ----------------------------------------------------
    console.log('📋 Test 6: Testing successful login...');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword
      })
    });

    const loginData = await loginRes.json();
    console.log(`Status: ${loginRes.status}`);
    console.log(`Response: ${loginData.message}`);

    if (loginRes.status === 200 && loginData.token) {
      authToken = loginData.token;
      console.log(`New token issued: ${authToken.substring(0, 20)}...`);
      console.log('✅ Test 6 Passed: Login successful.\n');
    } else {
      throw new Error(`❌ Test 6 Failed: Login failed. Response: ${JSON.stringify(loginData)}`);
    }

    // ----------------------------------------------------
    // TEST 7: Get Me (Private Route Verification)
    // ----------------------------------------------------
    console.log('📋 Test 7: Testing private profile endpoint (/auth/me)...');
    const meRes = await fetch(`${API_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const meData = await meRes.json();
    console.log(`Status: ${meRes.status}`);
    console.log('Response Profile Data:', JSON.stringify(meData.user, null, 2));

    if (meRes.status === 200 && meData.user && meData.user.email === testEmail) {
      console.log('✅ Test 7 Passed: Private endpoint accessed and details returned successfully.\n');
    } else {
      throw new Error('❌ Test 7 Failed: Failed to access private route or data mismatched');
    }

    console.log('==================================================');
    console.log('🎉 ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
    console.log('==================================================');
  } catch (err) {
    console.error('❌ Integration Test Script Failed:', err);
    process.exit(1);
  } finally {
    // End pool so the process can exit
    await pool.end();
  }
}

runTests();
