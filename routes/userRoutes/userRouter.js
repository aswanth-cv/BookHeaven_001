
const express = require('express');

const userRouter = express.Router();

const userController = require("../../controllers/userController/userController");
const { isNotAuthenticated, preventBackButtonCache, isAuthenticated } = require('../../middlewares/authMiddleware');
const signupController = require("../../controllers/userController/signupController");
const signupValidator = require('../../validators/user/signupValidation');
const loginController = require('../../controllers/userController/loginController')
const googleController = require("../../controllers/userController/googleAuthController");
const logoutController = require('../../controllers/userController/logoutController');
const loginValidator = require('../../validators/user/loginValidator');
const passwordController = require("../../controllers/userController/forgotPasswordController");
const shopPageController = require("../../controllers/userController/shope-page-controller");
const productDetailsController = require("../../controllers/userController/product-details-controller");
const profileController = require("../../controllers/userController/profileController");
const addressController = require("../../controllers/userController/addressController");
const orderController = require("../../controllers/userController/orderController");
const cartController = require("../../controllers/userController/cartController");
const wishlistController = require("../../controllers/userController/wishlist-controller");
const checkoutController = require("../../controllers/userController/checkoutController");
const passport = require("passport");




userRouter.get("/", userController.loadHomePage);
userRouter.get("/pageNotFound", userController.pageNotFound);

userRouter.get("/signup", isNotAuthenticated, preventBackButtonCache, signupController.getSignup);
userRouter.post("/signup", isNotAuthenticated, signupValidator.signupValidator, signupController.postSignup);

userRouter.get("/verify-otp", isNotAuthenticated, preventBackButtonCache, signupController.getOtp);
userRouter.post("/verify-otp", isNotAuthenticated, signupController.verifyOtp);

userRouter.get("/login", isNotAuthenticated, preventBackButtonCache, loginController.getLogin);
userRouter.post("/login", isNotAuthenticated, loginValidator.loginValidator, loginController.postLogin);

userRouter.get("/forgotPassword", isNotAuthenticated, preventBackButtonCache, passwordController.getForgotPassword);
userRouter.post("/forgotPassword", isNotAuthenticated, passwordController.postForgotPassword);

userRouter.get("/otpForgotPassword", isNotAuthenticated, preventBackButtonCache, passwordController.getOtpForgotPassword);
userRouter.post("/otpForgotPassword", isNotAuthenticated, passwordController.verifyOtp);

userRouter.post("/resend-otp", isNotAuthenticated, passwordController.resendOtp);
userRouter.post("/resend-signup-otp", isNotAuthenticated, signupController.resendOtp);

userRouter.get("/resetPassword", isNotAuthenticated, preventBackButtonCache, passwordController.getResetPassword);
userRouter.patch("/resetPassword", isNotAuthenticated, passwordController.patchResetPassword);

userRouter.get("/logout", isAuthenticated, logoutController.logout);

userRouter.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
userRouter.get("/auth/google/callback", googleController.googleController);

// Product routes
userRouter.get('/shopPage', shopPageController.shopPage);
userRouter.get('/products/:id', productDetailsController.productDetails);



userRouter.get("/profile",isAuthenticated,profileController.getProfile);
userRouter.patch("/profile",isAuthenticated,profileController.updateProfile);

userRouter.post("/profile/image",isAuthenticated,profileController.uploadProfileImage);
userRouter.post("/request-email-update",isAuthenticated,profileController.requestEmailUpdate);

userRouter.get('/verify-email-otp', isAuthenticated, preventBackButtonCache, (req, res) => {
  const { createOtpMessage } = require('../../helpers/email-mask');
  const email = req.session.newEmail;
  const otpMessage = createOtpMessage(email, 'email-update');

  res.render('profile-otp', {
    maskedEmail: otpMessage.maskedEmail,
    otpMessage: otpMessage.fullMessage
  });
});


userRouter.post("/verify-email-otp",isAuthenticated,profileController.verifyEmailOtp);
userRouter.post("/verify-resend-otp",isAuthenticated,profileController.resendEmailOtp);


userRouter.get("/address",isAuthenticated,addressController.getAddress);
userRouter.post("/address",isAuthenticated,addressController.addresses);
userRouter.put("/address/:id",isAuthenticated,addressController.updateAddress);
userRouter.delete("/address/:id",isAuthenticated,addressController.deleteAddress);
userRouter.patch("/address/:id/default",isAuthenticated,addressController.setDefaultAddress);
userRouter.get("/address/:id",isAuthenticated,addressController.getAddressById);


const cartValidator = require("../../validators/user/cart-validator");
userRouter.get("/cart",isAuthenticated,cartController.getCart);
userRouter.post('/cart/add',
  cartValidator.validateAddToCart,
  cartValidator.validateCartItemOwnership,
  cartController.addToCart
);
userRouter.post('/cart/update',
  isAuthenticated,
  cartValidator.validateUpdateCartQuantity,
  cartValidator.validateCartItemOwnership,
  cartController.updateCartItem
);
userRouter.post('/cart/remove',
  isAuthenticated,
  cartValidator.validateRemoveFromCart,
  cartValidator.validateCartItemOwnership,
  cartController.removeCartItem
);
userRouter.post('/cart/clear',
  isAuthenticated,
  cartValidator.validateCartCheckout,
  cartController.clearCart
);

// Wishlist routes with validation
const wishlistValidator = require('../../validators/user/wishlist-validator');
userRouter.get('/wishlist', isAuthenticated, wishlistController.getWishlist);
userRouter.post('/wishlist/toggle',
  wishlistValidator.validateWishlistToggle,
  wishlistValidator.validateWishlistAuth,
  wishlistController.toggleWishlist
);
userRouter.post('/wishlist/add-all-to-cart',
  isAuthenticated,
  wishlistValidator.validateWishlistAuth,
  wishlistController.addAllToCart
);
userRouter.post('/wishlist/clear',
  isAuthenticated,
  wishlistValidator.validateClearWishlist,
  wishlistController.clearWishlist
);

// Checkout routes
userRouter.get('/checkout', isAuthenticated, checkoutController.getCheckout);
userRouter.post('/checkout/place-order', isAuthenticated, checkoutController.placeOrder);


userRouter.get("/orders",isAuthenticated,orderController.getOrders);



module.exports = userRouter