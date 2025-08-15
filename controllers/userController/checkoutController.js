const mongoose = require("mongoose");
const Cart = require("../../models/cartSchema");
const Address = require("../../models/addressSchema");
const Order = require("../../models/orderSchema");
const Product = require("../../models/productSchema");



const getCheckout = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.redirect("/login");
    }

    const userId = req.session.user_id;
    const cart = await Cart.findOne({ user: userId }).populate("items.product");

    if (!cart || !cart.items || cart.items.length === 0) {
      req.session.errorMessage = "Your cart is empty. Please add items before checkout.";
      return res.redirect("/cart");
    }

    const addresses = await Address.find({ userId }).sort({ isDefault: -1, updatedAt: -1 });

    const cartItems = cart.items.filter(
      (item) =>
        item.product &&
        item.product.isListed &&
        !item.product.isDeleted &&
        item.product.stock >= item.quantity
    );

    if (cartItems.length === 0) {
      req.session.errorMessage =
        "No valid items in cart. Some items may be unavailable or out of stock.";
      return res.redirect("/cart");
    }

    if (cartItems.length !== cart.items.length) {
      cart.items = cartItems;
      await cart.save();
      req.session.errorMessage =
        "Some items were removed from your cart as they are no longer available.";
      return res.redirect("/cart");
    }

    let subtotal = cartItems.reduce(
      (sum, item) => sum + item.quantity * item.priceAtAddition,
      0
    );

    let tax = subtotal * 0.08; 
    let totalAmount = subtotal + tax;
    let cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    cartItems.forEach((item) => {
      item.originalPrice = item.priceAtAddition;
      item.finalPrice = item.priceAtAddition * item.quantity;
      item.totalDiscount = 0;
      item.discountPercentage = 0;
    });

    if (addresses.length === 0) {
      req.session.errorMessage =
        "Please add a delivery address before proceeding to checkout.";
      return res.redirect("/address");
    }

    res.render("checkout", {
      cartItems,
      subtotal,
      originalSubtotal: subtotal,
      tax,
      totalAmount,
      cartCount,
      addresses,
      offerDiscount: 0,
      couponDiscount: 0,
      appliedCoupon: null,
      availableCoupons: [],
      itemDetails: {},
      user: { id: userId },
      isAuthenticated: true,
      currentStep: req.query.step ? parseInt(req.query.step) : 1,
      selectedAddressId: req.query.address || "",
      paymentMethod: req.query.paymentMethod || "",
      shippingCost: 0,
      isCodEligible: totalAmount <= 1000,
      errorMessage: req.session.errorMessage,
      successMessage: req.session.successMessage,
      isWalletEligible: false,
      walletBalance: 0
    });

    delete req.session.errorMessage;
    delete req.session.successMessage;
  } catch (error) {
    console.error("Error in rendering checkout page:", error);
    req.session.errorMessage = "Something went wrong. Please try again.";
    return res.redirect("/cart");
  }
};

const addAddress = async (req, res) => {
  try {
    const userId = req.session.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Please log in to add an address" });
    }

    const { fullName, phone, pincode, district, state, street, landmark, isDefault } = req.body;

    if (!fullName || !phone || !pincode || !district || !state || !street) {
      return res.status(401).json({ success: false, message: "All required fields must be filled" });
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

    res.status(200).json({
      success: true,
      message: "Address added successfully",
      address: newAddress,
    });
  } catch (error) {
    console.error("Error adding address:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};


const placeOrder = async (req, res) => {
  try {
    const userId = req.session.user_id; 
    const { addressId, paymentMethod } = req.body;

    if (!paymentMethod) {
      return res.status(400).json({ success: false, message: "Payment method required" });
    }

    const addressDoc = await Address.findOne({ _id: addressId, userId });
    if (!addressDoc) {
      return res.status(404).json({ success: false, message: "Address not found" });
    }

    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: "Your cart is empty" });
    }

    let subtotal = 0;
    const orderItems = cart.items.map((item) => {
      const product = item.product;
      if (!product) {
        throw new Error(`Product not found for cart item ${item._id}`);
      }

      const price = product.price ?? item.priceAtAddition ?? 0;
      const discountedPrice = product.discountedPrice ?? price;
      const quantity = item.quantity;

      subtotal += discountedPrice * quantity;

      return {
        product: product._id,
        title: product.title || "Untitled Product",
        image: product.image || "/images/default-product.png",
        price,
        discountedPrice,
        quantity,
        priceBreakdown: {
          originalPrice: price,
          subtotal: price * quantity,
          offerDiscount: price - discountedPrice,
          offerTitle: product.offerTitle || null,
          priceAfterOffer: discountedPrice,
          couponDiscount: 0,
          couponProportion: 0,
          finalPrice: discountedPrice * quantity
        },
        status: "Active"
      };
    });

    const orderNumber = "ORD-" + Date.now();

    const newOrder = new Order({
      user: userId,
      orderNumber,
      items: orderItems,
      shippingAddress: addressDoc.toObject(), 
      paymentMethod,
      paymentStatus: paymentMethod === "COD" ? "Pending" : "Pending",
      orderStatus: paymentMethod === "COD" ? "Placed" : "Pending",
      subtotal,
      shipping: 0,
      tax: 0,
      total: subtotal
    });

    await newOrder.save();

    cart.items = [];
    cart.totalAmount = 0;
    await cart.save();

    return res.status(201).json({
      success: true,
      message: "Order placed successfully",
      orderId: newOrder._id
    });

  } catch (error) {
    console.error("Error placing order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to place order",
      error: error.message
    });
  }
};




module.exports = {
  getCheckout,
  placeOrder,
  addAddress,
};