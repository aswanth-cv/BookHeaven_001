const categoryController = require("../../controllers/userController/categoryController");
const Product = require('../../models/productSchema');
const Wishlist = require('../../models/wishlistSchema');
const { getActiveOfferForProduct, calculateDiscount } = require('../../utils/offer-helper');
const { HttpStatus } = require("../../helpers/status-code");


const pageNotFound = async (req, res) => {
  try {
    res.render("page-404");
  } catch (error) {
    res.redirect("/pageNotFound");
  }
};

const loadHomePage = async (req, res) => {
  try {
    const categories = await categoryController.getCategories();
    const LIMIT = 4;
    const userId = req.session.user_id;

    // Get user's wishlist if authenticated
    let userWishlistProductIds = [];
    if (userId) {
      const wishlist = await Wishlist.findOne({ user: userId });
      if (wishlist && wishlist.items) {
        userWishlistProductIds = wishlist.items.map(item => item.product.toString());
      }
    }

    const topSellingProducts = await Product.find({ isListed: true, isDeleted: false })
      .populate('category')
      .sort({ stock: -1 }) 
      .limit(LIMIT);

    const newArrivals = await Product.find({ isListed: true, isDeleted: false })
      .populate('category') 
      .sort({ createdAt: -1  }) 
      .limit(LIMIT);

    // Apply offers to top selling products and mark wishlist status
    for (const product of topSellingProducts) {
      const offer = await getActiveOfferForProduct(
        product._id,
        product.category._id,
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
      
      // Mark if product is in user's wishlist
      product.isWishlisted = userWishlistProductIds.includes(product._id.toString());
    }

    // Apply offers to new arrivals and mark wishlist status
    for (const product of newArrivals) {
      const offer = await getActiveOfferForProduct(
        product._id,
        product.category._id,
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
      
      // Mark if product is in user's wishlist
      product.isWishlisted = userWishlistProductIds.includes(product._id.toString());
    }


    return res.render("home", {
      categories,
      topSellingProducts,
      newArrivals,
      user: req.session.user_id ? { id: req.session.user_id } : null
    });


  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Server Error");
  }
};

const getAboutPage = async (req, res) => {
  try {
    res.render("about");
  } catch (error) {
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Server Error");
  }
};

module.exports = {
  loadHomePage,
  pageNotFound,
  getAboutPage,
};