const mongoose = require("mongoose");
const Cart = require("../../models/cartSchema");
const Address = require("../../models/addressSchema");
const Order = require("../../models/orderSchema");
const Product = require("../../models/productSchema");
const Coupon = require("../../models/couponSchema");
const razorpay = require("../../config/razorpay");
const Wallet =require("../../models/walletSchema");
const { HttpStatus } = require("../../helpers/status-code");
const { ErrorMessages } = require("../../helpers/error-messages");
const crypto = require('crypto');
const { getActiveOfferForProduct,
  calculateDiscount,
  calculateProportionalCouponDiscount,
  getItemPriceDetails,
  calculateFinalItemPrice

} = require("../../utils/offer-helper")

const validateCartStock = async (cartItems) => {
  const stockIssues = [];
  
  for (const item of cartItems) {
    const product = await Product.findById(item.product._id);
    
    if (!product) {
      stockIssues.push({
        productId: item.product._id,
        productTitle: item.product.title,
        requestedQuantity: item.quantity,
        availableStock: 0,
        issue: ErrorMessages.PRODUCT.NOT_FOUND
      });
      continue;
    }
    
    if (!product.isListed || product.isDeleted) {
      stockIssues.push({
        productId: item.product._id,
        productTitle: product.title,
        requestedQuantity: item.quantity,
        availableStock: 0,
        issue: ErrorMessages.PRODUCT.UNAVAILABLE
      });
      continue;
    }
    
    if (product.stock < item.quantity) {
      stockIssues.push({
        productId: item.product._id,
        productTitle: product.title,
        requestedQuantity: item.quantity,
        availableStock: product.stock,
        issue: ErrorMessages.CART.STOCK_INSUFFICIENT
      });
    }
  }
  
  return stockIssues;
};

const getInitialPaymentStatus = (paymentMethod) => {
  switch (paymentMethod) {
    case "Wallet":
      return "Paid"; 
    case "COD":
      return "Pending";
    case "Razorpay":
      return "Pending"; 
    default:
      return "Pending";
  }
};


// Generate unique order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString();
  const random = Math.floor(1000 + Math.random() * 9000).toString();
  const orderNumber = `ORD-${timestamp}-${random}`;
  console.log("Generated order number:", orderNumber);
  return orderNumber;
};


const getCheckout = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.redirect("/login");
    }

    const userId = req.session.user_id;
    const cart = await Cart.findOne({ user: userId }).populate("items.product");

    // Check if cart exists and has items
    if (!cart || !cart.items || cart.items.length === 0) {
      req.session.errorMessage = ErrorMessages.CART.EMPTY;
      return res.redirect("/cart");
    }

    const addresses = await Address.find({ userId }).sort({ isDefault: -1, updatedAt: -1 });

    const cartItems = cart.items.filter((item) =>
      item.product &&
      item.product.isListed &&
      !item.product.isDeleted
    );

    if (cartItems.length === 0) {
      req.session.errorMessage = ErrorMessages.CART.PRODUCT_UNAVAILABLE;
      return res.redirect("/cart");
    }

    // **NEW: Validate stock before allowing checkout**
    const stockIssues = await validateCartStock(cartItems);
    
    if (stockIssues.length > 0) {
      // Create detailed error message
      let errorMessage = "Stock has been updated. Please adjust your cart quantities:\n";
      stockIssues.forEach(issue => {
        if (issue.issue === ErrorMessages.CART.STOCK_INSUFFICIENT) {
          errorMessage += `• ${issue.productTitle}: You have ${issue.requestedQuantity} in cart, but only ${issue.availableStock} available\n`;
        } else {
          errorMessage += `• ${issue.productTitle}: ${issue.issue}\n`;
        }
      });
      
      req.session.errorMessage = errorMessage;
      return res.redirect("/cart");
    }

    const validCartItems = cartItems.filter((item) => item.product.stock >= item.quantity);

    if (validCartItems.length !== cartItems.length) {
      cart.items = validCartItems;
      await cart.save();
      req.session.errorMessage = ErrorMessages.CART.UPDATE_FAILED;
      return res.redirect("/cart");
    }

    let subtotal = 0;
    let tax = 0;
    let totalAmount = 0;
    let cartCount = 0;
    let offerDiscount = 0;
    let couponDiscount = 0;
    let appliedCoupon = null;
    let itemDetails = {};

   
    for (const item of validCartItems) {
      const offer = await getActiveOfferForProduct(
        item.product._id,
        item.product.category,
        item.priceAtAddition
      );

      if (offer) {
        const { discountAmount, discountPercentage, finalPrice } = calculateDiscount(offer, item.priceAtAddition);

        item.originalPrice = item.priceAtAddition;
        item.discountedPrice = finalPrice;
        item.offerDiscount = discountAmount * item.quantity;
        item.offerTitle = offer.title;
        item.discountPercentage = discountPercentage;

        offerDiscount += discountAmount * item.quantity;
      } else {
        item.originalPrice = item.priceAtAddition;
        item.discountedPrice = item.priceAtAddition;
        item.offerDiscount = 0;
        item.offerTitle = null;
        item.discountPercentage = 0;
      }
    }

    
    subtotal = validCartItems.reduce((sum, item) => sum + item.quantity * item.discountedPrice, 0);

    
    if (req.session.appliedCoupon) {
      const coupon = await Coupon.findById(req.session.appliedCoupon);

      if (coupon && coupon.isActive && new Date() <= coupon.expiryDate) {
        if (subtotal >= coupon.minOrderAmount) {
          appliedCoupon = coupon;

          const couponResult = calculateProportionalCouponDiscount(coupon, validCartItems);
          couponDiscount = couponResult.totalDiscount;

          validCartItems.forEach(item => {
            const itemCouponInfo = couponResult.itemDiscounts[item.product._id.toString()];

            item.couponDiscount = itemCouponInfo ? itemCouponInfo.amount : 0;
            item.couponProportion = itemCouponInfo ? itemCouponInfo.proportion : 0;

            const itemTotal = item.discountedPrice * item.quantity;
            const itemCouponDiscount = itemCouponInfo ? itemCouponInfo.amount : 0;
            item.finalPrice = itemTotal - itemCouponDiscount;

            item.totalDiscount = item.offerDiscount + itemCouponDiscount;

            const originalTotal = item.originalPrice * item.quantity;
            item.discountPercentage = originalTotal > 0
              ? ((item.totalDiscount / originalTotal) * 100).toFixed(1)
              : "0.0";

            itemDetails[item.product._id.toString()] = {
              originalPrice: item.originalPrice,
              quantity: item.quantity,
              subtotal: originalTotal,
              offerDiscount: item.offerDiscount,
              priceAfterOffer: itemTotal,
              couponDiscount: itemCouponDiscount,
              finalPrice: item.finalPrice,
              couponProportion: itemCouponInfo ? itemCouponInfo.proportion : 0
            };
          });
        } else {
          delete req.session.appliedCoupon;
          appliedCoupon = null;
          req.session.errorMessage = `Minimum order amount of ₹${coupon.minOrderAmount} required for coupon ${coupon.code}`;
        }
      } else {
        delete req.session.appliedCoupon;
        appliedCoupon = null;
        if (coupon) {
          req.session.errorMessage = "The applied coupon has expired or is no longer valid.";
        }
      }
    }

    if (!appliedCoupon) {
      validCartItems.forEach(item => {
        const itemTotal = item.discountedPrice * item.quantity;
        item.finalPrice = itemTotal;
        item.totalDiscount = item.offerDiscount;
        item.discountPercentage = item.discountPercentage || 0;

        itemDetails[item.product._id.toString()] = {
          originalPrice: item.originalPrice,
          quantity: item.quantity,
          subtotal: item.originalPrice * item.quantity,
          offerDiscount: item.offerDiscount,
          priceAfterOffer: itemTotal,
          couponDiscount: 0,
          finalPrice: itemTotal,
          couponProportion: 0
        };
      });
    }

    // Calculate delivery charges
    const FREE_DELIVERY_THRESHOLD = 1000;
    const DELIVERY_CHARGE = 50;
    
    let deliveryCharge = 0;
    if (subtotal < FREE_DELIVERY_THRESHOLD) {
      deliveryCharge = DELIVERY_CHARGE;
    }

    tax = (subtotal - couponDiscount) * 0.08;
    totalAmount = subtotal - couponDiscount + tax + deliveryCharge;
    cartCount = validCartItems.reduce((sum, item) => sum + item.quantity, 0);

    if (addresses.length === 0) {
      req.session.errorMessage = ErrorMessages.ADDRESS.NOT_FOUND;
      req.session.redirectToCheckout = true;
      return res.redirect("/address?returnTo=checkout");
    }

    const availableCoupons = await getAvailableCouponsForUser(userId, subtotal);

    const isCodEligible = totalAmount <= 1000;

    const wallet = await Wallet.findOne({ userId });
    const walletBalance = wallet ? wallet.balance : 0;
    const isWalletEligible = walletBalance >= totalAmount;

    const originalSubtotal = validCartItems.reduce((sum, item) => sum + item.quantity * item.originalPrice, 0);

    res.render("checkout", {
      cartItems: validCartItems,
      subtotal,
      originalSubtotal, 
      tax,
      totalAmount,
      cartCount,
      addresses,
      offerDiscount,
      couponDiscount,
      appliedCoupon,
      availableCoupons: availableCoupons || [], 
      itemDetails,
      user: userId ? { id: userId } : null,
      isAuthenticated: true,
      currentStep: req.query.step ? parseInt(req.query.step) : 1,
      selectedAddressId: req.query.address || "",
      paymentMethod: req.query.paymentMethod || "",
      deliveryCharge,
      freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID,
      isCodEligible, 
      walletBalance, 
      isWalletEligible,  
      errorMessage: req.session.errorMessage,
      successMessage: req.session.successMessage
    });

    delete req.session.errorMessage;
    delete req.session.successMessage;

  } catch (error) {
    console.error("Error in rendering checkout page:", error);
    req.session.errorMessage = ErrorMessages.GENERAL.SOMETHING_WENT_WRONG;
    return res.redirect("/cart");
  }
};


async function getAvailableCouponsForUser(userId, orderAmount) {
  try { 
    const allCoupons = await Coupon.find({
      isActive: true,
      minOrderAmount: { $lte: orderAmount }
    }).lean();


    const availableCoupons = allCoupons
      .filter((coupon) => {
        if (coupon.usageLimitGlobal && coupon.usedCount >= coupon.usageLimitGlobal) {
          return false;
        }

        const userUsage = coupon.usedBy.find((usage) => usage.userId.toString() === userId.toString());
        if (userUsage && userUsage.count >= coupon.usageLimitPerUser) {
          return false;
        }

        return true;
      })
      .map((coupon) => ({
        _id: coupon._id,
        code: coupon.code,
        description: coupon.description,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        maxDiscountValue: coupon.maxDiscountValue,
        minOrderAmount: coupon.minOrderAmount,
        discountDisplay: coupon.discountType === "percentage"
          ? `${coupon.discountValue}% OFF${coupon.maxDiscountValue ? ` (up to ₹${coupon.maxDiscountValue})` : ''}`
          : `₹${coupon.discountValue} OFF`,
        validUntil: new Date(coupon.expiryDate).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
      }));

    return availableCoupons;
  } catch (error) {
    console.error("Error fetching available coupons:", error);
    return [];
  }
}

const validateStock = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ 
        success: false, 
        message: ErrorMessages.AUTH.LOGIN_REQUIRED 
      });
    }

    const userId = req.session.user_id;
    const cart = await Cart.findOne({ user: userId }).populate("items.product");

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.json({ success: true, valid: true, message: "Cart is empty" });
    }

    const cartItems = cart.items.filter((item) =>
      item.product &&
      item.product.isListed &&
      !item.product.isDeleted
    );

    const stockIssues = await validateCartStock(cartItems);
    
    if (stockIssues.length > 0) {
      return res.json({
        success: true,
        valid: false,
        stockIssues: stockIssues,
        message: ErrorMessages.CART.STOCK_INSUFFICIENT
      });
    }

    return res.json({
      success: true,
      valid: true,
      message: "All items have sufficient stock"
    });

  } catch (error) {
    console.error('Error validating stock:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: ErrorMessages.SERVER.INTERNAL_ERROR
    });
  }
};

const addAddress = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ 
        success: false, 
        message: ErrorMessages.AUTH.LOGIN_REQUIRED 
      });
    }

    const { fullName, phone, pincode, district, state, street, landmark, isDefault } = req.body;

    if (!fullName || !phone || !pincode || !district || !state || !street) {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        success: false, 
        message: ErrorMessages.ADDRESS.REQUIRED_FIELDS 
      });
    }

    const newAddress = new Address({
      userId,
      fullName,
      phone,
      pincode,
      district,
      state,
      street,
      landmark,
      isDefault: isDefault || false,
    });

    if (isDefault) {
      await Address.updateMany({ userId }, { $set: { isDefault: false } });
    }

    await newAddress.save();

    res.status(HttpStatus.OK).json({
      success: true,
      message: "Address added successfully",
      address: newAddress,
    });
  } catch (error) {
    console.error("Error adding address:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: ErrorMessages.ADDRESS.CREATE_FAILED 
    });
  }
};



const placeOrder = async (req, res) => {
  const stockUpdates = [];
  try {
    const userId = req.session.user_id;
    if (!userId) {
      throw new Error("Please log in to place an order");
    }

    const { addressId, paymentMethod } = req.body;

    if (!addressId || !paymentMethod) {
      throw new Error("Address and payment method are required");
    }

    if (!["COD", "Wallet", "Razorpay"].includes(paymentMethod)) {
      throw new Error("Only COD, Wallet, and Razorpay payments are supported");
    }

    const address = await Address.findById(addressId);
    if (!address) {
      throw new Error("Selected address not found");
    }

    if (address.userId.toString() !== userId.toString()) {
      throw new Error("Unauthorized access to address");
    }

    if (!address.fullName || address.fullName.trim().length < 3) {
      throw new Error("Invalid address: Full name is required and must be at least 3 characters");
    }

    if (!address.phone || !/^\d{10}$/.test(address.phone.replace(/\D/g, ""))) {
      throw new Error("Invalid address: Valid 10-digit phone number is required");
    }

    if (!address.pincode || !/^\d{6}$/.test(address.pincode)) {
      throw new Error("Invalid address: Valid 6-digit pincode is required");
    }

    if (!address.district || address.district.trim().length < 3) {
      throw new Error("Invalid address: District is required");
    }

    if (!address.state || address.state.trim().length < 3) {
      throw new Error("Invalid address: State is required");
    }

    if (!address.street || address.street.trim().length < 10) {
      throw new Error("Invalid address: Complete street address is required (minimum 10 characters)");
    }

    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart || !cart.items.length) {
      throw new Error("Cart is empty");
    }

    const cartItems = cart.items.filter((item) => item.product && item.product.isListed && !item.product.isDeleted);

    if (!cartItems.length) {
      throw new Error("No valid items in cart");
    }

    let subtotal = 0;
    let offerDiscount = 0;
    let couponDiscount = 0;
    let appliedCoupon = null;

    const orderItems = [];
    const itemDetails = {};

    for (const item of cartItems) {
      const offer = await getActiveOfferForProduct(item.product._id, item.product.category, item.priceAtAddition);
      let itemPrice = item.priceAtAddition;
      let itemDiscount = 0;
      let offerTitle = null;

      if (offer) {
        const { discountAmount, finalPrice } = calculateDiscount(offer, item.priceAtAddition);
        itemPrice = finalPrice;
        itemDiscount = discountAmount * item.quantity;
        offerTitle = offer.title;
        offerDiscount += itemDiscount;
      }

      const orderItem = {
        product: item.product._id,
        title: item.product.title,
        image: item.product.mainImage,
        price: item.priceAtAddition,
        discountedPrice: itemPrice,
        quantity: item.quantity,
        offerDiscount: itemDiscount,
        offerTitle: offerTitle,
        priceBreakdown: {
          originalPrice: item.priceAtAddition,
          subtotal: item.priceAtAddition * item.quantity,
          offerDiscount: itemDiscount,
          offerTitle: offerTitle,
          priceAfterOffer: itemPrice * item.quantity,
          couponDiscount: 0,
          couponProportion: 0, 
          finalPrice: itemPrice * item.quantity 
        }
      };

      orderItems.push(orderItem);
      subtotal += itemPrice * item.quantity;
    }

    if (req.session.appliedCoupon) {
      const coupon = await Coupon.findById(req.session.appliedCoupon);

      if (!coupon) {
        throw new Error("Applied coupon not found");
      }

      if (!coupon.isActive) {
        throw new Error("Applied coupon is inactive");
      }

      const now = new Date();
      if (now < coupon.startDate || now > coupon.expiryDate) {
        throw new Error("Applied coupon has expired or is not yet active");
      }

      if (subtotal < coupon.minOrderAmount) {
        throw new Error(`Minimum order amount of ₹${coupon.minOrderAmount} required for coupon ${coupon.code}`);
      }

      if (coupon.usageLimitGlobal && coupon.usedCount >= coupon.usageLimitGlobal) {
        throw new Error("Coupon has reached its global usage limit");
      }

      const userUsage = coupon.usedBy.find((usage) => usage.userId.toString() === userId.toString());
      if (userUsage && userUsage.count >= coupon.usageLimitPerUser) {
        throw new Error("You have already used this coupon the maximum number of times");
      }

      appliedCoupon = coupon;

      const couponResult = calculateProportionalCouponDiscount(coupon, orderItems);
      couponDiscount = couponResult.totalDiscount;

      orderItems.forEach(item => {
        const itemCouponInfo = couponResult.itemDiscounts[item.product.toString()];
        if (itemCouponInfo) {
          item.couponDiscount = itemCouponInfo.amount;
          item.couponProportion = itemCouponInfo.proportion;

          item.priceBreakdown.couponDiscount = itemCouponInfo.amount;
          item.priceBreakdown.couponProportion = itemCouponInfo.proportion;
          item.priceBreakdown.finalPrice = item.priceBreakdown.priceAfterOffer - itemCouponInfo.amount;

          const finalPriceDetails = calculateFinalItemPrice(item, { couponDiscount });
          item.finalPrice = finalPriceDetails.finalPrice / item.quantity;
        }
      });

      coupon.usedCount += 1;
      const userUsageIndex = coupon.usedBy.findIndex((usage) => usage.userId.toString() === userId.toString());
      if (userUsageIndex >= 0) {
        coupon.usedBy[userUsageIndex].count += 1;
        coupon.usedBy[userUsageIndex].usedAt = new Date();
      } else {
        coupon.usedBy.push({
          userId,
          usedAt: new Date(),
          count: 1,
        });
      }
      await coupon.save();

      delete req.session.appliedCoupon;
    }

    // Calculate tax with proper rounding
    // Note: subtotal is already discounted (after offers), so only subtract coupons
    const tax = Math.round((subtotal - couponDiscount) * 0.08 * 100) / 100;
    
    // Calculate delivery charges (based on subtotal after offer discounts)
    const FREE_DELIVERY_THRESHOLD = 1000;
    const DELIVERY_CHARGE = 50;
    
    let deliveryCharge = 0;
    const subtotalAfterOffers = subtotal - offerDiscount;
    if (subtotalAfterOffers < FREE_DELIVERY_THRESHOLD) {
      deliveryCharge = DELIVERY_CHARGE;
    }
    
    // Calculate total with proper rounding
    // Note: subtotal already has offers applied, so: subtotal - coupons + tax + delivery
    const total = Math.round((subtotal - couponDiscount + tax + deliveryCharge) * 100) / 100;


    if (paymentMethod === "COD" && total > 1000) {
      throw new Error("Cash on Delivery is not available for orders above ₹1,000. Please choose an online payment method.");
    }

    let wallet = null;
    let order = null;
    
    if (paymentMethod === "Wallet") {
      
      wallet = await Wallet.findOne({ userId });
      if (!wallet) {
        wallet = new Wallet({ userId, balance: 0, transactions: [] });
        await wallet.save();
      }
      
      

      if (wallet.balance < total) {
        throw new Error(`Insufficient wallet balance. You need ₹${(total - wallet.balance).toFixed(2)} more to complete this order.`);
      }
    }

    try {
      for (const item of orderItems) {
        const product = await Product.findById(item.product);
        if (!product) {
          throw new Error(`Product ${item.title} not found`);
        }

        if (!product.isListed || product.isDeleted) {
          throw new Error(`Product ${item.title} is no longer available`);
        }

        const newStock = product.stock - item.quantity;
        if (newStock < 0) {
          throw new Error(`Insufficient stock for ${item.title}. Only ${product.stock} items available.`);
        }

        // Update stock
        const updateResult = await Product.findByIdAndUpdate(
          item.product,
          { stock: newStock, updatedAt: new Date() },
          { new: true }
        );

        if (!updateResult) {
          throw new Error(`Failed to update stock for ${item.title}`);
        }

        stockUpdates.push({
          productId: item.product,
          originalStock: product.stock,
          newStock: newStock,
          productTitle: item.title
        });
      }
    } catch (error) {
      throw error;
    }

    // Create order
    order = new Order({
      user: userId,
      orderNumber: generateOrderNumber(),
      items: orderItems,
      shippingAddress: {
        userId: address.userId,
        fullName: address.fullName,
        phone: address.phone,
        pincode: address.pincode,
        district: address.district,
        state: address.state,
        street: address.street,
        landmark: address.landmark,
        isDefault: address.isDefault,
      },
      paymentMethod: paymentMethod,
      paymentStatus: getInitialPaymentStatus(paymentMethod),
      orderStatus: "Placed",
      subtotal,
      shipping: deliveryCharge,
      tax,
      discount: offerDiscount,
      couponCode: appliedCoupon ? appliedCoupon.code : null,
      couponDiscount,
      total,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await order.save();

    if (paymentMethod === "Wallet" && wallet) {
      try {
        
        wallet.balance = Number(wallet.balance) - Number(total);

        wallet.transactions.push({
          type: 'debit',
          amount: Number(total),
          orderId: order._id,
          reason: `Payment for order #${order.orderNumber}`,
          date: new Date()
        });


        await wallet.save();
      } catch (walletError) {
        console.error('Error processing wallet payment:', walletError);
        await Order.findByIdAndDelete(order._id);

        // Restore stock
        for (const update of stockUpdates) {
          await Product.findByIdAndUpdate(update.productId, { stock: update.originalStock }, { new: true });
        }

        throw new Error("Failed to process wallet payment. Please try again.");
      }
    }

    // Clear cart
    await Cart.findOneAndUpdate({ user: userId }, { items: [] });

    res.status(HttpStatus.CREATED).json({
      success: true,
      message: paymentMethod === "Wallet" ? "Order placed and paid successfully from wallet" : "Order placed successfully",
      orderId: order._id,
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    console.error("Error placing order:", error);

    try {
      if (stockUpdates && stockUpdates.length > 0) {
        for (const update of stockUpdates) {
          await Product.findByIdAndUpdate(
            update.productId,
            { stock: update.originalStock },
            { new: true }
          );
        }
      }

      if (error.walletDeducted && wallet) {
        wallet.balance = Number(wallet.balance) + Number(total);

        wallet.transactions = wallet.transactions.filter(
          transaction => !transaction.orderId || transaction.orderId.toString() !== error.orderId
        );

        await wallet.save();
      }

      if (error.couponUpdated && appliedCoupon) {
        appliedCoupon.usedCount = Math.max(0, appliedCoupon.usedCount - 1);

        const userUsageIndex = appliedCoupon.usedBy.findIndex(
          (usage) => usage.userId.toString() === userId.toString()
        );

        if (userUsageIndex >= 0) {
          appliedCoupon.usedBy[userUsageIndex].count = Math.max(0, appliedCoupon.usedBy[userUsageIndex].count - 1);
          if (appliedCoupon.usedBy[userUsageIndex].count === 0) {
            appliedCoupon.usedBy.splice(userUsageIndex, 1);
          }
        }

        await appliedCoupon.save();
      }

    } catch (rollbackError) {
      console.error('Error during rollback:', rollbackError);
    }

    let statusCode = 500;
    let errorMessage = "Failed to place order. Please try again.";

    if (error.message.includes("Insufficient stock") ||
        error.message.includes("Stock for") ||
        error.message.includes("not found") ||
        error.message.includes("no longer available")) {
      statusCode = 400;
      errorMessage = error.message;
    } else if (error.message.includes("address") ||
               error.message.includes("payment method") ||
               error.message.includes("coupon") ||
               error.message.includes("wallet")) {
      statusCode = 400;
      errorMessage = error.message;
    } else if (error.message.includes("unauthorized") ||
               error.message.includes("Unauthorized")) {
      statusCode = 401;
      errorMessage = "Unauthorized access";
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};






const createRazorpayOrder = async (req, res) => {
  try {
    
    const userId = req.session.user_id;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: "Please log in to place an order" });
    }

    const { addressId } = req.body;

    
    if (!addressId) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Address is required" });
    }

    
    const address = await Address.findById(addressId);
    if (!address || address.userId.toString() !== userId.toString()) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Invalid or unauthorized address" });
    }

    
    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart || !cart.items.length) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Cart is empty" });
    }

    
    const cartItems = cart.items.filter((item) => item.product && item.product.isListed && !item.product.isDeleted);

    if (!cartItems.length) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "No valid items in cart" });
    }


    const orderNumber = generateOrderNumber();

    const orderItems = [];
    let originalSubtotal = 0;
    let subtotalAfterOffers = 0;
    let totalOfferDiscount = 0;

    for (const item of cartItems) {
      const originalItemTotal = item.priceAtAddition * item.quantity;
      originalSubtotal += originalItemTotal;

      const offer = await getActiveOfferForProduct(
        item.product._id,
        item.product.category,
        item.priceAtAddition
      );

      if (offer) {
        const { discountAmount, finalPrice } = calculateDiscount(offer, item.priceAtAddition);
        const itemDiscount = discountAmount * item.quantity;
        const itemTotalAfterOffer = finalPrice * item.quantity;

        totalOfferDiscount += itemDiscount;
        subtotalAfterOffers += itemTotalAfterOffer;

        const orderItem = {
          product: item.product._id,
          title: item.product.title,
          image: item.product.mainImage,
          price: item.priceAtAddition,
          discountedPrice: finalPrice,
          quantity: item.quantity,
          offerDiscount: itemDiscount,
          offerTitle: offer.title,
          priceBreakdown: {
            originalPrice: item.priceAtAddition,
            subtotal: originalItemTotal,
            offerDiscount: itemDiscount,
            offerTitle: offer.title,
            priceAfterOffer: itemTotalAfterOffer,
            couponDiscount: 0,
            couponProportion: 0, 
            finalPrice: itemTotalAfterOffer 
          }
        };

        orderItems.push(orderItem);
      } else {
        subtotalAfterOffers += originalItemTotal;
        const orderItem = {
          product: item.product._id,
          title: item.product.title,
          image: item.product.mainImage,
          price: item.priceAtAddition,
          discountedPrice: item.priceAtAddition,
          quantity: item.quantity,
          offerDiscount: 0,
          offerTitle: null,
          priceBreakdown: {
            originalPrice: item.priceAtAddition,
            subtotal: originalItemTotal,
            offerDiscount: 0,
            offerTitle: null,
            priceAfterOffer: originalItemTotal,
            couponDiscount: 0,
            couponProportion: 0,
            finalPrice: originalItemTotal
          }
        };

        orderItems.push(orderItem);
      }
    }

    const checkoutSubtotal = originalSubtotal;
    const checkoutOfferDiscount = totalOfferDiscount;

    let couponDiscount = 0;
    let appliedCouponCode = null;
    if (req.session.appliedCoupon) {
      const coupon = await Coupon.findById(req.session.appliedCoupon);
      if (coupon && coupon.isActive && new Date() <= coupon.expiryDate) {
        const amountAfterOffers = subtotalAfterOffers;
        if (amountAfterOffers >= coupon.minOrderAmount) {
          const couponResult = calculateProportionalCouponDiscount(coupon, orderItems);
          couponDiscount = couponResult.totalDiscount;
          appliedCouponCode = coupon.code;

          orderItems.forEach(item => {
            const itemCouponInfo = couponResult.itemDiscounts[item.product.toString()];
            if (itemCouponInfo) {
              item.couponDiscount = itemCouponInfo.amount;
              item.couponProportion = itemCouponInfo.proportion;

              item.priceBreakdown.couponDiscount = itemCouponInfo.amount;
              item.priceBreakdown.couponProportion = itemCouponInfo.proportion;
              item.priceBreakdown.finalPrice = item.priceBreakdown.priceAfterOffer - itemCouponInfo.amount;

              const finalPriceDetails = calculateFinalItemPrice(item, { couponDiscount });
              item.finalPrice = finalPriceDetails.finalPrice / item.quantity;
            }
          });
        }
      }
    }

    const amountAfterAllDiscounts = subtotalAfterOffers - couponDiscount;
    
    // Calculate delivery charges
    const FREE_DELIVERY_THRESHOLD = 1000;
    const DELIVERY_CHARGE = 50;
    
    let deliveryCharge = 0;
    if (checkoutSubtotal < FREE_DELIVERY_THRESHOLD) {
      deliveryCharge = DELIVERY_CHARGE;
    }
    
    const checkoutTax = Math.round(amountAfterAllDiscounts * 0.08 * 100) / 100;
    const checkoutTotal = Math.round((amountAfterAllDiscounts + checkoutTax + deliveryCharge) * 100) / 100;


    const itemFinalPriceSum = orderItems.reduce((sum, item) => sum + (item.priceBreakdown?.finalPrice || 0), 0);
    const expectedTotal = itemFinalPriceSum + checkoutTax + deliveryCharge;

    let finalCheckoutTotal = checkoutTotal;
    if (Math.abs(expectedTotal - checkoutTotal) > 0.01) {
      console.error('Order total inconsistency detected:', {
        itemFinalPriceSum: itemFinalPriceSum.toFixed(2),
        calculatedTax: checkoutTax.toFixed(2),
        expectedTotal: expectedTotal.toFixed(2),
        actualTotal: checkoutTotal.toFixed(2),
        difference: (checkoutTotal - expectedTotal).toFixed(2)
      });

      finalCheckoutTotal = expectedTotal;
    }

    const displayBreakdown = [
      `Subtotal: ₹${checkoutSubtotal.toFixed(2)}`,
      `Offer Discount: -₹${checkoutOfferDiscount.toFixed(2)}`,
      appliedCouponCode ? `Coupon (${appliedCouponCode}): -₹${couponDiscount.toFixed(2)}` : null,
      deliveryCharge > 0 ? `Delivery Charge: ₹${deliveryCharge.toFixed(2)}` : `Free Delivery`,
      `Tax (8%): ₹${checkoutTax.toFixed(2)}`,
      `Final Amount: ₹${finalCheckoutTotal.toFixed(2)}`
    ].filter(Boolean).join('\n');

    req.session.pendingOrder = {
      orderNumber: orderNumber,
      addressId,
      orderItems,
      subtotal: checkoutSubtotal,
      tax: checkoutTax,
      shipping: deliveryCharge,
      offerDiscount: checkoutOfferDiscount,
      couponDiscount,
      couponCode: appliedCouponCode,
      total: finalCheckoutTotal,
      paymentMethod: "Razorpay"
    };

    const amountInPaise = Math.round(finalCheckoutTotal * 100);

    if (amountInPaise <= 0) {
      console.error("Invalid amount calculated:", amountInPaise);
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Invalid order amount calculated" });
    }

    if (amountInPaise < 100) {
      console.error("Amount too small for Razorpay:", amountInPaise);
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Order amount must be at least ₹1" });
    }

   


    const razorpayOrderData = {
      amount: amountInPaise,
      currency: "INR",
      receipt: orderNumber,
      notes: {
        subtotal: checkoutSubtotal.toFixed(2),
        offerDiscount: checkoutOfferDiscount.toFixed(2),
        deliveryCharge: deliveryCharge.toFixed(2),
        tax: checkoutTax.toFixed(2),
        total: finalCheckoutTotal.toFixed(2)
      }
    };

   

    if (!razorpay) {
      throw new Error("Razorpay instance not available");
    }

    const razorpayOrder = await razorpay.orders.create(razorpayOrderData);
    

    res.status(HttpStatus.OK).json({
      success: true,
      order: razorpayOrder,
      key: process.env.RAZORPAY_KEY_ID,
      amount: amountInPaise, 
      currency: "INR",
      name: "BookHaven",
      description: `Order Total: ₹${finalCheckoutTotal.toFixed(2)}`,
      prefill: {
        name: address.fullName,
        contact: address.phone,
      },
      theme: {
        color: '#198754'
      },
      notes: {
        orderNumber: orderNumber,
        breakdown: displayBreakdown
      }
    });
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    console.error("Error stack:", error.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: "Failed to create payment order", error: error.message });
  }
};


const verifyPayment = async (req, res) => {
  let stockUpdates =[];
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (!isAuthentic) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Invalid payment signature" });
    }

    const pendingOrder = req.session.pendingOrder;
    if (!pendingOrder) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "No pending order found" });
    }

    const userId = req.session.user_id;

    for (const item of pendingOrder.orderItems) {
      const product = await Product.findById(item.product);
      if (!product) {
        throw new Error(`Product ${item.title} not found`);
      }

      const newStock = product.stock - item.quantity;
      if (newStock < 0) {
        throw new Error(`Insufficient stock for ${item.title}. Only ${product.stock} items available.`);
      }

      stockUpdates.push({ productId: item.product, originalStock: product.stock, newStock });
    }

    for (const update of stockUpdates) {
      await Product.findByIdAndUpdate(update.productId, { stock: update.newStock }, { new: true });
    }

    const address = await Address.findById(pendingOrder.addressId);

    const orderItems = pendingOrder.orderItems.map(item => ({
      ...item,
      priceBreakdown: {
        originalPrice: item.price,
        subtotal: item.price * item.quantity,
        offerDiscount: item.offerDiscount || 0,
        offerTitle: item.offerTitle,
        priceAfterOffer: item.discountedPrice * item.quantity,
        couponDiscount: item.couponDiscount || 0,
        couponProportion: item.couponProportion || 0,
        finalPrice: (item.discountedPrice * item.quantity) - (item.couponDiscount || 0)
      },
      status: "Active"
    }));

    // Create order
    const order = new Order({
      user: userId,
      orderNumber: pendingOrder.orderNumber,
      items: orderItems,
      shippingAddress: {
        userId: address.userId,
        fullName: address.fullName,
        phone: address.phone,
        pincode: address.pincode,
        district: address.district,
        state: address.state,
        street: address.street,
        landmark: address.landmark,
        isDefault: address.isDefault,
      },
      paymentMethod: "Razorpay",
      paymentStatus: "Paid",
      orderStatus: "Placed",
      subtotal: pendingOrder.subtotal,
      shipping: pendingOrder.shipping || 0,
      tax: pendingOrder.tax,
      discount: pendingOrder.offerDiscount,
      couponCode: pendingOrder.couponCode,
      couponDiscount: pendingOrder.couponDiscount,
      total: pendingOrder.total,
      createdAt: new Date(),
      updatedAt: new Date(),
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id
    });

    await order.save();

    if (pendingOrder.couponCode) {
      const coupon = await Coupon.findOne({ code: pendingOrder.couponCode });
      if (coupon) {
        coupon.usedCount += 1;

        const userUsageIndex = coupon.usedBy.findIndex((usage) => usage.userId.toString() === userId.toString());

        if (userUsageIndex >= 0) {
          coupon.usedBy[userUsageIndex].count += 1;
          coupon.usedBy[userUsageIndex].usedAt = new Date();
        } else {
          coupon.usedBy.push({
            userId,
            usedAt: new Date(),
            count: 1,
          });
        }

        await coupon.save();
      }
    }

    // Clear cart
    await Cart.findOneAndUpdate({ user: userId }, { items: [] });

    delete req.session.pendingOrder;
    delete req.session.appliedCoupon;

    res.status(HttpStatus.OK).json({
      success: true,
      message: "Payment successful",
      orderId: order._id,
      orderNumber: order.orderNumber
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};



const handlePaymentFailure = async (req, res) => {
  try {
    const { orderId, error } = req.body;
    
    
    res.status(HttpStatus.OK).json({
      success: true,
      message: "Payment failure handled"
    });
  } catch (error) {
    console.error("Error handling payment failure:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to handle payment failure"
    });
  }
};

const getPaymentFailure = (req, res) => {
  try {
    const error = req.query.error || "Payment failed";
    const orderId = req.query.orderId || null;

    res.render("user/payment-failure", {
      error,
      orderId,
      isAuthenticated: !!req.session.user_id,
      user: req.session.user || null
    });
  } catch (err) {
    console.error("Error loading payment failure page:", err);
    res.redirect("/checkout");
  }
};


const applyCoupon = async (req,res)=>{
  try {
   
    const { couponCode } = req.body;
    const userId = req.session.user_id;

    if(!userId){
      return res.status(HttpStatus.BAD_REQUEST).json({success:false , message:"Please log in to apply a coupon"})
    }
  
    const coupon = await Coupon.findOne({code:couponCode.toUpperCase()});

    if(!coupon){
      return res.status(HttpStatus.NOT_FOUND).json({success : false,message:"Invalid coupon code"})
    }

    if(!coupon.isActive){
      return res.status(HttpStatus.NOT_FOUND).json({success:false,message:"This coupon is Inactive"});
    }

    const now = new Date();
    if (now < coupon.startDate || now > coupon.expiryDate) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "This coupon has expired or is not yet active" });
    }

    const cart = await Cart.findOne({user:userId}).populate("items.product");

    if(!cart || !cart.items.length){
      return res.status(HttpStatus.NOT_FOUND).json({success : false , message : "Your cart is empty"});
    }

    const cartItems = cart.items.filter((item)=> item.product && item.product.isListed && !item.product.isDeleted)


    for (const item of cartItems) {
      const offer = await getActiveOfferForProduct(item.product._id, item.product.category);

      if (offer) {
        const { finalPrice } = calculateDiscount(offer, item.priceAtAddition);
        item.discountedPrice = finalPrice;
      } else {
        item.discountedPrice = item.priceAtAddition;
      }
    }

    const subtotal = cartItems.reduce((sum, item) => sum + item.quantity * item.discountedPrice, 0);

    if (subtotal < coupon.minOrderAmount) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon`,
      });
    }

    if (coupon.usageLimitGlobal && coupon.usedCount >= coupon.usageLimitGlobal) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "This coupon has reached its usage limit" });
    }

    const userUsage = coupon.usedBy.find((usage) => usage.userId.toString() === userId.toString());
    if (userUsage && userUsage.count >= coupon.usageLimitPerUser) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "You have already used this coupon the maximum number of times"
      });
    }


    const couponResult = calculateProportionalCouponDiscount(coupon, cartItems);
    const discount = couponResult.totalDiscount;

    req.session.appliedCoupon = coupon._id;

    const itemDetails = {};
    cartItems.forEach(item => {
      const itemCouponInfo = couponResult.itemDiscounts[item.product._id.toString()];
      const details = getItemPriceDetails(item, itemCouponInfo);
      itemDetails[item.product._id.toString()] = details;
    });

    // Calculate delivery charges
    const FREE_DELIVERY_THRESHOLD = 1000;
    const DELIVERY_CHARGE = 50;
    
    let deliveryCharge = 0;
    const originalSubtotal = cartItems.reduce((sum, item) => sum + item.quantity * item.priceAtAddition, 0);
    if (originalSubtotal < FREE_DELIVERY_THRESHOLD) {
      deliveryCharge = DELIVERY_CHARGE;
    }

    const tax = (subtotal - discount) * 0.08;
    const total = subtotal - discount + tax + deliveryCharge;

    res.status(HttpStatus.OK).json({
      success: true,
      message: "Coupon applied successfully",
      discount,
      itemDetails,
      deliveryCharge,
      freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD,
      tax,
      total,
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
      },
    });


  } catch (error) {
    
    console.error("Error applying coupon:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });

  }
}


const removeCoupon = async (req, res) => {
  try {
    delete req.session.appliedCoupon;

    res.status(HttpStatus.OK).json({
      success: true,
      message: "Coupon removed successfully",
    });
  } catch (error) {
    console.error("Error removing coupon:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};


const getCurrentCartTotal = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: "Please log in" });
    }

    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart || !cart.items.length) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "Cart is empty" });
    }

    const cartItems = cart.items.filter((item) => item.product && item.product.isListed && !item.product.isDeleted);

    if (!cartItems.length) {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: "No valid items in cart" });
    }

    let subtotal = 0;
    let offerDiscount = 0;

    for (const item of cartItems) {
      const originalItemTotal = item.priceAtAddition * item.quantity;
      subtotal += originalItemTotal;

      const offer = await getActiveOfferForProduct(item.product._id, item.product.category, item.priceAtAddition);
      if (offer) {
        const { discountAmount, finalPrice } = calculateDiscount(offer, item.priceAtAddition);
        offerDiscount += discountAmount * item.quantity;
        item.discountedPrice = finalPrice; 
      } else {
        item.discountedPrice = item.priceAtAddition; 
      }
    }

    let couponDiscount = 0;
    if (req.session.appliedCoupon) {
      const coupon = await Coupon.findById(req.session.appliedCoupon);
      if (coupon && coupon.isActive && new Date() <= coupon.expiryDate) {
        const amountAfterOffers = subtotal - offerDiscount;
        if (amountAfterOffers >= coupon.minOrderAmount) {
          const couponResult = calculateProportionalCouponDiscount(coupon, cartItems);
          couponDiscount = couponResult.totalDiscount;
        }
      }
    }

    // Calculate delivery charges
    const FREE_DELIVERY_THRESHOLD = 1000;
    const DELIVERY_CHARGE = 50;
    
    let deliveryCharge = 0;
    if (subtotal < FREE_DELIVERY_THRESHOLD) {
      deliveryCharge = DELIVERY_CHARGE;
    }

    const tax = (subtotal - offerDiscount - couponDiscount) * 0.08;
    const total = subtotal - offerDiscount - couponDiscount + tax + deliveryCharge;

    const wallet = await Wallet.findOne({ userId });
    const walletBalance = wallet ? wallet.balance : 0;

    res.status(HttpStatus.OK).json({
      success: true,
      data: {
        subtotal,
        offerDiscount,
        couponDiscount,
        deliveryCharge,
        freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD,
        tax,
        total,
        walletBalance,
        isWalletEligible: walletBalance >= total
      }
    });

  } catch (error) {
    console.error("Error getting current cart total:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};



module.exports = {
  getCheckout,
  addAddress,
  handlePaymentFailure,
  getPaymentFailure,
  createRazorpayOrder,
  verifyPayment,
  placeOrder,
  applyCoupon,
  removeCoupon,
  getCurrentCartTotal,
  validateStock
};