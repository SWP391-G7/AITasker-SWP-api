const { pool } = require('../config/db')

/**
 * @desc    Create a project from a job post with an accepted proposal (Client only)
 * @route   POST /api/projects
 * @access  Private (Client only)
 */
const createProject = async (req, res, next) => {
  const userId = req.user.id
  const userRole = req.user.role

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can start a project')
    err.statusCode = 403
    return next(err)
  }

  const { job_id } = req.body

  if (!job_id) {
    const err = new Error('Job post ID is required')
    err.statusCode = 400
    return next(err)
  }

  try {
    // Start transaction
    await pool.query('BEGIN')

    // 1. Fetch job post details
    const jobRes = await pool.query('SELECT * FROM job_posts WHERE id = $1', [job_id])
    if (jobRes.rows.length === 0) {
      await pool.query('ROLLBACK')
      const err = new Error('Job post not found')
      err.statusCode = 404
      return next(err)
    }
    const jobPost = jobRes.rows[0]

    // Verify ownership
    if (jobPost.client_id !== userId && userRole !== 'admin') {
      await pool.query('ROLLBACK')
      const err = new Error('Forbidden: You can only start a project for your own job posts')
      err.statusCode = 403
      return next(err)
    }

    // 2. Fetch accepted proposal for this job post
    const proposalRes = await pool.query(
      'SELECT * FROM proposals WHERE job_id = $1 AND status = $2 LIMIT 1',
      [job_id, 'accepted']
    )
    if (proposalRes.rows.length === 0) {
      await pool.query('ROLLBACK')
      const err = new Error('No accepted proposal found for this job post. Please accept a proposal first.')
      err.statusCode = 400
      return next(err)
    }
    const proposal = proposalRes.rows[0]

    // 3. Create the project
    const insertProjectQuery = `
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, title, description, start_date)
      VALUES ($1, $2, 'fixed_milestone', 'active', $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING *;
    `
    const projectRes = await pool.query(insertProjectQuery, [
      proposal.expert_id,
      jobPost.client_id,
      proposal.bid_amount,
      jobPost.title,
      jobPost.description
    ])
    const project = projectRes.rows[0]

    // 4. Delete the job post (this will cascade and delete associated proposals)
    await pool.query('DELETE FROM job_posts WHERE id = $1', [job_id])

    await pool.query('COMMIT')

    return res.status(201).json({
      success: true,
      message: 'Project started and job post transferred successfully',
      project
    })

  } catch (error) {
    await pool.query('ROLLBACK')
    return next(error)
  }
}

/**
 * @desc    Get all projects for the current user
 * @route   GET /api/projects
 * @access  Private
 */
const getMyProjects = async (req, res, next) => {
  const userId = req.user.id

  try {
    const query = `
      SELECT p.*, 
             u_client.full_name AS client_name, u_client.email AS client_email,
             u_expert.full_name AS expert_name, u_expert.email AS expert_email
      FROM projects p
      JOIN users u_client ON p.client_id = u_client.id
      JOIN users u_expert ON p.expert_id = u_expert.id
      WHERE p.client_id = $1 OR p.expert_id = $1
      ORDER BY p.start_date DESC;
    `

    const result = await pool.query(query, [userId])

    return res.status(200).json({
      success: true,
      projects: result.rows,
      data: result.rows
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get project by ID
 * @route   GET /api/projects/:id
 * @access  Private
 */
const getProjectById = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  try {
    const query = `
      SELECT p.*, 
             u_client.full_name AS client_name, u_client.email AS client_email,
             u_expert.full_name AS expert_name, u_expert.email AS expert_email
      FROM projects p
      JOIN users u_client ON p.client_id = u_client.id
      JOIN users u_expert ON p.expert_id = u_expert.id
      WHERE p.id = $1;
    `

    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      const err = new Error('Project not found')
      err.statusCode = 404
      return next(err)
    }

    const project = result.rows[0]

    // Access control: client, expert, or admin
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You are not a participant of this project')
      err.statusCode = 403
      return next(err)
    }

    return res.status(200).json({
      success: true,
      project
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Update project details / Close project
 * @route   PUT /api/projects/:id
 * @access  Private
 */
const updateProject = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role
  const { status, title, description } = req.body

  try {
    // 1. Fetch project
    const selectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id])
    if (selectRes.rows.length === 0) {
      const err = new Error('Project not found')
      err.statusCode = 404
      return next(err)
    }
    const project = selectRes.rows[0]

    // Access Control
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You cannot update this project')
      err.statusCode = 403
      return next(err)
    }

    const fieldsToUpdate = []
    const values = []
    let paramIdx = 1

    // Check status changes
    if (status) {
      if (status === 'terminated') {
        // Client or admin can close/abandon the project
        if (project.client_id !== userId && userRole !== 'admin') {
          const err = new Error('Forbidden: Only the client can abandon the project')
          err.statusCode = 403
          return next(err)
        }
        fieldsToUpdate.push(`status = $${paramIdx++}`)
        values.push('terminated')
        fieldsToUpdate.push(`end_date = CURRENT_TIMESTAMP`)
      } else {
        fieldsToUpdate.push(`status = $${paramIdx++}`)
        values.push(status)
      }
    }

    if (title !== undefined) {
      fieldsToUpdate.push(`title = $${paramIdx++}`)
      values.push(title.trim())
    }

    if (description !== undefined) {
      fieldsToUpdate.push(`description = $${paramIdx++}`)
      values.push(description.trim())
    }

    if (fieldsToUpdate.length === 0) {
      const err = new Error('No field provided to update')
      err.statusCode = 400
      return next(err)
    }

    values.push(id)
    const updateQuery = `
      UPDATE projects
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *;
    `

    const updateRes = await pool.query(updateQuery, values)

    return res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      project: updateRes.rows[0]
    })

  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Delete project (Admin or Owner client)
 * @route   DELETE /api/projects/:id
 * @access  Private
 */
const deleteProject = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  try {
    const selectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id])
    if (selectRes.rows.length === 0) {
      const err = new Error('Project not found')
      err.statusCode = 404
      return next(err)
    }
    const project = selectRes.rows[0]

    if (project.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the client who created this project or admin can delete it')
      err.statusCode = 403
      return next(err)
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id])

    return res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    })
  } catch (error) {
    return next(error)
  }
}

module.exports = {
  createProject,
  getMyProjects,
  getProjectById,
  updateProject,
  deleteProject
}
