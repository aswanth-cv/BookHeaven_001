const Product = require("../../models/productSchema");
const { HttpStatus } = require("../../helpers/status-code");

/**
 * Search for products by title or author
 * @route GET /search?q=query
 */
const searchProducts = async (req, res) => {
  try {
    const query = req.query.q;

    // Return empty array if no query or query is too short
    if (!query || query.trim().length < 2) {
      return res.json([]);
    }

    const searchQuery = query.trim();

    // Search for products matching title or author
    // Only return listed and non-deleted products
    const products = await Product.find({
      $and: [
        {
          $or: [
            { title: { $regex: searchQuery, $options: 'i' } },
            { author: { $regex: searchQuery, $options: 'i' } }
          ]
        },
        { isListed: true },
        { isDeleted: false }
      ]
    })
    .select('_id title author mainImage salePrice regularPrice')
    .limit(10) // Limit to 10 results for performance
    .lean();

    return res.json(products);

  } catch (error) {
    console.error('Error in searchProducts:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error searching products'
    });
  }
};

module.exports = {
  searchProducts
};
