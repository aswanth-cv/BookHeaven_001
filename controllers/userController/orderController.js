const Order = require("../../models/orderSchema");
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Cart = require("../../models/cartSchema"); // Added Cart import
const path = require('path');
const mongoose = require("mongoose");
const PDFDocument = require('pdfkit');


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
      return res.status(HttpStatus.BAD_REQUEST).render('error', { message: 'Invalid order ID' });
    }

    const order = await Order.findById(orderId).populate('items.product');
    if (!order || order.user.toString() !== userId.toString()) {
      return res.status(HttpStatus.NOT_FOUND).render('error', { message: 'Order not found' });
    }

    order.formattedDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    order.items.forEach(item => {
      item.originalPrice = item.price;
      item.formattedPrice = `₹${item.price.toFixed(2)}`;
      item.finalPrice = item.price;
      item.formattedFinalPrice = `₹${item.finalPrice.toFixed(2)}`;

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

    const subtotal = order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = order.tax || 0;
    const total = subtotal + tax;

    order.formattedSubtotal = `₹${subtotal.toFixed(2)}`;
    order.formattedTax = `₹${tax.toFixed(2)}`;
    order.formattedTotal = `₹${total.toFixed(2)}`;

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
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).render('error', { message: 'Error fetching order details' });
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
      return res.status(404).json({
        message: 'Order not found or you do not have access to this order',
        isAuthenticated: true
      });
    }

    const user = await User.findById(userId, 'fullName email profileImage').lean();
    if (!user) {
      return res.redirect('/login');
    }

    const totalOfferDiscount = order.items.reduce((sum, item) => {
      return sum + (item.priceBreakdown?.offerDiscount || 0);
    }, 0);

    const totalCouponDiscount = order.items.reduce((sum, item) => {
      return sum + (item.priceBreakdown?.couponDiscount || 0);
    }, 0);

    res.render('order-success', {
      orderNumber: order.orderNumber,
      orderId: order._id,
      paymentMethod: order.paymentMethod,
      subtotal: order.subtotal,
      offerDiscount: totalOfferDiscount,
      couponDiscount: totalCouponDiscount,
      couponCode: order.couponCode,
      tax: order.tax,
      total: order.total,
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
    res.status(500).render('error', {
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
      return res.status(404).render('error', {
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

    let recalculatedSubtotal = 0;
    order.items.forEach(item => {
      if (item.priceBreakdown) {
        recalculatedSubtotal += item.priceBreakdown.subtotal || (item.price * item.quantity);
      } else {
        recalculatedSubtotal += item.price * item.quantity;
      }
    });

    const useStoredSubtotal = order.subtotal && Math.abs(order.subtotal - recalculatedSubtotal) < 0.01;
    const displaySubtotal = useStoredSubtotal ? order.subtotal : recalculatedSubtotal;

    const correctTotal = displaySubtotal - (order.discount || 0) - (order.couponDiscount || 0) + (order.tax || 0);
    const useStoredTotal = order.total && Math.abs(order.total - correctTotal) < 0.01;
    const displayTotal = useStoredTotal ? order.total : correctTotal;

    order.formattedSubtotal = `₹${displaySubtotal.toFixed(2)}`;
    order.formattedTotal = `₹${displayTotal.toFixed(2)}`;
    order.formattedTax = `₹${(order.tax || 0).toFixed(2)}`;
    order.formattedDiscount = `₹${(order.discount || 0).toFixed(2)}`;
    order.formattedCouponDiscount = `₹${(order.couponDiscount || 0).toFixed(2)}`;

    order.total = displayTotal;

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
    res.status(500).render('error', {
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
            return res.status(404).send("Order not found");
        }

        const subtotal = order.items.reduce((acc, item) => acc + item.quantity * item.price, 0);
        const shipping = order.shippingCharge || 0;
        const discount = order.discount || 0;
        const total = subtotal + shipping - discount;

        const doc = new PDFDocument({ margin: 50 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=invoice-${orderId}.pdf`
        );

        doc.pipe(res);

        doc.fontSize(20).text("Invoice", { align: "center" });
        doc.moveDown();

        doc.fontSize(12).text(`Invoice ID: ${order._id}`);
        doc.text(`Date: ${order.createdAt.toLocaleDateString()}`);
        doc.text(`Customer: ${order.user.name}`);
        doc.text(`Email: ${order.user.email}`);
        doc.moveDown();

        doc.fontSize(14).text("Items", { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(12);
        doc.text("Product", 50, doc.y);
        doc.text("Qty", 250, doc.y);
        doc.text("Price", 300, doc.y);
        doc.text("Total", 400, doc.y);
        doc.moveDown();

        order.items.forEach(item => {
            doc.text(item.product.name, 50, doc.y);
            doc.text(item.quantity.toString(), 250, doc.y);
            doc.text(item.price.toFixed(2), 300, doc.y);
            doc.text((item.quantity * item.price).toFixed(2), 400, doc.y);
            doc.moveDown();
        });

        doc.moveDown();
        doc.text(`Subtotal: ₹${subtotal.toFixed(2)}`, { align: "right" });
        doc.text(`Shipping: ₹${shipping.toFixed(2)}`, { align: "right" });
        doc.text(`Discount: -₹${discount.toFixed(2)}`, { align: "right" });
        doc.moveDown(0.5);
        doc.fontSize(14).text(`Total: ₹${total.toFixed(2)}`, { align: "right" });

        doc.end();

    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).send("Internal Server Error");
    }
};


const cancelOrder = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(401).json({ success: false, message: 'Cancellation reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const allowedStatuses = ['Placed', 'Processing', 'Partially Cancelled'];
    if (!allowedStatuses.includes(order.orderStatus)) {
      return res.status(401).json({
        success: false,
        message: `Order cannot be cancelled in ${order.orderStatus} status`
      });
    }

    const activeItems = order.items.filter(item => item.status === 'Active');
    if (activeItems.length === 0) {
      return res.status(401).json({
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

    return res.status(200).json({
      success: true,
      message: 'Order cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};


const cancelOrderItem = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const productId = req.params.productId;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const orderItem = order.items.find(item =>
      item.product.toString() === productId && item.status === 'Active'
    );

    if (!orderItem) {
      return res.status(404).json({ success: false, message: 'Item not found or already cancelled' });
    }


    const allowedStatuses = ['Placed', 'Processing', 'Partially Cancelled'];
    if (!allowedStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: `Items cannot be cancelled when order is in ${order.orderStatus} status`
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

    return res.status(200).json({
      success: true,
      message: 'Item cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling order item:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};



const returnOrder = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Return reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
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
      return res.status(401).json({
        success: false,
        message: 'Order must be delivered before it can be returned.'
      });
    }

    const returnPeriod = 7 * 24 * 60 * 60 * 1000; 
    const daysSinceDelivery = Math.floor((Date.now() - deliveredDate.getTime()) / (24 * 60 * 60 * 1000));

    if (Date.now() - deliveredDate.getTime() > returnPeriod) {
      return res.status(401).json({
        success: false,
        message: `Return period has expired. Returns are only allowed within 7 days of delivery. Your order was delivered ${daysSinceDelivery} days ago.`
      });
    }

    const activeItems = order.items.filter(item => item.status === 'Active');
    if (activeItems.length === 0) {
      return res.status(401).json({
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

    return res.status(200).json({
      success: true,
      message: 'Return request submitted successfully. Our team will review your request.'
    });
  } catch (error) {
    console.error('Error processing return request:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};



const returnOrderItem = async (req, res) => {
  try {
    if (!req.session.user_id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.session.user_id;
    const orderId = req.params.id;
    const productId = req.params.productId;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
      return res.status(401).json({ success: false, message: 'Return reason is required' });
    }

    const order = await Order.findOne({
      _id: orderId,
      user: userId,
      isDeleted: false
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.orderStatus !== 'Delivered' &&
        order.orderStatus !== 'Partially Cancelled' &&
        order.orderStatus !== 'Partially Returned') {
      return res.status(401).json({
        success: false,
        message: `Items cannot be returned when order is in ${order.orderStatus} status. Only delivered orders can be returned.`
      });
    }

    const deliveredDate = order.deliveredAt;
    if (!deliveredDate) {
      return res.status(401).json({
        success: false,
        message: 'Order must be delivered before items can be returned.'
      });
    }

    const returnPeriod = 7 * 24 * 60 * 60 * 1000; 
    const daysSinceDelivery = Math.floor((Date.now() - deliveredDate.getTime()) / (24 * 60 * 60 * 1000));

    if (Date.now() - deliveredDate.getTime() > returnPeriod) {
      return res.status(401).json({
        success: false,
        message: `Return period has expired. Returns are only allowed within 7 days of delivery. Your order was delivered ${daysSinceDelivery} days ago.`
      });
    }

    const orderItem = order.items.find(item => item.product.toString() === productId);

    if (!orderItem) {
      return res.status(404).json({ success: false, message: 'Product not found in this order' });
    }

    if (orderItem.status !== 'Active') {
      return res.status(401).json({
        success: false,
        message: `This item is already ${orderItem.status.toLowerCase()}`
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

    return res.status(200).json({
      success: true,
      message: 'Return request submitted successfully. Our team will review your request.'
    });
  } catch (error) {
    console.error('Error processing item return request:', error);
    return res.status(500).json({
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
    cancelOrder
};