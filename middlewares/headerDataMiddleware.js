const Cart = require('../models/cartSchema');
const Wishlist = require('../models/wishlistSchema');

/**
 * Middleware to add cart and wishlist counts to res.locals for header display
 * This ensures the navbar badges show correct counts on all pages
 */
const addHeaderData = async (req, res, next) => {
  try {
    // Initialize counts to 0
    res.locals.cartCount = 0;
    res.locals.wishlistCount = 0;
    res.locals.isAuthenticated = false;

    // If user is authenticated, get actual counts
    if (req.session.user_id) {
      res.locals.isAuthenticated = true;
      
      // Get both cart and wishlist data in parallel for better performance
      const [cart, wishlist] = await Promise.all([
        Cart.findOne({ user: req.session.user_id }).select('items'),
        Wishlist.findOne({ user: req.session.user_id }).select('items')
      ]);

      // Calculate cart count (number of distinct items, not total quantity)
      if (cart && cart.items) {
        res.locals.cartCount = cart.items.length;
      }

      // Calculate wishlist count (number of items)
      if (wishlist && wishlist.items) {
        res.locals.wishlistCount = wishlist.items.length;
      }
    }

    next();
  } catch (error) {
    console.error('Error in headerDataMiddleware:', error);
    // Don't block the request if there's an error getting counts
    res.locals.cartCount = 0;
    res.locals.wishlistCount = 0;
    res.locals.isAuthenticated = !!req.session.user_id;
    next();
  }
};

module.exports = { addHeaderData };