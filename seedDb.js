const { pool } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function seedDatabase() {
  console.log('===================================================');
  console.log('Starting Database Seeding with Rich Mock Dataset');
  console.log('===================================================\n');

  const client = await pool.connect();
  const hashedPassword = bcrypt.hashSync('SecurePassword2026', 10);

  try {
    await client.query('BEGIN');

    // ----------------------------------------------------
    // STEP 0: Clean existing tables
    // ----------------------------------------------------
    console.log('Cleaning all tables...');
    await client.query(`
      TRUNCATE TABLE 
        users, 
        expert_profiles, 
        client_profiles, 
        services, 
        invitations, 
        job_posts, 
        proposals, 
        ai_logs, 
        projects, 
        conversations, 
        messages, 
        milestones, 
        transactions, 
        payments, 
        reviews, 
        disputes, 
        email_verification_codes 
      CASCADE;
    `);
    console.log('Tables cleaned successfully.');

    // ----------------------------------------------------
    // STEP 1: Insert Users
    // ----------------------------------------------------
    console.log('\nSeeding Users...');
    
    // Admins
    const adminRes = await client.query(`
      INSERT INTO users (password, full_name, email, role, is_verified)
      VALUES ($1, 'Global Admin', 'admin@example.com', 'admin', true)
      RETURNING id;
    `, [hashedPassword]);
    const adminId = adminRes.rows[0].id;
    console.log(`- Created Admin: admin@example.com (ID: ${adminId})`);

    // Experts
    const expertsData = [
      { email: 'expert1@example.com', name: 'Dr. Sarah Chen' },
      { email: 'expert2@example.com', name: 'Marcus Holloway' },
      { email: 'expert3@example.com', name: 'Elena Rostova' },
      { email: 'expert4@example.com', name: 'David K.' }
    ];
    const expertIds = {};
    for (const exp of expertsData) {
      const res = await client.query(`
        INSERT INTO users (password, full_name, email, role, is_verified)
        VALUES ($1, $2, $3, 'expert', true)
        RETURNING id;
      `, [hashedPassword, exp.name, exp.email]);
      expertIds[exp.email] = res.rows[0].id;
      console.log(`- Created Expert: ${exp.email} (ID: ${res.rows[0].id})`);
    }

    // Clients
    const clientsData = [
      { email: 'client1@example.com', name: 'John Smith (TechCorp)' },
      { email: 'client2@example.com', name: 'Jane Doe (HealthAI)' },
      { email: 'client3@example.com', name: 'Bob Johnson (EduLearn)' }
    ];
    const clientIds = {};
    for (const cli of clientsData) {
      const res = await client.query(`
        INSERT INTO users (password, full_name, email, role, is_verified)
        VALUES ($1, $2, $3, 'client', true)
        RETURNING id;
      `, [hashedPassword, cli.name, cli.email]);
      clientIds[cli.email] = res.rows[0].id;
      console.log(`- Created Client: ${cli.email} (ID: ${res.rows[0].id})`);
    }

    // ----------------------------------------------------
    // STEP 2: Insert Expert Profiles
    // ----------------------------------------------------
    console.log('\nSeeding Expert Profiles...');
    
    await client.query(`
      INSERT INTO expert_profiles (id, professional_title, skills, experience, portfolio_url, hourly_rate, bio, ai_specializations, avg_rating)
      VALUES 
        ($1, 'Senior ML Engineer & PhD', 'LLM Tuning, PyTorch, RAG Systems, Python', '8 years', 'https://sarahchen.ai', '$180/hr', 'Former OpenAI researcher specializing in fine-tuning, RAG systems, and neural network optimization.', 'NLP, Deep Learning', 4.9),
        ($2, 'Lead MLOps Architect', 'TensorFlow, AWS SageMaker, Kubernetes, AI Integration', '6 years', 'https://marcus.dev', '$225/hr', 'Specialist in scaling AI workloads, building high-availability inference setups, and hybrid-cloud ML pipelines.', 'MLOps, AI Infrastructure', 5.0),
        ($3, 'Computer Vision Researcher', 'OpenCV, PyTorch, YOLO, Computer Vision', '5 years', 'https://elena.vision', '$150/hr', 'Expert in custom object detection, image segmentation pipelines, and model deployment on edge devices.', 'Computer Vision, Image Processing', 4.8),
        ($4, 'Generative AI Developer', 'LangChain, OpenAI API, Automation, Data', '3 years', 'https://davidk.ai', '$120/hr', 'Specialized in building LLM agents, multi-agent frameworks, chat bots, and custom workflow automation.', 'Generative AI, Web Automation', 4.7);
    `, [expertIds['expert1@example.com'], expertIds['expert2@example.com'], expertIds['expert3@example.com'], expertIds['expert4@example.com']]);
    console.log('Expert profiles created.');

    // ----------------------------------------------------
    // STEP 3: Insert Client Profiles
    // ----------------------------------------------------
    console.log('\nSeeding Client Profiles...');
    
    await client.query(`
      INSERT INTO client_profiles (id, company_name, industry, bio)
      VALUES 
        ($1, 'TechCorp Solutions', 'Technology', 'A software development agency building next-generation developer tools and internal automation.'),
        ($2, 'HealthAI Technologies', 'Healthcare', 'A digital health startup creating artificial intelligence diagnostics tools and patient triage systems.'),
        ($3, 'EduLearn Platform', 'Education', 'An interactive platform offering personalized learning solutions for K-12 and university mathematics.');
    `, [clientIds['client1@example.com'], clientIds['client2@example.com'], clientIds['client3@example.com']]);
    console.log('Client profiles created.');

    // ----------------------------------------------------
    // STEP 4: Insert Services (Gigs/Offerings)
    // ----------------------------------------------------
    console.log('\nSeeding Services (Marketplace Gigs)...');
    
    const serviceRes1 = await client.query(`
      INSERT INTO services (expert_id, title, description, price, pricing_type, delivery_days, tags, avg_rating)
      VALUES ($1, 'Custom RAG Pipeline Deployment', 'I will build and deploy a state-of-the-art Retrieval Augmented Generation (RAG) system using Pinecone, LangChain, and GPT-4. Perfect for searching through thousands of PDF manuals or user documentation with high accuracy.', 1500.00, 'fixed', 7, 'RAG SYSTEMS, NLP', 4.9)
      RETURNING id;
    `, [expertIds['expert1@example.com']]);
    const service1Id = serviceRes1.rows[0].id;

    await client.query(`
      INSERT INTO services (expert_id, title, description, price, pricing_type, delivery_days, tags, avg_rating)
      VALUES 
        ($1, 'LLM Fine-tuning on Custom Dataset', 'Fine-tuning open-source models (Llama-3, Mistral) on your domain-specific dataset for custom conversational agents or automated ticket routing.', 3000.00, 'fixed', 14, 'LLM TUNING, PYTORCH', 4.8),
        ($2, 'MLOps Setup & Cloud Scaling', 'Establish automated training and deployment pipelines using AWS SageMaker and Kubernetes. Complete with monitoring dashboard and drift alerts.', 2500.00, 'fixed', 10, 'AWS SAGEMAKER, KUBERNETES', 5.0),
        ($3, 'YOLO-based Real-time Object Detection', 'Custom YOLO model training and setup for real-time video feeds, object counting, security monitoring, or industrial sorting.', 1800.00, 'fixed', 5, 'YOLO, COMPUTER VISION', 4.8),
        ($4, 'Multi-Agent LangChain Automation', 'Connecting multiple LLM agents together to perform complex tasks such as market research, web scraping, and automatic report drafting.', 1200.00, 'fixed', 4, 'LANGCHAIN, OPENAI API', 4.6);
    `, [expertIds['expert1@example.com'], expertIds['expert2@example.com'], expertIds['expert3@example.com'], expertIds['expert4@example.com']]);
    console.log(`Services created. (Example Service ID: ${service1Id})`);

    // ----------------------------------------------------
    // STEP 5: Insert Job Posts (Tasks)
    // ----------------------------------------------------
    console.log('\nSeeding Job Posts (Client Tasks)...');
    
    const jobRes1 = await client.query(`
      INSERT INTO job_posts (client_id, title, description, budget_min, budget_max, required_skill, duration_days, status)
      VALUES ($1, 'NLP Document Parser for Legal Contracts', 'We need an expert to build a parser that extracts key dates, termination clauses, and financial terms from legal PDFs. Output must be structured JSON.', 1000.00, 3000.00, 'NLP, Python', 10, 'open')
      RETURNING id;
    `, [clientIds['client1@example.com']]);
    const job1Id = jobRes1.rows[0].id;

    const jobRes2 = await client.query(`
      INSERT INTO job_posts (client_id, title, description, budget_min, budget_max, required_skill, duration_days, status)
      VALUES ($1, 'AI Medical Image Segmentation Model', 'Train a model (e.g. UNet) on MRI scans to segment brain tumors. Vetted experts only with medical AI background. Data is annotated.', 3000.00, 8000.00, 'Computer Vision, PyTorch', 30, 'closed')
      RETURNING id;
    `, [clientIds['client2@example.com']]);
    const job2Id = jobRes2.rows[0].id;

    const jobRes3 = await client.query(`
      INSERT INTO job_posts (client_id, title, description, budget_min, budget_max, required_skill, duration_days, status)
      VALUES ($1, 'Personalized Math Tutor Chatbot', 'Build a chatbot helper for student math problems. Must integrate with LaTeX rendering and handle algebra, calculus questions using step-by-step reasoning.', 1500.00, 2500.00, 'AI Integration, Gen AI', 15, 'closed')
      RETURNING id;
    `, [clientIds['client3@example.com']]);
    const job3Id = jobRes3.rows[0].id;

    console.log(`Job posts created. (Job IDs: ${job1Id}, ${job2Id}, ${job3Id})`);

    // ----------------------------------------------------
    // STEP 6: Insert Proposals
    // ----------------------------------------------------
    console.log('\nSeeding Proposals...');
    
    // Proposals for Job 1 (NLP Parser)
    await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES 
        ($1, $3, 'I have built multiple PDF document extraction tools. I can deliver a custom parser with 98% accuracy.', 2000.00, 8, 'pending', 95.5),
        ($2, $3, 'MLOps and data preprocessing pipelines for document extraction. Happy to help scale your NLP parser.', 2500.00, 10, 'pending', 82.0);
    `, [expertIds['expert1@example.com'], expertIds['expert2@example.com'], job1Id]);

    // Proposals for Job 2 (Medical Image Segmentation)
    const propRes1 = await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES ($1, $2, 'I hold a PhD in medical computer vision and have developed similar UNet brain diagnostics projects. Excited to help.', 5000.00, 25, 'accepted', 98.2)
      RETURNING id;
    `, [expertIds['expert1@example.com'], job2Id]);
    const acceptedProposal1Id = propRes1.rows[0].id;

    await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES 
        ($1, $3, 'I specialize in Computer Vision and OpenCV, and have previously deployed YOLO models for segmenting cells.', 4000.00, 20, 'pending', 89.0),
        ($2, $3, 'Generative AI and agent developer here. I can write the LLM backend for processing reports.', 3500.00, 15, 'rejected', 60.5);
    `, [expertIds['expert3@example.com'], expertIds['expert4@example.com'], job2Id]);

    // Proposals for Job 3 (Math Tutor)
    const propRes2 = await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES ($1, $2, 'I can build this chatbot using OpenAI Assistants API and LangChain with custom LaTeX rendering scripts.', 2000.00, 12, 'accepted', 92.0)
      RETURNING id;
    `, [expertIds['expert4@example.com'], job3Id]);
    const acceptedProposal2Id = propRes2.rows[0].id;

    console.log(`Proposals seeded. (Accepted Proposal IDs: ${acceptedProposal1Id}, ${acceptedProposal2Id})`);

    // ----------------------------------------------------
    // STEP 7: Insert Projects
    // ----------------------------------------------------
    console.log('\nSeeding Projects...');
    
    // Project 1: Sarah Chen & HealthAI (Active)
    const projRes1 = await client.query(`
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, deliverable, start_date)
      VALUES ($1, $2, 'fixed_milestone', 'active', 5000.00, true, NOW() - INTERVAL '5 days')
      RETURNING id;
    `, [expertIds['expert1@example.com'], clientIds['client2@example.com']]);
    const project1Id = projRes1.rows[0].id;

    // Project 2: David K & EduLearn (Completed)
    const projRes2 = await client.query(`
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, deliverable, start_date, end_date)
      VALUES ($1, $2, 'fixed_milestone', 'completed', 2000.00, true, NOW() - INTERVAL '15 days', NOW() - INTERVAL '2 days')
      RETURNING id;
    `, [expertIds['expert4@example.com'], clientIds['client3@example.com']]);
    const project2Id = projRes2.rows[0].id;

    console.log(`Projects created. (Project IDs: ${project1Id} [Active], ${project2Id} [Completed])`);

    // ----------------------------------------------------
    // STEP 8: Insert Milestones
    // ----------------------------------------------------
    console.log('\nSeeding Milestones...');
    
    // Milestones for Project 1 (Active, $5000 total)
    const mileRes1 = await client.query(`
      INSERT INTO milestones (project_id, title, content, amount, status, due_date, deliverable)
      VALUES 
        ($1, 'Data Preprocessing & UNet Architecture Setup', 'GitHub repository setup and data loaders ready.', 2000.00, 'released', NOW() - INTERVAL '1 days', true),
        ($1, 'Model Training & Validation Results', 'Trained model weights with validation metrics > 95% dice score.', 3000.00, 'funded', NOW() + INTERVAL '10 days', true)
      RETURNING id;
    `, [project1Id]);
    const milestone1Id = mileRes1.rows[0].id;

    // Milestones for Project 2 (Completed, $2000 total)
    await client.query(`
      INSERT INTO milestones (project_id, title, content, amount, status, due_date, deliverable)
      VALUES 
        ($1, 'Chatbot MVP Back-end', 'Express API endpoint connected to OpenAI.', 1000.00, 'released', NOW() - INTERVAL '10 days', true),
        ($1, 'LaTeX Integration & UI Delivery', 'Front-end chatbot component with LaTeX support.', 1000.00, 'released', NOW() - INTERVAL '3 days', true);
    `, [project2Id]);

    console.log(`Milestones seeded. (Project 1 Milestone 1 ID: ${milestone1Id})`);

    // ----------------------------------------------------
    // STEP 9: Insert Transactions & Payments
    // ----------------------------------------------------
    console.log('\nSeeding Transactions & Payments...');
    
    // Transaction for Project 1 Milestone 1 (Escrow Deposit)
    const transRes1 = await client.query(`
      INSERT INTO transactions (project_id, sender_id, receiver_id, amount, type, status, complete_at)
      VALUES ($1, $2, $3, 2000.00, 'escrow_deposit', 'completed', NOW() - INTERVAL '4 days')
      RETURNING id;
    `, [project1Id, clientIds['client2@example.com'], expertIds['expert1@example.com']]);
    const trans1Id = transRes1.rows[0].id;

    // Payment matching Transaction 1
    await client.query(`
      INSERT INTO payments (project_id, transaction_id, user_id, amount, type, paid_at)
      VALUES ($1, $2, $3, 2000.00, 'credit_card', NOW() - INTERVAL '4 days');
    `, [project1Id, trans1Id, clientIds['client2@example.com']]);

    // Transaction for Project 1 Milestone 1 (Escrow Release to Expert)
    const transRes2 = await client.query(`
      INSERT INTO transactions (project_id, sender_id, receiver_id, amount, type, status, complete_at)
      VALUES ($1, $2, $3, 2000.00, 'escrow_release', 'completed', NOW() - INTERVAL '1 days')
      RETURNING id;
    `, [project1Id, clientIds['client2@example.com'], expertIds['expert1@example.com']]);

    console.log(`Financial records seeded. (Deposit Trans: ${trans1Id}, Release Trans: ${transRes2.rows[0].id})`);

    // ----------------------------------------------------
    // STEP 10: Insert Conversations & Messages
    // ----------------------------------------------------
    console.log('\nSeeding Conversations & Messages...');
    
    // Conversation for Project 1
    const convRes1 = await client.query(`
      INSERT INTO conversations (sender_id, target_id, content)
      VALUES ($1, $2, 'Brain Tumor Image Segmentation Project Room')
      RETURNING id;
    `, [clientIds['client2@example.com'], expertIds['expert1@example.com']]);
    const conv1Id = convRes1.rows[0].id;

    // Messages
    await client.query(`
      INSERT INTO messages (user_id, conversation_id, content, is_read, send_at)
      VALUES 
        ($1, $3, 'Hello Dr. Chen, welcome to the project space! Have you had a chance to download the dataset?', true, NOW() - INTERVAL '4 days'),
        ($2, $3, 'Yes! I have successfully downloaded the scans and started setting up the preprocessing script.', true, NOW() - INTERVAL '3 days'),
        ($1, $3, 'Excellent. Please keep us updated on the preprocessing results.', false, NOW() - INTERVAL '2 hours');
    `, [clientIds['client2@example.com'], expertIds['expert1@example.com'], conv1Id]);

    // Conversation for Project 2
    const convRes2 = await client.query(`
      INSERT INTO conversations (sender_id, target_id, content)
      VALUES ($1, $2, 'Math Chatbot Project Room')
      RETURNING id;
    `, [clientIds['client3@example.com'], expertIds['expert4@example.com']]);
    const conv2Id = convRes2.rows[0].id;

    await client.query(`
      INSERT INTO messages (user_id, conversation_id, content, is_read, send_at)
      VALUES 
        ($2, $3, 'The back-end API endpoint is fully operational and outputs LaTeX formatting correctly.', true, NOW() - INTERVAL '12 days'),
        ($1, $3, 'Looks great. We will integrate it with our front-end client.', true, NOW() - INTERVAL '11 days');
    `, [clientIds['client3@example.com'], expertIds['expert4@example.com'], conv2Id]);

    console.log(`Conversations and messages created. (Room IDs: ${conv1Id}, ${conv2Id})`);

    // ----------------------------------------------------
    // STEP 11: Insert Reviews
    // ----------------------------------------------------
    console.log('\nSeeding Reviews...');
    
    await client.query(`
      INSERT INTO reviews (reviewer_id, reviewee_id, rating, comment, direction)
      VALUES 
        ($1, $2, 5, 'Dr. Chen delivered outstanding work. The UNet model met all our parameters and her medical tech knowledge is stellar.', 'client_to_expert'),
        ($2, $1, 5, 'Great experience working with HealthAI. Clear requirements and highly responsive engineers.', 'expert_to_client'),
        ($3, $4, 5, 'David was fast, efficient, and the math agent chatbot performs flawlessly.', 'client_to_expert');
    `, [clientIds['client2@example.com'], expertIds['expert1@example.com'], clientIds['client3@example.com'], expertIds['expert4@example.com']]);
    console.log('Reviews seeded.');

    // ----------------------------------------------------
    // STEP 12: Insert Disputes
    // ----------------------------------------------------
    console.log('\nSeeding Disputes...');
    
    await client.query(`
      INSERT INTO disputes (creator_id, target_id, project_id, message_log, type, title, content, is_resolved)
      VALUES ($1, $2, $3, 'Log: Client stated milestone was late. Expert replied data preprocessing took longer due to formatting issues.', 'delay', 'Late Milestone Delivery', 'The model validation results are delayed by 5 days and the expert is not responding to emails.', false);
    `, [clientIds['client2@example.com'], expertIds['expert1@example.com'], project1Id]);
    console.log('Dispute created.');

    // ----------------------------------------------------
    // STEP 13: Insert Invitations
    // ----------------------------------------------------
    console.log('\nSeeding Invitations...');
    
    await client.query(`
      INSERT INTO invitations (client_id, service_id, is_approved)
      VALUES ($1, $2, true);
    `, [clientIds['client1@example.com'], service1Id]);
    console.log('Service invitation created.');

    // ----------------------------------------------------
    // STEP 14: Insert AI Logs
    // ----------------------------------------------------
    console.log('\nSeeding AI Logs...');
    
    await client.query(`
      INSERT INTO ai_logs (user_id, module_type, input_prompt, ai_output)
      VALUES 
        ($1, 'job_assistant', 'Generate requirements for a computer vision engineer.', 'Key requirements: PyTorch, OpenCV, Object Detection, YOLO, Edge deployment experience.'),
        ($2, 'matchmaking', 'Find matching expert for contract NLP LEGAL PARSER', 'Sarah Chen: 98% match, Elena Rostova: 45% match.');
    `, [clientIds['client1@example.com'], clientIds['client2@example.com']]);
    console.log('AI logs created.');

    // ----------------------------------------------------
    // STEP 15: Insert Email Verification Codes
    // ----------------------------------------------------
    console.log('\nSeeding Email Verification Codes...');
    
    await client.query(`
      INSERT INTO email_verification_codes (email, code, expires_at, is_used)
      VALUES 
        ('expert1@example.com', '123456', NOW() - INTERVAL '10 minutes', true),
        ('client1@example.com', '654321', NOW() - INTERVAL '10 minutes', true);
    `);
    console.log('Email verification codes created.');

    await client.query('COMMIT');
    console.log('\n===================================================');
    console.log('DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('===================================================');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedDatabase();
