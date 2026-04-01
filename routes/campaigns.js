const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const Campaign = require("../models/Campaign");
const { protect } = require("../middleware/auth");

// All routes require authentication
router.use(protect);

/**
 * GET /api/campaigns
 * List all campaigns with optional filters.
 */
router.get("/", async (req, res) => {
  try {
    const { status, platform, sortBy = "createdAt", sortOrder = "desc" } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (platform && platform !== "all") filter.platform = platform;

    const campaigns = await Campaign.find(filter)
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
      .select("-__v");

    return res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error(`[Campaigns] GET error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch campaigns." });
  }
});

/**
 * GET /api/campaigns/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).select("-__v");
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch campaign." });
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign.
 */
router.post(
  "/",
  [
    body("name").trim().notEmpty().withMessage("Campaign name is required"),
    body("platform").notEmpty().isIn(["Google Ads", "Meta Ads", "TikTok", "Bing Ads", "YouTube", "LinkedIn", "Direct Mail", "Other"]),
    body("startDate").notEmpty().isISO8601().withMessage("Valid start date is required"),
    body("budget").optional().isFloat({ min: 0 }),
    body("endDate").optional().isISO8601(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    try {
      const campaign = new Campaign(req.body);
      await campaign.save();
      return res.status(201).json({ success: true, data: campaign });
    } catch (err) {
      console.error(`[Campaigns] POST error: ${err.message}`);
      return res.status(500).json({ success: false, message: "Failed to create campaign." });
    }
  }
);

/**
 * PATCH /api/campaigns/:id
 * Update campaign details.
 */
router.patch("/:id", async (req, res) => {
  try {
    const allowed = ["name", "platform", "status", "budget", "startDate", "endDate", "utmSource", "utmMedium", "utmCampaign", "notes"];
    const updates = {};
    allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const campaign = await Campaign.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to update campaign." });
  }
});

/**
 * DELETE /api/campaigns/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndDelete(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });
    return res.json({ success: true, message: "Campaign deleted." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete campaign." });
  }
});

/**
 * POST /api/campaigns/:id/spend
 * Add a spend entry to a campaign.
 */
router.post(
  "/:id/spend",
  [
    body("date").notEmpty().isISO8601(),
    body("amount").notEmpty().isFloat({ min: 0 }),
    body("impressions").optional().isInt({ min: 0 }),
    body("clicks").optional().isInt({ min: 0 }),
    body("conversions").optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    try {
      const campaign = await Campaign.findById(req.params.id);
      if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });

      campaign.spendEntries.push({
        date: req.body.date,
        amount: req.body.amount,
        impressions: req.body.impressions || 0,
        clicks: req.body.clicks || 0,
        conversions: req.body.conversions || 0,
        notes: req.body.notes || "",
      });

      await campaign.save();
      return res.json({ success: true, data: campaign });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Failed to add spend entry." });
    }
  }
);

/**
 * DELETE /api/campaigns/:id/spend/:spendId
 * Remove a spend entry.
 */
router.delete("/:id/spend/:spendId", async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found." });

    campaign.spendEntries.id(req.params.spendId)?.deleteOne();
    await campaign.save();
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to delete spend entry." });
  }
});

module.exports = router;
