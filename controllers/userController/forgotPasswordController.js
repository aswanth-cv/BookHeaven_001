const User = require("../../models/userSchema");
const OTP = require("../../models/otpSchema");
const hashPasswordHelper = require("../../helpers/hash");
const { sendOtpEmail } = require("../../helpers/sendMail");
const { createOtpMessage } = require("../../helpers/email-mask");
const { HttpStatus } = require("../../helpers/status-code");

const {
  validateBasicOtp,
  validateOtpSession,
} = require("../../validators/user/basic-otp-validator");

const getForgotPassword = async (req, res) => {
  try {
    res.render("forgotPassword");
  } catch (error) {
    console.log("Error in getting getForgotPassword", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server Error",
    });
  }
};

const postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "Email not exists",
      });
    }

    const otpGenerator = () =>
      Math.floor(100000 + Math.random() * 900000).toString();

    const otp = otpGenerator();

    await OTP.deleteMany({ email, purpose: "password-reset" });

    const otpDoc = new OTP({
      email,
      otp,
      purpose: "password-reset",
      createdAt: new Date(), 
    });

    await otpDoc.save();

    let subjectContent = "Reset Your Chapterless Password";
    await sendOtpEmail(email, user.fullName, otp, subjectContent, "forgot-password");

    req.session.user_email = email;

    const otpMessage = createOtpMessage(email, 'forgot-password');

    return res.status(HttpStatus.OK).json({
      message: otpMessage.message,
      success: true,
      expiresIn: 60,
    });
  } catch (error) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const resendOtp = async (req, res) => {
  try {
    const email = req.session.user_email;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "Email not exists",
      });
    }

    const otpGenerator = () =>
      Math.floor(100000 + Math.random() * 900000).toString();

    const otp = otpGenerator();

    await OTP.deleteMany({ email, purpose: "password-reset" });

    const otpDoc = new OTP({
      email,
      otp,
      purpose: "password-reset",
    });

    await otpDoc.save();

    let subjectContent = "New Password Reset Code - BookHaven";
    await sendOtpEmail(email, user.fullName, otp, subjectContent, "forgot-password");

    const otpMessage = createOtpMessage(email, 'resend');

    return res.status(HttpStatus.OK).json({
      message: otpMessage.message,
      success: true,
      expiresIn: 60,
    });
  } catch (error) {
    console.log("Error in resending OTP");
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getOtpForgotPassword = async (req, res) => {
  try {
    const email = req.session.user_email;
    const otpMessage = createOtpMessage(email, 'forgot-password');

    res.render("otpForgotPassword", {
      maskedEmail: otpMessage.maskedEmail,
      otpMessage: otpMessage.fullMessage
    });
  } catch (error) {
    console.log("Error in getting OTP verification page", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server Error",
    });
  }
};

const verifyOtp = async (req, res) => {
  try {
    const { otp } = req.body;

    const otpValidation = validateBasicOtp(otp);
    if (!otpValidation.isValid) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: otpValidation.message,
      });
    }

    const sessionValidation = validateOtpSession(req, "password-reset");
    if (!sessionValidation.isValid) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: sessionValidation.message,
        sessionExpired: sessionValidation.sessionExpired,
      });
    }

    const email = req.session.user_email;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
    }

    const otpDoc = await OTP.findOne({ email, purpose: "password-reset" });

    if (!otpDoc) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "OTP has expired! Please request a new one",
      });
    }

    if (String(otp) !== String(otpDoc.otp)) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    await OTP.deleteOne({ _id: otpDoc._id });

    return res.status(HttpStatus.OK).json({
      success: true,
      message: "OTP verification successful. You can now reset your password",
    });
  } catch (error) {
    console.log("Error verifying reset OTP", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server Error",
    });
  }
};

const getResetPassword = async (req, res) => {
  try {
    res.render("resetPasswordForm");
  } catch (error) {
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server Error" });
  }
};

const patchResetPassword = async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Passwords don't match",
      });
    }

    const email = req.session.user_email;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
    }

    const hashedPassword = await hashPasswordHelper.hashPassword(newPassword);
              
    user.password = hashedPassword;
    await user.save();

    // Only remove user session data, don't destroy entire session
    delete req.session.user_id;
    delete req.session.user_email;
    if (req.session.passport) {
      delete req.session.passport.user;
    }
    
    // Save the session changes
    req.session.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: "Password updated successfully. Please login again.",
    });
  } catch (error) {
    console.log("Error in updating password", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = {
  getForgotPassword,
  postForgotPassword,
  getOtpForgotPassword,
  verifyOtp,
  getResetPassword,
  patchResetPassword,
  resendOtp,
};
