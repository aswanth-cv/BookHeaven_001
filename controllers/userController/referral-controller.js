const User = require("../../models/userSchema");
const Referral = require("../../models/referralSchema");

const getReferrals = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const user = await User.findById(userId);

    if (!user) {
      return res.redirect('/login');
    }

    // Get referral statistics
    const referralStats = await Referral.find({ referrer: userId }).populate('referred', 'fullName email createdAt');

    res.render("referrals", {
      user,
      referralCode: user.referralCode,
      referrals: referralStats
    });
  } catch (error) {
    console.log("Error in rendering referrals page", error);
    res.status(500).render("error", {
      message: "Internal server error",
    });
  }
};

// Validate referral code
const validateReferral = async (req, res) => {
  try {
    const { referralCode } = req.body;

    if (!referralCode) {
      return res.status(400).json({
        success: false,
        message: "Referral code is required"
      });
    }

    // Find user with this referral code
    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });

    if (!referrer) {
      return res.status(404).json({
        success: false,
        message: "Invalid referral code"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Valid referral code",
      referrerName: referrer.fullName
    });

  } catch (error) {
    console.error("Error validating referral code:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while validating referral code"
    });
  }
};

module.exports = {
  getReferrals,
  validateReferral,
};
