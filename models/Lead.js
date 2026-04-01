const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    // Contact Information
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: [100, "Full name cannot exceed 100 characters"],
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please provide a valid email address"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },

    // Tax Situation
    taxDebtType: {
      type: String,
      required: [true, "Tax debt type is required"],
      enum: ["federal_irs", "state", "both", "business", "other"],
    },
    debtAmount: {
      type: String,
      required: [true, "Debt amount is required"],
      enum: ["10k_25k", "25k_50k", "50k_100k", "100k_250k", "250k_plus"],
    },
    previousExperience: {
      type: String,
      enum: ["yes", "no"],
      default: "no",
    },

    // Preferences
    bestCallTime: {
      type: String,
      trim: true,
    },
    preferredCompanies: {
      type: [String],
      default: ["Alleviate Tax"],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },

    // Privacy & Consent
    privacyAgreed: {
      type: Boolean,
      required: [true, "Privacy agreement is required"],
      validate: {
        validator: (val) => val === true,
        message: "You must agree to the privacy policy",
      },
    },

    // Lead Tracking
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "converted", "lost"],
      default: "new",
    },
    source: {
      type: String,
      enum: ["Google Ads", "Meta Ads", "TikTok", "Organic", "Direct", "Referral", "Unknown"],
      default: "Unknown",
    },
    utmSource: String,
    utmMedium: String,
    utmCampaign: String,
    utmContent: String,
    utmTerm: String,
    ipAddress: String,
    userAgent: String,
    referrer: String,
    landingPage: String,

    // CRM Integration
    irslogicsId: {
      type: String,
      sparse: true,
    },
    irslogicsSentAt: Date,
    irslogicsError: String,
    irslogicsStatus: {
      type: String,
      enum: ["pending", "sent", "failed", "updated"],
      default: "pending",
    },

    // Internal
    assignedTo: String,
    lastContactedAt: Date,
    closedAt: Date,
    closedReason: String,
    revenue: Number,
    tags: [String],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: derive first/last name from fullName
leadSchema.pre("save", function (next) {
  if (this.fullName && (!this.firstName || !this.lastName)) {
    const parts = this.fullName.trim().split(/\s+/);
    this.firstName = parts[0] || "";
    this.lastName = parts.slice(1).join(" ") || "";
  }
  next();
});

// Indexes for common queries
leadSchema.index({ email: 1 });
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ source: 1, createdAt: -1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ ipAddress: 1, createdAt: -1 });

// Virtual: debt amount label
leadSchema.virtual("debtAmountLabel").get(function () {
  const labels = {
    "10k_25k": "$10,000 – $25,000",
    "25k_50k": "$25,000 – $50,000",
    "50k_100k": "$50,000 – $100,000",
    "100k_250k": "$100,000 – $250,000",
    "250k_plus": "$250,000+",
  };
  return labels[this.debtAmount] || this.debtAmount;
});

module.exports = mongoose.model("Lead", leadSchema);
