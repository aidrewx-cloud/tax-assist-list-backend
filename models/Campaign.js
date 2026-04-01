const mongoose = require("mongoose");

const spendEntrySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const campaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Campaign name is required"],
      trim: true,
      maxlength: 200,
    },
    platform: {
      type: String,
      required: [true, "Platform is required"],
      enum: ["Google Ads", "Meta Ads", "TikTok", "Bing Ads", "YouTube", "LinkedIn", "Direct Mail", "Other"],
    },
    status: {
      type: String,
      enum: ["active", "paused", "completed", "draft"],
      default: "active",
    },
    budget: {
      type: Number,
      default: 0,
      min: 0,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: Date,
    utmSource: { type: String, trim: true },
    utmMedium: { type: String, trim: true },
    utmCampaign: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    spendEntries: [spendEntrySchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: total spend
campaignSchema.virtual("totalSpend").get(function () {
  return this.spendEntries.reduce((sum, e) => sum + e.amount, 0);
});

// Virtual: total impressions
campaignSchema.virtual("totalImpressions").get(function () {
  return this.spendEntries.reduce((sum, e) => sum + (e.impressions || 0), 0);
});

// Virtual: total clicks
campaignSchema.virtual("totalClicks").get(function () {
  return this.spendEntries.reduce((sum, e) => sum + (e.clicks || 0), 0);
});

campaignSchema.index({ status: 1, createdAt: -1 });
campaignSchema.index({ platform: 1 });
campaignSchema.index({ utmCampaign: 1 });

module.exports = mongoose.model("Campaign", campaignSchema);
