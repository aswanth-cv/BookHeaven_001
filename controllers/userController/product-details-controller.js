const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require("../../models/cartSchema");
const Wishlist = require("../../models/wishlistSchema");
const { getActiveOfferForProduct, calculateDiscount } = require("../../utils/offer-helper");

const productDetails = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const productId = req.params.id;



    const product = await Product.findById(productId).populate("category");
    if (!product || !product.isListed || product.isDeleted) {
      return res.status(500).render("pageNotFound");
    }

    // Apply offer to main product
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

    product.regularPrice = product.regularPrice || product.salePrice;

    const relatedProducts = await Product.aggregate([
      {
        $match: {
          _id: { $ne: product._id },
          isListed: true,
          isDeleted: false,
          category: product.category._id
        }
      },
      { $sample: { size: 4 } },
    ]);

    // Apply offers to related products
    for (const relatedProduct of relatedProducts) {
      const relatedOffer = await getActiveOfferForProduct(
        relatedProduct._id,
        relatedProduct.category,
        relatedProduct.salePrice
      );

      if (relatedOffer) {
        const { discountAmount, discountPercentage, finalPrice } = calculateDiscount(relatedOffer, relatedProduct.salePrice);
        
        relatedProduct.originalPrice = relatedProduct.salePrice;
        relatedProduct.finalPrice = finalPrice;
        relatedProduct.activeOffer = relatedOffer;
        relatedProduct.discountAmount = discountAmount;
        relatedProduct.discountPercentage = discountPercentage;
      } else {
        relatedProduct.originalPrice = relatedProduct.salePrice;
        relatedProduct.finalPrice = relatedProduct.salePrice;
        relatedProduct.activeOffer = null;
        relatedProduct.discountAmount = 0;
        relatedProduct.discountPercentage = 0;
      }

      relatedProduct.regularPrice = relatedProduct.regularPrice || relatedProduct.salePrice;
    }

    let cartCount = 0;
    let wishlistCount = 0;
    let isInCart = false;
    let isWishlisted = false;

    if (userId) {
      const cart = await Cart.findOne({ user: userId });
      if (cart) {
        cartCount = cart.items.length;
        isInCart = cart.items.some(item => item.product.toString() === productId);
      }

      const wishlist = await Wishlist.findOne({ user: userId });
      if (wishlist) {
        wishlistCount = wishlist.items.length;
        isWishlisted = wishlist.items.some(item => item.product.toString() === productId);
      }
    }

    

    res.render("product-details", {
      product,
      relatedProducts,
      isInCart,
      isWishlisted,
      cartCount,
      wishlistCount,
      user: userId ? { id: userId } : null,
      isAuthenticated: !!userId,
    });
  } catch (error) {
    console.error("Error fetching product details:", error);
    res.status(500).render("pageNotFound");
  }
};

module.exports = { productDetails };
