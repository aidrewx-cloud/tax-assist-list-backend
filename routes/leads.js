const express = require("express");
const router = express.Router();
const { body, validationResult, query } = require("express-validator");
const Lead = require("../models/Lead");
const { submitLead } = require("../services/irslogics");
const { protect } = require("../middleware/auth");

/**
 * Helper: extract UTM parameters and tracking data from request
 */
function extractTrackingData(req) {
  const {
    utmSource,
    utm_source,
    utmMedium,
    utm_medium,
    utmCampaign,
    utm_campaign,
    utmContent,
    utm_content,
    utmTerm,
    utm_term,
    source,
  } = req.body;

  // Determine source from UTM or referrer
  let leadSource = "Unknown";
  const utmSrc = utmSource || utm_source || "";
  const utmMed = utmMedium || utm_medium || "";

  if (utmSrc.includes("google") || utmMed.includes("cpc")) {
    leadSource = "Google Ads";
  } else if (utmSrc.includes("facebook") || utmSrc.includes("meta") || utmSrc.includes("instagram")) {
    leadSource = "Meta Ads";
  } else if (utmSrc.includes("tiktok")) {
    leadSource = "TikTok";
  } else if (req.headers.referer && !req.headers.referer.includes("taxreliefcompare.com")) {
    leadSource = "Organic";
  } else if (source) {
    leadSource = source;
  }

  return {
    source: leadSource,
    utmSource: utmSrc,
    utmMedium: utmMed,
    utmCampaign: utmCampaign || utm_campaign || "",
    utmContent: utmContent || utm_content || "",
    utmTerm: utmTerm || utm_term || "",
    ipAddress: req.ip || req.connection?.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
    referrer: req.headers.referer || req.headers.referrer || "",
    landingPage: req.body.landingPage || "",
  };
}

/**
 * Validation rules for lead submission
 */
const leadValidationRules = [
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Full name must be between 2 and 100 characters"),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .normalizeEmail(),

  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^[+\d][\d\s\-().]{6,20}$/)
    .withMessage("Please provide a valid phone number"),

  body("taxDebtType")
    .notEmpty()
    .withMessage("Tax debt type is required")
    .isIn(["federal_irs", "state", "both", "business", "other"])
    .withMessage("Invalid tax debt type"),

  body("debtAmount")
    .notEmpty()
    .withMessage("Debt amount is required")
    .isIn(["10k_25k", "25k_50k", "50k_100k", "100k_250k", "250k_plus"])
    .withMessage("Invalid debt amount range"),

  body("privacyAgreed")
    .equals("true")
    .withMessage("You must agree to the privacy policy")
    .optional()
    .toBoolean()
    .isBoolean()
    .withMessage("Privacy agreement must be a boolean"),

  body("notes")
    .optional()
    .isLength({ max: 1000 })
    .withMessage("Notes cannot exceed 1000 characters"),
];

/**
 * POST /api/leads/submit
 * Public endpoint — accepts lead form data, validates, stores in MongoDB,
 * and submits to IRSLogics API asynchronously.
 */
router.post(
  "/submit",
  leadValidationRules,
  async (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: "Validation failed. Please check the form fields.",
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const {
      fullName,
      email,
      phone,
      taxDebtType,
      debtAmount,
      previousExperience,
      bestCallTime,
      preferredCompanies,
      notes,
      privacyAgreed,
    } = req.body;

    const trackingData = extractTrackingData(req);

    try {
      // Create and save lead to database
      const lead = new Lead({
        fullName,
        email,
        phone,
        taxDebtType,
        debtAmount,
        previousExperience,
        bestCallTime,
        preferredCompanies: Array.isArray(preferredCompanies)
          ? preferredCompanies
          : preferredCompanies
          ? [preferredCompanies]
          : ["Alleviate Tax"],
        notes,
        privacyAgreed: true,
        ...trackingData,
      });

      await lead.save();
      console.log(`[Leads] New lead saved: ${lead._id} | ${lead.email}`);

      // Submit to IRSLogics asynchronously (don't block the response)
      submitLead(lead)
        .then(async (irsResult) => {
          const updateData = {
            irslogicsStatus: "sent",
            irslogicsSentAt: new Date(),
          };
          if (irsResult.irslogicsId) {
            updateData.irslogicsId = irsResult.irslogicsId;
          }
          await Lead.findByIdAndUpdate(lead._id, updateData);
          console.log(`[IRSLogics] Lead ${lead._id} sent successfully`);
        })
        .catch(async (irsErr) => {
          await Lead.findByIdAndUpdate(lead._id, {
            irslogicsStatus: "failed",
            irslogicsError: irsErr.message,
          });
          console.error(`[IRSLogics] Failed for lead ${lead._id}: ${irsErr.message}`);
        });

      return res.status(201).json({
        success: true,
        message:
          "Your request has been received! A tax relief specialist will contact you within 24 hours.",
        leadId: lead._id,
      });
    } catch (err) {
      console.error(`[Leads] Error saving lead: ${err.message}`);

      // Handle duplicate email
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message:
            "We already have a request from this email address. Please check your inbox or call us directly.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "An error occurred while processing your request. Please try again or call 1-800-555-0101.",
      });
    }
  }
);

/**
 * GET /api/leads
 * Protected — returns paginated leads list with filters.
 */
router.get("/", protect, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      source,
      startDate,
      endDate,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query filters
    const filter = {};

    if (status && status !== "all") filter.status = status;
    if (source && source !== "all") filter.source = source;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + "T23:59:59Z");
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .select("-__v"),
      Lead.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: leads,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(`[Leads] GET error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch leads." });
  }
});

/**
 * GET /api/leads/:id
 * Protected — returns a single lead by ID.
 */
router.get("/:id", protect, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).select("-__v");
    if (!lead) {
      return res.status(404).json({ success: false, message: "Lead not found." });
    }
    return res.json({ success: true, data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch lead." });
  }
});

/**
 * PATCH /api/leads/:id
 * Protected — update lead status or notes.
 */
router.patch(
  "/:id",
  protect,
  [
    body("status")
      .optional()
      .isIn(["new", "contacted", "qualified", "converted", "lost"])
      .withMessage("Invalid status"),
    body("notes").optional().isLength({ max: 1000 }),
    body("assignedTo").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    try {
      const allowedUpdates = ["status", "notes", "assignedTo", "tags", "revenue", "closedReason"];
      const updates = {};
      allowedUpdates.forEach((field) => {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      });

      if (updates.status === "converted" || updates.status === "lost") {
        updates.closedAt = new Date();
      }

      const lead = await Lead.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      });

      if (!lead) {
        return res.status(404).json({ success: false, message: "Lead not found." });
      }

      return res.json({ success: true, data: lead });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Failed to update lead." });
    }
  }
);

module.exports = router;
