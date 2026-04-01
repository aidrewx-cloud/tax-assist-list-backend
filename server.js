require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const path = require("path");

// Route imports
const leadsRouter = require("./routes/leads");
const authRouter = require("./routes/auth");
const analyticsRouter = require("./routes/analytics");
const webhooksRouter = require("./routes/webhooks");
const campaignsRouter = require("./routes/campaigns");
const revenueRouter = require("./routes/revenue");

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ─────────────────────────────────────────────
// Database Connection
// ─────────────────────────────────────────────
const connectDB = async () => {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/tax_relief_compare";
  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`[MongoDB] Connected to: ${uri.replace(/\/\/.*@/, "//***@")}`);
  } catch (err) {
    console.error(`[MongoDB] Connection failed: ${err.message}`);
    console.warn("[MongoDB] Running without database — some features will be limited.");
  }
};

connectDB();

// Handle MongoDB connection events
mongoose.connection.on("error", (err) => {
  console.error(`[MongoDB] Error: ${err.message}`);
});

mongoose.connection.on("disconnected", () => {
  console.warn("[MongoDB] Disconnected. Attempting reconnect...");
});

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.CORS_ORIGIN || "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:4173",
    ];
    // Allow requests with no origin (server-to-server, mobile apps)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (NODE_ENV === "development") {
      callback(null, true); // Allow all in development
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  maxAge: 86400, // Cache preflight for 24 hours
};
app.use(cors(corsOptions));

// Parse JSON bodies (but not for webhooks — they need raw body)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/webhooks")) {
    // Webhooks router handles its own body parsing with express.raw()
    next();
  } else {
    express.json({ limit: "10mb" })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Trust proxy headers (required for rate limiting behind load balancers)
app.set("trust proxy", 1);

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  if (NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// ─────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────

// General API rate limit
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again in 15 minutes.",
  },
  skip: (req) => NODE_ENV === "development" && req.ip === "127.0.0.1",
});

// Lead submission rate limit (stricter)
const leadSubmitLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "You have submitted too many requests. Please wait a minute before trying again.",
  },
  skip: (req) => NODE_ENV === "development",
});

// Auth rate limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    success: false,
    message: "Too many login attempts. Please try again in 15 minutes.",
  },
  skip: (req) => NODE_ENV === "development",
});

app.use("/api/", generalLimiter);
app.use("/api/leads/submit", leadSubmitLimiter);
app.use("/api/auth/login", authLimiter);

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────
app.use("/api/leads", leadsRouter);
app.use("/api/auth", authRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/revenue", revenueRouter);

// API health check endpoint
app.get("/api/health", (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStates = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
  res.json({
    status: "ok",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    database: dbStates[dbStatus] || "unknown",
    version: require("./package.json").version,
  });
});

// API 404 handler
app.use("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─────────────────────────────────────────────
// Serve Frontend (Production)
// ─────────────────────────────────────────────
if (NODE_ENV === "production") {
  });
}

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";

  // Don't expose internal errors in production
  const responseMessage =
    NODE_ENV === "production" && statusCode === 500
      ? "An unexpected error occurred. Please try again later."
      : message;

  console.error(`[Error] ${req.method} ${req.originalUrl} - ${statusCode}: ${message}`);

  if (!res.headersSent) {
    res.status(statusCode).json({
      success: false,
      message: responseMessage,
      ...(NODE_ENV === "development" && { stack: err.stack }),
    });
  }
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║       Tax Relief Compare - Backend API        ║
╠═══════════════════════════════════════════════╣
║  Status:    Running                           ║
║  Port:      ${PORT}                              ║
║  Env:       ${NODE_ENV.padEnd(35)}║
╚═══════════════════════════════════════════════╝
  `);
  console.log(`[Server] API available at: http://localhost:${PORT}/api`);
  console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log("[MongoDB] Connection closed.");
    } catch (err) {
      console.error("[MongoDB] Error during disconnect:", err.message);
    }
    console.log("[Server] Process terminated.");
    process.exit(0);
  });

  // Force kill after 10 seconds
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Server] Uncaught Exception:", err);
  process.exit(1);
});

module.exports = app;
