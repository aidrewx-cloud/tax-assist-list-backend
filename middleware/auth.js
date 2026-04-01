const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Middleware to protect routes requiring authentication.
 * Validates the JWT token from the Authorization header.
 */
const protect = async (req, res, next) => {
  let token;

  // Extract token from Authorization header or cookie
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access denied. No authentication token provided.",
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Try to find user in database
    let user;
    try {
      user = await User.findById(decoded.id).select("-password");
    } catch (dbErr) {
      // If DB unavailable, allow if token is valid (demo mode)
    }

    if (user) {
      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: "Your account has been deactivated.",
        });
      }
      // Check if password was changed after token was issued
      if (user.passwordChangedAfter(decoded.iat)) {
        return res.status(401).json({
          success: false,
          message: "Password was recently changed. Please log in again.",
        });
      }
      req.user = user;
    } else {
      // Attach decoded payload if user not found (demo mode)
      req.user = { id: decoded.id, username: decoded.username, role: decoded.role || "admin" };
    }

    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Authentication token has expired. Please log in again.",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

/**
 * Middleware to restrict access to specific roles.
 * Use after protect middleware.
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }
    next();
  };
};

/**
 * Optional auth — attaches user if token present, but doesn't block if missing.
 */
const optionalAuth = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch {
      // Ignore invalid token in optional mode
    }
  }
  next();
};

module.exports = { protect, restrictTo, optionalAuth };
