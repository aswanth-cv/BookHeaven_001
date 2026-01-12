const Order = require("../../models/orderSchema");
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Cart = require("../../models/cartSchema"); // Added Cart import
const path = require('path');
const mongoose = require("mongoose");
const PDFDocument = require('pdfkit');
const { processCancelRefund , processReturnRefund} = require("../../controllers/userController/walletController");
const { validateCouponAfterItemCancellation, validateCouponAfterItemReturn } = require("../../helpers/coupon-validation");
const { calculateExactRefundAmount } = require("../../helpers/money-calculator");
const { HttpStatus } = require("../../helpers/status-code");


const getOrders = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.redirect('/login');
    }

    const userId = req.session.user_id;


    const user = await User.findById(userId, 'fullName email profileImage').lean();
    if (!user) {
      return res.redirect('/login');
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;

    const validFilters = ['All', 'Delivered', 'Processing', 'Shipped', 'Placed', 'Cancelled', 'Returned', 'Partially Cancelled', 'Partially Returned'];
    let currentFilter = req.query.filter || 'All';
    if (!validFilters.includes(currentFilter)) {
      currentFilter = 'All';
    }
    const query = { user: userId, isDeleted: false };
    if (currentFilter !== 'All') {
      query.orderStatus = currentFilter;
    }

    const validSorts = {
      'createdAt-desc': { createdAt: -1 },
      'createdAt-asc': { createdAt: 1 },
      'total-desc': { total: -1 },
      'total-asc': { total: 1 }
    };

    const sortDisplayMap = {
      'createdAt-desc': 'Newest First',
      'createdAt-asc': 'Oldest First',
      'total-desc': 'Price: High to Low',
      'total-asc': 'Price: Low to High'
    };

    let currentSort = req.query.sort || 'createdAt-desc';
    if (!validSorts[currentSort]) {
      currentSort = 'createdAt-desc';
    }
    const sortCriteria = validSorts[currentSort];
    const sortDisplay = sortDisplayMap[currentSort];

    const filterDisplayMap = {
      'All': 'All Orders',
      'Delivered': 'Delivered Orders',
      'Processing': 'Processing Orders',
      'Shipped': 'Shipped Orders',
      'Placed': 'Placed Orders',
      'Cancelled': 'Cancelled Orders',
      'Returned': 'Returned Orders',
      'Partially Cancelled': 'Partially Cancelled Orders',
      'Partially Returned': 'Partially Returned Orders'
    };

    const totalOrders = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean();

    for (const order of orders) {
      order.formattedDate = new Date(order.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (!['Delivered', 'Cancelled', 'Returned'].includes(order.orderStatus)) {
        const deliveryDate = new Date(order.createdAt);
        deliveryDate.setDate(deliveryDate.getDate() + 5); 
        order.estimatedDeliveryDate = deliveryDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      } else if (order.orderStatus === 'Delivered') {
        order.estimatedDeliveryDate = new Date(order.deliveredAt || order.updatedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }

      order.formattedSubtotal = `₹${(order.subtotal || 0).toFixed(2)}`;
      order.formattedTax = `₹${(order.tax || 0).toFixed(2)}`;
      order.formattedShipping = `₹${(order.shipping || 0).toFixed(2)}`;
      order.formattedTotal = `₹${(order.total || 0).toFixed(2)}`;
      order.formattedDiscount = (order.discount || 0) > 0 ? `₹${order.discount.toFixed(2)}` : '₹0.00';
      order.formattedCouponDiscount = (order.couponDiscount || 0) > 0 ? `₹${order.couponDiscount.toFixed(2)}` : '₹0.00';
    }

    const totalPages = Math.ceil(totalOrders / limit);
    const pagination = {
      currentPage: page,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page - 1,
      nextPage: page + 1,
      pages: Array.from({ length: totalPages }, (_, i) => i + 1),
    };

    res.render('order', {
      title: 'My Orders',
      orders,
      user,
      pagination,
      currentFilter,
      currentSort,
      sortDisplay,
      filterDisplay: filterDisplayMap[currentFilter],
      isAuthenticated: true
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    req.session.errorMessage = 'Something went wrong while fetching your orders. Please try again.';
    return res.redirect('/');
  }
};


const getOrderDetails = async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.session.user_id;

    if (!userId) return res.redirect('/login');

    const user = await User.findById(userId, 'fullName email profileImage').lean();
    if (!user) return res.redirect('/login');

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(HttpStatus.UNAUTHORIZED).render('user/page-404', { 
        title: 'Invalid Order',
        message: 'Invalid order ID' 
      });
    }

    const order = await Order.findById(orderId).populate('items.product');
    if (!order || order.user.toString() !== userId.toString()) {
      return res.status(HttpStatus.NOT_FOUND).render('user/page-404', { 
        title: 'Order Not Found',
        message: 'Order not found' 
      });
    }

    order.formattedDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    order.items.forEach(item => {
      // Extract price breakdown information if available
      if (item.priceBreakdown) {
        item.originalPrice = item.priceBreakdown.originalPrice || item.price;
        // Fix: Convert total prices back to per-unit prices for display
        item.discountedPrice = (item.priceBreakdown.priceAfterOffer || (item.price * item.quantity)) / item.quantity;
        item.finalPrice = (item.priceBreakdown.finalPrice || (item.discountedPrice * item.quantity)) / item.quantity;
        item.offerDiscount = item.priceBreakdown.offerDiscount || 0;
        item.offerTitle = item.priceBreakdown.offerTitle || item.offerTitle;
        item.couponDiscount = item.priceBreakdown.couponDiscount || 0;
        item.couponProportion = item.priceBreakdown.couponProportion || 0;
        
        // Calculate discount percentage for display (based on per-unit prices)
        if (item.offerDiscount > 0 && item.originalPrice > 0) {
          const perUnitOfferDiscount = item.offerDiscount / item.quantity;
          item.discountPercentage = Math.round((perUnitOfferDiscount / item.originalPrice) * 100);
        }
        
        // Ensure numeric values for proper comparison
        item.originalPrice = Number(item.originalPrice);
        item.discountedPrice = Number(item.discountedPrice);
        item.finalPrice = Number(item.finalPrice);
        item.offerDiscount = Number(item.offerDiscount);
        item.couponDiscount = Number(item.couponDiscount);
      } else {
        // Fallback for orders without priceBreakdown
        item.originalPrice = Number(item.price);
        item.discountedPrice = Number(item.price);
        item.finalPrice = Number(item.price);
        item.offerDiscount = 0;
        item.couponDiscount = 0;
        item.couponProportion = 0;
      }

      // Calculate expected refund amount for this item (for display purposes)
      // Use the same calculation as the wallet refund processing
      try {
        item.expectedRefundAmount = calculateExactRefundAmount(item, order);
      } catch (error) {
        console.error('Error calculating expected refund amount:', error);
        // Fallback to item final price
        item.expectedRefundAmount = item.priceBreakdown?.finalPrice || 
                                   (item.discountedPrice * item.quantity) || 
                                   (item.price * item.quantity);
      }

      // Format prices for display
      item.formattedPrice = `₹${item.originalPrice.toFixed(2)}`;
      item.formattedDiscountedPrice = `₹${item.discountedPrice.toFixed(2)}`;
      item.formattedFinalPrice = `₹${item.finalPrice.toFixed(2)}`;
      item.formattedExpectedRefund = `₹${item.expectedRefundAmount.toFixed(2)}`;

      item.canBeCancelled = (
        item.status === 'Active' &&
        ['Placed', 'Processing'].includes(order.orderStatus)
      );

      if (
        (order.orderStatus === 'Delivered' ||
         order.orderStatus === 'Partially Cancelled' ||
         order.orderStatus === 'Partially Returned') &&
        item.status === 'Active'
      ) {
        const deliveredDate = order.deliveredAt;
        if (deliveredDate) {
          const returnPeriod = 7 * 24 * 60 * 60 * 1000; 
          const timeRemaining = returnPeriod - (Date.now() - deliveredDate.getTime());
          item.canBeReturned = timeRemaining > 0;

          if (item.canBeReturned) {
            item.returnTimeRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
            item.returnDeadline = new Date(deliveredDate.getTime() + returnPeriod).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            });
          } else {
            item.returnExpiredDays = Math.floor((Date.now() - deliveredDate.getTime()) / (24 * 60 * 60 * 1000)) - 7;
          }
        } else {
          item.canBeReturned = false;
          item.returnNotEligibleReason = 'Order not yet delivered';
        }
      } else {
        item.canBeReturned = false;
        if (item.status !== 'Active') {
          item.returnNotEligibleReason = `Item is ${item.status.toLowerCase()}`;
        } else if (order.orderStatus !== 'Delivered') {
          item.returnNotEligibleReason = 'Order must be delivered first';
        }
      }
    });

    // Calculate subtotal from original prices (before discounts)
    const originalSubtotal = order.items.reduce((sum, item) => {
      const itemOriginalTotal = (item.originalPrice || item.price) * (item.quantity || 1);
      return sum + itemOriginalTotal;
    }, 0);
    
    // Calculate final total using final prices (after offers and coupons)
    const finalTotal = order.items.reduce((sum, item) => {
      const itemFinalPrice = item.priceBreakdown?.finalPrice || (item.price * item.quantity);
      return sum + itemFinalPrice;
    }, 0);
    
    const tax = order.tax || 0;
    const shipping = order.shipping || 0;
    const totalWithTaxAndShipping = finalTotal + tax + shipping;

    // Format order totals
    order.formattedSubtotal = `₹${originalSubtotal.toFixed(2)}`;
    order.formattedTax = `₹${tax.toFixed(2)}`;
    order.formattedShipping = `₹${(order.shipping || 0).toFixed(2)}`;
    order.formattedTotal = `₹${totalWithTaxAndShipping.toFixed(2)}`;
    
    // Format individual discount totals for display
    const totalOfferDiscount = order.items.reduce((sum, item) => sum + (item.offerDiscount || 0), 0);
    const totalCouponDiscount = order.items.reduce((sum, item) => sum + (item.couponDiscount || 0), 0);
    
    // Set order-level discount values for template compatibility
    order.discount = totalOfferDiscount;
    order.couponDiscount = totalCouponDiscount;
    
    order.formattedOfferDiscount = `₹${totalOfferDiscount.toFixed(2)}`;
    order.formattedCouponDiscount = `₹${totalCouponDiscount.toFixed(2)}`;
    order.formattedDiscount = `₹${totalOfferDiscount.toFixed(2)}`;

    const timeline = [
      {
        status: 'Order Placed',
        timestamp: new Date(order.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        completed: true,
        active: false
      },
      {
        status: 'Processing',
        timestamp: order.processedAt ? new Date(order.processedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        completed: ['Processing', 'Shipped', 'Delivered'].includes(order.orderStatus),
        active: order.orderStatus === 'Processing'
      },
      {
        status: 'Shipped',
        timestamp: order.shippedAt ? new Date(order.shippedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        completed: ['Shipped', 'Delivered'].includes(order.orderStatus),
        active: order.orderStatus === 'Shipped'
      },
      {
        status: 'Delivered',
        timestamp: order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        completed: order.orderStatus === 'Delivered',
        active: order.orderStatus === 'Delivered'
      }
    ];

    if (['Cancelled', 'Partially Cancelled'].includes(order.orderStatus)) {
      timeline.push({
        status: order.orderStatus,
        timestamp: order.cancelledAt ? new Date(order.cancelledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        cancelled: true,
        active: true
      });
    }

    if (['Return Requested', 'Returned', 'Partially Return Requested', 'Partially Returned'].includes(order.orderStatus)) {
      timeline.push({
        status: order.orderStatus,
        timestamp: order.returnRequestedAt ? new Date(order.returnRequestedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        return_requested: order.orderStatus.includes('Return Requested'),
        returned: order.orderStatus.includes('Returned'),
        active: true
      });
    }

    // Check if this is a JSON request (for AJAX updates)
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({
        success: true,
        order: {
          ...order.toObject(),
          formattedDate: order.formattedDate,
          formattedSubtotal: order.formattedSubtotal,
          formattedTax: order.formattedTax,
          formattedTotal: order.formattedTotal,
          items: order.items
        },
        timeline
      });
    }

    res.render('order-details', {
      order,
      timeline,
      title: `Order #${order.orderNumber}`,
      user: {
        id: userId,
        fullName: user.fullName || 'User',
        email: user.email || '',
        profileImage: user.profileImage || '/api/placeholder/120/120'
      },
      isAuthenticated: true
    });

  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).render('user/page-404', { 
      title: 'Error',
      message: 'Error fetching order details' 
    });
  }
};



const getOrderSuccess = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.redirect('/login');
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    }).lean();

    if (!order) {
      return res.status(HttpStatus.NOT_FOUND).json({
        message: 'Order not found or you do not have access to this order',
        isAuthenticated: true
      });
    }

    const user = await User.findById(userId, 'fullName email profileImage').lean();
    if (!user) {
      return res.redirect('/login');
    }

    // Use order-level discount values for accuracy
    const totalOfferDiscount = order.discount || 0;
    const totalCouponDiscount = order.couponDiscount || 0;

    // IMPORTANT: order.subtotal is already discounted (after offers applied)
    // So the correct calculation is: subtotal - coupons + tax + shipping
    // NOT: subtotal - offers - coupons + tax + shipping
    const calculatedTotal = order.subtotal - totalCouponDiscount + (order.tax || 0) + (order.shipping || 0);


    res.render('order-success', {
      orderNumber: order.orderNumber,
      orderId: order._id,
      paymentMethod: order.paymentMethod,
      subtotal: order.subtotal, // This is already discounted
      offerDiscount: totalOfferDiscount,
      couponDiscount: totalCouponDiscount,
      couponCode: order.couponCode,
      tax: order.tax,
      shipping: order.shipping || 0,
      total: order.total,
      calculatedTotal: calculatedTotal,
      // Add original subtotal for proper display
      originalSubtotal: order.subtotal + totalOfferDiscount, // Reconstruct original
      user: {
        id: userId,
        fullName: user.fullName || 'User',
        email: user.email || '',
        profileImage: user.profileImage || '/api/placeholder/120/120'
      },
      isAuthenticated: true
    });
  } catch (error) {
    console.error('Error rendering order success page:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).render('user/page-404', {
      title: 'Error',
      message: 'Internal server error',
      isAuthenticated: req.session.user_id ? true : false
    });
  }
};



const viewInvoice = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.redirect('/login');
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    }).lean();

    if (!order) {
      return res.status(HttpStatus.NOT_FOUND).render('user/page-404', {
        title: 'Order Not Found',
        message: 'Order not found or you do not have access to this order'
      });
    }

    const user = await User.findById(userId, 'fullName email').lean();
    if (!user) {
      return res.redirect('/login');
    }

    order.formattedDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Filter out canceled and returned items for invoice display
    const activeItems = order.items.filter(item => 
      item.status === 'Active' || !item.status
    );

    let recalculatedSubtotal = 0;
    activeItems.forEach(item => {
      if (item.priceBreakdown) {
        recalculatedSubtotal += item.priceBreakdown.subtotal || (item.price * item.quantity);
      } else {
        recalculatedSubtotal += item.price * item.quantity;
      }
    });

    const useStoredSubtotal = order.subtotal && Math.abs(order.subtotal - recalculatedSubtotal) < 0.01;
    const displaySubtotal = useStoredSubtotal ? order.subtotal : recalculatedSubtotal;

    const correctTotal = displaySubtotal - (order.discount || 0) - (order.couponDiscount || 0) + (order.tax || 0) + (order.shipping || 0);
    const useStoredTotal = order.total && Math.abs(order.total - correctTotal) < 0.01;
    const displayTotal = useStoredTotal ? order.total : correctTotal;

    order.formattedSubtotal = `₹${displaySubtotal.toFixed(2)}`;
    order.formattedTotal = `₹${displayTotal.toFixed(2)}`;
    order.formattedTax = `₹${(order.tax || 0).toFixed(2)}`;
    order.formattedShipping = `₹${(order.shipping || 0).toFixed(2)}`;
    order.formattedDiscount = `₹${(order.discount || 0).toFixed(2)}`;
    order.formattedCouponDiscount = `₹${(order.couponDiscount || 0).toFixed(2)}`;

    order.total = displayTotal;

    // Update order.items to only include active items for invoice display
    order.items = activeItems;

    order.items.forEach(item => {
      item.formattedPrice = `₹${item.price.toFixed(2)}`;
    });

    res.render('invoice', {
      order,
      user,
      title: `Invoice - Order #${order.orderNumber}`
    });

  } catch (error) {
    console.error('Error viewing invoice:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).render('user/page-404', {
      title: 'Error',
      message: 'Error loading invoice'
    });
  }
};


const downloadInvoice = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await Order.findById(orderId)
            .populate("user")
            .populate("items.product");

        if (!order) {
            return res.status(HttpStatus.NOT_FOUND).send("Order not found");
        }

        const formattedDate = new Date(order.createdAt).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        // Filter out canceled and returned items for invoice display
        const activeItems = order.items.filter(item => 
            item.status === 'Active' || !item.status
        );

        let recalculatedSubtotal = 0;
        activeItems.forEach((item) => {
            if (item.priceBreakdown && item.priceBreakdown.subtotal != null) {
                recalculatedSubtotal += item.priceBreakdown.subtotal;
            } else {
                recalculatedSubtotal += (item.price || 0) * (item.quantity || 0);
            }
        });

        const useStoredSubtotal = order.subtotal && Math.abs(order.subtotal - recalculatedSubtotal) < 0.01;
        const displaySubtotal = useStoredSubtotal ? order.subtotal : recalculatedSubtotal;

        const discount = order.discount || 0;
        const couponDiscount = order.couponDiscount || 0;
        const tax = order.tax || 0;
        const shipping = order.shipping || 0; // Fixed: use order.shipping instead of order.shippingCharge

        const correctTotal = displaySubtotal - discount - couponDiscount + tax + shipping;
        const useStoredTotal = order.total && Math.abs(order.total - correctTotal) < 0.01;
        const displayTotal = useStoredTotal ? order.total : correctTotal;

        const toCurrency = (n) => `₹${Number(n || 0).toFixed(2)}`;

        const doc = new PDFDocument({ margin: 50 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=invoice-${orderId}.pdf`
        );

        doc.pipe(res);

        const rightColX = 350;
        doc.fillColor('#111827').fontSize(18).text('BookHaven', 50, 50);
        doc.fillColor('#6b7280').fontSize(10).text('Where Stories Find Lost Souls', 50, doc.y + 2);

        doc.fillColor('#6b7280').fontSize(11).text('Invoice', rightColX, 50, { width: 200, align: 'right' });
        doc.fillColor('#1f2937').fontSize(11).text(`Invoice #: ${order.orderNumber}`, rightColX, doc.y + 6, { width: 200, align: 'right' });
        doc.text(`Date: ${formattedDate}`, rightColX, doc.y + 2, { width: 200, align: 'right' });
        if (order.orderStatus) {
            doc.text(`Status: ${order.orderStatus}`, rightColX, doc.y + 2, { width: 200, align: 'right' });
        }

        let cursorY = 120;
        doc.fillColor('#6b7280').fontSize(10).text('Delivery Address', 50, cursorY);
        cursorY = doc.y + 6;
        doc.roundedRect(50, cursorY, 330, 90, 6).stroke('#e5e7eb');

        const addrX = 60;
        let addrY = cursorY + 10;
        const a = order.shippingAddress || {};
        const fullName = a.fullName || 'N/A';
        const street = a.street || '';
        const landmark = a.landmark || '';
        const city = a.city || '';
        const state = a.state || '';
        const pinCode = a.pinCode || '';
        const country = a.country || '';
        const userEmail = (order.user && order.user.email) ? order.user.email : '';

        doc.fillColor('#111827').fontSize(11).text(fullName, addrX, addrY, { width: 310 });
        addrY = doc.y + 2;
        if (street) { doc.fillColor('#1f2937').text(street, addrX, addrY, { width: 310 }); addrY = doc.y + 2; }
        if (landmark) { doc.text(landmark, addrX, addrY, { width: 310 }); addrY = doc.y + 2; }
        const lineCity = `${city}${city && state ? ', ' : ''}${state} ${pinCode}`.trim();
        if (lineCity) { doc.text(lineCity, addrX, addrY, { width: 310 }); addrY = doc.y + 2; }
        if (country) { doc.text(country, addrX, addrY, { width: 310 }); addrY = doc.y + 2; }
        if (userEmail) { doc.fillColor('#6b7280').text(userEmail, addrX, addrY, { width: 310 }); }

        doc.fillColor('#6b7280').fontSize(10).text('Order Summary', rightColX, 120, { width: 200, align: 'right' });
        const sumBoxY = 136;
        doc.roundedRect(rightColX, sumBoxY, 200, 90, 6).stroke('#e5e7eb');
        doc.fillColor('#1f2937').fontSize(11);
        let lineY = sumBoxY + 10;
        const drawKV = (k, v) => {
            doc.fillColor('#6b7280').text(k, rightColX + 10, lineY, { width: 90 });
            doc.fillColor('#111827').text(v, rightColX + 110, lineY, { width: 80, align: 'right' });
            lineY = doc.y + 4;
        };
        drawKV('Order #', `${order.orderNumber}`);
        drawKV('Order Date', `${formattedDate}`);
        drawKV('Payment', `${order.paymentMethod || 'Cash on Delivery'}`);
        if (order.couponCode) drawKV('Coupon', `${order.couponCode}`);

        let tableY = Math.max(cursorY + 110, sumBoxY + 110);
        const col = { idx: 50, title: 80, price: 370, qty: 440, total: 500 };
        const rowHeight = 20;

        doc.rect(50, tableY, 510, rowHeight).fill('#f3f4f6');
        doc.fillColor('#374151').fontSize(11).text('#', col.idx + 2, tableY + 6, { width: 20 });
        doc.text('Book', col.title, tableY + 6, { width: 270 });
        doc.text('Unit Price', col.price, tableY + 6, { width: 60, align: 'right' });
        doc.text('Qty', col.qty, tableY + 6, { width: 40, align: 'right' });
        doc.text('Line Total', col.total, tableY + 6, { width: 60, align: 'right' });

        doc.fillColor('#1f2937');
        tableY += rowHeight;

        const addTableHeader = () => {
            doc.addPage();
            tableY = 50;
            doc.rect(50, tableY, 510, rowHeight).fill('#f3f4f6');
            doc.fillColor('#374151').fontSize(11).text('#', col.idx + 2, tableY + 6, { width: 20 });
            doc.text('Book', col.title, tableY + 6, { width: 270 });
            doc.text('Unit Price', col.price, tableY + 6, { width: 60, align: 'right' });
            doc.text('Qty', col.qty, tableY + 6, { width: 40, align: 'right' });
            doc.text('Line Total', col.total, tableY + 6, { width: 60, align: 'right' });
            doc.fillColor('#1f2937');
            tableY += rowHeight;
        };

        activeItems.forEach((item, idx) => {
            const name = (item.title) ? item.title : (item.product && (item.product.title || item.product.name)) || 'Unknown Product';
            const qty = item.quantity || 1;
            const price = Number(item.price || 0);
            const lineTotal = price * qty;

            if (tableY > doc.page.height - 120) {
                addTableHeader();
            }

            doc.fontSize(11).fillColor('#6b7280').text(String(idx + 1), col.idx + 2, tableY + 6, { width: 20 });
            doc.fillColor('#1f2937').text(name, col.title, tableY + 6, { width: 270 });
            doc.text(toCurrency(price), col.price, tableY + 6, { width: 60, align: 'right' });
            doc.text(String(qty), col.qty, tableY + 6, { width: 40, align: 'right' });
            doc.text(toCurrency(lineTotal), col.total, tableY + 6, { width: 60, align: 'right' });

            doc.moveTo(50, tableY + rowHeight).lineTo(560, tableY + rowHeight).strokeColor('#e5e7eb').stroke();

            tableY += rowHeight;
        });

        let totalsY = tableY + 20;
        if (totalsY > doc.page.height - 180) {
            doc.addPage();
            totalsY = 50;
        }
        const totalsBoxW = 260;
        const totalsX = 560 - totalsBoxW;
        doc.roundedRect(totalsX, totalsY, totalsBoxW, 150, 8).stroke('#e5e7eb');

        const line = (label, value, isGrand = false) => {
            doc.fontSize(isGrand ? 12 : 11)
               .fillColor(isGrand ? '#111827' : '#1f2937')
               .text(label, totalsX + 12, doc.y + (isGrand ? 10 : 8), { width: 140 });
            doc.text(value, totalsX + 160, doc.y - (isGrand ? 0 : 0), { width: 80, align: 'right' });
            doc.moveTo(totalsX + 12, doc.y + 6).lineTo(totalsX + totalsBoxW - 12, doc.y + 6).strokeColor('#f3f4f6').stroke();
        };

        doc.moveTo(totalsX, totalsY).strokeColor('#e5e7eb');
        doc.y = totalsY + 6;
        line('Subtotal', toCurrency(displaySubtotal));
        if (discount > 0) line('Offer Discount', `-${toCurrency(discount)}`);
        if (couponDiscount > 0) line(`Coupon Discount${order.couponCode ? ' (' + order.couponCode + ')' : ''}`, `-${toCurrency(couponDiscount)}`);
        line('Tax', toCurrency(tax));
        if (shipping > 0) line('Shipping', toCurrency(shipping));
        line('Total', toCurrency(displayTotal), true);
        line('Payment Method', `${order.paymentMethod || 'Cash on Delivery'}`);

        
        let footerY = doc.page.height - 80;
        doc.fontSize(10).fillColor('#6b7280').text('This is a computer-generated invoice and does not require a signature.', 50, footerY, { width: 510, align: 'center' });
        doc.text('Thank you for shopping at BookHaven 📚', 50, doc.y + 4, { width: 510, align: 'center' });

        doc.end();

    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error");
    }
};


const cancelOrder = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Cancellation reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Order not found' });
    }

    const allowedStatuses = ['Placed', 'Processing', 'Partially Cancelled'];
    if (!allowedStatuses.includes(order.orderStatus)) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: `Order cannot be cancelled in ${order.orderStatus} status`
      });
    }

    const activeItems = order.items.filter(item => item.status === 'Active');
    if (activeItems.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'No active items found to cancel. All items have already been cancelled or returned.'
      });
    }

    order.orderStatus = 'Cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = reason;

    order.items.forEach(item => {
      if (item.status === 'Active') {
        item.status = 'Cancelled';
        item.cancelledAt = new Date();
        item.cancellationReason = reason;
      }
    });

    for (const item of order.items) {
      if (item.status === 'Cancelled') {
        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } }
        );
      }
    }

    if (order.paymentMethod === 'COD') {
      const wasDeliveredAndPaid = order.paymentStatus === 'Paid' ||
                                  order.orderStatus === 'Delivered' ||
                                  order.deliveredAt ||
                                  order.items.some(item =>
                                    item.status === 'Delivered' ||
                                    item.status === 'Returned' ||
                                    (item.status === 'Active' && order.orderStatus === 'Delivered')
                                  );

      if (wasDeliveredAndPaid) {
        const refundSuccess = await processCancelRefund(userId, order);
        if (refundSuccess) {
          order.paymentStatus = 'Refunded';
        } else {
          order.paymentStatus = 'Refund Failed';
        }
      } else {
        order.paymentStatus = 'Failed';
      }
    } else if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partially Refunded') {
      const refundSuccess = await processCancelRefund(userId, order);
      if (refundSuccess) {
        order.paymentStatus = 'Refunded';
      } else {
        order.paymentStatus = 'Refund Failed';
      }
    } else {
      order.paymentStatus = 'Failed';
    }

    await order.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Order cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const cancelOrderItem = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const productId = req.params.productId;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Cancellation reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Order not found' });
    }

    const orderItem = order.items.find(item =>
      item.product.toString() === productId && item.status === 'Active'
    );

    if (!orderItem) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Item not found or already cancelled' });
    }

    const allowedStatuses = ['Placed', 'Processing', 'Partially Cancelled'];
    if (!allowedStatuses.includes(order.orderStatus)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: `Items cannot be cancelled when order is in ${order.orderStatus} status`
      });
    }

    // **NEW: Validate coupon conditions before allowing partial cancellation**
    const couponValidation = await validateCouponAfterItemCancellation(order, productId);
    
    if (!couponValidation.success) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: couponValidation.message
      });
    }

    if (!couponValidation.allowPartialCancellation) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: couponValidation.message,
        requiresFullCancellation: true,
        couponCode: couponValidation.couponCode,
        minOrderAmount: couponValidation.minOrderAmount
      });
    }

    orderItem.status = 'Cancelled';
    orderItem.cancelledAt = new Date();
    orderItem.cancellationReason = reason;

    const hasActiveItems = order.items.some(item => item.status === 'Active');
    const hasCancelledItems = order.items.some(item => item.status === 'Cancelled');
    const hasReturnedItems = order.items.some(item => item.status === 'Returned');
    const hasReturnRequestedItems = order.items.some(item => item.status === 'Return Requested');

    if (!hasActiveItems && !hasReturnRequestedItems) {
      if (hasReturnedItems && hasCancelledItems) {
        order.orderStatus = 'Partially Returned'; 
      } else if (hasReturnedItems) {
        order.orderStatus = 'Returned';
      } else if (hasCancelledItems) {
        order.orderStatus = 'Cancelled';
      }
    } else if (hasCancelledItems || hasReturnedItems) {
      if (hasCancelledItems && hasReturnedItems) {
        order.orderStatus = 'Partially Returned'; 
      } else if (hasCancelledItems) {
        order.orderStatus = 'Partially Cancelled';
      } else if (hasReturnedItems) {
        order.orderStatus = 'Partially Returned';
      }
    }

    await Product.findByIdAndUpdate(
      productId,
      { $inc: { stock: orderItem.quantity } }
    );

    if (order.paymentMethod === 'COD') {
      const wasDeliveredAndPaid = order.paymentStatus === 'Paid' ||
                                  order.orderStatus === 'Delivered' ||
                                  order.deliveredAt ||
                                  order.items.some(item =>
                                    item.status === 'Delivered' ||
                                    item.status === 'Returned' ||
                                    (item.status === 'Active' && order.orderStatus === 'Delivered')
                                  );

      if (wasDeliveredAndPaid) {
        const refundSuccess = await processCancelRefund(userId, order, productId);

        if (refundSuccess) {
          if (!hasActiveItems) {
            order.paymentStatus = 'Refunded';
          } else {
            order.paymentStatus = 'Partially Refunded';
          }
        } else {
          order.paymentStatus = 'Refund Failed';
        }
      } else {
        if (!hasActiveItems) {
          order.paymentStatus = 'Failed'; 
        }
        
      }
    } else if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partially Refunded') {
      const refundSuccess = await processCancelRefund(userId, order, productId);

      if (refundSuccess) {
        if (!hasActiveItems) {
          order.paymentStatus = 'Refunded';
        } else {
          order.paymentStatus = 'Partially Refunded';
        }
      } else {
        order.paymentStatus = 'Refund Failed';
      }
    }

    await order.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Item cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling order item:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};



const returnOrder = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Return reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Order not found' });
    }

    if (order.orderStatus !== 'Delivered' &&
        order.orderStatus !== 'Partially Cancelled' &&
        order.orderStatus !== 'Partially Returned') {
      return res.status(401).json({
        success: false,
        message: `Order cannot be returned in ${order.orderStatus} status. Only delivered orders can be returned.`
      });
    }

    const deliveredDate = order.deliveredAt;
    if (!deliveredDate) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Order must be delivered before it can be returned.'
      });
    }

    const returnPeriod = 7 * 24 * 60 * 60 * 1000; 
    const daysSinceDelivery = Math.floor((Date.now() - deliveredDate.getTime()) / (24 * 60 * 60 * 1000));

    if (Date.now() - deliveredDate.getTime() > returnPeriod) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: `Return period has expired. Returns are only allowed within 7 days of delivery. Your order was delivered ${daysSinceDelivery} days ago.`
      });
    }

    const activeItems = order.items.filter(item => item.status === 'Active');
    if (activeItems.length === 0) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'No active items found to return. All items have already been cancelled or returned.'
      });
    }

    order.orderStatus = 'Return Requested';
    order.returnReason = reason;
    order.returnRequestedAt = new Date();

    let hasNonActiveItems = false;
    order.items.forEach(item => {
      if (item.status === 'Active') {
        item.status = 'Return Requested';
        item.returnReason = reason;
        item.returnRequestedAt = new Date();
      } else {
        hasNonActiveItems = true;
      }
    });

    if (hasNonActiveItems) {
      order.orderStatus = 'Partially Return Requested';
    }

    await order.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Return request submitted successfully. Our team will review your request.'
    });
  } catch (error) {
    console.error('Error processing return request:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};



const returnOrderItem = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const productId = req.params.productId;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(HttpStatus.UNAUTHORIZED).json({ success: false, message: 'Return reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Order not found' });
    }

    if (order.orderStatus !== 'Delivered' &&
        order.orderStatus !== 'Partially Cancelled' &&
        order.orderStatus !== 'Partially Returned') {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: `Items cannot be returned when order is in ${order.orderStatus} status. Only delivered orders can be returned.`
      });
    }

    const deliveredDate = order.deliveredAt;
    if (!deliveredDate) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: 'Order must be delivered before items can be returned.'
      });
    }

    const returnPeriod = 7 * 24 * 60 * 60 * 1000; 
    const daysSinceDelivery = Math.floor((Date.now() - deliveredDate.getTime()) / (24 * 60 * 60 * 1000));

    if (Date.now() - deliveredDate.getTime() > returnPeriod) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: `Return period has expired. Returns are only allowed within 7 days of delivery. Your order was delivered ${daysSinceDelivery} days ago.`
      });
    }

    const orderItem = order.items.find(item => item.product.toString() === productId);

    if (!orderItem) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'Product not found in this order' });
    }

    if (orderItem.status !== 'Active') {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: `This item is already ${orderItem.status.toLowerCase()}`
      });
    }

    // **NEW: Validate coupon conditions before allowing partial return**
    const couponValidation = await validateCouponAfterItemReturn(order, productId);
    
    if (!couponValidation.success) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: couponValidation.message
      });
    }

    if (!couponValidation.allowPartialReturn) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: couponValidation.message,
        requiresFullReturn: true,
        couponCode: couponValidation.couponCode,
        minOrderAmount: couponValidation.minOrderAmount
      });
    }

    orderItem.status = 'Return Requested';
    orderItem.returnReason = reason;
    orderItem.returnRequestedAt = new Date();

    const hasActiveItems = order.items.some(item => item.status === 'Active');
    const hasReturnRequestedItems = order.items.some(item => item.status === 'Return Requested');
    const hasCancelledItems = order.items.some(item => item.status === 'Cancelled');
    const hasReturnedItems = order.items.some(item => item.status === 'Returned');

    if (!hasActiveItems && hasReturnRequestedItems && !hasCancelledItems && !hasReturnedItems) {
      order.orderStatus = 'Return Requested';
    } else if (hasReturnRequestedItems && (hasActiveItems || hasCancelledItems || hasReturnedItems)) {
      order.orderStatus = 'Partially Return Requested';
    }

    await order.save();

    return res.status(HttpStatus.OK).json({
      success: true,
      message: 'Return request submitted successfully. Our team will review your request.'
    });
  } catch (error) {
    console.error('Error processing item return request:', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


module.exports = {
    getOrders,
    getOrderDetails,
    getOrderSuccess,
    viewInvoice,
    downloadInvoice,
    cancelOrder,
    cancelOrderItem,
    returnOrder,
    returnOrderItem
};