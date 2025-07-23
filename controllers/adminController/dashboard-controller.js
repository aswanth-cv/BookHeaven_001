const User = require('../../models/userSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');

const getDashboard = async (req, res) => {
  try {
    const chartFilter = req.query.chartFilter || 'monthly';

    const dashboardStats = []

    const chartData = []

    const bestSellingProducts = []

    const bestSellingCategories = []

    const bestSellingAuthors = []

    res.render('adminDashboard', {
      admin: res.locals.admin,
      dashboardStats,
      chartData,
      bestSellingProducts,
      bestSellingCategories,
      bestSellingAuthors,
      currentFilter: chartFilter
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load Dashboard',
    });
  }
};


module.exports = {
  getDashboard
};
