const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require("../../models/cartSchema");
const Wishlist = require("../../models/wishlistSchema");

const productDetails = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const productId = req.params.id;

    const product = await Product.findById(productId).populate("category");
    if (!product || !product.isListed || product.isDeleted) {
      return res.status(500).render("pageNotFound");
    }

    product.finalPrice = product.salePrice || product.regularPrice;
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

    for (const relatedProduct of relatedProducts) {
      relatedProduct.finalPrice = relatedProduct.salePrice || relatedProduct.regularPrice;
      relatedProduct.regularPrice = relatedProduct.regularPrice || relatedProduct.salePrice;
    }

    let cartCount = 0;
    let wishlistCount = 0;
    let isInCart = false;
    let isWishlisted = false;

    if (userId) {
      const cart = await Cart.findOne({ user: userId });
      if (cart) {
        cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
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
