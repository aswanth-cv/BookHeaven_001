
const { HttpStatus } = require("../../helpers/status-code");


const validateBasicOtp = (otp) => {
  if (!otp) {
    return {
      isValid: false,
      message: "OTP is required"
    };
  }

  const otpString = otp.toString().trim();

  if (!/^\d{6}$/.test(otpString)) {
    return {
      isValid: false,
      message: "Please provide a valid 6-digit OTP"
    };
  }

  return {
    isValid: true,
    message: "OTP format is valid",
    sanitizedOtp: otpString
  };
};


const basicOtpValidationMiddleware = (req, res, next) => {
  const { otp } = req.body;
  
  const validation = validateBasicOtp(otp);
  
  if (!validation.isValid) {
    return res.status(HttpStatus.BAD_REQUEST).json({
      success: false,
      message: validation.message,
    });
  }

  req.sanitizedOtp = validation.sanitizedOtp;
  next();
};


const validateBasicEmail = (email) => {
  if (!email) {
    return {
      isValid: false,
      message: "Email is required"
    };
  }

  const emailString = email.toString().trim().toLowerCase();
  
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  
  if (!emailRegex.test(emailString)) {
    return {
      isValid: false,
      message: "Please provide a valid email address"
    };
  }

  return {
    isValid: true,
    message: "Email format is valid",
    sanitizedEmail: emailString
  };
};


const validateOtpSession = (req, purpose) => {
  switch (purpose) {
    case 'signup':
      if (!req.session.tempUser || !req.session.tempUser.email) {
        return {
          isValid: false,
          message: "Session expired. Please sign up again.",
          sessionExpired: true
        };
      }
      break;
      
    case 'password-reset':
      if (!req.session.user_email) {
        return {
          isValid: false,
          message: "Session expired. Please start the password reset process again.",
          sessionExpired: true
        };
      }
      break;
      
    case 'email-update':
      if (!req.session.user_id || !req.session.newEmail) {
        return {
          isValid: false,
          message: "Session expired. Please start the email update process again.",
          sessionExpired: true
        };
      }
      break;
      
    default:
      return {
        isValid: false,
        message: "Invalid OTP purpose"
      };
  }

  return {
    isValid: true,
    message: "Session is valid"
  };
};


const sanitizeOtp = (otp) => {
  if (!otp) return '';
  return otp.toString().replace(/\D/g, '');
};


const isValidOtpFormat = (otp) => {
  if (!otp) return false;
  const sanitized = sanitizeOtp(otp);
  return /^\d{6}$/.test(sanitized);
};


const createOtpErrorResponse = (message = "Please provide a valid 6-digit OTP") => {
  return {
    success: false,
    message: message,
    code: "INVALID_OTP_FORMAT"
  };
};


const createOtpSuccessResponse = (message = "OTP verified successfully", data = {}) => {
  return {
    success: true,
    message: message,
    ...data
  };
};


module.exports = {
  validateBasicOtp,
  validateBasicEmail,
  validateOtpSession,
  
  sanitizeOtp,
  isValidOtpFormat,
  
  createOtpErrorResponse,
  createOtpSuccessResponse,
  
  basicOtpValidationMiddleware,
};
