const express = require('express')

const adminRoute = express.Router()

const adminController = require('../../controllers/adminController/adminController');
const { isAdminNotAuthenticated, preventCache, isAdminAuthenticated } = require('../../middlewares/adminMiddleware');
const adminUserController = require('../../controllers/adminController/getUserController');
const categoryController = require('../../controllers/adminController/categoryController');
const productController = require('../../controllers/adminController/productController');
const manageProductController = require('../../controllers/adminController/manageProducts');
const dashboardController = require('../../controllers/adminController/dashboard-controller')
const manageOrderController =require("../../controllers/adminController/manage-orders");
const upload = require('../../config/multer');


adminRoute.get('/adminLogin', isAdminNotAuthenticated, preventCache, adminController.getAdminLogin);
adminRoute.post('/adminLogin', isAdminNotAuthenticated, adminController.postAdminLogin);



adminRoute.use(isAdminAuthenticated);
adminRoute.use(preventCache);


adminRoute.get('/adminDashboard', dashboardController.getDashboard);

adminRoute.get('/adminLogout', adminController.logoutAdminDashboard);

adminRoute.get('/getUsers', adminUserController.getUsers);
adminRoute.put('/getUsers/:id/block', adminUserController.blockUser);
adminRoute.put('/getUsers/:id/unblock', adminUserController.unblockUser);

adminRoute.get('/categories', categoryController.getCategory);
adminRoute.post('/categories', upload.single('image'), categoryController.addCategory);
adminRoute.put('/categories/:id', upload.single('image'), categoryController.editCategory);
adminRoute.put('/categories/:id/toggle', categoryController.toggleCategoryStatus);

adminRoute.get('/getProducts', productController.getProducts);
adminRoute.get('/add-product', manageProductController.getAddProduct);
adminRoute.post(
  '/products',
  upload.fields([
    { name: 'mainImage', maxCount: 1 },
    { name: 'subImages', maxCount: 3 },
  ]),
  productController.addProduct
);
adminRoute.put('/products/:id/toggle', productController.toggleProductStatus);

adminRoute.get('/categories/list', async (req, res) => {
  try {
    const categories = await require('../../models/categorySchema').find({ isListed: true });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Server Error' });
  }
});

adminRoute.get('/products/:id/edit', productController.getEditProduct);
adminRoute.post('/products/:id', upload.fields([{ name: 'mainImage' }, { name: 'subImages', maxCount: 3 }]), productController.updateProduct);
adminRoute.put('/products/:id', upload.fields([{ name: 'mainImage' }, { name: 'subImages', maxCount: 3 }]), productController.updateProduct);
adminRoute.put('/products/:id/soft-delete', productController.softDeleteProduct);


adminRoute.get('/getOrders', manageOrderController.getManageOrders);
adminRoute.get('/orders/:id', manageOrderController.getOrderDetails);
adminRoute.put('/orders/:id/status', manageOrderController.updateOrderStatus);




module.exports = adminRoute