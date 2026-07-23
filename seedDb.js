const { pool } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function seedDatabase() {
  console.log('===================================================');
  console.log('Starting Database Seeding with Standard Seed Dataset');
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
        review, 
        disputes, 
        email_verification_codes 
      CASCADE;
    `);
    console.log('Tables cleaned successfully.');

    // ----------------------------------------------------
    // STEP 1: Insert Users (14 accounts: 1 Admin, 7 Experts, 6 Clients)
    // ----------------------------------------------------
    console.log('\nSeeding Users (14 total)...');
    
    // Admin
    const adminRes = await client.query(`
      INSERT INTO users (password, full_name, email, role, is_verified)
      VALUES ($1, 'Global Admin', 'admin@example.com', 'admin', true)
      RETURNING id;
    `, [hashedPassword]);
    const adminId = adminRes.rows[0].id;
    console.log(`- Created Admin: admin@example.com (ID: ${adminId})`);

    // Experts (7 total)
    const expertsData = [
      { email: 'expert1@example.com', name: 'Dr. Sarah Chen', title: 'Senior ML Engineer & PhD', skills: 'LLM Tuning, PyTorch, RAG Systems, Python', exp: '8 years', port: 'https://sarahchen.ai', rate: '$180/hr', bio: 'Former OpenAI researcher specializing in fine-tuning, RAG systems, and neural network optimization.', spec: 'NLP, Deep Learning', rating: 4.9 },
      { email: 'expert2@example.com', name: 'Marcus Holloway', title: 'Lead MLOps Architect', skills: 'TensorFlow, AWS SageMaker, Kubernetes, AI Integration', exp: '6 years', port: 'https://marcus.dev', rate: '$225/hr', bio: 'Specialist in scaling AI workloads, building high-availability inference setups, and hybrid-cloud ML pipelines.', spec: 'MLOps, AI Infrastructure', rating: 5.0 },
      { email: 'expert3@example.com', name: 'Elena Rostova', title: 'Computer Vision Researcher', skills: 'OpenCV, PyTorch, YOLO, Computer Vision', exp: '5 years', port: 'https://elena.vision', rate: '$150/hr', bio: 'Expert in custom object detection, image segmentation pipelines, and model deployment on edge devices.', spec: 'Computer Vision, Image Processing', rating: 4.8 },
      { email: 'expert4@example.com', name: 'David K.', title: 'Generative AI Developer', skills: 'LangChain, OpenAI API, Automation, Data', exp: '3 years', port: 'https://davidk.ai', rate: '$120/hr', bio: 'Specialized in building LLM agents, multi-agent frameworks, chat bots, and custom workflow automation.', spec: 'Generative AI, Web Automation', rating: 4.7 },
      { email: 'alex.nguyen@example.com', name: 'Alex Nguyen', title: 'NLP Solutions Engineer', skills: 'Python, Transformers, spaCy, RAG', exp: '4 years', port: 'https://alexnguyen.dev', rate: '$95/hr', bio: 'NLP Engineer focusing on semantic search, document classification, and entity extraction.', spec: 'Natural Language Processing', rating: 4.6 },
      { email: 'maya.patel@example.com', name: 'Maya Patel', title: 'AI Product Consultant', skills: 'Product Strategy, LLM, Prompt Engineering', exp: '5 years', port: 'https://mayapatel.ai', rate: '$110/hr', bio: 'Helping startups and enterprises integrate generative AI capabilities into production products.', spec: 'AI Product Strategy', rating: 4.8 },
      { email: 'sofia.martinez@example.com', name: 'Sofia Martinez', title: 'Computer Vision Engineer', skills: 'OpenCV, YOLO, PyTorch, CUDA', exp: '4 years', port: 'https://sofiam.vision', rate: '$135/hr', bio: 'Specializing in autonomous vision systems, defect inspection, and real-time streaming analytics.', spec: 'Computer Vision', rating: 4.7 }
    ];

    const expertIds = {};
    for (const exp of expertsData) {
      const res = await client.query(`
        INSERT INTO users (password, full_name, email, role, is_verified, acc_status)
        VALUES ($1, $2, $3, 'expert', true, true)
        RETURNING id;
      `, [hashedPassword, exp.name, exp.email]);
      const expId = res.rows[0].id;
      expertIds[exp.email] = expId;
      console.log(`- Created Expert: ${exp.email} (ID: ${expId})`);
    }

    // Clients (6 total)
    const clientsData = [
      { email: 'client1@example.com', name: 'John Smith', company: 'TechCorp Solutions', industry: 'Technology', budget: 15000.00, bio: 'A software development agency building next-generation developer tools and internal automation.' },
      { email: 'client2@example.com', name: 'Jane Doe', company: 'HealthAI Technologies', industry: 'Healthcare', budget: 25000.00, bio: 'A digital health startup creating artificial intelligence diagnostics tools and patient triage systems.' },
      { email: 'client3@example.com', name: 'Bob Johnson', company: 'EduLearn Platform', industry: 'Education', budget: 5000.00, bio: 'An interactive platform offering personalized learning solutions for K-12 and university mathematics.' },
      { email: 'client.nova@example.com', name: 'Olivia Davis', company: 'Nova Retail Labs', industry: 'Retail', budget: 18000.00, bio: 'E-commerce platform deploying AI recommendation engines and automated inventory forecast tools.' },
      { email: 'client.green@example.com', name: 'James Miller', company: 'GreenGrid Energy', industry: 'Energy', budget: 30000.00, bio: 'Clean energy startup using predictive machine learning for smart power distribution.' },
      { email: 'client.finpeak@example.com', name: 'Charlotte Moore', company: 'FinPeak Analytics', industry: 'Finance', budget: 45000.00, bio: 'Fintech firm offering automated financial risk modeling and market sentiment analysis.' }
    ];

    const clientIds = {};
    for (const cli of clientsData) {
      const res = await client.query(`
        INSERT INTO users (password, full_name, email, role, is_verified, acc_status)
        VALUES ($1, $2, $3, 'client', true, true)
        RETURNING id;
      `, [hashedPassword, cli.name, cli.email]);
      const cliId = res.rows[0].id;
      clientIds[cli.email] = cliId;
      console.log(`- Created Client: ${cli.email} (ID: ${cliId})`);
    }

    // ----------------------------------------------------
    // STEP 2: Insert Expert Profiles
    // ----------------------------------------------------
    console.log('\nSeeding Expert Profiles...');
    for (const exp of expertsData) {
      await client.query(`
        INSERT INTO expert_profiles (id, professional_title, skills, experience, portfolio_url, hourly_rate, bio, ai_specializations, avg_rating)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `, [
        expertIds[exp.email],
        exp.title,
        exp.skills,
        exp.exp,
        exp.port,
        exp.rate,
        exp.bio,
        exp.spec,
        exp.rating
      ]);
    }
    console.log('Expert profiles created.');

    // ----------------------------------------------------
    // STEP 3: Insert Client Profiles
    // ----------------------------------------------------
    console.log('\nSeeding Client Profiles...');
    for (const cli of clientsData) {
      await client.query(`
        INSERT INTO client_profiles (id, company_name, industry, bio, budget)
        VALUES ($1, $2, $3, $4, $5);
      `, [
        clientIds[cli.email],
        cli.company,
        cli.industry,
        cli.bio,
        cli.budget
      ]);
    }
    console.log('Client profiles created.');

    // ----------------------------------------------------
    // STEP 4: Insert Services (9 Services across 7 Experts: 2, 2, 1, 1, 1, 1, 1)
    // ----------------------------------------------------
    console.log('\nSeeding Services (9 total)...');
    
    const servicesList = [
      // Expert 1 (Dr. Sarah Chen): 2 services
      { expertEmail: 'expert1@example.com', title: 'Custom RAG Pipeline Deployment', desc: 'I will build and deploy a state-of-the-art Retrieval Augmented Generation (RAG) system using Pinecone, LangChain, and GPT-4. Perfect for searching through thousands of PDF manuals with high accuracy.', price: 1500.00, type: 'fixed', days: 7, tags: 'RAG SYSTEMS, NLP', rating: 4.9, status: 'approved' },
      { expertEmail: 'expert1@example.com', title: 'LLM Fine-tuning on Custom Dataset', desc: 'Fine-tuning open-source models (Llama-3, Mistral) on your domain-specific dataset for custom conversational agents or automated ticket routing.', price: 3000.00, type: 'fixed', days: 14, tags: 'LLM TUNING, PYTORCH', rating: 4.8, status: 'approved' },
      
      // Expert 2 (Marcus Holloway): 2 services
      { expertEmail: 'expert2@example.com', title: 'MLOps Setup & Cloud Scaling', desc: 'Establish automated training and deployment pipelines using AWS SageMaker and Kubernetes. Complete with monitoring dashboard and drift alerts.', price: 2500.00, type: 'fixed', days: 10, tags: 'AWS SAGEMAKER, KUBERNETES', rating: 5.0, status: 'approved' },
      { expertEmail: 'expert2@example.com', title: 'AI Infrastructure Audit & Optimization', desc: 'Comprehensive review of your cloud AI infrastructure to reduce latency by up to 40% and optimize GPU cluster compute costs.', price: 1800.00, type: 'fixed', days: 5, tags: 'MLOPS, CLOUD, GPU', rating: 4.9, status: 'approved' },

      // Expert 3 (Elena Rostova): 1 service
      { expertEmail: 'expert3@example.com', title: 'YOLO-based Real-time Object Detection', desc: 'Custom YOLO model training and setup for real-time video feeds, object counting, security monitoring, or industrial sorting.', price: 1800.00, type: 'fixed', days: 5, tags: 'YOLO, COMPUTER VISION', rating: 4.8, status: 'approved' },

      // Expert 4 (David K.): 1 service
      { expertEmail: 'expert4@example.com', title: 'Multi-Agent LangChain Automation', desc: 'Connecting multiple LLM agents together to perform complex tasks such as market research, web scraping, and automatic report drafting.', price: 1200.00, type: 'fixed', days: 4, tags: 'LANGCHAIN, OPENAI API', rating: 4.6, status: 'approved' },

      // Expert 5 (Alex Nguyen): 1 service
      { expertEmail: 'alex.nguyen@example.com', title: 'Domain-Specific Named Entity Recognition', desc: 'Train specialized spaCy and Transformer models to extract medical, legal, or financial entities from raw text documents.', price: 1400.00, type: 'fixed', days: 6, tags: 'NLP, SPACY, NER', rating: 4.7, status: 'approved' },

      // Expert 6 (Maya Patel): 1 service
      { expertEmail: 'maya.patel@example.com', title: 'AI Product Strategy & LLM Architecture', desc: 'Strategic consulting for AI product integration, vendor evaluation, prompt optimization, and tech stack design.', price: 2000.00, type: 'fixed', days: 7, tags: 'STRATEGY, PROMPT ENG', rating: 4.8, status: 'approved' },

      // Expert 7 (Sofia Martinez): 1 service
      { expertEmail: 'sofia.martinez@example.com', title: 'Industrial Defect Inspection Vision Pipeline', desc: 'Deploy automated visual quality control systems on edge hardware using PyTorch and OpenCV for manufacturing lines.', price: 2800.00, type: 'fixed', days: 12, tags: 'COMPUTER VISION, OPENCV', rating: 4.7, status: 'approved' }
    ];

    const serviceIds = [];
    for (const s of servicesList) {
      const res = await client.query(`
        INSERT INTO services (expert_id, title, description, price, pricing_type, delivery_days, tags, avg_rating, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id;
      `, [expertIds[s.expertEmail], s.title, s.desc, s.price, s.type, s.days, s.tags, s.rating, s.status]);
      serviceIds.push(res.rows[0].id);
    }
    console.log(`Created ${serviceIds.length} Services.`);

    // ----------------------------------------------------
    // STEP 5: Insert Job Posts (9 Job Posts across 6 Clients: 2, 2, 1, 1, 1, 2)
    // ----------------------------------------------------
    console.log('\nSeeding Job Posts (9 total)...');

    const jobPostsList = [
      // Client 1 (John Smith / TechCorp): 2 job posts
      { clientEmail: 'client1@example.com', title: 'NLP Document Parser for Legal Contracts', desc: 'We need an expert to build a parser that extracts key dates, termination clauses, and financial terms from legal PDFs. Output must be structured JSON.', req: 'NLP, Python', minB: 1000.00, maxB: 3000.00, days: 10, status: 'open' },
      { clientEmail: 'client1@example.com', title: 'Automated Code Review AI Assistant', desc: 'Build a GitHub action integration that uses Claude/GPT-4 to run static security and code style reviews on incoming PRs.', req: 'Node.js, GitHub API, LLMs', minB: 1500.00, maxB: 2500.00, days: 7, status: 'open' },

      // Client 2 (Jane Doe / HealthAI): 2 job posts
      { clientEmail: 'client2@example.com', title: 'AI Medical Image Segmentation Model', desc: 'Train a model (e.g. UNet) on MRI scans to segment brain tumors. Vetted experts only with medical AI background. Data is annotated.', req: 'Computer Vision, PyTorch', minB: 3000.00, maxB: 8000.00, days: 30, status: 'closed' },
      { clientEmail: 'client2@example.com', title: 'Patient Triage Chatbot with HIPAA Compliance', desc: 'Develop a conversational agent capable of collecting symptoms and routing non-emergency clinical requests safely.', req: 'Conversational AI, Python', minB: 4000.00, maxB: 7000.00, days: 20, status: 'open' },

      // Client 3 (Bob Johnson / EduLearn): 1 job post
      { clientEmail: 'client3@example.com', title: 'Personalized Math Tutor Chatbot', desc: 'Build a chatbot helper for student math problems. Must integrate with LaTeX rendering and handle algebra, calculus questions using step-by-step reasoning.', req: 'AI Integration, Gen AI', minB: 1500.00, maxB: 2500.00, days: 15, status: 'closed' },

      // Client 4 (Olivia Davis / Nova Retail): 1 job post
      { clientEmail: 'client.nova@example.com', title: 'Personalized E-Commerce Recommender Engine', desc: 'Implement collaborative filtering and vector embeddings to recommend products based on user browsing session data.', req: 'Data Science, Python, Recommenders', minB: 2500.00, maxB: 5000.00, days: 14, status: 'open' },

      // Client 5 (James Miller / GreenGrid): 1 job post
      { clientEmail: 'client.green@example.com', title: 'Predictive Solar Energy Generation Forecasting', desc: 'Develop time-series machine learning models to forecast solar power output based on weather radar and historic grid telemetry.', req: 'Python, Time-Series, XGBoost', minB: 3500.00, maxB: 6000.00, days: 18, status: 'open' },

      // Client 6 (Charlotte Moore / FinPeak): 2 job posts
      { clientEmail: 'client.finpeak@example.com', title: 'Financial Market Sentiment Analyzer from News Feeds', desc: 'Real-time NLP pipeline that ingests financial news feeds and computes ticker sentiment metrics with alert triggers.', req: 'NLP, Python, Financial Datasets', minB: 3000.00, maxB: 6000.00, days: 15, status: 'open' },
      { clientEmail: 'client.finpeak@example.com', title: 'Fraud Detection Anomaly Classification Pipeline', desc: 'Machine learning model pipeline to identify fraudulent transaction patterns with low false-positive rates.', req: 'Scikit-Learn, Python, Fraud Analytics', minB: 4000.00, maxB: 8000.00, days: 21, status: 'open' }
    ];

    const jobPostIds = [];
    for (const j of jobPostsList) {
      const res = await client.query(`
        INSERT INTO job_posts (client_id, title, description, required_skill, budget_min, budget_max, duration_days, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id;
      `, [clientIds[j.clientEmail], j.title, j.desc, j.req, j.minB, j.maxB, j.days, j.status]);
      jobPostIds.push(res.rows[0].id);
    }
    console.log(`Created ${jobPostIds.length} Job Posts.`);

    // ----------------------------------------------------
    // STEP 6: Insert Proposals
    // ----------------------------------------------------
    console.log('\nSeeding Proposals...');

    // Job 0: Legal Contract Parser (Client 1)
    await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES 
        ($1, $3, 'I have built multiple PDF document extraction tools. I can deliver a custom parser with 98% accuracy.', 2000.00, 8, 'pending', 95.5),
        ($2, $3, 'MLOps and data preprocessing pipelines for document extraction. Happy to help scale your NLP parser.', 2500.00, 10, 'pending', 82.0);
    `, [expertIds['expert1@example.com'], expertIds['expert2@example.com'], jobPostIds[0]]);

    // Job 2: Medical Image Segmentation (Client 2 - Closed/Accepted)
    const propRes1 = await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES ($1, $2, 'I hold a PhD in medical computer vision and have developed similar UNet brain diagnostics projects. Excited to help.', 5000.00, 25, 'accepted', 98.2)
      RETURNING id;
    `, [expertIds['expert1@example.com'], jobPostIds[2]]);
    const acceptedProposal1Id = propRes1.rows[0].id;

    await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES 
        ($1, $3, 'I specialize in Computer Vision and OpenCV, and have previously deployed YOLO models for segmenting cells.', 4000.00, 20, 'pending', 89.0),
        ($2, $3, 'Generative AI and agent developer here. I can write the LLM backend for processing reports.', 3500.00, 15, 'rejected', 60.5);
    `, [expertIds['expert3@example.com'], expertIds['expert4@example.com'], jobPostIds[2]]);

    // Job 4: Math Tutor Chatbot (Client 3 - Closed/Accepted)
    const propRes2 = await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES ($1, $2, 'I can build this chatbot using OpenAI Assistants API and LangChain with custom LaTeX rendering scripts.', 2000.00, 12, 'accepted', 92.0)
      RETURNING id;
    `, [expertIds['expert4@example.com'], jobPostIds[4]]);
    const acceptedProposal2Id = propRes2.rows[0].id;

    // Proposals for Nova Retail & GreenGrid jobs
    await client.query(`
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status, ai_match_score)
      VALUES 
        ($1, $3, 'Experienced in recommendation systems using Python and PyTorch. Can build vector search matching.', 3200.00, 12, 'pending', 91.0),
        ($2, $4, 'Experienced in time series modeling for smart energy grids. Let us build an XGBoost model.', 4500.00, 15, 'pending', 88.5);
    `, [expertIds['alex.nguyen@example.com'], expertIds['maya.patel@example.com'], jobPostIds[5], jobPostIds[6]]);

    console.log('Proposals seeded.');

    // ----------------------------------------------------
    // STEP 7: Insert Projects (Active & Completed + Historical Analytics)
    // ----------------------------------------------------
    console.log('\nSeeding Projects...');

    // Project 1: Sarah Chen & HealthAI (Active)
    const projRes1 = await client.query(`
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, proposal_id, deliverable, start_date)
      VALUES ($1, $2, 'fixed_milestone', 'active', 5000.00, $3, true, NOW() - INTERVAL '5 days')
      RETURNING id;
    `, [expertIds['expert1@example.com'], clientIds['client2@example.com'], acceptedProposal1Id]);
    const project1Id = projRes1.rows[0].id;

    // Project 2: David K & EduLearn (Completed)
    const projRes2 = await client.query(`
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, proposal_id, deliverable, start_date, end_date)
      VALUES ($1, $2, 'fixed_milestone', 'completed', 2000.00, $3, true, NOW() - INTERVAL '15 days', NOW() - INTERVAL '2 days')
      RETURNING id;
    `, [expertIds['expert4@example.com'], clientIds['client3@example.com'], acceptedProposal2Id]);
    const project2Id = projRes2.rows[0].id;

    // Historical Analytics Projects across 5 months
    const analyticsProjectsData = [
      { expert: 'expert1@example.com', client: 'client1@example.com', amount: 4200, status: 'completed', monthOffset: 4, startDay: 3 },
      { expert: 'expert2@example.com', client: 'client2@example.com', amount: 3600, status: 'completed', monthOffset: 4, startDay: 8 },
      { expert: 'expert3@example.com', client: 'client3@example.com', amount: 5200, status: 'completed', monthOffset: 4, startDay: 12 },
      { expert: 'expert4@example.com', client: 'client.nova@example.com', amount: 2400, status: 'completed', monthOffset: 3, startDay: 4 },
      { expert: 'alex.nguyen@example.com', client: 'client.green@example.com', amount: 3100, status: 'completed', monthOffset: 3, startDay: 9 },
      { expert: 'maya.patel@example.com', client: 'client.finpeak@example.com', amount: 4500, status: 'completed', monthOffset: 3, startDay: 13 },
      { expert: 'sofia.martinez@example.com', client: 'client1@example.com', amount: 6100, status: 'completed', monthOffset: 2, startDay: 2 },
      { expert: 'expert1@example.com', client: 'client2@example.com', amount: 3800, status: 'completed', monthOffset: 2, startDay: 7 },
      { expert: 'expert2@example.com', client: 'client.nova@example.com', amount: 2900, status: 'completed', monthOffset: 2, startDay: 11 },
      { expert: 'expert3@example.com', client: 'client.finpeak@example.com', amount: 2700, status: 'completed', monthOffset: 1, startDay: 8 },
      { expert: 'alex.nguyen@example.com', client: 'client.green@example.com', amount: 2600, status: 'completed', monthOffset: 1, startDay: 12 },
      { expert: 'expert1@example.com', client: 'client.nova@example.com', amount: 3200, status: 'completed', monthOffset: 0, startDay: 1 },
      { expert: 'expert4@example.com', client: 'client.green@example.com', amount: 1800, status: 'completed', monthOffset: 0, startDay: 2 },
      { expert: 'maya.patel@example.com', client: 'client.finpeak@example.com', amount: 5000, status: 'active', monthOffset: 0, startDay: 4 }
    ];

    const currentMonthIndex = new Date().getMonth();
    const historicalExperts = ['expert1@example.com', 'expert2@example.com', 'expert3@example.com', 'expert4@example.com', 'alex.nguyen@example.com', 'maya.patel@example.com'];
    const historicalClients = ['client1@example.com', 'client2@example.com', 'client3@example.com', 'client.nova@example.com', 'client.green@example.com', 'client.finpeak@example.com'];

    for (let monthOffset = currentMonthIndex; monthOffset >= 5; monthOffset -= 1) {
      const seq = currentMonthIndex - monthOffset;
      analyticsProjectsData.push({
        expert: historicalExperts[seq % historicalExperts.length],
        client: historicalClients[seq % historicalClients.length],
        amount: 2800 + seq * 450,
        status: 'completed',
        monthOffset,
        startDay: 3 + (seq % 5)
      });
    }

    const seededAnalyticsProjectIds = [];
    for (const project of analyticsProjectsData) {
      const expertId = expertIds[project.expert];
      const clientId = clientIds[project.client];

      const analyticsProjectRes = await client.query(`
        INSERT INTO projects (
          expert_id, client_id, type, status, total_amount,
          deliverable, start_date, end_date
        )
        VALUES (
          $1, $2, 'fixed_milestone', $3::project_status, $4, $5,
          date_trunc('month', CURRENT_DATE)
            - ($6::integer * INTERVAL '1 month')
            + ($7::integer * INTERVAL '1 day'),
          CASE
            WHEN LOWER($3::text) = 'completed' THEN
              date_trunc('month', CURRENT_DATE)
                - ($6::integer * INTERVAL '1 month')
                + (($7::integer + 12) * INTERVAL '1 day')
            ELSE NULL
          END
        )
        RETURNING id;
      `, [
        expertId,
        clientId,
        project.status,
        project.amount,
        project.status === 'completed',
        project.monthOffset,
        project.startDay
      ]);

      const analyticsProjectId = analyticsProjectRes.rows[0].id;
      seededAnalyticsProjectIds.push(analyticsProjectId);

      if (project.status === 'completed') {
        await client.query(`
          INSERT INTO transactions (
            project_id, sender_id, receiver_id, amount,
            type, status, funding_source, complete_at
          )
          VALUES (
            $1, $2, $3, $4,
            'escrow_release', 'completed', 'card',
            date_trunc('month', CURRENT_DATE)
              - ($5::integer * INTERVAL '1 month')
              + (($6::integer + 12) * INTERVAL '1 day')
          );
        `, [
          analyticsProjectId,
          clientId,
          expertId,
          project.amount,
          project.monthOffset,
          project.startDay
        ]);
      }
    }

    console.log(`Projects created. Base: ${project1Id}, ${project2Id}; analytics demo: ${seededAnalyticsProjectIds.length}.`);

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

    // Transaction for Project 1 Milestone 1 (Escrow Release)
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
      INSERT INTO review (creator_id, target_id, review)
      VALUES 
        ($1, $2, 'Dr. Chen delivered outstanding work. The UNet model met all our parameters and her medical tech knowledge is stellar.'),
        ($2, $1, 'Great experience working with HealthAI. Clear requirements and highly responsive engineers.'),
        ($3, $4, 'David was fast, efficient, and the math agent chatbot performs flawlessly.');
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
    `, [clientIds['client1@example.com'], serviceIds[0]]);
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
