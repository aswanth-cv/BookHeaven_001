const { default: mongoose, Types } = require("mongoose");
const Cart = require("../../models/cartSchema");
const Product = require("../../models/productSchema");
const Wishlist = require("../../models/wishlistSchema");
const { getActiveOfferForProduct, calculateDiscount, isOfferActive, recalculateCartTotals } = require("../../utils/offer-helper");
const { HttpStatus } = require("../../helpers/status-code");
const { ErrorMessages } = require("../../helpers/error-messages");



const getCart = async (req, res) => {
  try {

    if (!req.session.user_id) {
      return res.redirect("/login");
    }
   
    const userId = req.session.user_id;
    const cart = await Cart.findOne({user:userId}).populate("items.product");


    const wishlist = await Wishlist.findOne({ user: userId });

    let cartItems = [];
    let totalAmount = 0;
    let totalDiscount = 0;
    let cartCount = 0;
    let wishlistCount = 0;

    if (cart && cart.items.length > 0) {
      
      cartItems = cart.items.filter(
        (item) => item.product && item.product.isListed
      );

      // Apply offers to cart items
      for (const item of cartItems) {
        const price = item.product.salePrice || item.product.regularPrice || 0;
        
        // Get active offer for this product
        const offer = await getActiveOfferForProduct(
          item.product._id,
          item.product.category,
          price
        );

        if (offer) {
          const { discountAmount, discountPercentage, finalPrice } = calculateDiscount(offer, price);
          
          item.product.originalPrice = price;
          item.product.finalPrice = finalPrice;
          item.product.activeOffer = offer;
          item.product.discountAmount = discountAmount;
          item.product.discountPercentage = discountPercentage;
          
          // Calculate totals for this item with discount
          const itemTotal = item.quantity * finalPrice;
          const itemDiscount = item.quantity * discountAmount;
          
          totalAmount += itemTotal;
          totalDiscount += itemDiscount;
        } else {
          item.product.originalPrice = price;
          item.product.finalPrice = price;
          item.product.activeOffer = null;
          item.product.discountAmount = 0;
          item.product.discountPercentage = 0;
          
          // Calculate total for this item without discount
          totalAmount += item.quantity * price;
        }
      }


      cartCount = cartItems.length;
    }

    if (wishlist) {
      wishlistCount = wishlist.items.length;
    }

    
    const relatedProducts = await Product.aggregate([
      { $match: { isListed: true, isDeleted: false } },
      { $sample: { size: 4 } },
    ]);
    
    // Apply offers to related products
    for (const product of relatedProducts) {
      const offer = await getActiveOfferForProduct(
        product._id,
        product.category,
        product.salePrice
      );

      if (offer) {
        const { discountAmount, discountPercentage, finalPrice } = calculateDiscount(offer, product.salePrice);
        
        product.originalPrice = product.salePrice;
        product.finalPrice = finalPrice;
        product.activeOffer = offer;
        product.discountAmount = discountAmount;
        product.discountPercentage = discountPercentage;
      } else {
        product.originalPrice = product.salePrice;
        product.finalPrice = product.salePrice;
        product.activeOffer = null;
        product.discountAmount = 0;
        product.discountPercentage = 0;
      }
    }


    res.render("cart", {
      cartItems,
      totalAmount: totalAmount.toFixed(2),
      totalDiscount: totalDiscount.toFixed(2),
      relatedProducts,
      cartCount,
      wishlistCount,
      user: userId ? { id: userId } : null,
      isAuthenticated: true,
      errorMessage: req.session.errorMessage,
      successMessage: req.session.successMessage
    });
    
    // Clear messages after displaying
    delete req.session.errorMessage;
    delete req.session.successMessage;
  } catch (error) {
    console.log("Error in rendering cart:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Server Error");
  }
};

const addToCart = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({
          success: false,
          message: "Please log in to add items to your cart",
          requiresAuth: true,
          redirectTo: "/login"
        });
    }

    const userId = req.session.user_id;
    const { productId, quantity } = req.body;
    const product = await Product.findById(productId);

    if (!product || !product.isListed || product.isDeleted) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, message: "Product not found or unavailable" });
    }

    // Use current product price
    const currentPrice = product.salePrice || product.regularPrice || 0;

    let cart = await Cart.findOne({ user: userId });
    let existingQuantity = 0;
    const MAX_QUANTITY_PER_PRODUCT = 5;

    if (cart) {
      existingQuantity = cart.items
        .filter((item) => item.product.toString() === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
    }

    const totalQuantity = existingQuantity + parseInt(quantity);

    if (totalQuantity > MAX_QUANTITY_PER_PRODUCT) {
      const remainingAllowed = MAX_QUANTITY_PER_PRODUCT - existingQuantity;
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: remainingAllowed > 0
          ? `You can only add ${remainingAllowed} more of this item. Maximum ${MAX_QUANTITY_PER_PRODUCT} items allowed per product.`
          : `Maximum quantity reached! You can only have up to ${MAX_QUANTITY_PER_PRODUCT} of this item in your cart.`,
        isQuantityLimitReached: true
      });
    }

    if (totalQuantity > product.stock) {
      const availableStock = product.stock - existingQuantity;
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: availableStock > 0 
          ? `Stock has been updated. Only ${availableStock} items available. Please adjust your quantity to continue.`
          : `This product is currently out of stock. Please check back later.`,
        isStockInsufficient: true,
        availableStock: Math.max(0, availableStock),
        requestedQuantity: parseInt(quantity),
        currentStock: product.stock,
        existingInCart: existingQuantity
      });
    }

    // Get active offer for this product
    const offer = await getActiveOfferForProduct(
      productId,
      product.category,
      currentPrice
    );

    let finalPriceForCart = currentPrice;
    if (offer && isOfferActive(offer)) {
      const { finalPrice } = calculateDiscount(offer, currentPrice);
      finalPriceForCart = finalPrice;
    }

    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [
          {
            product: productId,
            quantity: parseInt(quantity),
            priceAtAddition: currentPrice, // Store original price for reference
          },
        ],
        totalAmount: parseInt(quantity) * finalPriceForCart, // Use discounted price for total
      });
    } else {
      const matchingIndices = [];
      cart.items.forEach((item, idx) => {
        if (item.product.toString() === productId) matchingIndices.push(idx);
      });

      if (matchingIndices.length > 0) {
        const keepIndex = matchingIndices[0];
        cart.items[keepIndex].quantity = totalQuantity;
        cart.items[keepIndex].priceAtAddition = currentPrice; // Update to current price
        for (let i = matchingIndices.length - 1; i > 0; i--) {
          cart.items.splice(matchingIndices[i], 1);
        }
      } else {
        cart.items.push({
          product: productId,
          quantity: parseInt(quantity),
          priceAtAddition: currentPrice,
        });
      }

      // Recalculate total with current offers
      const cartTotals = await recalculateCartTotals(cart);
      cart.totalAmount = cartTotals.totalAmount;
    }

   
    await cart.save();

    const cartCount = cart.items.length; // Number of unique items

    res.json({ 
      success: true, 
      message: offer && isOfferActive(offer) ? "Added to cart with offer applied!" : "Added to cart", 
      cartCount,
      hasOffer: !!(offer && isOfferActive(offer)),
      offerTitle: offer && isOfferActive(offer) ? offer.title : null
    });
  } catch (error) {
    console.log("Error adding to cart:", error);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Server error" });
  }
};

const updateCartItem = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ success: false, message: "Please log in" });
    }

    const userId = req.session.user_id;
    const { productId, quantity } = req.body;

    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, message: "Cart not found" });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.product._id.toString() === productId
    );
    if (itemIndex === -1) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, message: "Item not found in cart" });
    }

    const product = await Product.findById(productId);
    if (!product || !product.isListed || product.isDeleted) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, message: "Product not found or unavailable" });
    }

    const MAX_QUANTITY_PER_PRODUCT = 5;
    if (quantity > MAX_QUANTITY_PER_PRODUCT) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({
          success: false,
          message: `Maximum quantity reached! You can only have up to ${MAX_QUANTITY_PER_PRODUCT} of this item in your cart.`,
          isQuantityLimitReached: true
        });
    }

    if (quantity > product.stock) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .json({
          success: false,
          message: `Stock has been updated. Only ${product.stock} items available. Please adjust your quantity to continue.`,
          isStockInsufficient: true,
          availableStock: product.stock,
          requestedQuantity: quantity,
          currentStock: product.stock
        });
    }

    const currentPrice = product.salePrice || product.regularPrice;
    
    // Get active offer for updated pricing
    const offer = await getActiveOfferForProduct(
      product._id,
      product.category,
      currentPrice
    );
    
    let discountedPrice = currentPrice;
    let discountAmount = 0;
    let discountPercentage = 0;
    let offerExpired = false;
    
    if (offer && isOfferActive(offer)) {
      const discountResult = calculateDiscount(offer, currentPrice);
      discountedPrice = discountResult.finalPrice;
      discountAmount = discountResult.discountAmount;
      discountPercentage = discountResult.discountPercentage;
    } else if (offer && !isOfferActive(offer)) {
      // Offer has expired
      offerExpired = true;
    }

    // Update the cart item with current price
    cart.items[itemIndex].quantity = parseInt(quantity);
    cart.items[itemIndex].priceAtAddition = currentPrice;
    
    // Recalculate totals for entire cart with fresh offer lookups
    const cartTotals = await recalculateCartTotals(cart);
    const totalAmount = cartTotals.totalAmount;
    const totalDiscount = cartTotals.totalDiscount;
    const totalItemCount = cartTotals.itemCount;

    cart.totalAmount = totalAmount;
    await cart.save();

    // Prepare response with detailed pricing information
    const response = {
      success: true,
      message: offerExpired ? "Cart updated (offer expired)" : "Cart updated",
      totalAmount: totalAmount,
      totalDiscount: totalDiscount,
      itemTotal: quantity * discountedPrice, // Final price after discount for this item
      originalItemTotal: quantity * currentPrice, // Original price before discount for this item
      itemOriginalPrice: currentPrice, // Per unit original price
      itemDiscountedPrice: discountedPrice, // Per unit discounted price
      itemDiscountAmount: discountAmount, // Per unit discount amount
      cartCount: cart.items.length, // Number of unique items, not total quantity
      hasOffer: !!offer && isOfferActive(offer),
      discountPercentage: discountPercentage,
      offerTitle: offer && isOfferActive(offer) ? offer.title : null,
      offerValid: !!offer && isOfferActive(offer),
      offerExpired: offerExpired,
      priceChanged: cart.items[itemIndex].priceAtAddition !== currentPrice
    };

    res.json(response);
  } catch (error) {
    console.log("Error updating cart item:", error);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Server error" });
  }
};

const removeCartItem = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ success: false, message: "Please log in" });
    }

    const userId = req.session.user_id;
    const { productId } = req.body;

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, message: "Cart not found" });
    }

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== productId
    );
    // Recalculate totals with current offers
    const cartTotals = await recalculateCartTotals(cart);
    cart.totalAmount = cartTotals.totalAmount;

    await cart.save();

    const cartCount = cart.items.length; // Number of unique items

    res.json({
      success: true,
      message: "Item removed",
      cartCount,
      totalAmount: cartTotals.totalAmount,
      totalDiscount: cartTotals.totalDiscount,
    });
  } catch (error) {
    console.log("Error removing cart item:", error);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Server error" });
  }
};

const clearCart = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ success: false, message: "Please log in" });
    }

    const userId = req.session.user_id;
    await Cart.findOneAndDelete({ user: userId });

    res.json({
      success: true,
      message: "Cart cleared",
      cartCount: 0,
      totalAmount: 0,
    });
  } catch (error) {
    console.log("Error clearing cart:", error);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Server error" });
  }
};

const addFromWishlist = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: "Please log in to add items to your cart",
        requiresAuth: true,
        redirectTo: "/login"
      });
    }

    const userId = req.session.user_id;
    const { productId } = req.params;
    const quantity = 1;

    const product = await Product.findById(productId);
    if (!product || !product.isListed || product.isDeleted) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "Product not found or unavailable"
      });
    }

    if (product.stock === 0) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "This product is currently out of stock",
        outOfStock: true
      });
    }

    const currentPrice = product.salePrice || product.regularPrice || 0;
    const MAX_QUANTITY_PER_PRODUCT = 5;

    // Get active offer for this product
    const offer = await getActiveOfferForProduct(
      productId,
      product.category,
      currentPrice
    );

    let finalPriceForCart = currentPrice;
    if (offer && isOfferActive(offer)) {
      const { finalPrice } = calculateDiscount(offer, currentPrice);
      finalPriceForCart = finalPrice;
    }

    let cart = await Cart.findOne({ user: userId });
    let existingQuantity = 0;

    if (cart) {
      existingQuantity = cart.items
        .filter((item) => item.product.toString() === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
    }

    const totalQuantity = existingQuantity + quantity;

    if (totalQuantity > product.stock) {
      const available = product.stock - existingQuantity;
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: available > 0
          ? `Cannot add — only ${available} item(s) available. You already have ${existingQuantity} in your cart.`
          : `Cannot add — this item is already in your cart (${existingQuantity}). No more stock available.`,
        stockExceeded: true,
        availableStock: available,
        currentCartQty: existingQuantity
      });
    }

    if (totalQuantity > MAX_QUANTITY_PER_PRODUCT) {
      const remainingAllowed = MAX_QUANTITY_PER_PRODUCT - existingQuantity;
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: remainingAllowed > 0
          ? `You can only add ${remainingAllowed} more of this item. Maximum ${MAX_QUANTITY_PER_PRODUCT} items allowed per product.`
          : `Maximum quantity reached! You already have ${MAX_QUANTITY_PER_PRODUCT} of this item in your cart.`,
        isQuantityLimitReached: true,
        currentCartQty: existingQuantity
      });
    }

    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [{
          product: productId,
          quantity: quantity,
          priceAtAddition: currentPrice,
        }],
        totalAmount: quantity * finalPriceForCart,
      });
    } else {
      const matchingIndices = [];
      cart.items.forEach((item, idx) => {
        if (item.product.toString() === productId) matchingIndices.push(idx);
      });

      if (matchingIndices.length > 0) {
        const keepIndex = matchingIndices[0];
        cart.items[keepIndex].quantity = totalQuantity;
        cart.items[keepIndex].priceAtAddition = currentPrice;
        
        for (let i = matchingIndices.length - 1; i > 0; i--) {
          cart.items.splice(matchingIndices[i], 1);
        }
      } else {
        cart.items.push({
          product: productId,
          quantity: quantity,
          priceAtAddition: currentPrice,
        });
      }

      // Recalculate totals with current offers
      const cartTotals = await recalculateCartTotals(cart);
      cart.totalAmount = cartTotals.totalAmount;
    }

    await cart.save();

    const cartCount = cart.items.length; // Number of unique items


    return res.status(HttpStatus.OK).json({
      success: true,
      message: "Added to cart successfully",
      cartCount
    });
  } catch (error) {
    console.error(" Error adding from wishlist to cart:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server error"
    });
  }
};

const getCartQuantities = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.json({ success: true, quantities: {} });
    }

    const userId = req.session.user_id;
    const cart = await Cart.findOne({ user: userId });

    if (!cart || !cart.items || cart.items.length === 0) {
      return res.json({ success: true, quantities: {} });
    }

    const quantities = {};
    cart.items.forEach(item => {
      const productId = item.product.toString();
      quantities[productId] = (quantities[productId] || 0) + item.quantity;
    });

    res.json({ success: true, quantities });
  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  getCart,
  addToCart,
  addFromWishlist,
  updateCartItem,
  removeCartItem,
  clearCart,
  getCartQuantities,
};
