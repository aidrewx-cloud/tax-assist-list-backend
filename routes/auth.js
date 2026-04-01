const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

/**
 * Generate a signed JWT token for a user
 */
function generateToken(userId, username, role) {
  return jwt.sign(
    { id: userId, username, role },
    process.env.JWT_SECRET || "fallback_secret_for_development",
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

/**
 * POST /api/auth/login
 * Authenticate admin user and return JWT token.
 * Falls back to environment variable credentials if DB is unavailable.
 */
router.post(
  "/login",
  [
    body("username")
      .trim()
      .notEmpty()
      .withMessage("Username is required")
      .isLength({ min: 1, max: 50 })
      .withMessage("Username must be between 1 and 50 characters"),
    body("password")
      .notEmpty()
      .withMessage("Password is required")
      .isLength({ min: 1 })
      .withMessage("Password cannot be empty"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { username, password } = req.body;

    try {
      // Try database authentication first
      let user;
      try {
        user = await User.findOne({
          username: username.toLowerCase(),
          isActive: true,
        }).select("+password");
      } catch (dbErr) {
        console.warn("[Auth] DB unavailable, falling back to env credentials:", dbErr.message);
      }

      if (user) {
        // Database user found — verify password
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
          return res.status(401).json({
            success: false,
            message: "Invalid username or password.",
          });
        }

        // Update last login
        user.lastLoginAt = new Date();
        user.lastLoginIp = req.ip;
        await user.save({ validateBeforeSave: false });

        const token = generateToken(user._id, user.username, user.role);

        return res.json({
          success: true,
          token,
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
          },
        });
      } else {
        // Fallback: check environment variable credentials (demo mode)
        const adminUsername = process.env.ADMIN_USERNAME || "admin";
        const adminPassword = process.env.ADMIN_PASSWORD || "password";

        if (
          username.toLowerCase() !== adminUsername.toLowerCase() ||
          password !== adminPassword
        ) {
          return res.status(401).json({
            success: false,
            message: "Invalid username or password.",
          });
        }

        // Generate demo token
        const token = generateToken("demo-admin-id", "admin", "admin");

        return res.json({
          success: true,
          token,
          user: {
            id: "demo-admin-id",
            username: "admin",
            email: "admin@taxreliefcompare.com",
            role: "admin",
          },
        });
      }
    } catch (err) {
      console.error(`[Auth] Login error: ${err.message}`);
      return res.status(500).json({
        success: false,
        message: "An error occurred during authentication. Please try again.",
      });
    }
  }
);

/**
 * GET /api/auth/me
 * Protected — return current authenticated user info.
 */
router.get("/me", protect, async (req, res) => {
  try {
    let user;
    try {
      user = await User.findById(req.user.id).select("-password -__v");
    } catch {
      // DB unavailable
    }

    return res.json({
      success: true,
      user: user || {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch user info." });
  }
});

/**
 * POST /api/auth/change-password
 * Protected — change the authenticated user's password.
 */
router.post(
  "/change-password",
  protect,
  [
    body("currentPassword").notEmpty().withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        "New password must contain at least one uppercase letter, one lowercase letter, and one number"
      ),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const user = await User.findById(req.user.id).select("+password");
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const isCurrentValid = await user.comparePassword(req.body.currentPassword);
      if (!isCurrentValid) {
        return res.status(401).json({ success: false, message: "Current password is incorrect." });
      }

      user.password = req.body.newPassword;
      await user.save();

      const token = generateToken(user._id, user.username, user.role);

      return res.json({
        success: true,
        message: "Password changed successfully.",
        token,
      });
    } catch (err) {
      console.error(`[Auth] Change password error: ${err.message}`);
      return res.status(500).json({ success: false, message: "Failed to change password." });
    }
  }
);

/**
 * POST /api/auth/logout
 * Client-side only logout (invalidate token client-side).
 * For a full implementation, maintain a token blacklist in Redis.
 */
router.post("/logout", protect, (req, res) => {
  return res.json({
    success: true,
    message: "Logged out successfully. Please remove the token from local storage.",
  });
});

module.exports = router;
