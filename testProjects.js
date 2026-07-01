const { pool } = require('./src/config/db');

const API_URL = 'http://localhost:5000/api';

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Running AITasker Projects & Milestones Tests');
  console.log('==================================================\n');

  const clientEmail = `client_${Date.now()}@example.com`;
  const expertEmail = `expert_${Date.now()}@example.com`;
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
      body: JSON.stringify({ fullName: 'Test Client', email: clientEmail, password, role: 'client' })
    });
    const clientData = await regClientRes.json();
    clientId = clientData.user?.id;
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [clientEmail.toLowerCase()]);

    // Register Expert
    const regExpertRes = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Test Expert', email: expertEmail, password, role: 'expert' })
    });
    const expertData = await regExpertRes.json();
    expertId = expertData.user?.id;
    await pool.query('UPDATE users SET is_verified = true WHERE email = $1', [expertEmail.toLowerCase()]);

    console.log('✅ Users registered.\n');

    // Log in users
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

    // 2. Post a Job as Client
    console.log('📋 Posting a job as client...');
    const jobRes = await fetch(`${API_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        title: 'Project Integration System',
        description: 'Need assistance building modular projects.',
        budgetMin: 100,
        budgetMax: 500,
        requiredSkill: 'Node.js',
        durationDays: 10,
        deadline: new Date(Date.now() + 86400000 * 5).toISOString()
      })
    });
    const jobData = await jobRes.json();
    jobId = jobData.jobPost.id;
    console.log(`✅ Job posted. ID: ${jobId}\n`);

    // 3. Submit a Proposal as Expert
    console.log('📋 Submitting a proposal as expert...');
    const proposalRes = await fetch(`${API_URL}/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        job_id: jobId,
        cover_letter: 'I am highly experienced with Node.js and SQL.',
        bid_amount: 300,
        delivery_days: 7
      })
    });
    const proposalData = await proposalRes.json();
    proposalId = proposalData.proposal.id;
    console.log(`✅ Proposal submitted. ID: ${proposalId}\n`);

    // 4. Accept Proposal but don't start project immediately (No flow)
    console.log('📋 Accepting proposal with start_project = false...');
    const acceptRes = await fetch(`${API_URL}/proposals/${proposalId}/status`, {
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
    const acceptData = await acceptRes.json();
    console.log(`Status status: ${acceptRes.status}`);
    
    // Verify job post is in 'pending' status
    const dbJobCheck = await pool.query('SELECT status FROM job_posts WHERE id = $1', [jobId]);
    console.log(`Job status in DB: ${dbJobCheck.rows[0].status}`);
    if (dbJobCheck.rows[0].status === 'pending') {
      console.log('✅ Test Passed: Job is in pending status.\n');
    } else {
      throw new Error('❌ Test Failed: Job status is not pending');
    }

    // 5. Create project manually from pending job post (Yes flow later)
    console.log('📋 Creating project manually from job post...');
    const createProjectRes = await fetch(`${API_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        job_id: jobId
      })
    });
    const createProjectData = await createProjectRes.json();
    projectId = createProjectData.project.id;
    console.log(`✅ Project created manually. ID: ${projectId}`);
    
    // Verify job post is now 'closed'
    const dbJobCheckClosed = await pool.query('SELECT status FROM job_posts WHERE id = $1', [jobId]);
    console.log(`Job status in DB now: ${dbJobCheckClosed.rows[0].status}`);
    if (dbJobCheckClosed.rows[0].status === 'closed') {
      console.log('✅ Test Passed: Job is now closed.\n');
    } else {
      throw new Error('❌ Test Failed: Job status is not closed');
    }

    // 6. Expert creates a Milestone
    console.log('📋 Creating a milestone as expert...');
    const milestoneRes = await fetch(`${API_URL}/milestones/project/${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        title: 'Initial architecture setup',
        content: 'Design backend layout and connect db tables.',
        amount: 150,
        due_date: new Date(Date.now() + 86400000 * 2).toISOString()
      })
    });
    const milestoneData = await milestoneRes.json();
    milestoneId = milestoneData.milestone.id;
    console.log(`✅ Milestone created. ID: ${milestoneId}\n`);

    // 7. Expert updates the Milestone
    console.log('📋 Updating milestone details...');
    const updateMilestoneRes = await fetch(`${API_URL}/milestones/${milestoneId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        title: 'Initial Architecture Setup (Revised)',
        amount: 200
      })
    });
    const updateMilestoneData = await updateMilestoneRes.json();
    console.log(`Updated title: ${updateMilestoneData.milestone.title}`);
    console.log(`Updated amount: ${updateMilestoneData.milestone.amount}`);
    if (updateMilestoneData.milestone.amount === '200.00') {
      console.log('✅ Test Passed: Milestone amount updated successfully.\n');
    } else {
      throw new Error('❌ Test Failed: Milestone amount not updated');
    }

    // 8. Client pays for the Milestone
    console.log('📋 Client starts payment for milestone...');
    const payRes = await fetch(`${API_URL}/milestones/${milestoneId}/pay`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      }
    });
    const payData = await payRes.json();
    console.log(`Milestone paid status: ${payData.milestone.status}`);
    console.log(`Project completed?: ${payData.projectCompleted}`);
    
    if (payData.milestone.status === 'released' && payData.projectCompleted === true) {
      console.log('✅ Test Passed: Milestone paid and project completed automatically.\n');
    } else {
      throw new Error('❌ Test Failed: Milestone payment flow failure');
    }

    // Verify Project status in DB is completed and end_date is filled
    const projectCheck = await pool.query('SELECT status, end_date FROM projects WHERE id = $1', [projectId]);
    console.log(`Project DB Status: ${projectCheck.rows[0].status}`);
    console.log(`Project DB End Date: ${projectCheck.rows[0].end_date}`);
    if (projectCheck.rows[0].status === 'completed' && projectCheck.rows[0].end_date !== null) {
      console.log('✅ Test Passed: Project database completion verified.\n');
    } else {
      throw new Error('❌ Test Failed: Project database values incorrect');
    }

    // 9. Verify getMyProjects endpoint
    console.log('📋 Testing getMyProjects for client...');
    const getProjectsRes = await fetch(`${API_URL}/projects`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${clientToken}` }
    });
    const getProjectsData = await getProjectsRes.json();
    console.log(`Projects found for client: ${getProjectsData.projects.length}`);
    if (getProjectsData.projects.length > 0) {
      console.log('✅ Test Passed: Retrieved client projects list.\n');
    } else {
      throw new Error('❌ Test Failed: Client projects list empty');
    }

    // 10. Client accepts proposal with start_project = true (Auto flow)
    console.log('📋 Test Auto Flow: Posting a second job...');
    const job2Res = await fetch(`${API_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        title: 'Task Two',
        budgetMin: 50,
        budgetMax: 100
      })
    });
    const job2Data = await job2Res.json();
    const job2Id = job2Data.jobPost.id;

    console.log('📋 Submitting second proposal...');
    const proposal2Res = await fetch(`${API_URL}/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expertToken}`
      },
      body: JSON.stringify({
        job_id: job2Id,
        bid_amount: 80,
        delivery_days: 3
      })
    });
    const proposal2Data = await proposal2Res.json();
    const proposal2Id = proposal2Data.proposal.id;

    console.log('📋 Approving second proposal with start_project = true...');
    const approve2Res = await fetch(`${API_URL}/proposals/${proposal2Id}/status`, {
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
    const approve2Data = await approve2Res.json();
    const autoProjectId = approve2Data.project.id;
    console.log(`✅ Project auto created. ID: ${autoProjectId}`);

    // Verify job post status is 'closed'
    const job2Check = await pool.query('SELECT status FROM job_posts WHERE id = $1', [job2Id]);
    console.log(`Job 2 status: ${job2Check.rows[0].status}`);

    // 11. Client closes/abandons project
    console.log('📋 Client closes project (abandoned)...');
    const closeProjectRes = await fetch(`${API_URL}/projects/${autoProjectId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clientToken}`
      },
      body: JSON.stringify({
        status: 'terminated'
      })
    });
    const closeProjectData = await closeProjectRes.json();
    console.log(`Closed Project status: ${closeProjectData.project.status}`);
    console.log(`Closed Project end date: ${closeProjectData.project.end_date}`);

    if (closeProjectData.project.status === 'terminated' && closeProjectData.project.end_date !== null) {
      console.log('✅ Test Passed: Project closed successfully.\n');
    } else {
      throw new Error('❌ Test Failed: Project closure failure');
    }

    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');

  } catch (error) {
    console.error('❌ Integration Test Failure:', error);
    process.exit(1);
  } finally {
    pool.end();
  }
}

runTests();
