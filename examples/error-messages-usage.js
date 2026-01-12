/**
 * Example Usage of Error Messages Enum
 * This file demonstrates how to use the centralized error messages
 */

const { ErrorMessages, getErrorMessage, formatErrorMessage } = require('../helpers/error-messages');

// Example 1: Direct usage
console.log('Direct usage:');
console.log(ErrorMessages.CART.EMPTY);
console.log(ErrorMessages.USER.INVALID_EMAIL);
console.log(ErrorMessages.PAYMENT.TRANSACTION_FAILED);

// Example 2: Using helper function
console.log('\nUsing helper function:');
console.log(getErrorMessage('CART', 'EMPTY'));
console.log(getErrorMessage('USER', 'INVALID_EMAIL'));
console.log(getErrorMessage('PAYMENT', 'TRANSACTION_FAILED'));

// Example 3: Formatting messages with dynamic content
console.log('\nFormatted messages:');
const dynamicMessage = "Minimum order amount of ₹{amount} required for coupon {code}";
const formatted = formatErrorMessage(dynamicMessage, { amount: '500', code: 'SAVE20' });
console.log(formatted);

// Example 4: In a controller function
const exampleController = async (req, res) => {
  try {
    // Some logic here...
    
    // Instead of hardcoded error message:
    // return res.status(400).json({ success: false, message: "Your cart is empty" });
    
    // Use enum:
    return res.status(400).json({ 
      success: false, 
      message: ErrorMessages.CART.EMPTY 
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: ErrorMessages.SERVER.INTERNAL_ERROR 
    });
  }
};

// Example 5: Validation with error messages
const validateUserInput = (email, phone) => {
  const errors = [];
  
  if (!email) {
    errors.push(ErrorMessages.VALIDATION.REQUIRED_FIELD);
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(ErrorMessages.VALIDATION.INVALID_EMAIL);
  }
  
  if (!phone) {
    errors.push(ErrorMessages.VALIDATION.REQUIRED_FIELD);
  } else if (!/^\d{10}$/.test(phone)) {
    errors.push(ErrorMessages.VALIDATION.INVALID_PHONE);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  exampleController,
  validateUserInput
};