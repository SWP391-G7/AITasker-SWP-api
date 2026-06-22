-- Enable UUID extension if not already active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- CREATE CUSTOM ENUM TYPES
-- ==========================================
CREATE TYPE user_role AS ENUM ('client', 'expert', 'admin');
CREATE TYPE pricing_type AS ENUM ('fixed', 'hourly');
CREATE TYPE job_status AS ENUM ('open', 'active', 'completed', 'cancelled');
CREATE TYPE proposal_status AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE ai_module_type AS ENUM ('job_assistant', 'service_generator', 'matchmaking');
CREATE TYPE project_type AS ENUM ('fixed_milestone', 'hourly_contract');
CREATE TYPE project_status AS ENUM ('active', 'completed', 'disputed', 'terminated');
CREATE TYPE milestone_status AS ENUM ('pending', 'funded', 'submitted', 'released');
CREATE TYPE transaction_type AS ENUM ('escrow_deposit', 'escrow_release', 'refund');
CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE payment_type AS ENUM ('credit_card', 'paypal', 'vnpay', 'momo');
CREATE TYPE review_direction AS ENUM ('client_to_expert', 'expert_to_client');

-- ==========================================
-- CREATE TABLES
-- ==========================================

-- 1. USER TABLE
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role user_role NOT NULL,
    is_verified BOOLEAN DEFAULT false,
    is_expert BOOLEAN DEFAULT false,
    created_at DATE DEFAULT CURRENT_DATE
);

-- 2. EXPERT PROFILE TABLE
CREATE TABLE expert_profiles (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    professional_title VARCHAR(255),
    skills TEXT,
    experience VARCHAR(100),
    portfolio_url VARCHAR(255),
    hourly_rate VARCHAR(50),
    bio TEXT,
    ai_specializations TEXT,
    avg_rating REAL DEFAULT 0.0
);

-- 3. CLIENT PROFILE TABLE
CREATE TABLE client_profiles (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(255),
    industry VARCHAR(255),
    bio TEXT
);

-- 4. SERVICE TABLE
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expert_id UUID NOT NULL REFERENCES expert_profiles(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL,
    pricing_type pricing_type NOT NULL,
    delivery_days INT NOT NULL,
    tags VARCHAR(255),
    avg_rating REAL DEFAULT 0.0
);

-- 5. INVITATION TABLE
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    is_approved BOOLEAN DEFAULT false
);

-- 6. JOB POST TABLE
CREATE TABLE job_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    budget_min NUMERIC(10, 2),
    budget_max NUMERIC(10, 2),
    required_skill VARCHAR(255),
    duration_days INT,
    status job_status DEFAULT 'open',
    deadline TIMESTAMP
);

-- 7. PROPOSAL TABLE
CREATE TABLE proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expert_id UUID NOT NULL REFERENCES expert_profiles(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES job_posts(id) ON DELETE CASCADE,
    cover_letter TEXT,
    bid_amount NUMERIC(10, 2) NOT NULL,
    delivery_days INT NOT NULL,
    status proposal_status DEFAULT 'pending',
    ai_match_score REAL
);

-- 8. AI LOG TABLE
CREATE TABLE ai_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    module_type ai_module_type NOT NULL,
    input_prompt TEXT,
    ai_output TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. PROJECT TABLE
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expert_id UUID NOT NULL REFERENCES expert_profiles(id),
    client_id UUID NOT NULL REFERENCES client_profiles(id),
    type project_type NOT NULL,
    status project_status DEFAULT 'active',
    total_amount NUMERIC(10, 2) NOT NULL,
    deliverable BOOLEAN DEFAULT false,
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP
);

-- 10. CONVERSATION TABLE
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. MESSAGE TABLE
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT,
    attachments VARCHAR(255),
    is_read BOOLEAN DEFAULT false,
    send_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. MILESTONE TABLE
CREATE TABLE milestones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    status milestone_status DEFAULT 'pending',
    due_date TIMESTAMP,
    deliverable TEXT
);

-- 13. TRANSACTION TABLE
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id),
    sender_id UUID REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    amount NUMERIC(10, 2) NOT NULL,
    type transaction_type NOT NULL,
    discount VARCHAR(50), -- Map database flexible placeholder
    status transaction_status DEFAULT 'pending',
    complete_at TIMESTAMP
);

-- 14. PAYMENT TABLE
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id),
    transaction_id UUID REFERENCES transactions(id),
    user_id UUID REFERENCES users(id),
    amount NUMERIC(10, 2) NOT NULL,
    type payment_type NOT NULL,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. REVIEW TABLE
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    reviewee_id UUID NOT NULL REFERENCES users(id),
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    direction review_direction NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 16. DISPUTE TABLE
CREATE TABLE disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id UUID NOT NULL REFERENCES users(id),
    target_id UUID NOT NULL REFERENCES users(id),
    project_id UUID NOT NULL REFERENCES projects(id),
    message_log TEXT,
    type VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    content TEXT,
    is_resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- EMAIL VERIFICATION TABLE
CREATE TABLE email_verification_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN DEFAULT false,
    UNIQUE(email)
);

-- ==========================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- ==========================================
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_job_posts_status ON job_posts(status);
CREATE INDEX idx_services_expert ON services(expert_id);
CREATE INDEX idx_proposals_job ON proposals(job_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_email_verification_email ON email_verification_codes(email);