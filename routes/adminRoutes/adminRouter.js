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
const returnManagementController = require("../../controllers/adminController/returnManagementController");
const couponController = require("../../controllers/adminController/couponController");
const offerController = require("../../controllers/adminController/offer-controller");
const salesController =require("../../controllers/adminController/sales-controller");
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
adminRoute.put('/orders/:id/return-request', manageOrderController.approveReturnRequest);


adminRoute.get('/return-management', returnManagementController.getReturnRequests);
adminRoute.get('/return-management/:id', returnManagementController.getReturnRequestDetails);
adminRoute.put("/return-management/:id/process", returnManagementController.processReturnRequest)
adminRoute.post('/return-management/bulk-process', returnManagementController.bulkProcessReturns)


//coupon management 

adminRoute.get('/coupons', couponController.getCoupons);
adminRoute.get('/coupons/:id', couponController.getCouponDetails);
adminRoute.post('/coupons', couponController.createCoupon);
adminRoute.put('/coupons/:id', couponController.updateCoupon);
adminRoute.put('/coupons/:id/toggle-status', couponController.toggleCouponStatus);


adminRoute.get('/offers', offerController.getOffers);
adminRoute.post('/offers', offerController.createOffer);
adminRoute.get('/offers/:id', offerController.getOfferDetails); // For fetching details for edit/view
adminRoute.put('/offers/:id', offerController.updateOffer);
adminRoute.put('/offers/:id/toggle-status', offerController.toggleOfferStatus);


adminRoute.get('/sales',salesController.getSales)
adminRoute.get('/sales/export/excel', salesController.exportToExcel)
adminRoute.get('/sales/export/pdf', salesController.exportToPDF)



module.exports = adminRoute