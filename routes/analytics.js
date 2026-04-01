const express = require("express");
const router = express.Router();
const Lead = require("../models/Lead");
const { protect } = require("../middleware/auth");

/**
 * Helper: get date range boundaries
 */
function getDateRange(range) {
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
    default: // 30 days
      start.setDate(now.getDate() - 30);
  }
  return { start, end: now };
}

/**
 * GET /api/analytics/summary
 * Protected — returns KPI summary metrics.
 */
router.get("/summary", protect, async (req, res) => {
  try {
    const { range = "month" } = req.query;
    const { start, end } = getDateRange(range);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Parallel queries for performance
    const [
      totalLeads,
      leadsThisPeriod,
      leadsToday,
      leadsYesterday,
      leadsByStatus,
      leadsBySource,
    ] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ createdAt: { $gte: start, $lte: end } }),
      Lead.countDocuments({ createdAt: { $gte: todayStart } }),
      Lead.countDocuments({
        createdAt: {
          $gte: new Date(todayStart.getTime() - 86400000),
          $lt: todayStart,
        },
      }),
      Lead.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Build status map
    const statusMap = {};
    leadsByStatus.forEach((s) => { statusMap[s._id] = s.count; });

    const converted = statusMap["converted"] || 0;
    const conversionRate =
      totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : "0.0";

    // Mock ad spend data (replace with real ad platform API data in production)
    const adSpend = 54120;
    const costPerLead = totalLeads > 0 ? (adSpend / totalLeads).toFixed(2) : "0.00";
    const avgRevenuePerConversion = 3500; // Estimated
    const estimatedRevenue = converted * avgRevenuePerConversion;
    const roi =
      adSpend > 0
        ? (((estimatedRevenue - adSpend) / adSpend) * 100).toFixed(0)
        : "0";

    return res.json({
      success: true,
      data: {
        totalLeads,
        leadsThisPeriod,
        leadsToday,
        leadsYesterday,
        todayChange:
          leadsYesterday > 0
            ? (((leadsToday - leadsYesterday) / leadsYesterday) * 100).toFixed(1)
            : null,
        conversionRate: `${conversionRate}%`,
        convertedLeads: converted,
        costPerLead: `$${costPerLead}`,
        estimatedROI: `${roi}%`,
        adSpend: `$${adSpend.toLocaleString()}`,
        leadsByStatus: statusMap,
        leadsBySource: leadsBySource.map((s) => ({
          source: s._id || "Unknown",
          count: s.count,
          percentage:
            leadsThisPeriod > 0
              ? ((s.count / leadsThisPeriod) * 100).toFixed(1)
              : "0",
        })),
        range,
        periodStart: start,
        periodEnd: end,
      },
    });
  } catch (err) {
    console.error(`[Analytics] Summary error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch analytics." });
  }
});

/**
 * GET /api/analytics/leads-by-day
 * Protected — returns daily lead counts for the last N days.
 */
router.get("/leads-by-day", protect, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const result = await Lead.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill in missing days with 0
    const dateMap = {};
    result.forEach((r) => { dateMap[r._id] = r.count; });

    const filled = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      filled.push({
        date: key,
        leads: dateMap[key] || 0,
      });
    }

    return res.json({ success: true, data: filled });
  } catch (err) {
    console.error(`[Analytics] Leads by day error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch daily leads." });
  }
});

/**
 * GET /api/analytics/funnel
 * Protected — returns funnel stage counts.
 */
router.get("/funnel", protect, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.range || "month");

    const statusCounts = await Lead.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const statusMap = {};
    statusCounts.forEach((s) => { statusMap[s._id] = s.count; });

    const totalLeads = Object.values(statusMap).reduce((a, b) => a + b, 0);

    // Estimate website visitors (leads represent ~10% of visitors typically)
    const estimatedVisitors = totalLeads * 10;

    const funnel = [
      { stage: "Visitors", count: estimatedVisitors },
      { stage: "Form Started", count: Math.round(totalLeads * 2.9) },
      { stage: "Leads Submitted", count: totalLeads },
      { stage: "Contacted", count: (statusMap["contacted"] || 0) + (statusMap["qualified"] || 0) + (statusMap["converted"] || 0) },
      { stage: "Qualified", count: (statusMap["qualified"] || 0) + (statusMap["converted"] || 0) },
      { stage: "Converted", count: statusMap["converted"] || 0 },
    ];

    return res.json({ success: true, data: funnel });
  } catch (err) {
    console.error(`[Analytics] Funnel error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch funnel data." });
  }
});

/**
 * GET /api/analytics/lead-sources
 * Protected — returns lead counts grouped by source with percentages.
 */
router.get("/lead-sources", protect, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.range || "month");

    const result = await Lead.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const total = result.reduce((sum, r) => sum + r.count, 0);

    const sources = result.map((r) => ({
      source: r._id || "Unknown",
      count: r.count,
      percentage: total > 0 ? parseFloat(((r.count / total) * 100).toFixed(1)) : 0,
    }));

    return res.json({ success: true, data: sources, total });
  } catch (err) {
    console.error(`[Analytics] Lead sources error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch lead sources." });
  }
});

/**
 * GET /api/analytics/top-companies
 * Protected — returns most frequently selected companies.
 */
router.get("/top-companies", protect, async (req, res) => {
  try {
    const result = await Lead.aggregate([
      { $unwind: "$preferredCompanies" },
      { $group: { _id: "$preferredCompanies", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    return res.json({ success: true, data: result.map((r) => ({ company: r._id, count: r.count })) });
  } catch (err) {
    console.error(`[Analytics] Top companies error: ${err.message}`);
    return res.status(500).json({ success: false, message: "Failed to fetch company data." });
  }
});

module.exports = router;
