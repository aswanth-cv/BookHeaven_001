const Order = require("../../models/orderSchema");
const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");

const { processReturnRefund } = require("../../controllers/userController/walletController");
const { calculateExactRefundAmount } = require("../../helpers/money-calculator");


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

    // Search by order number, payment method, or customer name
    const q = (req.query.q || '').trim()
    if (q) {
      const userMatches = await User.find({ fullName: { $regex: q, $options: 'i' } }, { _id: 1 }).lean()
      const userIds = userMatches.map(u => u._id)
      query.$or = [
        { orderNumber: { $regex: q, $options: 'i' } },
        { paymentMethod: { $regex: q, $options: 'i' } },
        { user: { $in: userIds } }
      ]
    }

    // Sorting
    const sortBy = (req.query.sortBy || 'date').toLowerCase()
    const sortOrder = (req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1
    const sortFieldMap = {
      date: 'createdAt',
      total: 'total',
      ordernumber: 'orderNumber'
    }
    const sortField = sortFieldMap[sortBy] || 'createdAt'
    const sortOptions = { [sortField]: sortOrder }

    const totalOrders = await Order.countDocuments(query)

    const orders = await Order.find(query)
      .populate("user", "fullName")
      .sort(sortOptions) 
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
      
      // Calculate current order value (excluding cancelled/returned items)
      let currentOrderValue = 0;
      let totalRefunded = 0;
      let hasAnyCancellations = false;
      
      if (order.items && order.items.length > 0) {
        order.items.forEach(item => {
          const isItemCancelled = (item.status === 'Cancelled' || item.status === 'Returned');
          
          if (isItemCancelled) {
            hasAnyCancellations = true;
          }
          
          if (!isItemCancelled) {
            // Add active item value
            if (item.priceBreakdown && item.priceBreakdown.finalPrice) {
              currentOrderValue += item.priceBreakdown.finalPrice;
            } else {
              const itemPrice = item.discountedPrice || item.price;
              currentOrderValue += itemPrice * item.quantity;
            }
          } else {
            // Calculate refunded amount (simplified)
            if (item.priceBreakdown && item.priceBreakdown.finalPrice) {
              totalRefunded += item.priceBreakdown.finalPrice;
            } else {
              const itemPrice = item.discountedPrice || item.price;
              totalRefunded += itemPrice * item.quantity;
            }
          }
        });
        
        // Add tax and shipping to current value only if there are active items
        if (currentOrderValue > 0) {
          // For partially cancelled orders, calculate proportional tax
          if (hasAnyCancellations) {
            const originalItemsValue = currentOrderValue + totalRefunded;
            const activeProportion = originalItemsValue > 0 ? currentOrderValue / originalItemsValue : 1;
            currentOrderValue += ((order.tax || 0) * activeProportion) + (order.shipping || 0);
          } else {
            currentOrderValue += (order.tax || 0) + (order.shipping || 0);
          }
        }
      } else {
        // Fallback to original total if no items data
        currentOrderValue = order.total;
      }
      
      // Show current order value instead of original total
      order.currentTotal = currentOrderValue;
      order.formattedTotal = `₹${currentOrderValue.toFixed(2)}`;
      order.formattedOriginalTotal = `₹${order.total.toFixed(2)}`;
      order.hasPartialCancellation = hasAnyCancellations;
      order.formattedRefunded = totalRefunded > 0 ? `₹${totalRefunded.toFixed(2)}` : null;
      
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
      q: q || "",
      sortBy: req.query.sortBy || 'date',
      sortOrder: req.query.sortOrder || 'desc',
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

    // Calculate totals properly accounting for cancelled/returned items
    const totals = {
      originalSubtotal: 0,      // Original subtotal of all items
      activeSubtotal: 0,        // Subtotal of only active items
      offerDiscount: 0,         // Total offer discounts on active items
      couponDiscount: 0,        // Total coupon discounts on active items
      tax: Number(order.tax || 0),
      shipping: Number(order.shipping || 0),
      totalRefunded: 0,         // Total amount refunded for cancelled/returned items
      currentOrderValue: 0      // Current value of active items only
    };

    let hasAnyCancellations = false;

    // Calculate totals for all items
    order.items.forEach(item => {
      // Check if this item is cancelled or returned
      const isItemCancelled = (item.status === 'Cancelled' || item.status === 'Returned');
      if (isItemCancelled) {
        hasAnyCancellations = true;
      }

      if (item.priceBreakdown) {
        // Add to original totals (all items)
        totals.originalSubtotal += item.totalOriginalPrice;
        
        // Only add to active totals if item is not cancelled/returned
        if (!isItemCancelled) {
          totals.activeSubtotal += item.totalOriginalPrice;
          totals.offerDiscount += item.totalOfferSavings;
          totals.couponDiscount += item.totalCouponSavings;
          totals.currentOrderValue += item.totalFinalPrice;
        }

        // Add refund amounts for cancelled/returned items
        if (isItemCancelled && item.refundAmount && item.refundAmount > 0) {
          totals.totalRefunded += item.refundAmount;
        }
      } else {
        // Fallback for items without priceBreakdown
        totals.originalSubtotal += item.totalOriginalPrice;
        
        if (!isItemCancelled) {
          totals.activeSubtotal += item.totalOriginalPrice;
          totals.offerDiscount += (item.totalOriginalPrice - item.totalDiscountedPrice);
          totals.currentOrderValue += item.totalDiscountedPrice;
        }

        if (isItemCancelled && item.refundAmount && item.refundAmount > 0) {
          totals.totalRefunded += item.refundAmount;
        }
      }
    });

    // Calculate current order total (active items + tax + shipping)
    // For partially cancelled orders, we need to proportionally calculate tax
    let currentTax = totals.tax;
    let currentShipping = totals.shipping;
    
    if (hasAnyCancellations && totals.originalSubtotal > 0) {
      // Calculate proportional tax based on active items
      const activeProportion = totals.currentOrderValue / (totals.originalSubtotal - (order.discount || 0) - (order.couponDiscount || 0));
      currentTax = totals.tax * activeProportion;
      // Shipping is usually fixed, but you might want to adjust this logic
      currentShipping = totals.shipping; // Keep full shipping for now
    }

    const currentOrderTotal = totals.currentOrderValue + currentTax + currentShipping;

    // Use stored values for display consistency, but show current values for active items
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

    // Set order totals for display
    order.originalTotal = displayTotal;  // Original order total
    order.currentTotal = hasAnyCancellations ? currentOrderTotal : displayTotal;  // Current active order total
    order.total = displayTotal; // Keep original for compatibility

    // Format all totals for display
    order.formattedOriginalSubtotal = `₹${displaySubtotal.toFixed(2)}`;
    order.formattedActiveSubtotal = `₹${totals.activeSubtotal.toFixed(2)}`;
    order.formattedSubtotal = `₹${displaySubtotal.toFixed(2)}`;
    order.formattedOfferDiscount = totals.offerDiscount > 0 ? `₹${totals.offerDiscount.toFixed(2)}` : null;
    order.formattedCouponDiscount = totals.couponDiscount > 0 ? `₹${totals.couponDiscount.toFixed(2)}` : null;
    order.formattedTax = `₹${totals.tax.toFixed(2)}`;
    order.formattedCurrentTax = `₹${currentTax.toFixed(2)}`;
    order.formattedShipping = totals.shipping > 0 ? `₹${totals.shipping.toFixed(2)}` : 'Free';
    order.formattedOriginalTotal = `₹${displayTotal.toFixed(2)}`;
    order.formattedCurrentTotal = `₹${currentOrderTotal.toFixed(2)}`;
    order.formattedTotal = hasAnyCancellations ? `₹${currentOrderTotal.toFixed(2)}` : `₹${displayTotal.toFixed(2)}`;
    order.formattedTotalRefunded = totals.totalRefunded > 0 ? `₹${totals.totalRefunded.toFixed(2)}` : null;
    order.formattedNetAmount = `₹${(displayTotal - totals.totalRefunded).toFixed(2)}`;

    // Add summary data for the view
    order.totals = totals;
    order.hasPartialCancellation = hasAnyCancellations;
    order.currentOrderValue = currentOrderTotal;

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

const approveReturnRequest = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { itemId, approved } = req.body;

    const order = await Order.findById(orderId);
    if (!order || order.isDeleted) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (itemId) {
      const item = order.items.id(itemId);
      if (!item) {
        return res.status(404).json({ message: "Item not found in order" });
      }

      if (item.status !== 'Return Requested') {
        return res.status(400).json({
          message: `Cannot process return for item with status ${item.status}`
        });
      }

      const now = new Date();

      if (approved) {
        item.status = 'Returned';
        item.returnedAt = now;

        await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } }
        );

        if (order.paymentStatus === 'Paid') {
          const refundSuccess = await processReturnRefund(order.user, order, itemId);
          if (refundSuccess) {
            const allItemsRefunded = order.items.every(i =>
              i.status === 'Returned' || i.status === 'Cancelled'
            );
            order.paymentStatus = allItemsRefunded ? 'Refunded' : 'Partially Refunded';
          } else {
            order.paymentStatus = 'Refund Processing';
          }
        } else {
        }
      } else {
        item.status = 'Active';
        item.returnRequestedAt = null;
        item.returnReason = null;
      }

      const hasActiveItems = order.items.some(i => i.status === 'Active');
      const hasReturnRequestedItems = order.items.some(i => i.status === 'Return Requested');
      const hasCancelledItems = order.items.some(i => i.status === 'Cancelled');
      const hasReturnedItems = order.items.some(i => i.status === 'Returned');

      if (!hasActiveItems && !hasReturnRequestedItems) {
        if (hasReturnedItems && !hasCancelledItems) {
          order.orderStatus = 'Returned';
        } else if (hasCancelledItems && !hasReturnedItems) {
          order.orderStatus = 'Cancelled';
        } else {
          order.orderStatus = 'Delivered';
        }
      } else if (hasReturnRequestedItems) {

      } else {
        order.orderStatus = 'Delivered';
      }

      await order.save();
      return res.status(200).json({
        message: approved ? "Return request approved" : "Return request rejected",
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus
      });
    }

    if (order.orderStatus !== 'Return Requested') {
      return res.status(401).json({
        message: `Cannot process return for order with status ${order.orderStatus}`
      });
    }

    const now = new Date();

    if (approved) {
      for (const item of order.items) {
        if (item.status === 'Return Requested') {
          item.status = 'Returned';
          item.returnedAt = now;

          try {
            await Product.findByIdAndUpdate(
              item.product,
              { $inc: { stock: item.quantity } }
            );
          } catch (error) {
            console.error('Error restoring stock:', error);
          }
        }
      }

      const hasActiveItems = order.items.some(i => i.status === 'Active');
      order.orderStatus = hasActiveItems ? 'Delivered' : 'Returned';

      if (order.paymentStatus === 'Paid') {
        const refundSuccess = await processReturnRefund(order.user, order);
        if (refundSuccess) {
          order.paymentStatus = hasActiveItems ? 'Partially Refunded' : 'Refunded';
        } else {
          console.error(`Failed to process refund for returned items in order ${order._id}`);
        }
      }

      order.returnedAt = now;
    } else {
      order.items.forEach(item => {
        if (item.status === 'Return Requested') {
          item.status = 'Active';
          item.returnRequestedAt = null;
          item.returnReason = null;
        }
      });

      order.orderStatus = 'Delivered';
    }

    await order.save();

    return res.status(200).json({
      message: approved ? "All return requests approved" : "All return requests rejected",
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus
    });
  } catch (error) {
    console.error("Error processing return request:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};



module.exports = {
    getManageOrders,
    updateOrderStatus,
    updateItemStatus,
    getOrderDetails,
    approveReturnRequest
}