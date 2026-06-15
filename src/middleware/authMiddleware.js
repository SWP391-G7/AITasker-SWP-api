const { verifyToken } = require('../utils/token');

/**
 * Authentication guard middleware to protect secure endpoints
 */
const protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header (Bearer <token>)
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = verifyToken(token);

      // Attach user details to request object
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      };

      return next();
    } catch (err) {
      const authError = new Error('Not authorized, token failed');
      authError.statusCode = 401;
      return next(authError);
    }
  }

  if (!token) {
    const noTokenError = new Error('Not authorized, no token provided');
    noTokenError.statusCode = 401;
    return next(noTokenError);
  }
};

/**
 * Role authorization guard middleware
 * @param {Array<string>} roles - Permitted roles (e.g. ['client', 'admin'])
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      const error = new Error('User not authenticated');
      error.statusCode = 401;
      return next(error);
    }

    if (roles.length && !roles.includes(req.user.role)) {
      const error = new Error(`Forbidden: Role '${req.user.role}' is not authorized to access this resource`);
      error.statusCode = 403;
      return next(error);
    }

    next();
  };
};

module.exports = {
  protect,
  authorize
};
