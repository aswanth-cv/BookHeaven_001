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

    if (!userId) {
      return res.status(401).json({ success: false, message: "User not logged in" });
    }

    if (!addressId) {
      return res.status(400).json({ success: false, message: "Please select an address" });
    }

    const cart = await Cart.findOne({ userId }).populate("items.productId");
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: "Your cart is empty" });
    }

    let totalPrice = 0;
    cart.items.forEach(item => {
      totalPrice += item.productId.price * item.quantity;
    });

    const orderItems = cart.items.map(item => ({
      productId: item.productId._id,
      quantity: item.quantity,
      price: item.productId.price
    }));

    const newOrder = new Order({
      userId,
      addressId,
      paymentMethod,
      items: orderItems,
      totalAmount: totalPrice,
      status: paymentMethod === "COD" ? "Placed" : "Pending",
      createdAt: new Date()
    });

    await newOrder.save();

    for (let item of cart.items) {
      await Product.findByIdAndUpdate(item.productId._id, {
        $inc: { stock: -item.quantity }
      });
    }

    cart.items = [];
    await cart.save();

    return res.status(200).json({ success: true, message: "Order placed successfully" });

  } catch (error) {
    console.error("Error placing order:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


module.exports = {
  getCheckout,
  placeOrder,
  addAddress,
};