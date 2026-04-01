const express = require("express");
const router = express.Router();
const Lead = require("../models/Lead");
const { verifyWebhookSignature } = require("../services/irslogics");

/**
 * POST /api/webhooks/irslogics
 *
 * Receives real-time lead status updates from IRSLogics CRM.
 * IRSLogics will POST to this endpoint when:
 *  - A lead is accepted/rejected
 *  - A lead status changes (contacted, qualified, converted, etc.)
 *  - A lead is merged or deduplicated
 *
 * Configure this URL in your IRSLogics dashboard as the webhook endpoint.
 */
router.post("/irslogics", express.raw({ type: "application/json" }), async (req, res) => {
  // Verify webhook signature for security
  const signature = req.headers["x-irslogics-signature"] || req.headers["x-webhook-signature"];
  const rawBody = req.body.toString("utf8");

  if (process.env.NODE_ENV === "production") {
    const isValid = verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.warn("[Webhook] Invalid signature received from IRSLogics");
      return res.status(401).json({ success: false, message: "Invalid webhook signature" });
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (parseErr) {
    console.error("[Webhook] Failed to parse webhook payload:", parseErr.message);
    return res.status(400).json({ success: false, message: "Invalid JSON payload" });
  }

  const { event, lead_id, data } = payload;

  console.log(`[Webhook] IRSLogics event received: ${event} | Lead ID: ${lead_id}`);

  // Respond immediately (IRSLogics expects a 2xx response quickly)
  res.status(200).json({ success: true, message: "Webhook received" });

  // Process asynchronously after response is sent
  try {
    if (!lead_id) {
      console.warn("[Webhook] No lead_id in payload, skipping processing");
      return;
    }

    // Find our lead by IRSLogics ID
    const lead = await Lead.findOne({ irslogicsId: lead_id });
    if (!lead) {
      console.warn(`[Webhook] Lead with IRSLogics ID ${lead_id} not found in database`);
      return;
    }

    // Map IRSLogics events to our status values
    const eventStatusMap = {
      "lead.accepted": "new",
      "lead.contacted": "contacted",
      "lead.qualified": "qualified",
      "lead.converted": "converted",
      "lead.closed": "converted",
      "lead.lost": "lost",
      "lead.rejected": "lost",
      "lead.assigned": "contacted",
    };

    const updates = {};

    if (eventStatusMap[event]) {
      updates.status = eventStatusMap[event];
      if (updates.status === "converted" || updates.status === "lost") {
        updates.closedAt = new Date();
      }
    }

    // Extract additional data from the webhook payload
    if (data) {
      if (data.assigned_to) updates.assignedTo = data.assigned_to;
      if (data.notes) updates.notes = lead.notes ? `${lead.notes}\n\n[IRSLogics]: ${data.notes}` : data.notes;
      if (data.revenue) updates.revenue = parseFloat(data.revenue);
    }

    if (Object.keys(updates).length > 0) {
      await Lead.findByIdAndUpdate(lead._id, updates);
      console.log(`[Webhook] Lead ${lead._id} updated: ${JSON.stringify(updates)}`);
    }
  } catch (err) {
    console.error(`[Webhook] Error processing IRSLogics webhook: ${err.message}`);
  }
});

/**
 * POST /api/webhooks/test
 * Development only — test webhook endpoint without signature verification
 */
router.post("/test", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ message: "Not found" });
  }

  console.log("[Webhook Test] Payload received:", JSON.stringify(req.body, null, 2));
  return res.json({
    success: true,
    message: "Test webhook received",
    payload: req.body,
  });
});

/**
 * GET /api/webhooks/health
 * Health check for webhook endpoint (used by IRSLogics to verify connectivity)
 */
router.get("/health", (req, res) => {
  return res.json({
    success: true,
    message: "Webhook endpoint is operational",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
