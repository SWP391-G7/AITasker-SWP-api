const { pool } = require('../config/db');

/**
 * @desc    Search and filter experts, clients, services, and jobs
 * @route   GET /api/search
 * @access  Public
 */
const searchEntities = async (req, res, next) => {
  const { target } = req.query;

  if (!target) {
    const err = new Error('Search target is required');
    err.statusCode = 400;
    return next(err);
  }

  const validTargets = ['expert', 'client', 'services', 'jobs'];
  if (!validTargets.includes(target)) {
    const err = new Error('Invalid search target. Must be one of: expert, client, services, jobs');
    err.statusCode = 400;
    return next(err);
  }

  const {
    query,
    budgetMin,
    budgetMax,
    requiredSkill,
    duration,
    priceMin,
    priceMax,
    pricingType,
    skill,
    experience,
    professionalTitle,
    hourlyRateMin,
    hourlyRateMax,
    industry,
    companyName,
    ratingMin,
    ratingMax
  } = req.query;

  let queryText = '';
  const values = [];

  // Helper to add parameterised filter
  const addFilter = (condition, value) => {
    values.push(value);
    queryText += ` AND ${condition} $${values.length}`;
  };

  try {
    if (target === 'jobs') {
      const includeClosed = req.query.includeClosed === 'true' || req.query.showClosed === 'true';
      queryText = `
        SELECT j.*, c.company_name, u.full_name as client_name, u.avatar_url as client_avatar
        FROM job_posts j
        LEFT JOIN client_profiles c ON j.client_id = c.id
        LEFT JOIN users u ON c.id = u.id
        WHERE j.status != 'pending' AND j.status != 'removed' AND j.status != 'rejected'
      `;
      if (!includeClosed) {
        queryText += " AND j.status != 'closed'";
      }

      if (query && query.trim() !== '') {
        values.push(`%${query.trim()}%`);
        queryText += ` AND (j.title ILIKE $${values.length} OR j.description ILIKE $${values.length})`;
      }

      if (budgetMin !== undefined && budgetMin !== null && budgetMin !== '') {
        const parsedMin = parseFloat(budgetMin);
        if (!isNaN(parsedMin)) {
          addFilter('j.budget_min >=', parsedMin);
        }
      }

      if (budgetMax !== undefined && budgetMax !== null && budgetMax !== '') {
        const parsedMax = parseFloat(budgetMax);
        if (!isNaN(parsedMax)) {
          addFilter('j.budget_max <=', parsedMax);
        }
      }

      if (requiredSkill && requiredSkill.trim() !== '') {
        addFilter('j.required_skill ILIKE', `%${requiredSkill.trim()}%`);
      }

      if (duration !== undefined && duration !== null && duration !== '') {
        const parsedDuration = parseInt(duration, 10);
        if (!isNaN(parsedDuration)) {
          addFilter('j.duration_days <=', parsedDuration);
        }
      }

    } else if (target === 'services') {
      queryText = `
        SELECT s.*, e.professional_title, u.full_name as expert_name, u.avatar_url as expert_avatar
        FROM services s
        LEFT JOIN expert_profiles e ON s.expert_id = e.id
        LEFT JOIN users u ON e.id = u.id
        WHERE s.status = 'approved'
      `;

      if (query && query.trim() !== '') {
        values.push(`%${query.trim()}%`);
        queryText += ` AND (s.title ILIKE $${values.length} OR s.description ILIKE $${values.length})`;
      }

      if (priceMin !== undefined && priceMin !== null && priceMin !== '') {
        const parsedMin = parseFloat(priceMin);
        if (!isNaN(parsedMin)) {
          addFilter('s.price >=', parsedMin);
        }
      }

      if (priceMax !== undefined && priceMax !== null && priceMax !== '') {
        const parsedMax = parseFloat(priceMax);
        if (!isNaN(parsedMax)) {
          addFilter('s.price <=', parsedMax);
        }
      }

      if (pricingType && pricingType.trim() !== '' && pricingType !== 'all') {
        addFilter('s.pricing_type =', pricingType.trim());
      }

      if (req.query.tags && req.query.tags.trim() !== '') {
        addFilter('s.tags ILIKE', `%${req.query.tags.trim()}%`);
      }

      if (ratingMin !== undefined && ratingMin !== null && ratingMin !== '') {
        const parsedMin = parseFloat(ratingMin);
        if (!isNaN(parsedMin)) {
          addFilter('s.avg_rating >=', parsedMin);
        }
      }

    } else if (target === 'expert') {
      queryText = `
        SELECT e.*, u.full_name, u.email, u.avatar_url,
          (SELECT COUNT(*) FROM projects WHERE expert_id = e.id AND status = 'completed') AS completed_projects,
          (SELECT COUNT(*) FROM projects WHERE expert_id = e.id) AS total_projects
        FROM expert_profiles e
        INNER JOIN users u ON e.id = u.id
        WHERE u.role = 'expert'
          AND (e.professional_title IS NOT NULL OR e.skills IS NOT NULL OR e.bio IS NOT NULL)
      `;

      if (query && query.trim() !== '') {
        values.push(`%${query.trim()}%`);
        queryText += ` AND (u.full_name ILIKE $${values.length} OR e.professional_title ILIKE $${values.length} OR e.bio ILIKE $${values.length})`;
      }

      if (skill && skill.trim() !== '') {
        addFilter('e.skills ILIKE', `%${skill.trim()}%`);
      }

      if (experience && experience.trim() !== '') {
        addFilter('e.experience ILIKE', `%${experience.trim()}%`);
      }

      if (professionalTitle && professionalTitle.trim() !== '') {
        addFilter('e.professional_title ILIKE', `%${professionalTitle.trim()}%`);
      }

      if (hourlyRateMin !== undefined && hourlyRateMin !== null && hourlyRateMin !== '') {
        const parsedMin = parseFloat(hourlyRateMin);
        if (!isNaN(parsedMin)) {
          addFilter("CAST(NULLIF(regexp_replace(e.hourly_rate, '[^0-9.]', '', 'g'), '') AS NUMERIC) >=", parsedMin);
        }
      }

      if (hourlyRateMax !== undefined && hourlyRateMax !== null && hourlyRateMax !== '') {
        const parsedMax = parseFloat(hourlyRateMax);
        if (!isNaN(parsedMax)) {
          addFilter("CAST(NULLIF(regexp_replace(e.hourly_rate, '[^0-9.]', '', 'g'), '') AS NUMERIC) <=", parsedMax);
        }
      }

    } else if (target === 'client') {
      queryText = `
        SELECT c.*, u.full_name, u.email, u.avatar_url,
          (SELECT COUNT(*) FROM job_posts WHERE client_id = c.id) AS posted_jobs_count
        FROM client_profiles c
        INNER JOIN users u ON c.id = u.id
        WHERE u.role = 'client'
          AND (c.company_name IS NOT NULL OR c.industry IS NOT NULL OR c.bio IS NOT NULL)
      `;

      if (query && query.trim() !== '') {
        values.push(`%${query.trim()}%`);
        queryText += ` AND (u.full_name ILIKE $${values.length} OR c.company_name ILIKE $${values.length} OR c.bio ILIKE $${values.length})`;
      }

      if (industry && industry.trim() !== '') {
        addFilter('c.industry ILIKE', `%${industry.trim()}%`);
      }

      if (companyName && companyName.trim() !== '') {
        addFilter('c.company_name ILIKE', `%${companyName.trim()}%`);
      }
    }

    // Add default ordering for stability
    queryText += ' ORDER BY id DESC';

    const result = await pool.query(queryText, values);

    let finalResults = result.rows;
    if (target === 'jobs') {
      finalResults = result.rows.map(row => {
        if (row.status === 'pending') {
          return { ...row, status: 'closed' };
        }
        return row;
      });
    }

    return res.status(200).json({
      success: true,
      target,
      count: finalResults.length,
      results: finalResults
    });

  } catch (error) {
    return next(error);
  }
};

module.exports = {
  searchEntities
};
