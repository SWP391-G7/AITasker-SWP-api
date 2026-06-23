const { pool } = require('../config/db');
const { generateToken } = require('../utils/token');

/**
 * @desc    Get user profile details (client, expert, or both)
 * @route   GET /api/profile/:userId
 * @access  Private
 */
const getUserProfile = async (req, res, next) => {
  const { userId } = req.params;

  try {
    // 1. Fetch user general information
    const userQuery = `
      SELECT id, full_name, email, role, is_verified, created_at 
      FROM users 
      WHERE id = $1
    `;
    const userRes = await pool.query(userQuery, [userId]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    const user = userRes.rows[0];

    // 2. Fetch Client Profile if exists
    const clientQuery = `SELECT * FROM client_profiles WHERE id = $1`;
    const clientRes = await pool.query(clientQuery, [userId]);
    const clientProfile = clientRes.rows[0] || null;

    // 3. Fetch Expert Profile if exists
    const expertQuery = `SELECT * FROM expert_profiles WHERE id = $1`;
    const expertRes = await pool.query(expertQuery, [userId]);
    const expertProfile = expertRes.rows[0] || null;

    // 4. Determine if profiles have actually been onboarded/created
    // (A simple check to see if key profile fields are filled)
    const hasClientProfile = !!(clientProfile && (clientProfile.company_name || clientProfile.industry || clientProfile.bio));
    const hasExpertProfile = !!(expertProfile && (expertProfile.professional_title || expertProfile.skills || expertProfile.bio));

    // 5. Fetch associated services if expert
    let services = [];
    if (hasExpertProfile) {
      const servicesRes = await pool.query('SELECT * FROM services WHERE expert_id = $1 ORDER BY id DESC', [userId]);
      services = servicesRes.rows;
    }

    // 6. Fetch associated job posts if client
    let projects = [];
    if (hasClientProfile) {
      const projectsRes = await pool.query('SELECT * FROM job_posts WHERE client_id = $1 ORDER BY id DESC', [userId]);
      projects = projectsRes.rows;
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        createdAt: user.created_at
      },
      clientProfile: clientProfile ? {
        id: clientProfile.id,
        companyName: clientProfile.company_name,
        industry: clientProfile.industry,
        bio: clientProfile.bio
      } : null,
      expertProfile: expertProfile ? {
        id: expertProfile.id,
        professionalTitle: expertProfile.professional_title,
        skills: expertProfile.skills,
        experience: expertProfile.experience,
        portfolioUrl: expertProfile.portfolio_url,
        hourlyRate: expertProfile.hourly_rate,
        bio: expertProfile.bio,
        avgRating: expertProfile.avg_rating
      } : null,
      hasClientProfile,
      hasExpertProfile,
      services: services.map(s => ({
        id: s.id,
        title: s.title,
        description: s.description,
        price: s.price,
        pricingType: s.pricing_type,
        deliveryDays: s.delivery_days,
        tags: s.tags,
        avgRating: s.avg_rating
      })),
      projects: projects.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        budgetMin: p.budget_min,
        budgetMax: p.budget_max,
        requiredSkill: p.required_skill,
        durationDays: p.duration_days,
        status: p.status,
        deadline: p.deadline
      }))
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Create or Update Client Profile details
 * @route   PUT /api/profile/client
 * @access  Private
 */
const updateClientProfile = async (req, res, next) => {
  const userId = req.user.id;
  const { companyName, industry, bio } = req.body;

  // Basic validation
  if (!companyName || typeof companyName !== 'string' || companyName.trim() === '') {
    const err = new Error('Company name is required');
    err.statusCode = 400;
    return next(err);
  }
  if (!industry || typeof industry !== 'string' || industry.trim() === '') {
    const err = new Error('Industry is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const upsertQuery = `
      INSERT INTO client_profiles (id, company_name, industry, bio)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET 
        company_name = EXCLUDED.company_name,
        industry = EXCLUDED.industry,
        bio = COALESCE(EXCLUDED.bio, client_profiles.bio)
      RETURNING *;
    `;
    const resProfile = await pool.query(upsertQuery, [
      userId,
      companyName.trim(),
      industry.trim(),
      bio ? bio.trim() : null
    ]);

    const updatedProfile = resProfile.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Client profile updated successfully',
      clientProfile: {
        id: updatedProfile.id,
        companyName: updatedProfile.company_name,
        industry: updatedProfile.industry,
        bio: updatedProfile.bio
      }
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Create or Update Expert Profile details
 * @route   PUT /api/profile/expert
 * @access  Private
 */
const updateExpertProfile = async (req, res, next) => {
  const userId = req.user.id;
  const { professionalTitle, skills, experience, portfolioUrl, hourlyRate, bio } = req.body;

  // Basic validation
  const errors = {};
  if (!professionalTitle || typeof professionalTitle !== 'string' || professionalTitle.trim() === '') {
    errors.professionalTitle = 'Professional title is required';
  }
  if (!skills || typeof skills !== 'string' || skills.trim() === '') {
    errors.skills = 'Skills are required';
  }
  if (!experience || typeof experience !== 'string' || experience.trim() === '') {
    errors.experience = 'Experience level is required';
  }
  if (!hourlyRate || isNaN(Number(hourlyRate)) || Number(hourlyRate) <= 0) {
    errors.hourlyRate = 'Hourly rate must be a number greater than 0';
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed');
    err.statusCode = 400;
    err.errors = errors;
    return next(err);
  }

  try {
    const upsertQuery = `
      INSERT INTO expert_profiles (id, professional_title, skills, experience, portfolio_url, hourly_rate, bio)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id)
      DO UPDATE SET 
        professional_title = EXCLUDED.professional_title,
        skills = EXCLUDED.skills,
        experience = EXCLUDED.experience,
        portfolio_url = EXCLUDED.portfolio_url,
        hourly_rate = EXCLUDED.hourly_rate,
        bio = COALESCE(EXCLUDED.bio, expert_profiles.bio)
      RETURNING *;
    `;
    const resProfile = await pool.query(upsertQuery, [
      userId,
      professionalTitle.trim(),
      skills.trim(),
      experience.trim(),
      portfolioUrl ? portfolioUrl.trim() : null,
      hourlyRate.toString(),
      bio ? bio.trim() : null
    ]);

    const updatedProfile = resProfile.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Expert profile updated successfully',
      expertProfile: {
        id: updatedProfile.id,
        professionalTitle: updatedProfile.professional_title,
        skills: updatedProfile.skills,
        experience: updatedProfile.experience,
        portfolioUrl: updatedProfile.portfolio_url,
        hourlyRate: updatedProfile.hourly_rate,
        bio: updatedProfile.bio,
        avgRating: updatedProfile.avg_rating
      }
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Update user role and initialize profile
 * @route   PUT /api/profile/role
 * @access  Private
 */
const updateUserRole = async (req, res, next) => {
  const userId = req.user.id;
  const { role } = req.body;

  const validRoles = ['client', 'expert'];
  if (!role || !validRoles.includes(role)) {
    const err = new Error('Role must be one of: client, expert');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    // 1. Update user role
    const updateRoleQuery = `
      UPDATE users
      SET role = $1
      WHERE id = $2
      RETURNING id, full_name, email, role, is_verified, created_at;
    `;
    const userRes = await dbClient.query(updateRoleQuery, [role, userId]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    const updatedUser = userRes.rows[0];

    // 2. Ensure profile entry exists
    if (role === 'client') {
      const insertClientProfileQuery = `
        INSERT INTO client_profiles (id) 
        VALUES ($1) 
        ON CONFLICT (id) DO NOTHING;
      `;
      await dbClient.query(insertClientProfileQuery, [userId]);
    } else if (role === 'expert') {
      const insertExpertProfileQuery = `
        INSERT INTO expert_profiles (id) 
        VALUES ($1) 
        ON CONFLICT (id) DO NOTHING;
      `;
      await dbClient.query(insertExpertProfileQuery, [userId]);
    }

    await dbClient.query('COMMIT');

    const token = generateToken({
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role
    });

    return res.status(200).json({
      success: true,
      message: 'Role updated successfully',
      user: {
        id: updatedUser.id,
        fullName: updatedUser.full_name,
        email: updatedUser.email,
        role: updatedUser.role,
        isVerified: updatedUser.is_verified,
        createdAt: updatedUser.created_at
      },
      token
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

module.exports = {
  getUserProfile,
  updateClientProfile,
  updateExpertProfile,
  updateUserRole
};
