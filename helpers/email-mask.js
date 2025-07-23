
const maskEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return 'your***@example.com';
  }

  const [localPart, domain] = email.split('@');
  
  if (!localPart || !domain) {
    return 'your***@example.com';
  }

  let visibleChars;
  if (localPart.length <= 2) {
    visibleChars = 1;
  } else if (localPart.length <= 4) {
    visibleChars = 2;
  } else {
    visibleChars = 3;
  }

  
  const visiblePart = localPart.substring(0, visibleChars);
  const maskedPart = '***';
  
  return `${visiblePart}${maskedPart}@${domain}`;
};


const maskEmailCustom = (email, maskChar = '*', visibleCount = 3) => {
  if (!email || typeof email !== 'string') {
    return `your${maskChar.repeat(3)}@example.com`;
  }

  const [localPart, domain] = email.split('@');
  
  if (!localPart || !domain) {
    return `your${maskChar.repeat(3)}@example.com`;
  }

  const visibleChars = Math.min(visibleCount, localPart.length - 1);
  const visiblePart = localPart.substring(0, Math.max(1, visibleChars));
  const maskedPart = maskChar.repeat(3);
  
  return `${visiblePart}${maskedPart}@${domain}`;
};


const createOtpMessage = (email, purpose = 'verification') => {
  const maskedEmail = maskEmail(email);
  
  const messages = {
    'signup': `We've sent a verification code to ${maskedEmail}`,
    'forgot-password': `Password reset code sent to ${maskedEmail}`,
    'resend': `New verification code sent to ${maskedEmail}`,
    'verification': `Verification code sent to ${maskedEmail}`,
    'email-update': `Email verification code sent to ${maskedEmail}`
  };

  return {
    maskedEmail,
    message: messages[purpose] || messages['verification'],
    fullMessage: `Enter the verification code sent to ${maskedEmail}`
  };
};


const isValidEmailFormat = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

module.exports = {
  maskEmail,
  maskEmailCustom,
  createOtpMessage,
  isValidEmailFormat
};
