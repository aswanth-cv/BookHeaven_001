const Coupon = require("../models/couponSchema");

const validateCouponAfterItemCancellation = async (order, itemIdToCancel) => {
  try {
    // If no coupon was applied, allow cancellation
    if (!order.couponCode) {
      return {
        success: true,
        allowPartialCancellation: true,
        message: "No coupon applied - cancellation allowed"
      };
    }

    // Find the coupon that was applied
    const appliedCoupon = await Coupon.findOne({ code: order.couponCode });
    if (!appliedCoupon) {
      return {
        success: true,
        allowPartialCancellation: true,
        message: "Applied coupon not found - cancellation allowed"
      };
    }

    // Find the item being cancelled
    const itemToCancel = order.items.find(item => 
      item.product.toString() === itemIdToCancel.toString() && 
      item.status === 'Active'
    );

    if (!itemToCancel) {
      return {
        success: false,
        allowPartialCancellation: false,
        message: "Item not found or already cancelled"
      };
    }

    const activeItems = order.items.filter(item => item.status === 'Active');
    const currentOrderTotal = activeItems.reduce((total, item) => {
      const itemFinalPrice = item.priceBreakdown?.finalPrice || 
                            (item.discountedPrice * item.quantity);
      return total + itemFinalPrice;
    }, 0);

    const itemFinalPrice = itemToCancel.priceBreakdown?.finalPrice || 
                          (itemToCancel.discountedPrice * itemToCancel.quantity);
    const remainingOrderTotal = currentOrderTotal - itemFinalPrice;

    
    const remainingSubtotal = activeItems
      .filter(item => item.product.toString() !== itemIdToCancel.toString())
      .reduce((total, item) => {
        const priceAfterOffer = item.priceBreakdown?.priceAfterOffer || 
                               (item.discountedPrice * item.quantity);
        return total + priceAfterOffer;
      }, 0);

    if (remainingSubtotal < appliedCoupon.minOrderAmount) {
      return {
        success: true,
        allowPartialCancellation: false,
        message: `This order used coupon "${appliedCoupon.code}" which requires a minimum purchase of ₹${appliedCoupon.minOrderAmount}. Cancelling this item would reduce your order total to ₹${remainingSubtotal.toFixed(2)}, breaking the coupon condition. Please cancel the entire order instead.`,
        couponCode: appliedCoupon.code,
        minOrderAmount: appliedCoupon.minOrderAmount,
        currentTotal: remainingSubtotal,
        itemToCancel: itemToCancel.title
      };
    }

    return {
      success: true,
      allowPartialCancellation: true,
      message: "Coupon conditions still satisfied after cancellation",
      couponCode: appliedCoupon.code,
      minOrderAmount: appliedCoupon.minOrderAmount,
      remainingTotal: remainingSubtotal
    };

  } catch (error) {
    console.error('Error validating coupon after item cancellation:', error);
    return {
      success: false,
      allowPartialCancellation: false,
      message: "Error validating coupon conditions. Please try again."
    };
  }
};


const validateCouponAfterItemReturn = async (order, itemIdToReturn) => {
  try {
    if (!order.couponCode) {
      return {
        success: true,
        allowPartialReturn: true,
        message: "No coupon applied - return allowed"
      };
    }

    const appliedCoupon = await Coupon.findOne({ code: order.couponCode });
    if (!appliedCoupon) {
      return {
        success: true,
        allowPartialReturn: true,
        message: "Applied coupon not found - return allowed"
      };
    }

    const itemToReturn = order.items.find(item => 
      item.product.toString() === itemIdToReturn.toString() && 
      item.status === 'Active'
    );

    if (!itemToReturn) {
      return {
        success: false,
        allowPartialReturn: false,
        message: "Item not found or not eligible for return"
      };
    }

    const activeItems = order.items.filter(item => item.status === 'Active');
    const remainingSubtotal = activeItems
      .filter(item => item.product.toString() !== itemIdToReturn.toString())
      .reduce((total, item) => {
        const priceAfterOffer = item.priceBreakdown?.priceAfterOffer || 
                               (item.discountedPrice * item.quantity);
        return total + priceAfterOffer;
      }, 0);

    if (remainingSubtotal < appliedCoupon.minOrderAmount) {
      return {
        success: true,
        allowPartialReturn: false,
        message: `This order used coupon "${appliedCoupon.code}" which requires a minimum purchase of ₹${appliedCoupon.minOrderAmount}. Returning this item would reduce your order total to ₹${remainingSubtotal.toFixed(2)}, breaking the coupon condition. Please return the entire order instead.`,
        couponCode: appliedCoupon.code,
        minOrderAmount: appliedCoupon.minOrderAmount,
        currentTotal: remainingSubtotal,
        itemToReturn: itemToReturn.title
      };
    }

    return {
      success: true,
      allowPartialReturn: true,
      message: "Coupon conditions still satisfied after return",
      couponCode: appliedCoupon.code,
      minOrderAmount: appliedCoupon.minOrderAmount,
      remainingTotal: remainingSubtotal
    };

  } catch (error) {
    console.error('Error validating coupon after item return:', error);
    return {
      success: false,
      allowPartialReturn: false,
      message: "Error validating coupon conditions. Please try again."
    };
  }
};

module.exports = {
  validateCouponAfterItemCancellation,
  validateCouponAfterItemReturn
};