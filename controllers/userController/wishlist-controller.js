const Wishlist = require("../../models/wishlistSchema")
const Product = require("../../models/productSchema")
const Cart = require("../../models/cartSchema")
const { getActiveOfferForProduct, calculateDiscount } = require("../../utils/offer-helper")
const { HttpStatus } = require("../../helpers/status-code");
const { ErrorMessages } = require("../../helpers/error-messages");

const getWishlist = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.redirect("/login")
    }

    const userId = req.session.user_id
    const page = Number.parseInt(req.query.page) || 1
    const limit = 5
    const skip = (page - 1) * limit

    const wishlist = await Wishlist.findOne({ user: userId }).populate("items.product")
    const cart = await Cart.findOne({ user: userId })

    let wishlistItems = []
    let totalItems = 0
    let inStockItems = 0
    let lowStockItems = 0
    let outOfStockItems = 0
    let cartCount = 0
    let wishlistCount = 0

    if (wishlist && wishlist.items.length > 0) {
      wishlistItems = wishlist.items.filter((item) => item.product && item.product.isListed && !item.product.isDeleted)
      totalItems = wishlistItems.length
      wishlistCount = totalItems

      // Apply offers to wishlist items
      for (const item of wishlistItems) {
        const offer = await getActiveOfferForProduct(
          item.product._id,
          item.product.category,
          item.product.salePrice
        );

        if (offer) {
          const { discountAmount, discountPercentage, finalPrice } = calculateDiscount(offer, item.product.salePrice);
          
          item.product.originalPrice = item.product.salePrice;
          item.product.finalPrice = finalPrice;
          item.product.activeOffer = offer;
          item.product.discountAmount = discountAmount;
          item.product.discountPercentage = discountPercentage;
        } else {
          item.product.originalPrice = item.product.salePrice;
          item.product.finalPrice = item.product.salePrice;
          item.product.activeOffer = null;
          item.product.discountAmount = 0;
          item.product.discountPercentage = 0;
        }

        if (item.product.stock > 10) {
          inStockItems++;
        } else if (item.product.stock > 0) {
          lowStockItems++;
        } else {
          outOfStockItems++;
        }
      }

      wishlistItems = wishlistItems.slice(skip, skip + limit)
    }

    if (cart) {
      cartCount = cart.items.length
    }

    const totalPages = Math.ceil(totalItems / limit)

    const recentlyViewed = await Product.aggregate([
      { $match: { isListed: true, isDeleted: false } },
      { $sample: { size: 4 } },
    ])

    // Apply offers to recently viewed products
    for (const product of recentlyViewed) {
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

    res.render("wishlist", {
      wishlistItems,
      totalItems,
      inStockItems,
      lowStockItems,
      outOfStockItems,
      recentlyViewed,
      currentPage: page,
      totalPages,
      cartCount,
      wishlistCount,
      user: userId ? { id: userId } : null,
      isAuthenticated: true,
    })
  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(ErrorMessages.SERVER.INTERNAL_ERROR)
  }
}

const toggleWishlist = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Please log in to manage your wishlist',
        requiresAuth: true,
        redirectTo: '/login'
      });
    }

    const userId = req.session.user_id;
    const { productId } = req.body;
    const product = await Product.findById(productId);

    if (!product || !product.isListed || product.isDeleted) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Product not found or unavailable' });
    }

    let wishlist = await Wishlist.findOne({ user: userId });

    if (!wishlist) {
      wishlist = new Wishlist({
        user: userId,
        items: [{ product: productId }]
      });
      await wishlist.save();
      return res.json({ success: true, message: 'Added to wishlist', isWishlisted: true, wishlistCount: 1 });
    }

    const itemIndex = wishlist.items.findIndex(item => item.product.toString() === productId);

    if (itemIndex > -1) {
      wishlist.items.splice(itemIndex, 1);
      await wishlist.save();
      return res.json({ success: true, message: 'Removed from wishlist', isWishlisted: false, wishlistCount: wishlist.items.length });
    } else {
      wishlist.items.push({ product: productId });
      await wishlist.save();
      return res.json({ success: true, message: 'Added to wishlist', isWishlisted: true, wishlistCount: wishlist.items.length });
    }
  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const addAllToCart = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Please log in' });
    }

    const userId = req.session.user_id;
    
    const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');

    if (!wishlist || wishlist.items.length === 0) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Wishlist is empty' });
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [], totalAmount: 0 });
    }

    const successMessages = [];
    const errorMessages = [];
    const addedProductIds = [];
    const itemsToRemoveFromWishlist = [];
    let addedCount = 0;
    let skippedCount = 0;
    const MAX_QUANTITY_PER_PRODUCT = 5;
    
    const validItems = wishlist.items.filter(item => 
      item.product && item.product.isListed && !item.product.isDeleted
    );

    for (const item of validItems) {
      const product = item.product;
      const productTitle = product.title || 'Unknown Product';
      const productId = product._id.toString();
      
      if (product.stock === 0) {
        errorMessages.push(`${productTitle}: ${ErrorMessages.PRODUCT.OUT_OF_STOCK}`);
        skippedCount++;
        continue; 
      }

      const itemIndex = cart.items.findIndex(cartItem => 
        cartItem.product.toString() === productId
      );

      let existingQuantity = 0;
      if (itemIndex > -1) {
        existingQuantity = cart.items[itemIndex].quantity;
      }

      const newQuantity = existingQuantity + 1;

      if (newQuantity > MAX_QUANTITY_PER_PRODUCT) {
        errorMessages.push(`${productTitle}: ${ErrorMessages.CART.MAX_QUANTITY_EXCEEDED}`);
        skippedCount++;
        continue;
      }

      if (newQuantity > product.stock) {
        const available = product.stock - existingQuantity;
        if (available > 0) {
          errorMessages.push(`${productTitle}: Only ${available} more available (you have ${existingQuantity} in cart)`);
        } else {
          errorMessages.push(`${productTitle}: Already in cart (${existingQuantity}), no more stock`);
        }
        skippedCount++;
        continue; 
      }

      if (itemIndex > -1) {
        cart.items[itemIndex].quantity = newQuantity;
        cart.items[itemIndex].priceAtAddition = product.salePrice || product.regularPrice;
      } else {
        cart.items.push({
          product: productId,
          quantity: 1,
          priceAtAddition: product.salePrice || product.regularPrice
        });
      }

      addedCount++;
      addedProductIds.push(productId);
      itemsToRemoveFromWishlist.push(productId);
      successMessages.push(`${productTitle}: Added to cart`);
    }

    if (addedCount > 0) {        
      cart.totalAmount = cart.items.reduce((sum, item) => 
        sum + (item.quantity * item.priceAtAddition), 0
      );
      
      try {
        // Save cart first
        await cart.save();
        
        const originalWishlistLength = wishlist.items.length;
        
        wishlist.items = wishlist.items.filter(item => {
          const productIdString = item.product._id ? item.product._id.toString() : item.product.toString();
          const shouldRemove = itemsToRemoveFromWishlist.includes(productIdString);
          return !shouldRemove;
        });
        
        
        const updatedWishlist = await Wishlist.findOneAndUpdate(
          { user: userId },
          { items: wishlist.items },
          { new: true }
        );
        
        const verifyWishlist = await Wishlist.findOne({ user: userId });
        
      } catch (saveError) {
        console.error(' Error saving cart or wishlist:', saveError);
        return res.status(500).json({ 
          success: false, 
          message: 'Error saving changes to cart or wishlist',
          error: process.env.NODE_ENV === 'development' ? saveError.message : undefined
        });
      }
    }

    const cartCount = cart.items.length;
    const wishlistCount = wishlist.items.length;

    let message = '';
    if (addedCount > 0 && skippedCount === 0) {
      message = `Successfully added ${addedCount} item(s) to cart`;
    } else if (addedCount > 0 && skippedCount > 0) {
      message = `Added ${addedCount} item(s) to cart, ${skippedCount} item(s) skipped`;
    } else if (addedCount === 0 && skippedCount > 0) {
      message = `Could not add any items to cart`;
    } else {
      message = 'No items to add';
    }

    const result = {
      success: addedCount > 0,
      message: message,
      cartCount,
      wishlistCount,
      addedCount,
      skippedCount,
      addedProductIds,
      successMessages,
      errorMessages,
      updatedWishlist: wishlist.items.map(item => ({
        productId: item.product._id,
        title: item.product.title,
        stock: item.product.stock
      }))
    };
    
    res.json(result);
    
  } catch (error) {
    console.error(' Error in bulk add to cart:', error);
    
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: 'Server error occurred while adding items to cart',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const addToCartFromWishlist = async (req, res) => {
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
    const { productId } = req.body;
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
        message: ErrorMessages.PRODUCT.OUT_OF_STOCK,
        outOfStock: true
      });
    }

    const finalPrice = product.salePrice || product.regularPrice || 0;
    const MAX_QUANTITY_PER_PRODUCT = 5;

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
        stockExceeded: true
      });
    }

    if (totalQuantity > MAX_QUANTITY_PER_PRODUCT) {
      const remainingAllowed = MAX_QUANTITY_PER_PRODUCT - existingQuantity;
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: remainingAllowed > 0
          ? `You can only add ${remainingAllowed} more of this item. Maximum ${MAX_QUANTITY_PER_PRODUCT} items allowed per product.`
          : `Maximum quantity reached! You already have ${MAX_QUANTITY_PER_PRODUCT} of this item in your cart.`,
        isQuantityLimitReached: true
      });
    }

    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [{
          product: productId,
          quantity: quantity,
          priceAtAddition: finalPrice,
        }],
        totalAmount: quantity * finalPrice,
      });
    } else {
      const matchingIndices = [];
      cart.items.forEach((item, idx) => {
        if (item.product.toString() === productId) matchingIndices.push(idx);
      });

      if (matchingIndices.length > 0) {
        const keepIndex = matchingIndices[0];
        cart.items[keepIndex].quantity = totalQuantity;
        cart.items[keepIndex].priceAtAddition = finalPrice;
        
        for (let i = matchingIndices.length - 1; i > 0; i--) {
          cart.items.splice(matchingIndices[i], 1);
        }
      } else {
        cart.items.push({
          product: productId,
          quantity: quantity,
          priceAtAddition: finalPrice,
        });
      }

      cart.totalAmount = cart.items.reduce(
        (sum, item) => sum + item.quantity * item.priceAtAddition,
        0
      );
    }

    try {
      await cart.save();
      
      const wishlist = await Wishlist.findOne({ user: userId });
      if (wishlist) {
        const itemIndex = wishlist.items.findIndex(item => 
          item.product.toString() === productId
        );
        
        if (itemIndex > -1) {
          wishlist.items.splice(itemIndex, 1);
          await wishlist.save();
        }
      }

      const cartCount = cart.items.length;
      const wishlistCount = wishlist ? wishlist.items.length : 0;

      return res.status(HttpStatus.OK).json({
        success: true,
        message: "Added to cart and removed from wishlist",
        cartCount,
        wishlistCount
      });
    } catch (saveError) {
      console.error(" Error saving cart or wishlist:", saveError);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error saving changes"
      });
    }
  } catch (error) {
    console.error(" Error adding from wishlist to cart:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server error"
    });
  }
};

const clearWishlist = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Please log in' });
    }

    const userId = req.session.user_id;
    await Wishlist.findOneAndDelete({ user: userId });

    res.json({ success: true, message: 'Wishlist cleared', wishlistCount: 0 });
  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error' });
  }
};

const getWishlistDebug = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Please log in' });
    }

    const userId = req.session.user_id;
    const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');
    
    res.json({
      success: true,
      userId,
      wishlistExists: !!wishlist,
      itemCount: wishlist?.items?.length || 0,
      items: wishlist?.items?.map(item => ({
        productId: item.product?._id,
        title: item.product?.title,
        addedAt: item.addedAt
      })) || []
    });
  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'Server error', error: error.message });
  }
};

module.exports = {
  getWishlist,
  toggleWishlist,
  addAllToCart,
  addToCartFromWishlist,
  clearWishlist,
  getWishlistDebug
 };