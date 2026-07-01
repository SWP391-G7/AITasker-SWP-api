const { pool } = require('./src/config/db');

const API_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Running AITasker Projects & Milestones Integration Tests');
  console.log('==================================================\n');

  const clientEmail = `client_proj_${Date.now()}@example.com`;
  const expertEmail = `expert_proj_${Date.now()}@example.com`;
  const password = 'SecurePassword2026';
  
  let clientToken = '';
  let expertToken = '';
  
  let clientId = '';
  let expertId = '';
  let jobId = '';
  let proposalId = '';
  let projectId = '';
  let milestoneId = '';

  try {
    // 1. Register Users
    console.log('📋 Registering client and expert...');
    
    // Register Client
    const regClientRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Project Client', email: clientEmail, password, role: 'client' })
    });
    const regClientData = await regClientRes.json();
    clientId = regClientData.user?.id || regClientData.data?.id;
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [clientEmail.toLowerCase()]);

    // Register Expert
    const regExpertRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Project Expert', email: expertEmail, password, role: 'expert' })
    });
    const regExpertData = await regExpertRes.json();
    expertId = regExpertData.user?.id || regExpertData.data?.id;
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [expertEmail.toLowerCase()]);

    console.log('✅ Users registered.\n');

    // 2. Log in users
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
    expertToken = await login(expertEmail);
    console.log('✅ Users logged in.\n');

    // 3. Post a Job Post as Client
    console.log('📋 Posting a job as client...');
    const jobRes = await fetch(`${API_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        title: 'Deep Learning Model Optimization',
        description: 'Optimize training speeds for LLMs.',
        budgetMin: 1000,
        budgetMax: 2000,
        requiredSkill: 'PyTorch',
        durationDays: 14
      })
    });
    const jobData = await jobRes.json();
    jobId = jobData.jobPost.id;
    console.log(`✅ Job created with ID: ${jobId}\n`);

    // 4. Submit proposal as Expert
    console.log('📋 Submitting proposal as expert...');
    const proposalRes = await fetch(`${API_URL}/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        job_id: jobId,
        cover_letter: 'I can optimize your model by 40%.',
        bid_amount: 1500,
        delivery_days: 10
      })
    });
    const proposalData = await proposalRes.json();
    proposalId = proposalData.proposal.id;
    console.log(`✅ Proposal submitted with ID: ${proposalId}\n`);

    // 5. Approve proposal with start_project = false
    console.log('📋 Test 1: Client approves proposal, start_project = false...');
    const approveRes = await fetch(`${API_URL}/proposals/${proposalId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        status: 'accepted',
        start_project: false
      })
    });
    const approveData = await approveRes.json();
    
    // Check job status in DB
    const checkJobStatus = await pool.query('SELECT status FROM job_posts WHERE id = $1', [jobId]);
    console.log(`Job status in DB: ${checkJobStatus.rows[0].status}`);
    
    if (approveRes.status === 200 && checkJobStatus.rows[0].status === 'pending') {
      console.log('✅ Test 1 Passed: Proposal accepted and Job Post status is pending.\n');
    } else {
      throw new Error('❌ Test 1 Failed');
    }

    // 6. Create project manually from pending Job Post
    console.log('📋 Test 2: Client manually creates project from pending Job Post...');
    const createProjRes = await fetch(`${API_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        job_id: jobId
      })
    });
    const createProjData = await createProjRes.json();
    
    if (createProjRes.status === 201) {
      projectId = createProjData.project.id;
      console.log(`Created Project ID: ${projectId}`);
      // Verify job post is deleted
      const checkJobDeleted = await pool.query('SELECT 1 FROM job_posts WHERE id = $1', [jobId]);
      if (checkJobDeleted.rows.length === 0) {
        console.log('✅ Test 2 Passed: Project created and Job Post successfully deleted/transferred.\n');
      } else {
        throw new Error('❌ Test 2 Failed: Job post was not deleted');
      }
    } else {
      throw new Error(`❌ Test 2 Failed: status code ${createProjRes.status} - ${createProjData.message}`);
    }

    // 7. Expert creates milestone
    console.log('📋 Test 3: Expert creates a milestone for the project...');
    const mileCreateRes = await fetch(`${API_URL}/milestones/project/${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        title: 'Phase 1: Profiling and bottleneck analysis',
        content: 'Identify performance bottlenecks.',
        amount: 500,
        due_date: '2026-08-01'
      })
    });
    const mileCreateData = await mileCreateRes.json();
    
    if (mileCreateRes.status === 201 && mileCreateData.milestone.status === 'pending') {
      milestoneId = mileCreateData.milestone.id;
      console.log(`✅ Test 3 Passed: Milestone created with ID ${milestoneId}.\n`);
    } else {
      throw new Error('❌ Test 3 Failed');
    }

    // 8. Expert updates milestone
    console.log('📋 Test 4: Expert updates the milestone...');
    const mileUpdateRes = await fetch(`${API_URL}/milestones/${milestoneId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        title: 'Phase 1: Updated Title',
        amount: 600
      })
    });
    const mileUpdateData = await mileUpdateRes.json();
    
    if (mileUpdateRes.status === 200 && parseFloat(mileUpdateData.milestone.amount) === 600) {
      console.log('✅ Test 4 Passed: Milestone details successfully updated.\n');
    } else {
      throw new Error('❌ Test 4 Failed');
    }

    // 9. Expert deletes and recreates milestone (to test deletion)
    console.log('📋 Test 5: Expert deletes the milestone...');
    const mileDeleteRes = await fetch(`${API_URL}/milestones/${milestoneId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${expertToken}` }
    });
    
    if (mileDeleteRes.status === 200) {
      console.log('✅ Milestone deleted.');
      // Re-create it so client can pay
      const recreateRes = await fetch(`${API_URL}/milestones/project/${projectId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expertToken}`
        },
        body: JSON.stringify({
          title: 'Final Phase: Implementation',
          amount: 1500
        })
      });
      const recreateData = await recreateRes.json();
      milestoneId = recreateData.milestone.id;
      console.log(`✅ Test 5 Passed: Milestone deleted and recreated successfully.\n`);
    } else {
      throw new Error('❌ Test 5 Failed');
    }

    // 10. Client pays for the milestone
    console.log('📋 Test 6: Client pays for the milestone...');
    const payRes = await fetch(`${API_URL}/milestones/${milestoneId}/pay`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${clientToken}` }
    });
    const payData = await payRes.json();
    
    // Check project status in DB
    const checkProjectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    const updatedProject = checkProjectRes.rows[0];
    
    if (payRes.status === 200 && payData.milestone.status === 'released' && updatedProject.status === 'completed' && updatedProject.end_date !== null) {
      console.log('✅ Test 6 Passed: Milestone paid/released, and project automatically completed with end_date.\n');
    } else {
      throw new Error(`❌ Test 6 Failed: project status ${updatedProject.status}, end_date: ${updatedProject.end_date}`);
    }

    // 11. Test: Approve proposal with start_project = true (automatic start)
    console.log('📋 Test 7: Client approves proposal, start_project = true...');
    // Create new job
    const jobRes2 = await fetch(`${API_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        title: 'Project 2 title',
        budgetMax: 500
      })
    });
    const jobData2 = await jobRes2.json();
    const jobId2 = jobData2.jobPost.id;
    
    // Submit proposal
    const propRes2 = await fetch(`${API_URL}/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        job_id: jobId2,
        bid_amount: 400,
        delivery_days: 2
      })
    });
    const propData2 = await propRes2.json();
    const proposalId2 = propData2.proposal.id;
    
    // Accept proposal immediately starting project
    const approveRes2 = await fetch(`${API_URL}/proposals/${proposalId2}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        status: 'accepted',
        start_project: true
      })
    });
    const approveData2 = await approveRes2.json();
    const project2Id = approveData2.project.id;
    
    const checkJobDeleted2 = await pool.query('SELECT 1 FROM job_posts WHERE id = $1', [jobId2]);
    
    if (approveRes2.status === 200 && approveData2.project !== null && checkJobDeleted2.rows.length === 0) {
      console.log(`✅ Test 7 Passed: Project created immediately (ID: ${project2Id}) and job post deleted.\n`);
    } else {
      throw new Error('❌ Test 7 Failed');
    }

    // 12. Close/abandon project as Client
    console.log('📋 Test 8: Client closes/abandons project...');
    const closeRes = await fetch(`${API_URL}/projects/${project2Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        status: 'terminated'
      })
    });
    const closeData = await closeRes.json();
    
    if (closeRes.status === 200 && closeData.project.status === 'terminated' && closeData.project.end_date !== null) {
      console.log('✅ Test 8 Passed: Client successfully abandoned project. Status is terminated and end_date is populated.\n');
    } else {
      throw new Error('❌ Test 8 Failed');
    }

    console.log('==================================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('==================================================');

  } catch (error) {
    console.error('❌ Integration Tests Failed:', error.message);
    process.exit(1);
  } finally {
    pool.end();
  }
}

runTests();
