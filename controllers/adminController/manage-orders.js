const Order = require("../../models/orderSchema");
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");


const getManageOrders = async (req, res) => {
  try {
    
    const page = Number.parseInt(req.query.page) || 1
    const limit = 10 
    const skip = (page - 1) * limit

   
    const query = { isDeleted: false }

    const validStatuses = ["Placed", "Processing", "Shipped", "Delivered", "Cancelled", "Returned"]
    let status = req.query.status || ""
    if (status === "Pending") status = "Placed"
    if (status && validStatuses.includes(status)) {
      query.orderStatus = status
    }

    const validPaymentMethods = ["COD", "UPI", "Card", "Wallet"]
    let payment = req.query.payment || ""
    if (payment === "CARD") payment = "Card"
    if (payment === "UPI") payment = "UPI"
    if (payment && validPaymentMethods.includes(payment)) {
      query.paymentMethod = payment
    }

    const minAmount = Number.parseFloat(req.query.min_amount) || 0
    const maxAmount = Number.parseFloat(req.query.max_amount) || Number.POSITIVE_INFINITY
    if (minAmount > 0 || maxAmount < Number.POSITIVE_INFINITY) {
      query.total = {}
      if (minAmount > 0) query.total.$gte = minAmount
      if (maxAmount < Number.POSITIVE_INFINITY) query.total.$lte = maxAmount
    }

    const startDate = req.query.start_date ? new Date(req.query.start_date) : null
    const endDate = req.query.end_date ? new Date(req.query.end_date) : null
    if (startDate && !isNaN(startDate)) {
      query.createdAt = query.createdAt || {}
      query.createdAt.$gte = startDate
    }
    if (endDate && !isNaN(endDate)) {
      endDate.setHours(23, 59, 59, 999)
      query.createdAt = query.createdAt || {}
      query.createdAt.$lte = endDate
    }

    const totalOrders = await Order.countDocuments(query)

    const orders = await Order.find(query)
      .populate("user", "fullName")
      .sort({ createdAt: -1 }) 
      .skip(skip)
      .limit(limit)
      .lean()

    const totalPages = Math.ceil(totalOrders / limit)

    orders.forEach((order) => {
      order.formattedDate = new Date(order.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
      order.formattedTotal = `₹${order.total.toFixed(2)}`
      order.customerName = order.user ? order.user.fullName : "Unknown"
    })

    const pagination = {
      currentPage: page,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page - 1,
      nextPage: page + 1,
      pages: Array.from({ length: totalPages }, (_, i) => i + 1),
    }

    const filters = {
      status: status || "",
      payment: payment || "",
      min_amount: req.query.min_amount || "",
      max_amount: req.query.max_amount || "",
      start_date: req.query.start_date || "",
      end_date: req.query.end_date || "",
    }

    res.render("manage-orders", {
      orders,
      pagination,
      title: "Manage Orders",
      filters,
    })
  } catch (error) {
    console.error("Error fetching orders:", error)
    res.redirect('/admin/dashboard');
  }
}


const updateOrderStatus = async (req, res) => {
  try {
    const orderId = req.params.id
    const { status, itemId } = req.body

    const validStatuses = ["Placed", "Processing", "Shipped", "Delivered", "Cancelled", "Returned", "Return Requested"]
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" })
    }

    const order = await Order.findById(orderId)
    if (!order || order.isDeleted) {
      return res.status(404).json({ success: false, message: "Order not found" })
    }

    if (itemId) {
      const item = order.items.id(itemId);
      if (!item) {
        return res.status(404).json({ success: false, message: "Item not found in order" });
      }

      const itemStatusTransitions = {
        'Active': ['Cancelled', 'Returned'],
        'Cancelled': [],
        'Returned': []
      };

      const allowedItemStatuses = itemStatusTransitions[item.status] || [];
      if (!allowedItemStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot update item status from ${item.status} to ${status}`
        });
      }

      const now = new Date();
      item.status = status;

      if (status === 'Cancelled') {
        item.cancelledAt = now;
        item.cancellationReason = 'Cancelled by admin';

        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } }
        );
      } else if (status === 'Returned') {
        item.returnedAt = now;
        item.returnReason = 'Returned by admin';

        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } }
        );
      }

      const hasActiveItems = order.items.some(i => i.status === 'Active');
      const hasCancelledItems = order.items.some(i => i.status === 'Cancelled');
      const hasReturnedItems = order.items.some(i => i.status === 'Returned');

      if (!hasActiveItems) {
        if (hasReturnedItems && !hasCancelledItems) {
          order.orderStatus = 'Returned';
        } else if (hasCancelledItems && !hasReturnedItems) {
          order.orderStatus = 'Cancelled';
        } else if (hasReturnedItems && hasCancelledItems) {
          order.orderStatus = 'Partially Returned';
        }
      } else {
        if (hasReturnedItems && hasCancelledItems) {
          order.orderStatus = 'Partially Returned';
        } else if (hasReturnedItems) {
          order.orderStatus = 'Partially Returned';
        } else if (hasCancelledItems) {
          order.orderStatus = 'Partially Cancelled';
        }
      }

      await order.save();
      return res.status(200).json({ success: true, message: "Item status updated successfully" });
    }

   
    const statusTransitions = {
      Placed: ["Processing", "Cancelled"],
      Processing: ["Shipped", "Cancelled"],
      Shipped: ["Delivered"],
      "Partially Cancelled": ["Processing", "Shipped", "Delivered", "Cancelled"],
      Delivered: [], 
      Cancelled: [],
      Returned: [],
      "Partially Returned": [], 
      "Return Requested": [],
      "Partially Return Requested": [],
    }

    const allowedStatuses = statusTransitions[order.orderStatus] || []
    if (!allowedStatuses.includes(status)) {
      let errorMessage = '';

      if (order.orderStatus.includes('Return')) {
        errorMessage = `This order has return requests. Please use the Return Management page to handle returns.`;
      } else if (order.orderStatus === 'Delivered') {
        errorMessage = `This order has been delivered successfully. No further status updates are needed.`;
      } else if (['Cancelled', 'Returned', 'Partially Cancelled', 'Partially Returned'].includes(order.orderStatus)) {
        errorMessage = `Cannot update status from ${order.orderStatus} - this is a terminal state.`;
      } else {
        errorMessage = `Cannot transition from ${order.orderStatus} to ${status}. Allowed transitions: ${allowedStatuses.join(', ') || 'None'}`;
      }

      return res.status(400).json({
        success: false,
        message: errorMessage
      })
    }

    const now = new Date()
    order.orderStatus = status

    if (order.orderStatus === "Partially Cancelled" || order.orderStatus === "Partially Returned") {
      if (status === "Cancelled") {
        order.items.forEach((item) => {
          if (item.status === "Active") {
            item.status = "Cancelled"
            item.cancelledAt = now
            item.cancellationReason = "Cancelled by admin"

            Product.findByIdAndUpdate(
              item.product,
              { $inc: { stock: item.quantity } }
            ).catch(err => console.error("Error updating product stock:", err));
          }
        })
      }
    } else if (status === "Cancelled") {
      order.items.forEach((item) => {
        if (item.status === "Active") {
          item.status = "Cancelled"
          item.cancelledAt = now
          item.cancellationReason = "Cancelled by admin"

          Product.findByIdAndUpdate(
            item.product,
            { $inc: { stock: item.quantity } }
          ).catch(err => console.error("Error updating product stock:", err));
        }
      })
    }

    if (status === "Processing") {
      order.processedAt = now
    } else if (status === "Shipped") {
      order.shippedAt = now
      if (!order.processedAt) {
        order.processedAt = order.createdAt
      }
    } else if (status === "Delivered") {
      order.deliveredAt = now
      if (!order.processedAt) {
        order.processedAt = order.createdAt
      }
      if (!order.shippedAt) {
        order.shippedAt = new Date(order.createdAt.getTime() + 3 * 24 * 60 * 60 * 1000)
      }
      if (order.paymentMethod === "COD") {
        order.paymentStatus = "Paid"
      }
    } else if (status === "Cancelled") {
      order.cancelledAt = now
      if (order.paymentMethod === "COD") {
        order.paymentStatus = "Failed"
      } else if (order.paymentStatus === "Paid") {
        order.paymentStatus = "Refund Initiated" 
      } else if (order.paymentStatus === "Pending") {
        order.paymentStatus = "Failed" 
      }
    }

    await order.save()

    res.status(200).json({ success: true, message: "Order status updated successfully" })
  } catch (error) {
    console.error("Error updating order status:", error)
    res.status(500).json({ success: false, message: "Failed to update order status" })
  }
}


const updateItemStatus = async (req, res) => {
  try {
    const orderId = req.params.id;
    const itemId = req.params.itemId;
    const { status, reason } = req.body;

    const validStatuses = ["Cancelled", "Returned"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const order = await Order.findById(orderId);
    if (!order || order.isDeleted) {
      return res.status(404).json({ message: "Order not found" });
    }

    const item = order.items.id(itemId);
    if (!item) {
      return res.status(404).json({ message: "Item not found in order" });
    }

    if (item.status !== "Active") {
      return res.status(400).json({
        message: `Item cannot be ${status.toLowerCase()} in its current state (${item.status})`
      });
    }

    const now = new Date();
    item.status = status;

    if (status === "Cancelled") {
      item.cancelledAt = now;
      item.cancellationReason = reason || "Cancelled by admin";

      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity } }
      );
    } else if (status === "Returned") {
      item.returnedAt = now;
      item.returnReason = reason || "Returned by admin";

      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity } }
      );
    }

    const hasActiveItems = order.items.some(i => i.status === "Active");
    const hasCancelledItems = order.items.some(i => i.status === "Cancelled");
    const hasReturnedItems = order.items.some(i => i.status === "Returned");
    const hasReturnRequestedItems = order.items.some(i => i.status === "Return Requested");

    if (!hasActiveItems && !hasReturnRequestedItems) {
      if (hasReturnedItems && hasCancelledItems) {
        order.orderStatus = "Partially Returned"; 
      } else if (hasReturnedItems) {
        order.orderStatus = "Returned";
      } else if (hasCancelledItems) {
        order.orderStatus = "Cancelled";
      }
    } else if (hasCancelledItems || hasReturnedItems) {
      if (hasCancelledItems && hasReturnedItems) {
        order.orderStatus = "Partially Returned"; 
      } else if (hasCancelledItems) {
        order.orderStatus = "Partially Cancelled";
      } else if (hasReturnedItems) {
        order.orderStatus = "Partially Returned";
      }
    } else if (hasReturnRequestedItems && hasActiveItems) {
      order.orderStatus = "Partially Return Requested";
    } else if (hasReturnRequestedItems && !hasActiveItems) {
      order.orderStatus = "Return Requested";
    }

    if (status === "Cancelled" || status === "Returned") {
      if (order.paymentMethod === "COD") {
        const wasDeliveredAndPaid = order.paymentStatus === "Paid" ||
                                    order.orderStatus === "Delivered" ||
                                    order.deliveredAt ||
                                    order.items.some(item =>
                                      item.status === "Delivered" ||
                                      item.status === "Returned" ||
                                      (item.status === "Active" && order.orderStatus === "Delivered")
                                    );

        if (wasDeliveredAndPaid) {
          if (!hasActiveItems && !hasReturnRequestedItems) {
            order.paymentStatus = status === "Cancelled" ? "Refunded" : "Refunded";
          } else {
            order.paymentStatus = "Partially Refunded";
          }
        } else {
          if (!hasActiveItems && !hasReturnRequestedItems) {
            order.paymentStatus = "Failed"; 
          }
        }
      } else {
        if (order.paymentStatus === "Paid" || order.paymentStatus === "Partially Refunded") {
          if (!hasActiveItems && !hasReturnRequestedItems) {
            order.paymentStatus = "Refunded";
          } else {
            order.paymentStatus = "Partially Refunded";
          }
        } else if (order.paymentStatus === "Pending" && !hasActiveItems && !hasReturnRequestedItems) {
          order.paymentStatus = "Failed";
        }
      }
    }

    await order.save();

    res.status(200).json({
      message: `Item ${status.toLowerCase()} successfully`,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus
    });
  } catch (error) {
    console.error(`Error updating item status:`, error);
    res.status(500).json({ message: "Internal server error" });
  }
};


const getOrderDetails = async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId)
      .populate('user', 'fullName email phone address')
      .populate({
        path: 'items.product',
        select: 'title author isbn image price'
      })
      .lean();

    if (!order) {
      return res.redirect('/admin/getOrders');
    }

    order.formattedDate = new Date(order.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    order.items = order.items.map(item => {
      const originalPrice = Number(item.price);
      const quantity = Number(item.quantity || 1);

      if (item.priceBreakdown) {
        const breakdown = {
          originalPrice: Number(item.priceBreakdown.originalPrice),
          subtotal: Number(item.priceBreakdown.subtotal),
          offerDiscount: Number(item.priceBreakdown.offerDiscount || 0),
          priceAfterOffer: Number(item.priceBreakdown.priceAfterOffer),
          couponDiscount: Number(item.priceBreakdown.couponDiscount || 0),
          couponProportion: Number(item.priceBreakdown.couponProportion || 0),
          finalPrice: Number(item.priceBreakdown.finalPrice),
          offerTitle: item.priceBreakdown.offerTitle || ''
        };

        item.formattedOriginalPrice = `₹${breakdown.originalPrice.toFixed(2)}`;
        item.formattedPriceAfterOffer = `₹${breakdown.priceAfterOffer.toFixed(2)}`;
        item.formattedFinalPrice = `₹${breakdown.finalPrice.toFixed(2)}`;

        const finalPricePerUnit = breakdown.finalPrice;

        item.totalOriginalPrice = breakdown.originalPrice * quantity;
        item.totalPriceAfterOffer = breakdown.priceAfterOffer * quantity;
        item.totalFinalPrice = breakdown.finalPrice * quantity;
        item.totalOfferSavings = breakdown.offerDiscount * quantity;
        item.totalCouponSavings = breakdown.couponDiscount * quantity;

        item.formattedTotalOriginalPrice = `₹${item.totalOriginalPrice.toFixed(2)}`;
        item.formattedTotalFinalPrice = `₹${item.totalFinalPrice.toFixed(2)}`;

        if (breakdown.offerDiscount > 0) {
          const offerSavingPercent = (breakdown.offerDiscount / breakdown.originalPrice) * 100;
          item.offerSavingText = `Save ${offerSavingPercent.toFixed(0)}% with ${breakdown.offerTitle}`;
        }

        if (item.status === 'Cancelled' || item.status === 'Returned') {
          const shouldShowRefund = (
            (order.paymentMethod === 'COD' && order.orderStatus === 'Delivered' && item.status === 'Returned') ||
            (order.paymentMethod !== 'COD' && (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partially Refunded'))
          );

          if (shouldShowRefund) {
            item.refundAmount = calculateExactRefundAmount(item, order);
            item.formattedRefund = `₹${item.refundAmount.toFixed(2)}`;
            item.taxAmount = 0; 
            item.formattedTaxAmount = null;
          } else {
            item.refundAmount = 0;
            item.formattedRefund = null;
            item.taxAmount = 0;
            item.formattedTaxAmount = null;
          }
        }

      } else {
        const discountedPrice = Number(item.discountedPrice || item.price);

        item.formattedOriginalPrice = `₹${originalPrice.toFixed(2)}`;
        item.formattedDiscountedPrice = `₹${discountedPrice.toFixed(2)}`;

        item.totalOriginalPrice = originalPrice * quantity;
        item.totalDiscountedPrice = discountedPrice * quantity;

        item.formattedTotalOriginalPrice = `₹${item.totalOriginalPrice.toFixed(2)}`;
        item.formattedTotalDiscountedPrice = `₹${item.totalDiscountedPrice.toFixed(2)}`;

        if (originalPrice > discountedPrice) {
          const savingPercent = ((originalPrice - discountedPrice) / originalPrice) * 100;
          item.savingText = `Save ${savingPercent.toFixed(0)}%`;
        }

        if (item.status === 'Cancelled' || item.status === 'Returned') {
          const shouldShowRefund = (
            (order.paymentMethod === 'COD' && order.orderStatus === 'Delivered' && item.status === 'Returned') ||
            (order.paymentMethod !== 'COD' && (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partially Refunded'))
          );

          if (shouldShowRefund) {
            item.refundAmount = calculateExactRefundAmount(item, order);
            item.formattedRefund = `₹${item.refundAmount.toFixed(2)}`;
            item.taxAmount = 0; 
            item.formattedTaxAmount = null;
          } else {
            item.refundAmount = 0;
            item.formattedRefund = null;
            item.taxAmount = 0;
            item.formattedTaxAmount = null;
          }
        }
      }

      return item;
    });

    const totals = {
      subtotal: 0,
      offerDiscount: 0,
      couponDiscount: 0,
      tax: Number(order.tax || 0),
      shipping: Number(order.shipping || 0),
      totalRefunded: 0
    };

    order.items.forEach(item => {
      if (item.priceBreakdown) {
        totals.subtotal += item.totalOriginalPrice;
        totals.offerDiscount += item.totalOfferSavings;
        totals.couponDiscount += item.totalCouponSavings;

        if (item.status === 'Cancelled' || item.status === 'Returned') {
          if (item.refundAmount && item.refundAmount > 0) {
            totals.totalRefunded += item.refundAmount;
          }
        }
      } else {
        totals.subtotal += item.totalOriginalPrice;
        totals.offerDiscount += (item.totalOriginalPrice - item.totalDiscountedPrice);

        if (item.status === 'Cancelled' || item.status === 'Returned') {
          if (item.refundAmount && item.refundAmount > 0) {
            totals.totalRefunded += item.refundAmount;
          }
        }
      }
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

    order.total = displayTotal;

    order.formattedSubtotal = `₹${displaySubtotal.toFixed(2)}`;
    order.formattedOfferDiscount = totals.offerDiscount > 0 ? `₹${totals.offerDiscount.toFixed(2)}` : null;
    order.formattedCouponDiscount = totals.couponDiscount > 0 ? `₹${totals.couponDiscount.toFixed(2)}` : null;
    order.formattedTax = `₹${totals.tax.toFixed(2)}`;
    order.formattedShipping = totals.shipping > 0 ? `₹${totals.shipping.toFixed(2)}` : 'Free';
    order.formattedTotal = `₹${displayTotal.toFixed(2)}`;
    order.formattedTotalRefunded = totals.totalRefunded > 0 ? `₹${totals.totalRefunded.toFixed(2)}` : null;

    const hasActiveItems = order.items.some(item =>
      item.status !== 'Cancelled' && item.status !== 'Returned'
    );

    const hasReturnRequestedItems = order.items.some(item =>
      item.status === 'Return Requested'
    );

    const timeline = [];

    timeline.push({
      status: 'Order Placed',
      timestamp: new Date(order.createdAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      message: 'Order has been placed successfully',
      completed: true
    });

    if (order.processedAt || order.orderStatus === 'Processing') {
      timeline.push({
        status: 'Processing',
        timestamp: order.processedAt ? new Date(order.processedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'Pending',
        message: 'Order is being processed',
        completed: !!order.processedAt
      });
    }

    if (order.shippedAt || order.orderStatus === 'Shipped') {
      timeline.push({
        status: 'Shipped',
        timestamp: order.shippedAt ? new Date(order.shippedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'Pending',
        message: order.trackingId ? `Order shipped with tracking ID: ${order.trackingId}` : 'Order has been shipped',
        completed: !!order.shippedAt
      });
    }

    if (order.deliveredAt || order.orderStatus === 'Delivered') {
      timeline.push({
        status: 'Delivered',
        timestamp: order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : 'Pending',
        message: 'Order has been delivered',
        completed: !!order.deliveredAt
      });
    }

    if (order.orderStatus.includes('Cancelled') || order.orderStatus.includes('Returned')) {
      timeline.push({
        status: order.orderStatus,
        timestamp: (order.cancelledAt || order.returnedAt) ?
          new Date(order.cancelledAt || order.returnedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) : 'N/A',
        message: `Order has been ${order.orderStatus.toLowerCase()}`,
        completed: true,
        refundAmount: order.formattedTotalRefunded
      });
    }

    res.render('manage-order-details', {
      title: `Order #${order.orderNumber}`,
      order,
      hasActiveItems,
      hasReturnRequestedItems,
      timeline,
      customer: order.user || {}
    });

  } catch (error) {
    console.error('Error in getOrderDetails:', error);
    res.redirect('/admin/getOrders');
  }
};



module.exports = {
    getManageOrders,
    updateOrderStatus,
    updateItemStatus,
    getOrderDetails
}