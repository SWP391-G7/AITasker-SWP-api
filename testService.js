const { pool } = require('../../../../../Documents/Semester 5/SWP/SOURCE CODE/AITasker-SWP-api/src/config/db');

const API_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Running AITasker Service CRUD Integration Tests');
  console.log('==================================================\n');

  const clientEmail = `client_${Date.now()}@example.com`;
  const expertEmail1 = `expert1_${Date.now()}@example.com`;
  const expertEmail2 = `expert2_${Date.now()}@example.com`;
  const password = 'SecurePassword2026';
  
  let clientToken = '';
  let expert1Token = '';
  let expert2Token = '';
  
  let serviceId = '';

  try {
    // 1. Register Users
    console.log('📋 Registering client and experts...');
    
    // Register Client
    const regClientRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Test Client', email: clientEmail, password, role: 'client' })
    });
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [clientEmail.toLowerCase()]);

    // Register Expert 1
    const regExpert1Res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Expert One', email: expertEmail1, password, role: 'expert' })
    });
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [expertEmail1.toLowerCase()]);

    // Register Expert 2
    const regExpert2Res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Expert Two', email: expertEmail2, password, role: 'expert' })
    });
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [expertEmail2.toLowerCase()]);

    console.log('✅ Users registered.\n');

    // 2. Log in all users
    const login = async (email) => {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      return data.token;
    };

    clientToken = await login(clientEmail);
    expert1Token = await login(expertEmail1);
    expert2Token = await login(expertEmail2);
    console.log('✅ Users logged in.\n');

    // 3. Post a Service as Expert 1
    console.log('📋 Posting a service as Expert 1...');
    const createRes = await fetch(`${API_URL}/services`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expert1Token}`
      },
      body: JSON.stringify({
        title: 'RAG Pipeline Deployment',
        description: 'Building custom RAG architectures.',
        price: 500.00,
        pricing_type: 'fixed',
        delivery_days: 5,
        tags: 'RAG, AI'
      })
    });
    const createData = await createRes.json();
    serviceId = createData.service.id;
    console.log(`✅ Service created with ID: ${serviceId}\n`);

    // 4. Test: Get My Services (Expert 1)
    console.log('📋 Test 1: Getting Expert 1\'s own services...');
    const getMyRes = await fetch(`${API_URL}/services/my`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${expert1Token}` }
    });
    const getMyData = await getMyRes.json();
    console.log(`Status: ${getMyRes.status}`);
    console.log(`Count of services found: ${getMyData.services.length}`);
    if (getMyRes.status === 200 && getMyData.services.length > 0) {
      console.log('✅ Test 1 Passed: Retrieved expert services list successfully.\n');
    } else {
      throw new Error('❌ Test 1 Failed');
    }

    // 5. Test: Get Service By ID (Client)
    console.log('📋 Test 2: Getting service details by ID (using Client account)...');
    const getByIdRes = await fetch(`${API_URL}/services/${serviceId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${clientToken}` }
    });
    const getByIdData = await getByIdRes.json();
    console.log(`Status: ${getByIdRes.status}`);
    console.log(`Service Title: ${getByIdData.service.title}`);
    if (getByIdRes.status === 200 && getByIdData.service.id === serviceId) {
      console.log('✅ Test 2 Passed: Retrieved service details successfully.\n');
    } else {
      throw new Error('❌ Test 2 Failed');
    }

    // 6. Test: Update Service (Expert 2 trying to update Expert 1\'s service - should fail)
    console.log('📋 Test 3: Updating Expert 1\'s service as Expert 2 (should be Forbidden)...');
    const updateFailRes = await fetch(`${API_URL}/services/${serviceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expert2Token}`
      },
      body: JSON.stringify({ title: 'Hacked Title' })
    });
    const updateFailData = await updateFailRes.json();
    console.log(`Status (Expected 403): ${updateFailRes.status}`);
    console.log(`Response: ${updateFailData.message}`);
    if (updateFailRes.status === 403) {
      console.log('✅ Test 3 Passed: Successfully blocked unauthorized service update.\n');
    } else {
      throw new Error('❌ Test 3 Failed');
    }

    // 7. Test: Update Service (Expert 1 updating their own service - should succeed)
    console.log('📋 Test 4: Updating Expert 1\'s service as Expert 1...');
    const updateSuccessRes = await fetch(`${API_URL}/services/${serviceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expert1Token}`
      },
      body: JSON.stringify({
        title: 'Optimized RAG Deployment',
        price: 600.00
      })
    });
    const updateSuccessData = await updateSuccessRes.json();
    console.log(`Status (Expected 200): ${updateSuccessRes.status}`);
    console.log(`Updated Title: ${updateSuccessData.service.title}`);
    console.log(`Updated Price: ${updateSuccessData.service.price}`);
    if (updateSuccessRes.status === 200 && updateSuccessData.service.price === '600.00') {
      console.log('✅ Test 4 Passed: Service updated successfully by owner.\n');
    } else {
      throw new Error('❌ Test 4 Failed');
    }

    // 8. Test: Delete Service (Expert 2 trying to delete Expert 1\'s service - should fail)
    console.log('📋 Test 5: Deleting Expert 1\'s service as Expert 2 (should be Forbidden)...');
    const deleteFailRes = await fetch(`${API_URL}/services/${serviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${expert2Token}` }
    });
    const deleteFailData = await deleteFailRes.json();
    console.log(`Status (Expected 403): ${deleteFailRes.status}`);
    console.log(`Response: ${deleteFailData.message}`);
    if (deleteFailRes.status === 403) {
      console.log('✅ Test 5 Passed: Successfully blocked unauthorized service deletion.\n');
    } else {
      throw new Error('❌ Test 5 Failed');
    }

    // 9. Test: Delete Service (Expert 1 deleting their own service - should succeed)
    console.log('📋 Test 6: Deleting Expert 1\'s service as Expert 1...');
    const deleteSuccessRes = await fetch(`${API_URL}/services/${serviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${expert1Token}` }
    });
    const deleteSuccessData = await deleteSuccessRes.json();
    console.log(`Status (Expected 200): ${deleteSuccessRes.status}`);
    console.log(`Deleted Item Title: ${deleteSuccessData.data.title}`);
    if (deleteSuccessRes.status === 200 && deleteSuccessData.data.id === serviceId) {
      console.log('✅ Test 6 Passed: Service deleted successfully by owner.\n');
    } else {
      throw new Error('❌ Test 6 Failed');
    }

    // 10. Verify deletion in database
    const dbCheckRes = await pool.query('SELECT * FROM services WHERE id = $1', [serviceId]);
    if (dbCheckRes.rows.length === 0) {
      console.log('⚡ Direct database query confirms service row was deleted.');
      console.log('✅ Test Direct Database Check Passed.\n');
    } else {
      throw new Error('❌ Database Check Failed: Service row still exists');
    }

    console.log('==================================================');
    console.log('🎉 ALL SERVICE CRUD INTEGRATION TESTS PASSED!');
    console.log('==================================================');

  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
