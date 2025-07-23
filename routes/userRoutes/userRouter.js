
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



module.exports = userRouter