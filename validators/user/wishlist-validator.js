const { createValidationMiddleware } = require('../../helpers/validation-helper');
const { HttpStatus } = require("../../helpers/status-code");

const validateWishlistToggle = createValidationMiddleware({
  productId: {
    type: 'objectId',
    fieldName: 'Product ID'
  }
});


const validateWishlistAuth = (req, res, next) => {
  try {
    const userId = req.session.user_id || req.user?._id;
    
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Please login to manage wishlist'
      });
    }
    
    req.validatedData = { ...req.validatedData, userId };
    next();
  } catch (error) {
    console.error('Wishlist auth validation error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const validateRemoveFromWishlist = createValidationMiddleware({
  productId: {
    type: 'objectId',
    fieldName: 'Product ID'
  }
});


const validateClearWishlist = (req, res, next) => {
  try {
    const userId = req.session.user_id || req.user?._id;
    
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Please login to clear wishlist'
      });
    }
    
    req.validatedData = { userId };
    next();
  } catch (error) {
    console.error('Clear wishlist validation error:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  validateWishlistToggle,
  validateWishlistAuth,
  validateRemoveFromWishlist,
  validateClearWishlist
};
