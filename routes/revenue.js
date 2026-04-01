const express = require("express");
const router = express.Router();
const { body, validationResult } = require("express-validator");
const Lead = require("../models/Lead");
const Campaign = require("../models/Campaign");
const { protect } = require("../middleware/auth");

router.use(protect);

/**
 * GET /api/revenue/summary
 * Returns profit & loss summary with ad spend, revenue, and ROI.
 */
router.get("/summary", async (req, res) => {
  try {
    const { range = "month" } = req.query;
    const now = new Date();
    const start = new Date();

    switch (range) {
      case "today":
        start.setHours(0, 0, 0, 0);
        break;
      case "week":
        start.setDate(now.getDate() - 7);
        break;
      case "month":
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        break;
      case "quarter":
        start.setMonth(now.getMonth() - 3);
        break;
      case "year":
        start.setFullYear(now.getFullYear(), 0, 1);
        start.setHours(0, 0, 0, 0);
        break;
      case "all":
        start.setFullYear(2020, 0, 1);
        break;
      default:
        start.setDate(now.getDate() - 30);
    }

    // Get total revenue from converted leads
    const revenueResult = await Lead.aggregate([
      {
        $match: {
          status: "converted",
          revenue: { $gt: 0 },
          closedAt: { $gte: start, $lte: now },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$revenue" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;
    const convertedCount = revenueResult[0]?.count || 0;

    // Get total ad spend from campaigns
    const campaigns = await Campaign.find({});
    let totalAdSpend = 0;
    let periodAdSpend = 0;

    campaigns.forEach((c) => {
      c.spendEntries.forEach((e) => {
        totalAdSpend += e.amount;
        if (e.date >= start && e.date <= now) {
          periodAdSpend += e.amount;
        }
      });
    });

    // Get all leads in period for CPL
    const periodLeads = await Lead.countDocuments({
      createdAt: { $gte: start, $lte: now },
    });

    const profit = totalRevenue - periodAdSpend;
    const roi = periodAdSpend > 0 ? ((profit / periodAdSpend) * 100).toFixed(1) : "0";
    const costPerLead = periodLeads > 0 ? (periodAdSpend / periodLeads).toFixed(2) : "0";
    const costPerAcquisition = convertedCount > 0 ? (periodAdSpend / convertedCount).toFixed(2) : "0";
    const avgRevenuePerDeal = convertedCount > 0 ? (totalRevenue / convertedCount).toFixed(2) : "0";

    return res.json({
      success: true,
      data: {
        totalRevenue,
        periodAdSpend,
        totalAdSpend,
        profit,
        roi: `${roi}%`,
        costPerLead: parseFloat(costPerLead),
        costPerAcquisition: parseFloat(costPerAcquisition),
        avgRevenuePerDeal: parseFloat(avgRevenuePerDeal),
        convertedCount,
        periodLeads,
        range,
        periodStart: start,
        periodEnd: now,
      },
    });
  } catch (err) {
    console.error(`[Revenue] Summary error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch revenue summary." });
  }
});

/**
 * GET /api/revenue/by-month
 * Returns monthly revenue and spend breakdown.
 */
router.get("/by-month", async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    // Revenue by month
    const revenueByMonth = await Lead.aggregate([
      {
        $match: {
          status: "converted",
          revenue: { $gt: 0 },
          closedAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$closedAt" } },
          revenue: { $sum: "$revenue" },
          deals: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Spend by month from campaigns
    const campaigns = await Campaign.find({});
    const spendByMonth = {};
    campaigns.forEach((c) => {
      c.spendEntries.forEach((e) => {
        if (e.date >= startDate) {
          const key = e.date.toISOString().slice(0, 7);
          spendByMonth[key] = (spendByMonth[key] || 0) + e.amount;
        }
      });
    });

    // Build combined data
    const revenueMap = {};
    revenueByMonth.forEach((r) => {
      revenueMap[r._id] = { revenue: r.revenue, deals: r.deals };
    });

    const data = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      data.push({
        month: key,
        revenue: revenueMap[key]?.revenue || 0,
        deals: revenueMap[key]?.deals || 0,
        adSpend: spendByMonth[key] || 0,
        profit: (revenueMap[key]?.revenue || 0) - (spendByMonth[key] || 0),
      });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error(`[Revenue] By month error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch monthly data." });
  }
});

/**
 * PATCH /api/revenue/lead/:id
 * Set revenue amount on a lead (for converted leads).
 */
router.patch(
  "/lead/:id",
  [body("revenue").notEmpty().isFloat({ min: 0 }).withMessage("Revenue must be a positive number")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    try {
      const lead = await Lead.findByIdAndUpdate(
        req.params.id,
        { revenue: req.body.revenue },
        { new: true, runValidators: true }
      );
      if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
      return res.json({ success: true, data: lead });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Failed to update revenue." });
    }
  }
);

module.exports = router;
