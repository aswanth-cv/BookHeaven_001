const Wishlist = require("../../models/wishlistSchema")
const Product = require("../../models/productSchema")
const Cart = require("../../models/cartSchema")

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

      for (const item of wishlistItems) {
  const price = item.product.salePrice || item.product.regularPrice || 0;
  item.product.finalPrice = price; 
  item.product.salePrice = price;
  item.product.regularPrice = price;

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
      cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0)
    }

    const totalPages = Math.ceil(totalItems / limit)

    const recentlyViewed = await Product.aggregate([
      { $match: { isListed: true, isDeleted: false } },
      { $sample: { size: 4 } },
    ])

    for (const product of recentlyViewed) {
  const price = product.salePrice || product.regularPrice || 0;
  product.finalPrice = price;
  product.salePrice = price;
  product.regularPrice = price;
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
    console.log("Error in rendering wishlist:", error)
    res.status(500).send("Server Error")
  }
}


const toggleWishlist = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({
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
      return res.status(404).json({ success: false, message: 'Product not found or unavailable' });
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
    console.log('Error toggling wishlist:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const addAllToCart = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const userId = req.session.user_id;
    const wishlist = await Wishlist.findOne({ user: userId }).populate('items.product');

    if (!wishlist || wishlist.items.length === 0) {
      return res.status(404).json({ success: false, message: 'Wishlist is empty' });
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [], totalAmount: 0 });
    }

    const messages = [];
    const MAX_QUANTITY_PER_PRODUCT = 5; 
    const availableItems = wishlist.items.filter(item => item.product && item.product.isListed && !item.product.isDeleted && item.product.stock > 0);

    for (const item of availableItems) {
      const product = item.product;
      const itemIndex = cart.items.findIndex(cartItem => cartItem.product.toString() === product._id.toString());

      if (itemIndex > -1) {
        const newQuantity = cart.items[itemIndex].quantity + 1;

        if (newQuantity > MAX_QUANTITY_PER_PRODUCT) {
          messages.push(`${product.title}: Maximum ${MAX_QUANTITY_PER_PRODUCT} items allowed per product`);
          continue;
        }

        if (newQuantity <= product.stock) {
          cart.items[itemIndex].quantity = newQuantity;
          cart.items[itemIndex].priceAtAddition = product.salePrice;
        } else {
          messages.push(`${product.title}: Only ${product.stock} items in stock`);
          continue;
        }
      } else {
        cart.items.push({
          product: product._id,
          quantity: 1,
          priceAtAddition: product.salePrice
        });
      }
    }

    cart.totalAmount = cart.items.reduce((sum, item) => sum + (item.quantity * item.priceAtAddition), 0);
    await cart.save();


    const cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const wishlistCount = wishlist.items.length;

    res.json({
      success: true,
      message: 'Available items added to cart',
      cartCount,
      wishlistCount,
      warnings: messages
    });
  } catch (error) {
    console.log('Error adding all to cart:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const clearWishlist = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const userId = req.session.user_id;
    await Wishlist.findOneAndDelete({ user: userId });

    res.json({ success: true, message: 'Wishlist cleared', wishlistCount: 0 });
  } catch (error) {
    console.log('Error clearing wishlist:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { getWishlist, toggleWishlist, addAllToCart, clearWishlist };