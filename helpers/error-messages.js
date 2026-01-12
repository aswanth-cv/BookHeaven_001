/**
 * Centralized Error Messages Enum
 * This file contains all error messages used throughout the application
 * to ensure consistency and easy maintenance.
 */

const ErrorMessages = Object.freeze({
  // Authentication & Authorization
  AUTH: {
    UNAUTHORIZED: "You are not authorized to access this resource",
    LOGIN_REQUIRED: "Please log in to continue",
    INVALID_CREDENTIALS: "Invalid email or password",
    SESSION_EXPIRED: "Your session has expired. Please log in again",
    ACCESS_DENIED: "Access denied. Insufficient permissions",
    TOKEN_INVALID: "Invalid or expired token",
    ACCOUNT_LOCKED: "Account has been locked. Please contact support",
    EMAIL_NOT_VERIFIED: "Please verify your email address to continue"
  },

  // User Management
  USER: {
    NOT_FOUND: "User not found",
    EMAIL_EXISTS: "Email address is already registered",
    PHONE_EXISTS: "Phone number is already registered",
    INVALID_EMAIL: "Please enter a valid email address",
    INVALID_PHONE: "Please enter a valid phone number",
    WEAK_PASSWORD: "Password must be at least 8 characters long",
    PASSWORD_MISMATCH: "Passwords do not match",
    PROFILE_UPDATE_FAILED: "Failed to update profile. Please try again",
    ACCOUNT_DISABLED: "Your account has been disabled. Please contact support"
  },

  // OTP & Verification
  OTP: {
    INVALID: "Please provide a valid 6-digit OTP",
    EXPIRED: "OTP has expired. Please request a new one",
    INCORRECT: "Incorrect OTP. Please try again",
    MAX_ATTEMPTS: "Maximum OTP attempts exceeded. Please try again later",
    SEND_FAILED: "Failed to send OTP. Please try again",
    VERIFICATION_FAILED: "OTP verification failed. Please try again"
  },

  // Cart Management
  CART: {
    EMPTY: "Your cart is empty. Please add items before checkout",
    ITEM_NOT_FOUND: "Item not found in cart",
    INVALID_QUANTITY: "Please enter a valid quantity",
    MAX_QUANTITY_EXCEEDED: "Maximum quantity limit exceeded",
    STOCK_INSUFFICIENT: "Insufficient stock available",
    PRODUCT_UNAVAILABLE: "Product is no longer available",
    UPDATE_FAILED: "Failed to update cart. Please try again",
    CLEAR_FAILED: "Failed to clear cart. Please try again",
    ADD_FAILED: "Failed to add item to cart. Please try again",
    REMOVE_FAILED: "Failed to remove item from cart. Please try again"
  },

  // Product Management
  PRODUCT: {
    NOT_FOUND: "Product not found",
    OUT_OF_STOCK: "Product is out of stock",
    UNAVAILABLE: "Product is currently unavailable",
    INVALID_CATEGORY: "Invalid product category",
    PRICE_INVALID: "Invalid product price",
    STOCK_INVALID: "Invalid stock quantity",
    IMAGE_UPLOAD_FAILED: "Failed to upload product image",
    CREATE_FAILED: "Failed to create product. Please try again",
    UPDATE_FAILED: "Failed to update product. Please try again",
    DELETE_FAILED: "Failed to delete product. Please try again"
  },

  // Order Management
  ORDER: {
    NOT_FOUND: "Order not found",
    INVALID_STATUS: "Invalid order status",
    CANNOT_CANCEL: "Order cannot be cancelled at this stage",
    CANNOT_RETURN: "Order cannot be returned at this stage",
    PAYMENT_FAILED: "Payment processing failed. Please try again",
    PAYMENT_PENDING: "Payment is still pending",
    CREATION_FAILED: "Failed to create order. Please try again",
    UPDATE_FAILED: "Failed to update order. Please try again",
    INSUFFICIENT_STOCK: "Some items are out of stock",
    INVALID_ADDRESS: "Please select a valid delivery address",
    INVALID_PAYMENT_METHOD: "Please select a valid payment method"
  },

  // Address Management
  ADDRESS: {
    NOT_FOUND: "Address not found",
    INVALID_PINCODE: "Please enter a valid PIN code",
    INVALID_PHONE: "Please enter a valid phone number",
    REQUIRED_FIELDS: "Please fill in all required fields",
    CREATE_FAILED: "Failed to add address. Please try again",
    UPDATE_FAILED: "Failed to update address. Please try again",
    DELETE_FAILED: "Failed to delete address. Please try again",
    MAX_LIMIT_REACHED: "Maximum address limit reached"
  },

  // Coupon Management
  COUPON: {
    NOT_FOUND: "Coupon not found",
    INVALID_CODE: "Invalid coupon code",
    EXPIRED: "Coupon has expired",
    NOT_ACTIVE: "Coupon is not active",
    MIN_ORDER_NOT_MET: "Minimum order amount not met for this coupon",
    MAX_USAGE_EXCEEDED: "Coupon usage limit exceeded",
    ALREADY_USED: "You have already used this coupon",
    APPLY_FAILED: "Failed to apply coupon. Please try again",
    REMOVE_FAILED: "Failed to remove coupon. Please try again"
  },

  // Wallet Management
  WALLET: {
    INSUFFICIENT_BALANCE: "Insufficient wallet balance",
    INVALID_AMOUNT: "Please enter a valid amount",
    TRANSACTION_FAILED: "Transaction failed. Please try again",
    REFUND_FAILED: "Refund processing failed. Please contact support",
    MINIMUM_AMOUNT: "Minimum transaction amount not met",
    MAXIMUM_AMOUNT: "Maximum transaction amount exceeded"
  },

  // Wishlist Management
  WISHLIST: {
    ITEM_NOT_FOUND: "Item not found in wishlist",
    ALREADY_EXISTS: "Item already exists in wishlist",
    ADD_FAILED: "Failed to add item to wishlist. Please try again",
    REMOVE_FAILED: "Failed to remove item from wishlist. Please try again",
    CLEAR_FAILED: "Failed to clear wishlist. Please try again",
    MAX_LIMIT_REACHED: "Maximum wishlist limit reached"
  },

  // File Upload
  UPLOAD: {
    FILE_TOO_LARGE: "File size is too large. Maximum size allowed is 5MB",
    INVALID_FORMAT: "Invalid file format. Please upload a valid image",
    UPLOAD_FAILED: "File upload failed. Please try again",
    NO_FILE_SELECTED: "Please select a file to upload",
    MULTIPLE_FILES_ERROR: "Error uploading multiple files"
  },

  // Validation Errors
  VALIDATION: {
    REQUIRED_FIELD: "This field is required",
    INVALID_EMAIL: "Please enter a valid email address",
    INVALID_PHONE: "Please enter a valid phone number",
    INVALID_DATE: "Please enter a valid date",
    INVALID_NUMBER: "Please enter a valid number",
    MIN_LENGTH: "Minimum length requirement not met",
    MAX_LENGTH: "Maximum length exceeded",
    INVALID_FORMAT: "Invalid format provided"
  },

  // Payment Errors
  PAYMENT: {
    GATEWAY_ERROR: "Payment gateway error. Please try again",
    TRANSACTION_FAILED: "Transaction failed. Please try again",
    INVALID_PAYMENT_METHOD: "Invalid payment method selected",
    PAYMENT_TIMEOUT: "Payment timeout. Please try again",
    REFUND_FAILED: "Refund processing failed",
    INSUFFICIENT_FUNDS: "Insufficient funds in the selected payment method",
    CARD_DECLINED: "Your card was declined. Please try another payment method",
    NETWORK_ERROR: "Network error during payment. Please try again"
  },

  // Server Errors
  SERVER: {
    INTERNAL_ERROR: "Internal server error. Please try again later",
    SERVICE_UNAVAILABLE: "Service temporarily unavailable. Please try again later",
    DATABASE_ERROR: "Database connection error. Please try again",
    NETWORK_ERROR: "Network error. Please check your connection",
    TIMEOUT_ERROR: "Request timeout. Please try again",
    MAINTENANCE_MODE: "System is under maintenance. Please try again later"
  },

  // Admin Specific
  ADMIN: {
    UNAUTHORIZED: "Admin access required",
    INVALID_ACTION: "Invalid admin action",
    PERMISSION_DENIED: "You don't have permission to perform this action",
    RESOURCE_LOCKED: "Resource is currently locked by another admin",
    BULK_ACTION_FAILED: "Bulk action failed. Some items may not have been processed"
  },

  // General Messages
  GENERAL: {
    SOMETHING_WENT_WRONG: "Something went wrong. Please try again",
    INVALID_REQUEST: "Invalid request. Please check your input",
    RESOURCE_NOT_FOUND: "Requested resource not found",
    OPERATION_FAILED: "Operation failed. Please try again",
    ACCESS_FORBIDDEN: "You don't have access to this resource",
    REQUEST_TIMEOUT: "Request timed out. Please try again",
    INVALID_INPUT: "Invalid input provided",
    OPERATION_NOT_ALLOWED: "This operation is not allowed"
  }
});

// Helper function to get nested error messages
const getErrorMessage = (category, key) => {
  try {
    return ErrorMessages[category]?.[key] || ErrorMessages.GENERAL.SOMETHING_WENT_WRONG;
  } catch (error) {
    return ErrorMessages.GENERAL.SOMETHING_WENT_WRONG;
  }
};

// Helper function to format error messages with dynamic content
const formatErrorMessage = (template, replacements = {}) => {
  let message = template;
  Object.keys(replacements).forEach(key => {
    message = message.replace(`{${key}}`, replacements[key]);
  });
  return message;
};

module.exports = {
  ErrorMessages,
  getErrorMessage,
  formatErrorMessage
};