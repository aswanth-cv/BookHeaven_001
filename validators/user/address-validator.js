const { createValidationMiddleware, validateName, validatePhone, validateText, VALIDATION_PATTERNS, VALIDATION_RULES } = require('../../helpers/validation-helper');
const { HttpStatus } = require("../../helpers/status-code");


const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
  'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry'
];


const validateAddressData = createValidationMiddleware({
  fullName: {
    type: 'name',
    fieldName: 'Full Name'
  },
  phone: {
    type: 'phone',
    fieldName: 'Phone Number'
  },
  pincode: {
    type: 'text',
    fieldName: 'Pincode',
    pattern: VALIDATION_PATTERNS.PINCODE,
    required: true
  },
  district: {
    type: 'text',
    fieldName: 'District',
    min: 2,
    max: 50,
    pattern: /^[A-Za-z\s]+$/,
    required: true
  },
  state: {
    type: 'text',
    fieldName: 'State',
    min: 2,
    max: 50,
    pattern: /^[A-Za-z\s]+$/,
    required: true
  },
  street: {
    type: 'text',
    fieldName: 'Street Address',
    min: VALIDATION_RULES.ADDRESS.min,
    max: VALIDATION_RULES.ADDRESS.max,
    pattern: VALIDATION_PATTERNS.ALPHANUMERIC_SPECIAL,
    required: true
  },
  landmark: {
    type: 'text',
    fieldName: 'Landmark',
    required: false,
    max: 100,
    pattern: VALIDATION_PATTERNS.ALPHANUMERIC_SPECIAL
  },
  addressType: {
    type: 'text',
    fieldName: 'Address Type',
    pattern: /^(home|work|other)$/,
    required: false
  }
});


const validateState = (req, res, next) => {
  try {
    const { state } = req.validatedData;
    
    const normalized = INDIAN_STATES.find(
      (s) => s.toLowerCase() === String(state || '').toLowerCase()
    );
    
    if (!normalized) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Please select a valid Indian state',
        errors: ['Invalid state selected']
      });
    }
    
    req.validatedData.state = normalized;
    
    next();
  } catch (error) {
    console.error('State validation error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const validateAddressAuth = (req, res, next) => {
  try {
    const userId = req.session.user_id || req.user?._id;
    
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Please login to manage addresses'
      });
    }
    
    req.validatedData = { ...req.validatedData, userId };
    next();
  } catch (error) {
    console.error('Address auth validation error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const validateAddressId = createValidationMiddleware({
  addressId: {
    type: 'objectId',
    fieldName: 'Address ID'
  }
});


const validateSetDefaultAddress = createValidationMiddleware({
  addressId: {
    type: 'objectId',
    fieldName: 'Address ID'
  }
});


const validateAddressOwnership = async (req, res, next) => {
  try {
    const { addressId, userId } = req.validatedData;
    
   
    req.validatedData = { ...req.validatedData, addressId, userId };
    next();
  } catch (error) {
    console.error('Address ownership validation error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const validatePincodeDetails = (req, res, next) => {
  try {
    const { pincode } = req.validatedData;
    
    
    next();
  } catch (error) {
    console.error('Pincode validation error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  validateAddressData,
  validateState,
  validateAddressAuth,
  validateAddressId,
  validateSetDefaultAddress,
  validateAddressOwnership,
  validatePincodeDetails,
  INDIAN_STATES
};
