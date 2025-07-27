const categoryController = require("../../controllers/userController/categoryController");
const Product = require('../../models/productSchema');


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

    const topSellingProducts = await Product.find({ isListed: true, isDeleted: false })
      .populate('category')
      .sort({ stock: -1 }) 
      .limit(LIMIT);

    const newArrivals = await Product.find({ isListed: true, isDeleted: false })
      .populate('category') 
      .sort({ createdAt: -1  }) 
      .limit(LIMIT);


    return res.render("home", {
      categories,
      topSellingProducts,
      newArrivals,
      user: req.session.user_id ? { id: req.session.user_id } : null,
      isAuthenticated: !!req.session.user_id
    });


  } catch (error) {
    res.status(500).send("Server Error");
  }
};

const getAboutPage = async (req, res) => {
  try {
    res.render("about");
  } catch (error) {
    res.status(500).send("Server Error");
  }
};

module.exports = {
  loadHomePage,
  pageNotFound,
  getAboutPage,
};