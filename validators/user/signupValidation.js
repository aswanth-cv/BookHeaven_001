const signupValidator = (req, res, next) => {
  const { fullName, email, phoneNumber, password, confirmPassword } = req.body;
  const errors = {};

  req.body.fullName = fullName?.trim();
  req.body.email = email?.toLowerCase().trim();

  if (!req.body.fullName || req.body.fullName.length < 3) {
    errors.fullName = "Full name must be at least 3 characters";
  } else {
    const nameWords = req.body.fullName.split(' ').filter(word => word.length > 0);
    if (nameWords.length < 2) {
      errors.fullName = "Please provide both first and last name";
    } else if (!/^[A-Za-z\s'-]+$/.test(req.body.fullName)) {
      errors.fullName = "Name contains invalid characters";
    }
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email || !emailRegex.test(req.body.email)) {
    errors.email = "Enter a valid email address";
  } else {
    const disposableDomains = ['mailinator.com', 'tempmail.com', 'temp-mail.org', 'guerrillamail.com', 'yopmail.com', 'sharklasers.com'];
    const domain = req.body.email.split('@')[1];
    if (disposableDomains.includes(domain)) {
      errors.email = "Please use a non-disposable email address";
    }
  }

  if (!phoneNumber) {
    errors.phoneNumber = "Phone number is required";
  } else {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    if (cleanPhone.length !== 10 && (cleanPhone.length < 11 || cleanPhone.length > 15)) {
      errors.phoneNumber = "Phone number must be 10 digits or include a valid country code";
    } else if (!/^\d+$/.test(cleanPhone)) {
      errors.phoneNumber = "Phone number must contain only digits";
    }
    
    if (/^(.)\1+$/.test(cleanPhone) || /^0{10}$/.test(cleanPhone) || /^1{10}$/.test(cleanPhone)) {
      errors.phoneNumber = "Please enter a valid phone number";
    }
  }

  if (!password) {
    errors.password = "Password is required";
  } else {
    const minLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[@$!%*?&_\-#]/.test(password);

    if (!minLength || !hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
      let errorMsg = "Password must include: ";
      const missing = [];
      
      if (!minLength) missing.push("at least 8 characters");
      if (!hasUppercase) missing.push("uppercase letter");
      if (!hasLowercase) missing.push("lowercase letter");
      if (!hasNumber) missing.push("number");
      if (!hasSpecial) missing.push("special character (@$!%*?&_-#)");
      
      errors.password = errorMsg + missing.join(", ");
    }
    
    if (/123456|password|qwerty/i.test(password)) {
      errors.password = "Password contains a common pattern and is not secure";
    }
  }

  if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  next();
};

module.exports = { signupValidator };