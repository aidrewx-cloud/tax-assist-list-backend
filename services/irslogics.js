const axios = require("axios");

/**
 * IRSLogics CRM Integration Service
 *
 * Handles submitting leads to the IRSLogics API and receiving status updates.
 * API credentials are loaded from environment variables.
 */

const IRSLOGICS_ENDPOINT = process.env.IRSLOGICS_API_ENDPOINT || "https://api.irslogics.com/v1/leads";
const IRSLOGICS_API_KEY = process.env.IRSLOGICS_API_KEY;
const IRSLOGICS_COMPANY_ID = process.env.IRSLOGICS_COMPANY_ID;

/**
 * Maps tax debt type enum to human-readable label for IRSLogics
 */
function mapTaxType(taxDebtType) {
  const map = {
    federal_irs: "Federal IRS",
    state: "State Tax Debt",
    both: "Federal & State",
    business: "Business Tax",
    other: "Other",
  };
  return map[taxDebtType] || taxDebtType;
}

/**
 * Maps debt amount range enum to a display value for IRSLogics
 */
function mapDebtAmount(debtAmount) {
  const map = {
    "10k_25k": "$10,000 - $25,000",
    "25k_50k": "$25,000 - $50,000",
    "50k_100k": "$50,000 - $100,000",
    "100k_250k": "$100,000 - $250,000",
    "250k_plus": "$250,000+",
  };
  return map[debtAmount] || debtAmount;
}

/**
 * Formats a phone number into E.164 format.
 * Assumes US numbers if no country code prefix present.
 */
function formatPhoneE164(phone) {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");
  // If starts with +, it's already in E.164 format
  if (cleaned.startsWith("+")) return cleaned;
  // Assume US number
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  return `+${cleaned}`;
}

/**
 * Maps our lead data to the IRSLogics API field format.
 * Adjust field names here to match the exact IRSLogics API spec.
 */
function mapLeadToIRSLogics(lead) {
  const nameParts = (lead.fullName || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  return {
    // Contact fields
    contact_name: lead.fullName,
    first_name: firstName,
    last_name: lastName,
    email_address: lead.email,
    primary_phone: formatPhoneE164(lead.phone),

    // Tax situation custom fields
    custom_field_tax_type: mapTaxType(lead.taxDebtType),
    custom_field_debt_amount: mapDebtAmount(lead.debtAmount),
    custom_field_previous_experience: lead.previousExperience === "yes" ? "Yes" : "No",
    custom_field_best_call_time: lead.bestCallTime || "Any time",
    custom_field_preferred_companies: Array.isArray(lead.preferredCompanies)
      ? lead.preferredCompanies.join(", ")
      : lead.preferredCompanies || "Alleviate Tax",
    custom_field_notes: lead.notes || "",

    // Lead source tracking
    lead_source: lead.source || "Website",
    utm_source: lead.utmSource || "",
    utm_medium: lead.utmMedium || "",
    utm_campaign: lead.utmCampaign || "",
    utm_content: lead.utmContent || "",
    utm_term: lead.utmTerm || "",
    referrer_url: lead.referrer || "",
    landing_page_url: lead.landingPage || "",

    // System fields
    company_id: IRSLOGICS_COMPANY_ID,
    created_at: new Date().toISOString(),
  };
}

/**
 * Submit a lead to the IRSLogics API.
 *
 * @param {Object} lead - The lead document from MongoDB (or plain object)
 * @returns {Promise<Object>} - The IRSLogics API response data
 */
async function submitLead(lead) {
  if (!IRSLOGICS_API_KEY) {
    console.warn("[IRSLogics] API key not configured. Lead submission skipped.");
    return { skipped: true, reason: "API key not configured" };
  }

  const payload = mapLeadToIRSLogics(lead);

  try {
    const response = await axios.post(IRSLOGICS_ENDPOINT, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${IRSLOGICS_API_KEY}`,
        "X-API-Key": IRSLOGICS_API_KEY,
        "User-Agent": "TaxReliefCompare/1.0",
      },
      timeout: 15000, // 15 second timeout
    });

    console.log(`[IRSLogics] Lead submitted successfully. ID: ${response.data?.id || "unknown"}`);
    return {
      success: true,
      irslogicsId: response.data?.id || response.data?.lead_id,
      data: response.data,
    };
  } catch (err) {
    const errorMessage =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      "Unknown error";
    const statusCode = err.response?.status;

    console.error(`[IRSLogics] Lead submission failed (HTTP ${statusCode}): ${errorMessage}`);

    throw new Error(`IRSLogics API error (${statusCode}): ${errorMessage}`);
  }
}

/**
 * Update an existing lead's status in IRSLogics.
 *
 * @param {string} irslogicsId - The lead ID in IRSLogics
 * @param {Object} updates - Status updates to apply
 * @returns {Promise<Object>}
 */
async function updateLeadStatus(irslogicsId, updates) {
  if (!IRSLOGICS_API_KEY || !irslogicsId) {
    return { skipped: true };
  }

  try {
    const response = await axios.patch(
      `${IRSLOGICS_ENDPOINT}/${irslogicsId}`,
      updates,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${IRSLOGICS_API_KEY}`,
          "X-API-Key": IRSLOGICS_API_KEY,
        },
        timeout: 10000,
      }
    );
    return { success: true, data: response.data };
  } catch (err) {
    console.error(`[IRSLogics] Update failed for ${irslogicsId}: ${err.message}`);
    throw err;
  }
}

/**
 * Verify a webhook signature from IRSLogics.
 * Implement HMAC verification based on IRSLogics webhook docs.
 *
 * @param {string} rawBody - Raw request body string
 * @param {string} signature - Signature from X-IRSLogics-Signature header
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  // In production, implement HMAC-SHA256 verification:
  // const crypto = require('crypto');
  // const expected = crypto.createHmac('sha256', process.env.IRSLOGICS_WEBHOOK_SECRET)
  //   .update(rawBody).digest('hex');
  // return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  return true; // Permissive in demo mode
}

module.exports = {
  submitLead,
  updateLeadStatus,
  verifyWebhookSignature,
  mapLeadToIRSLogics,
  formatPhoneE164,
};
