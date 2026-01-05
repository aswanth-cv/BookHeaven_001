


const calculateRefundAmount = (refundType, order, targetItemId = null) => {
  try {
    if (!order || !order.total || order.total <= 0) {
      console.error('Invalid order data for refund calculation');
      return { success: false, amount: 0, reason: 'Invalid order data' };
    }

   
    const activeItems = order.items.filter(item =>
      item.status === 'Active' || item.status === 'Placed' || !item.status
    );

    order.items.forEach((item, index) => {
    });

    if (refundType === 'INDIVIDUAL_ITEM') {
      
      return calculateIndividualItemRefund(targetItemId, order, order.items);
    } else if (refundType === 'REMAINING_ORDER') {
      return calculateRemainingOrderRefund(order, activeItems, order.items);
    } else {
      return { success: false, amount: 0, reason: 'Invalid refund type' };
    }

  } catch (error) {
    console.error('Error in refund calculation:', error.message);
    return { success: false, amount: 0, reason: 'Calculation error' };
  }
};


const calculateIndividualItemRefund = (targetItemId, order, allItems) => {
  const itemToRefund = allItems.find(item => {
    const productMatch = item.product?.toString() === targetItemId?.toString();
    const idMatch = item._id?.toString() === targetItemId?.toString();
    return productMatch || idMatch;
  });

  if (!itemToRefund) {
    return { success: false, amount: 0, reason: 'Item not found in order' };
  }

  const eligibleStatuses = ['Cancelled', 'Active', 'Return Requested', 'Returned'];
  if (!eligibleStatuses.includes(itemToRefund.status)) {
    return { success: false, amount: 0, reason: 'Item not eligible for refund' };
  }

  let refundAmount;
  
  if (order.items.length === 1) {
    refundAmount = Number(order.total.toFixed(2));
  } else {
    refundAmount = calculateItemProportion(itemToRefund, order, allItems);
  }

  return {
    success: true,
    amount: refundAmount,
    reason: `Refund for cancelled item: ${itemToRefund.title}`,
    itemTitle: itemToRefund.title,
    itemId: itemToRefund._id || itemToRefund.product
  };
};



const calculateRemainingOrderRefund = (order, activeItems, allItems) => {

  if (activeItems.length === 0) {

    const recentlyCancelledItems = allItems.filter(item => item.status === 'Cancelled');

    if (recentlyCancelledItems.length === 0) {
      console.log(` No items to refund`);
      return { success: false, amount: 0, reason: 'No items to refund' };
    }

    let totalRefund = 0;
    const refundedItems = [];

    const totalOrderRefund = order.total;

    let alreadyRefunded = 0;

    const remainingItems = recentlyCancelledItems.filter(item => {

      return true; 
    });

    if (remainingItems.length > 0) {
      remainingItems.forEach(item => {
        const itemRefund = calculateItemProportion(item, order, allItems);
        totalRefund += itemRefund;
        refundedItems.push({
          title: item.title,
          amount: itemRefund
        });
      });


      return {
        success: true,
        amount: totalRefund,
        reason: `Refund for remaining ${remainingItems.length} item(s) in cancelled order`,
        itemCount: remainingItems.length,
        refundedItems: refundedItems
      };
    }

    return { success: false, amount: 0, reason: 'All items already processed' };
  }

  let totalRefund = 0;
  const refundedItems = [];

  activeItems.forEach(item => {
    const itemRefund = calculateItemProportion(item, order, allItems);
    totalRefund += itemRefund;
    refundedItems.push({
      title: item.title,
      amount: itemRefund
    });
  });


  return {
    success: true,
    amount: totalRefund,
    reason: `Refund for remaining ${activeItems.length} item(s) in order`,
    itemCount: activeItems.length,
    refundedItems: refundedItems
  };
};


const calculateItemProportion = (item, order, allItems) => {
  try {
    const itemFinalPrice = item.priceBreakdown?.finalPrice || 
                          (item.discountedPrice ? item.discountedPrice * item.quantity : item.price * item.quantity);

    if (order.items.length === 1) {
      return Number(order.total.toFixed(2));
    }

    // Calculate total value of all items in the original order
    const totalItemsValue = allItems.reduce((sum, orderItem) => {
      const orderItemFinalPrice = orderItem.priceBreakdown?.finalPrice || 
                                 (orderItem.discountedPrice ? orderItem.discountedPrice * orderItem.quantity : orderItem.price * orderItem.quantity);
      return sum + orderItemFinalPrice;
    }, 0);

    if (totalItemsValue <= 0) {
      console.error('Invalid total items value for proportion calculation');
      return 0;
    }

    // Calculate this item's proportion of the original order
    const itemProportion = itemFinalPrice / totalItemsValue;

    // Calculate proportional refund including tax and shipping
    const orderSubtotal = order.subtotal || totalItemsValue;
    const orderTax = order.tax || 0;
    const orderShipping = order.shipping || 0;
    
    // Customer should get their proportional share of everything they paid
    const totalRefundableAmount = orderSubtotal + orderTax + orderShipping;
    const itemRefund = totalRefundableAmount * itemProportion;

    console.log(`Refund calculation for ${item.title}:`, {
      itemFinalPrice,
      totalItemsValue,
      itemProportion: (itemProportion * 100).toFixed(2) + '%',
      orderSubtotal,
      orderTax,
      orderShipping,
      totalRefundableAmount,
      itemRefund: itemRefund.toFixed(2)
    });

    return Number(itemRefund.toFixed(2));
  } catch (error) {
    console.error('Error calculating item proportion:', error.message);
    return 0;
  }
};

const calculateExactRefundAmount = (item, order) => {
  try {
    // If this is the only item in the order, refund the full order total
    if (order && order.items && order.items.length === 1) {
      return Number(order.total.toFixed(2));
    }
    
    // For multiple items, just return the item's final price (not proportional)
    // This matches the business requirement of refunding only the item amount
    if (item.priceBreakdown && item.priceBreakdown.finalPrice) {
      return Number(item.priceBreakdown.finalPrice.toFixed(2));
    }
    
    if (item.discountedPrice && item.quantity) {
      return Number((item.discountedPrice * item.quantity).toFixed(2));
    }
    
    const baseAmount = item.price * (item.quantity || 1);
    return Number(baseAmount.toFixed(2));
  } catch (error) {
    console.error('Error calculating exact refund amount:', error.message);
    // Fallback to basic calculation
    const baseAmount = (item.price || 0) * (item.quantity || 1);
    return Number(baseAmount.toFixed(2));
  }
};

const getItemDisplayPrice = (item, order) => {
  const refundAmount = calculateExactRefundAmount(item, order);
  return `₹${refundAmount.toFixed(2)}`;
};


const validateRefundCalculation = (items, order) => {
  try {
    let totalRefund = 0;
    
    items.forEach(item => {
      totalRefund += calculateExactRefundAmount(item, order);
    });

    const isFullOrderRefund = items.length === order.items.length;
    const expectedTotal = isFullOrderRefund ? order.total : totalRefund;
    
    return {
      totalRefund: Number(totalRefund.toFixed(2)),
      expectedTotal: Number(expectedTotal.toFixed(2)),
      isAccurate: Math.abs(totalRefund - expectedTotal) < 0.01,
      difference: Number((totalRefund - expectedTotal).toFixed(2))
    };
  } catch (error) {
    console.error('Error validating refund calculation:', error.message);
    return {
      totalRefund: 0,
      expectedTotal: 0,
      isAccurate: false,
      difference: 0
    };
  }
};


const getRefundBreakdown = (item, order) => {
  try {
    let refundAmount;
    let explanation;
    
    if (order.items.length === 1) {
      refundAmount = Number(order.total.toFixed(2));
      explanation = 'Full order total (what you paid including tax/shipping)';
    } else {
      refundAmount = calculateItemProportion(item, order, order.items);
      explanation = 'Proportional share of order total (includes your share of tax/shipping)';
    }
    
    const itemFinalPrice = item.priceBreakdown?.finalPrice || 
                          (item.discountedPrice ? item.discountedPrice * item.quantity : item.price * item.quantity);
    
    return {
      itemTitle: item.title || 'Unknown Item',
      originalPrice: item.price || 0,
      finalPrice: itemFinalPrice,
      quantity: item.quantity || 1,
      refundAmount: refundAmount,
      formattedRefund: `₹${refundAmount.toFixed(2)}`,
      formattedFinalPrice: `₹${itemFinalPrice.toFixed(2)}`,
      isFullOrderRefund: order.items.length === 1,
      explanation: explanation,
      hasDiscounts: item.priceBreakdown && (item.priceBreakdown.offerDiscount > 0 || item.priceBreakdown.couponDiscount > 0)
    };
  } catch (error) {
    console.error('Error getting refund breakdown:', error.message);
    return {
      itemTitle: 'Unknown Item',
      originalPrice: 0,
      finalPrice: 0,
      quantity: 1,
      refundAmount: 0,
      formattedRefund: '₹0.00',
      formattedFinalPrice: '₹0.00',
      isFullOrderRefund: false,
      explanation: 'Error calculating refund',
      hasDiscounts: false
    };
  }
};


const calculateTotalRefund = (items, order) => {
  try {
    if (items.length === order.items.length) {
      return Number(order.total.toFixed(2));
    }
    
    let totalRefund = 0;
    
    items.forEach(item => {
      const itemRefund = calculateItemProportion(item, order, order.items);
      totalRefund += itemRefund;
    });

    return Number(totalRefund.toFixed(2));
  } catch (error) {
    console.error('Error calculating total refund:', error.message);
    return 0;
  }
};


const validateRefundForPaymentMethod = (order, refundAmount) => {
  try {

    if (order.paymentMethod === 'COD') {
      const wasDelivered = order.orderStatus === 'Delivered' || order.paymentStatus === 'Paid';


      if (!wasDelivered) {
        return {
          isValid: true,
          shouldRefund: false,
          reason: 'COD order not delivered - no cash payment made',
          refundAmount: 0
        };
      }
    }

    if (order.paymentMethod !== 'COD') {
      const isPaid = ['Paid', 'Partially Refunded'].includes(order.paymentStatus);


      if (!isPaid) {
        return {
          isValid: true,
          shouldRefund: false,
          reason: 'Order not paid - no refund needed',
          refundAmount: 0
        };
      }
    }

    return {
      isValid: true,
      shouldRefund: true,
      reason: 'Valid for refund',
      refundAmount: Number(refundAmount.toFixed(2))
    };
  } catch (error) {
    console.error('Error validating refund for payment method:', error.message);
    return {
      isValid: false,
      shouldRefund: false,
      reason: 'Error validating payment method',
      refundAmount: 0
    };
  }
};

module.exports = {
  calculateRefundAmount,
  calculateExactRefundAmount,
  getItemDisplayPrice,
  validateRefundCalculation,
  getRefundBreakdown,
  calculateTotalRefund,
  validateRefundForPaymentMethod
};
