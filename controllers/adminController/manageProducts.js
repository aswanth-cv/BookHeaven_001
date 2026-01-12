const { HttpStatus } = require('../../helpers/status-code');
const Product = require('../../models/productSchema');

const getAddProduct = async (req,res) => {
     try {
          res.render('manageProducts.ejs')
     } catch (error) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
               message: 'Server Error'
          })
     }
}


module.exports = {getAddProduct}