const { pool } = require('../config/db')
const { sendNotification } = require('../utils/notificationService')

/**
 * @desc    Create a request to buy a service
 * @route   POST /api/invitations
 * @access  Private (Client only)
 */
const createInvitation = async (req, res, next) => {
  const userId = req.user.id
  const userRole = req.user.role

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can request services.')
    err.statusCode = 403
    return next(err)
  }

  const { service_id, cover_letter, bid_amount, delivery_days } = req.body

  const errors = {}
  if (!service_id) {
    errors.service_id = 'Service ID is required'
  }

  let parsedBidAmount = null
  if (bid_amount === undefined || bid_amount === null || bid_amount === '') {
    errors.bid_amount = 'Bid amount is required'
  } else {
    parsedBidAmount = parseFloat(bid_amount)
    if (isNaN(parsedBidAmount) || parsedBidAmount <= 0) {
      errors.bid_amount = 'Bid amount must be a positive number'
    }
  }

  let parsedDeliveryDays = null
  if (delivery_days === undefined || delivery_days === null || delivery_days === '') {
    errors.delivery_days = 'Delivery days is required'
  } else {
    parsedDeliveryDays = parseInt(delivery_days, 10)
    if (isNaN(parsedDeliveryDays) || parsedDeliveryDays <= 0) {
      errors.delivery_days = 'Delivery days must be a positive integer'
    }
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  try {
    // 1. Verify service exists
    const serviceCheck = await pool.query(
      `SELECT s.*, u.full_name as expert_name FROM services s
       JOIN users u ON s.expert_id = u.id WHERE s.id = $1`,
      [service_id]
    )
    if (serviceCheck.rows.length === 0) {
      const err = new Error('Service not found')
      err.statusCode = 404
      return next(err)
    }
    const service = serviceCheck.rows[0]

    // 2. Prevent buying own service
    if (service.expert_id === userId) {
      const err = new Error('You cannot request your own service')
      err.statusCode = 400
      return next(err)
    }

    // 3. Ensure client profile exists
    const clientProfileCheck = await pool.query('SELECT 1 FROM client_profiles WHERE id = $1', [userId])
    if (clientProfileCheck.rows.length === 0) {
      await pool.query('INSERT INTO client_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [userId])
    }

    // 4. Check duplicate pending request
    const duplicateCheck = await pool.query(
      "SELECT id FROM invitations WHERE client_id = $1 AND service_id = $2 AND status IN ('pending', 'accepted', 'countered')",
      [userId, service_id]
    )
    if (duplicateCheck.rows.length > 0) {
      const err = new Error('You already have an active request for this service')
      err.statusCode = 400
      return next(err)
    }

    // 5. Insert invitation
    const insertQuery = `
      INSERT INTO invitations (client_id, service_id, cover_letter, bid_amount, delivery_days, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *;
    `
    const values = [
      userId,
      service_id,
      cover_letter ? cover_letter.trim() : null,
      parsedBidAmount,
      parsedDeliveryDays
    ]
    const result = await pool.query(insertQuery, values)
    const invitation = result.rows[0]

    // Trigger Notification to Expert
    try {
      const clientInfo = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId])
      const clientName = clientInfo.rows[0]?.full_name || 'A client'

      await sendNotification(service.expert_id, {
        title: "New Service Request Received",
        message: `Client ${clientName} has requested your service "${service.title}".`,
        type: "new_service_request",
        referenceId: invitation.id
      })
    } catch (notifErr) {
      console.error('[Notification Trigger Error] new_service_request:', notifErr.message)
    }

    return res.status(201).json({
      success: true,
      message: 'Service request sent successfully',
      invitation
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get all invitations for the authenticated user (client or expert)
 * @route   GET /api/invitations/my
 * @access  Private
 */
const getMyInvitations = async (req, res, next) => {
  const userId = req.user.id
  const userRole = req.user.role

  try {
    let query = ''
    const values = [userId]

    if (userRole === 'expert') {
      query = `
        SELECT
          i.*,
          s.title              AS service_title,
          s.description        AS service_description,
          s.price              AS service_price,
          s.delivery_days      AS service_delivery_days,
          u_client.full_name   AS client_name,
          u_expert.full_name   AS expert_name
        FROM invitations i
        JOIN services s        ON i.service_id = s.id
        JOIN users u_client    ON i.client_id  = u_client.id
        JOIN users u_expert    ON s.expert_id  = u_expert.id
        WHERE s.expert_id = $1
        ORDER BY i.id DESC;
      `
    } else if (userRole === 'client') {
      query = `
        SELECT
          i.*,
          s.title              AS service_title,
          s.description        AS service_description,
          s.price              AS service_price,
          s.delivery_days      AS service_delivery_days,
          u_client.full_name   AS client_name,
          u_expert.full_name   AS expert_name
        FROM invitations i
        JOIN services s        ON i.service_id = s.id
        JOIN users u_client    ON i.client_id  = u_client.id
        JOIN users u_expert    ON s.expert_id  = u_expert.id
        WHERE i.client_id = $1
        ORDER BY i.id DESC;
      `
    } else if (userRole === 'admin') {
      query = `
        SELECT
          i.*,
          s.title              AS service_title,
          s.description        AS service_description,
          s.price              AS service_price,
          s.delivery_days      AS service_delivery_days,
          u_client.full_name   AS client_name,
          u_expert.full_name   AS expert_name
        FROM invitations i
        JOIN services s        ON i.service_id = s.id
        JOIN users u_client    ON i.client_id  = u_client.id
        JOIN users u_expert    ON s.expert_id  = u_expert.id
        ORDER BY i.id DESC;
      `
    } else {
      const err = new Error('Unauthorized role')
      err.statusCode = 401
      return next(err)
    }

    const result = await pool.query(query, values)
    return res.status(200).json({
      success: true,
      invitations: result.rows
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get a single invitation by ID
 * @route   GET /api/invitations/:id
 * @access  Private (client who sent it OR expert who owns the service)
 */
const getInvitationById = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  try {
    const query = `
      SELECT
        i.*,
        s.title              AS service_title,
        s.description        AS service_description,
        s.price              AS service_price,
        s.delivery_days      AS service_delivery_days,
        s.expert_id,
        u_client.full_name   AS client_name,
        u_client.email       AS client_email,
        u_expert.full_name   AS expert_name,
        u_expert.email       AS expert_email
      FROM invitations i
      JOIN services s        ON i.service_id = s.id
      JOIN users u_client    ON i.client_id  = u_client.id
      JOIN users u_expert    ON s.expert_id  = u_expert.id
      WHERE i.id = $1;
    `
    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      const err = new Error('Request not found')
      err.statusCode = 404
      return next(err)
    }

    const invitation = result.rows[0]

    if (
      userRole !== 'admin' &&
      invitation.client_id !== userId &&
      invitation.expert_id !== userId
    ) {
      const err = new Error('Forbidden: You do not have access to this request')
      err.statusCode = 403
      return next(err)
    }

    return res.status(200).json({
      success: true,
      invitation
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Accept or reject a service request
 * @route   PUT /api/invitations/:id/status
 * @access  Private
 */
const updateInvitationStatus = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role
  let { status, start_project } = req.body

  if (!status) {
    const err = new Error('Status is required')
    err.statusCode = 400
    return next(err)
  }

  if (status === 'approved') status = 'accepted'

  if (status !== 'accepted' && status !== 'rejected') {
    const err = new Error('Invalid status. Status must be: accepted, rejected')
    err.statusCode = 400
    return next(err)
  }

  try {
    // 1. Fetch invitation with service details
    const query = `
      SELECT i.*, s.expert_id, s.title as service_title, s.description as service_description
      FROM invitations i
      JOIN services s ON i.service_id = s.id
      WHERE i.id = $1
    `
    const invitationRes = await pool.query(query, [id])

    if (invitationRes.rows.length === 0) {
      const err = new Error('Request not found')
      err.statusCode = 404
      return next(err)
    }

    const invitation = invitationRes.rows[0]

    const isClient = userRole === 'client' && invitation.client_id === userId
    const isExpert = userRole === 'expert' && invitation.expert_id === userId

    if (isExpert) {
      // Expert can respond to original pending request, or counter-proposals sent by client
      if (invitation.status !== 'pending' && (invitation.status !== 'countered' || invitation.counter_initiated_by === userId)) {
        const err = new Error('Forbidden: You cannot respond to this request at its current stage')
        err.statusCode = 403
        return next(err)
      }
    } else if (isClient) {
      // Client can only respond to a counter-proposal initiated by the expert
      if (invitation.status !== 'countered' || invitation.counter_initiated_by !== invitation.expert_id) {
        const err = new Error('Forbidden: You can only respond to counter-proposals from the expert')
        err.statusCode = 403
        return next(err)
      }
    } else if (userRole !== 'admin') {
      const err = new Error('Forbidden')
      err.statusCode = 403
      return next(err)
    }

    await pool.query('BEGIN')

    // Adopt final bid and delivery days if accepting a counter
    let finalBidAmount = invitation.bid_amount
    let finalDeliveryDays = invitation.delivery_days
    if (status === 'accepted' && invitation.status === 'countered') {
      if (invitation.counter_bid_amount) finalBidAmount = invitation.counter_bid_amount
      if (invitation.counter_delivery_days) finalDeliveryDays = invitation.counter_delivery_days
    }

    const updateQuery = `
      UPDATE invitations
      SET status = $1, bid_amount = $2, delivery_days = $3
      WHERE id = $4
      RETURNING *;
    `
    const updatedRes = await pool.query(updateQuery, [status, finalBidAmount, finalDeliveryDays, id])
    const updatedInvitation = updatedRes.rows[0]

    let createdProject = null

    if (status === 'accepted') {
      // Accepting only confirms the terms. Escrow funding is required before
      // the client can create a project, regardless of who clicked Accept.
    }

    await pool.query('COMMIT')

    // Notifications
    try {
      const recipientId = isClient ? invitation.expert_id : invitation.client_id
      const title = status === 'accepted' ? 'Service Request Accepted' : 'Service Request Declined'
      const message = status === 'accepted'
        ? `Your request for the service "${invitation.service_title}" has been accepted.`
        : `Your request for the service "${invitation.service_title}" was declined.`

      await sendNotification(recipientId, {
        title,
        message,
        type: "service_request_accepted",
        referenceId: invitation.id
      })

      if (createdProject) {
        await sendNotification(invitation.client_id, {
          title: "New Project Started",
          message: `A new project for service "${invitation.service_title}" has been initiated.`,
          type: "new_project",
          referenceId: createdProject.id
        })
        await sendNotification(invitation.expert_id, {
          title: "New Project Started",
          message: `A new project for service "${invitation.service_title}" has been initiated.`,
          type: "new_project",
          referenceId: createdProject.id
        })
      }
    } catch (notifErr) {
      console.error('[Notification Trigger Error] updateInvitationStatus:', notifErr.message)
    }

    return res.status(200).json({
      success: true,
      message: `Request status updated to ${status} successfully.`,
      invitation: updatedInvitation,
      project: createdProject
    })
  } catch (error) {
    await pool.query('ROLLBACK')
    return next(error)
  }
}

/**
 * @desc    Counter a service request (either client or expert)
 * @route   PUT /api/invitations/:id/counter
 * @access  Private
 */
const counterInvitation = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role
  const { bid_amount, delivery_days, cover_letter } = req.body

  const parsedBid = parseFloat(bid_amount)
  const parsedDays = parseInt(delivery_days, 10)

  if (!bid_amount || isNaN(parsedBid) || parsedBid <= 0) {
    const err = new Error('A valid counter bid amount is required')
    err.statusCode = 400
    return next(err)
  }

  if (!delivery_days || isNaN(parsedDays) || parsedDays <= 0) {
    const err = new Error('A valid counter delivery days is required')
    err.statusCode = 400
    return next(err)
  }

  try {
    const query = `
      SELECT i.*, s.expert_id, s.title as service_title
      FROM invitations i
      JOIN services s ON i.service_id = s.id
      WHERE i.id = $1
    `
    const invitationRes = await pool.query(query, [id])

    if (invitationRes.rows.length === 0) {
      const err = new Error('Request not found')
      err.statusCode = 404
      return next(err)
    }

    const invitation = invitationRes.rows[0]

    const isClient = userRole === 'client' && invitation.client_id === userId
    const isExpert = userRole === 'expert' && invitation.expert_id === userId

    if (!isClient && !isExpert && userRole !== 'admin') {
      const err = new Error('Forbidden: You are not a party to this request')
      err.statusCode = 403
      return next(err)
    }

    if (invitation.status === 'accepted' || invitation.status === 'rejected') {
      const err = new Error(`Cannot counter a request that is already ${invitation.status}`)
      err.statusCode = 400
      return next(err)
    }

    if (invitation.status === 'countered' && invitation.counter_initiated_by === userId) {
      const err = new Error('You already sent a counter-proposal. Wait for response.')
      err.statusCode = 400
      return next(err)
    }

    const updateQuery = `
      UPDATE invitations
      SET
        status = 'countered',
        counter_bid_amount = $1,
        counter_delivery_days = $2,
        counter_cover_letter = $3,
        counter_initiated_by = $4
      WHERE id = $5
      RETURNING *;
    `
    const result = await pool.query(updateQuery, [
      parsedBid,
      parsedDays,
      cover_letter ? cover_letter.trim() : null,
      userId,
      id
    ])

    // Notifications
    try {
      const recipientId = isClient ? invitation.expert_id : invitation.client_id
      const senderNameQuery = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId])
      const senderName = senderNameQuery.rows[0]?.full_name || 'Someone'

      await sendNotification(recipientId, {
        title: "New Counter Request",
        message: `${senderName} has sent a counter-proposal for service "${invitation.service_title}".`,
        type: "counter_service_request",
        referenceId: invitation.id
      })
    } catch (notifErr) {
      console.error('[Notification Trigger Error] counterInvitation:', notifErr.message)
    }

    return res.status(200).json({
      success: true,
      message: 'Counter offer submitted successfully',
      invitation: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Start project from an accepted invitation (Client only)
 * @route   POST /api/invitations/:id/start-project
 * @access  Private (Client only)
 */
const startProject = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can start projects.')
    err.statusCode = 403
    return next(err)
  }

  try {
    const query = `
      SELECT i.*, s.expert_id, s.title as service_title, s.description as service_description
      FROM invitations i
      JOIN services s ON i.service_id = s.id
      WHERE i.id = $1
    `
    const invitationRes = await pool.query(query, [id])

    if (invitationRes.rows.length === 0) {
      const err = new Error('Request not found')
      err.statusCode = 404
      return next(err)
    }

    const invitation = invitationRes.rows[0]

    if (invitation.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only start projects for your own requests')
      err.statusCode = 403
      return next(err)
    }

    if (invitation.status !== 'accepted') {
      const err = new Error('Cannot start project: Request must be in accepted status.')
      err.statusCode = 400
      return next(err)
    }

    // Support both the new funded marker and the paid_at marker introduced by
    // the existing services-test payment flow.
    if (invitation.payment_status !== 'funded' && !invitation.paid_at) {
      const err = new Error('Cannot start project: Client payment has not been secured in escrow')
      err.statusCode = 400
      return next(err)
    }

    await pool.query('BEGIN')

    // Create the project
    const insertProjectQuery = `
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, title, description, invitation_id)
      VALUES ($1, $2, 'fixed_milestone', 'Planning', $3, $4, $5, $6)
      RETURNING *;
    `
    const projectRes = await pool.query(insertProjectQuery, [
      invitation.expert_id,
      invitation.client_id,
      invitation.bid_amount,
      invitation.service_title,
      invitation.cover_letter || invitation.service_description,
      invitation.id
    ])
    const project = projectRes.rows[0]

    await pool.query(
      "UPDATE transactions SET project_id = $1 WHERE invitation_id = $2 AND type = 'escrow_deposit' AND status = 'completed'",
      [project.id, invitation.id]
    )

    // Set invitation status to something complete if needed or keep it accepted. We'll keep it accepted.
    await pool.query('COMMIT')

    // Notifications
    try {
      await sendNotification(invitation.client_id, {
        title: "New Project Started",
        message: `A new project for service "${invitation.service_title}" has been created.`,
        type: "new_project",
        referenceId: project.id
      })
      await sendNotification(invitation.expert_id, {
        title: "New Project Started",
        message: `A new project for service "${invitation.service_title}" has been created.`,
        type: "new_project",
        referenceId: project.id
      })
    } catch (notifErr) {
      console.error('[Notification Trigger Error] startProject:', notifErr.message)
    }

    return res.status(201).json({
      success: true,
      message: 'Project started successfully',
      project
    })
  } catch (error) {
    await pool.query('ROLLBACK')
    return next(error)
  }
}

module.exports = {
  createInvitation,
  getMyInvitations,
  getInvitationById,
  updateInvitationStatus,
  counterInvitation,
  startProject
}
