const { createValidationMiddleware, validateObjectId, validateQuantity } = require('../../helpers/validation-helper');


const validateAddToCart = createValidationMiddleware({
  productId: {
    type: 'objectId',
    fieldName: 'Product ID'
  },
  quantity: {
    type: 'quantity',
    fieldName: 'Quantity'
  }
});


const validateUpdateCartQuantity = createValidationMiddleware({
  productId: {
    type: 'objectId',
    fieldName: 'Product ID'
  },
  quantity: {
    type: 'quantity',
    fieldName: 'Quantity'
  }
});


const validateRemoveFromCart = createValidationMiddleware({
  productId: {
    type: 'objectId',
    fieldName: 'Product ID'
  }
});


const validateCartItemOwnership = async (req, res, next) => {
  try {
    const { productId } = req.validatedData || req.body;
    const userId = req.session.user_id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Please login to manage cart'
      });
    }
    
    req.validatedData = { ...req.validatedData, userId };
    next();
  } catch (error) {
    console.error('Cart validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const validateCartCheckout = (req, res, next) => {
  try {
    const userId = req.session.user_id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Please login to proceed with checkout'
      });
    }
    
    req.validatedData = { userId };
    next();
  } catch (error) {
    console.error('Cart checkout validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  validateAddToCart,
  validateUpdateCartQuantity,
  validateRemoveFromCart,
  validateCartItemOwnership,
  validateCartCheckout
};
