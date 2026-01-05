const Order = require("../../models/orderSchema");
const Product = require("../../models/productSchema");
const { processReturnRefund } = require("../userController/walletController");
const { calculateExactRefundAmount } = require("../../helpers/money-calculator");


const calculateEstimatedRefund = (order) => {
  try {
    
    if (!order?.items?.length) {
      return { total: 0, base: 0, tax: 0, breakdown: [] };
    }

    const returnRequestedItems = order.items.filter(item => item.status === 'Return Requested');
    if (returnRequestedItems.length === 0) {
      return { total: 0, base: 0, tax: 0, breakdown: [] };
    }

    
    const isFullOrderReturn = returnRequestedItems.length === order.items.length;
    let totalRefund = 0;
    let totalBase = 0;
    let totalTax = 0;

   
    for (const item of returnRequestedItems) {
      totalRefund += calculateExactRefundAmount(item, order);
    }

    return {
      total: Number(totalRefund.toFixed(2)),
      itemCount: returnRequestedItems.length
    };
  } catch (error) {
    console.error('Error calculating estimated refund:', error.message);
    return { total: 0 };
  }
};


const getReturnRequests = async (req, res) => {
  try {
    
    const page = Number.parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    
    const query = {
      isDeleted: false,
      $or: [
        { orderStatus: 'Return Requested' },
        { 'items.status': 'Return Requested' }
      ]
    };

   
    const status = req.query.status || "";
    if (status === "pending") {
      query.orderStatus = 'Return Requested';
    } else if (status === "individual") {
      query.orderStatus = 'Delivered';
      query['items.status'] = 'Return Requested';
    }

    
    const totalOrders = await Order.countDocuments(query);

    
    const orders = await Order.find(query)
      .populate("user", "fullName email")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    
    const processedOrders = orders.map(order => {
      const returnRequestedItems = order.items.filter(item => item.status === 'Return Requested');

      
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

      
      const estimatedRefund = calculateEstimatedRefund(order);

      return {
        ...order,
        returnRequestedItems,
        returnRequestCount: returnRequestedItems.length,
        formattedDate: new Date(order.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
        formattedTotal: `₹${displayTotal.toFixed(2)}`,
        customerName: order.user ? order.user.fullName : "Unknown",
        customerEmail: order.user ? order.user.email : "N/A",
        hasIndividualReturns: returnRequestedItems.length > 0 && order.orderStatus === 'Delivered',
        hasFullOrderReturn: order.orderStatus === 'Return Requested',
        estimatedRefund: estimatedRefund 
      };
    });

    
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

    
    const filters = {
      status: status || "",
    };

   
    const errorMessage = req.session.errorMessage;
    delete req.session.errorMessage;

    
    res.render("admin/return-management", {
      orders: processedOrders,
      pagination,
      title: "Return Management",
      filters,
      totalReturnRequests: totalOrders,
      errorMessage
    });
  } catch (error) {
    console.error("Error fetching return requests:", error);
    res.redirect('/admin/dashboard');
  }
};


const getReturnRequestDetails = async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await Order.findById(orderId)
      .populate("user", "fullName email phone")
      .lean();

    if (!order || order.isDeleted) {
      return res.status(404).render('admin/page-404', {
        title: 'Return Request Not Found'
      });
    }

   
    const returnRequestedItems = order.items.filter(item => item.status === 'Return Requested');

    if (returnRequestedItems.length === 0) {
      
      req.session.errorMessage = 'No pending return requests found for this order.';
      return res.redirect('/admin/return-management');
    }

   
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

    order.formattedDate = new Date(order.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    order.formattedTotal = `₹${displayTotal.toFixed(2)}`;

    
    const estimatedRefund = calculateEstimatedRefund(order);
    const totalRefundAmount = estimatedRefund.total;

    res.render('admin/return-request-details', {
      title: `Return Request - Order #${order.orderNumber}`,
      order,
      returnRequestedItems,
      totalRefundAmount: totalRefundAmount.toFixed(2),
      customer: order.user || {}
    });

  } catch (error) {
    console.error('Error in getReturnRequestDetails:', error);
    res.redirect('/admin/return-management');
  }
};


const processReturnRequest = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { approved } = req.body;

    const order = await Order.findById(orderId);
    if (!order || order.isDeleted) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    
    const returnRequestedItems = order.items.filter(item => item.status === 'Return Requested');

    if (returnRequestedItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No return requests found for this order' });
    }

    const preHasActiveItems = order.items.some(i => i.status === 'Active');
    const preHasReturnRequestedItems = returnRequestedItems.length > 0;

    const now = new Date();
    console.log('Return requested items:', returnRequestedItems.map(i => ({ id: i._id?.toString(), product: i.product, qty: i.quantity })));

    const returnedItems = [];

    for (const item of returnRequestedItems) {
      if (approved) {
        item.status = 'Returned';
        item.returnedAt = now;
        item.returnRequestedAt = null;
        returnedItems.push(item);

        
        const prodUpdate = await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity } },
          { new: true }
        );
        if (!prodUpdate) {
          console.warn(`Product ${item.product} not found while restoring stock for returned item`);
        }
      } else {
        item.status = 'Active';
        item.returnRequestedAt = null;
        item.returnedAt = null;
        item.returnReason = null;
      }
    }

    order.markModified && order.markModified('items');

    
    const hasActiveItemsNow = order.items.some(i => i.status === 'Active');
    const hasReturnRequestedItemsNow = order.items.some(i => i.status === 'Return Requested');

    if (approved) {
      if (!hasActiveItemsNow && !hasReturnRequestedItemsNow) {
        order.orderStatus = 'Returned';
      } else if (!hasReturnRequestedItemsNow) {
        order.orderStatus = 'Delivered';
      }
    } else {
      if (!hasReturnRequestedItemsNow && !hasActiveItemsNow) {
        order.orderStatus = 'Returned';
      } else if (hasActiveItemsNow) {
        order.orderStatus = 'Delivered';
      }
    }

    if (approved) {
      console.log('Processing return refund for order:', orderId, {
        paymentStatus: order.paymentStatus,
        userId: order.user,
        returnedCount: returnedItems.length
      });

      let refundProcessed = false;

      if (order.paymentMethod === 'COD') {
        const wasDeliveredAndPaid = order.paymentStatus === 'Paid' ||
                                   order.orderStatus === 'Delivered' ||
                                   !!order.deliveredAt ||
                                   order.items.some(item =>
                                     item.status === 'Delivered' ||
                                     item.status === 'Returned' ||
                                     (item.status === 'Active' && order.orderStatus === 'Delivered')
                                   );

        if (wasDeliveredAndPaid) {
          try {
            const refundSuccess = await processReturnRefund(order.user, order, returnedItems);
            if (refundSuccess) {
              refundProcessed = true;
            } else {
              console.error('Failed to process COD return refund');
              return res.status(500).json({ success: false, message: 'Failed to process refund. Please try again.' });
            }
          } catch (err) {
            console.error('Error in processReturnRefund:', err);
            return res.status(500).json({ success: false, message: 'Refund processing error' });
          }
        } else {
          refundProcessed = true;
        }
      } else {
        try {
          const refundSuccess = await processReturnRefund(order.user, order, returnedItems);
          if (refundSuccess) refundProcessed = true;
          else {
            console.error('Failed to process online refund');
            return res.status(500).json({ success: false, message: 'Failed to process refund. Please try again.' });
          }
        } catch (err) {
          console.error('Error in processReturnRefund (online):', err);
          return res.status(500).json({ success: false, message: 'Refund processing error' });
        }
      }

      if (refundProcessed) {
        if (order.paymentMethod === 'COD' && order.paymentStatus !== 'Paid') {
          order.paymentStatus = 'Failed';
        } else if (hasActiveItemsNow) {
          order.paymentStatus = 'Partially Refunded';
        } else {
          order.paymentStatus = 'Refunded';
        }
      }
    }

    await order.save();

    return res.json({
      success: true,
      message: approved
        ? 'Return request approved and refund processed successfully'
        : 'Return request rejected successfully'
    });

  } catch (error) {
    console.error('Error processing return request:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};



const bulkProcessReturns = async (req, res) => {
  try {
    const { orderIds, action } = req.body; 

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No orders selected'
      });
    }

    const approved = action === 'approve';
    let processedCount = 0;
    let errors = [];

    for (const orderId of orderIds) {
      try {
        const order = await Order.findById(orderId);
        if (!order) continue;

        const returnRequestedItems = order.items.filter(item => item.status === 'Return Requested');

        for (const item of returnRequestedItems) {
          if (approved) {
            item.status = 'Returned';
            item.returnedAt = new Date();

            await Product.findByIdAndUpdate(
              item.product,
              { $inc: { stock: item.quantity } }
            );
          } else {
            item.status = 'Active';
            item.returnRequestedAt = null;
            item.returnReason = null;
          }
        }

        const hasActiveItems = order.items.some(i => i.status === 'Active');
        const hasReturnRequestedItems = order.items.some(i => i.status === 'Return Requested');

        if (!hasActiveItems && !hasReturnRequestedItems) {
          order.orderStatus = 'Returned';
        } else if (!hasReturnRequestedItems) {
          order.orderStatus = 'Delivered';
        }

        if (approved) {
          let refundProcessed = false;

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
              const refundSuccess = await processReturnRefund(order.user, order, returnRequestedItems);
              if (refundSuccess) {
                refundProcessed = true;
              }
            } else {
              refundProcessed = true; 
            }
          } else {
            if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partially Refunded') {
              const refundSuccess = await processReturnRefund(order.user, order, returnRequestedItems);
              if (refundSuccess) {
                refundProcessed = true;
              }
            } else {
              refundProcessed = true;
            }
          }

          if (refundProcessed) {
            if (order.paymentMethod === 'COD' && order.paymentStatus !== 'Paid') {
              order.paymentStatus = 'Failed';
            } else if (hasActiveItems) {
              order.paymentStatus = 'Partially Refunded';
            } else {
              order.paymentStatus = 'Refunded';
            }
          }
        }

        await order.save();
        processedCount++;
      } catch (error) {
        console.error(`Error processing order ${orderId}:`, error);
        errors.push(`Order ${orderId}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: `${approved ? 'Approved' : 'Rejected'} ${processedCount} return request(s)`,
      processedCount,
      errors: errors.length > 0 ? errors : null
    });

  } catch (error) {
    console.error("Error in bulk process returns:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

module.exports = {
  getReturnRequests,                                                    
  getReturnRequestDetails,
  processReturnRequest,
  bulkProcessReturns
};
