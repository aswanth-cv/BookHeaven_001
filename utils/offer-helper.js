
const Offer = require("../models/offerSchema");
const Product = require("../models/productSchema");




const getActiveOfferForProduct = async (productId, productCategoryId, productPrice) => {
  try {
    const now = new Date()
    let categoryToQuery = productCategoryId

    if (!categoryToQuery && productId) {
      const productDoc = await Product.findById(productId).select("category").lean()
      if (productDoc && productDoc.category) {
        categoryToQuery = productDoc.category.toString()
      }
    }

    const offerQueryConditions = []

    // **CRITICAL FIX: Restrict flat amount offers from being applied globally**
    // Only allow percentage discounts for global offers (all_products and all_categories)
    // Flat amount discounts should only be applied to specific products/categories
    
    // Allow all_products offers only for percentage discounts
    offerQueryConditions.push({ 
      appliesTo: "all_products",
      discountType: "percentage"  // Only percentage discounts for global application
    })

    // Allow specific product offers (both percentage and flat amount)
    if (productId) {
      offerQueryConditions.push({
        appliesTo: "specific_products",
        applicableProducts: { $in: [productId] },
        // Both percentage and flat amount allowed for specific products
      })
    }

    // Allow all_categories offers only for percentage discounts
    offerQueryConditions.push({ 
      appliesTo: "all_categories",
      discountType: "percentage"  // Only percentage discounts for global category application
    })

    // Allow specific category offers (both percentage and flat amount)
    if (categoryToQuery) {
      offerQueryConditions.push({
        appliesTo: "specific_categories",
        applicableCategories: { $in: [categoryToQuery] },
        // Both percentage and flat amount allowed for specific categories
      })
    }

    const potentialOffers = await Offer.find({
      $or: offerQueryConditions,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean()

    if (!potentialOffers || potentialOffers.length === 0) {
      return null
    }

    let bestOffer = null
    let bestDiscountAmount = 0

    for (const offer of potentialOffers) {
      // **ADDITIONAL VALIDATION: Double-check flat amount restrictions**
      if (offer.discountType === "fixed") {
        // Flat amount offers should only be allowed for specific products/categories
        if (offer.appliesTo === "all_products" || offer.appliesTo === "all_categories") {
          console.warn(`Skipping invalid flat amount offer "${offer.title}" with global application: ${offer.appliesTo}`)
          continue // Skip this offer as it violates our restriction
        }
      }

      const discountInfo = calculateDiscount(offer, productPrice)

      if (discountInfo.discountAmount > bestDiscountAmount) {
        bestOffer = offer
        bestDiscountAmount = discountInfo.discountAmount
      } else if (discountInfo.discountAmount === bestDiscountAmount && bestOffer) {
        const currentPriority = getOfferPriority(bestOffer)
        const newPriority = getOfferPriority(offer)

        if (newPriority < currentPriority) {
          bestOffer = offer
        }
      }
    }

    return bestOffer
  } catch (error) {
    console.error("Error fetching active offer:", error)
    return null
  }
}


const calculateDiscount = (offer, price) => {
  if (!offer || typeof price !== "number" || price <= 0) {
    return { discountAmount: 0, discountPercentage: 0, finalPrice: price || 0 }
  }

  let discountAmount = 0
  let discountPercentage = 0

  if (offer.discountType === "percentage") {
    discountPercentage = Math.min(offer.discountValue, 100) // Cap at 100%
    discountAmount = (price * discountPercentage) / 100
  } else if (offer.discountType === "fixed") {
    discountAmount = offer.discountValue
    discountPercentage = price > 0 ? (discountAmount / price) * 100 : 0
  }

  discountAmount = Math.min(discountAmount, price)
  discountPercentage = Math.min(discountPercentage, 100)

  const finalPrice = Math.max(0, price - discountAmount)

  return {
    discountAmount: Number.parseFloat(discountAmount.toFixed(2)),
    discountPercentage: Number.parseFloat(discountPercentage.toFixed(2)),
    finalPrice: Number.parseFloat(finalPrice.toFixed(2)),
    offer: offer,
  }
}

const calculateProportionalCouponDiscount = (coupon, items) => {
  if (!coupon || !items || items.length === 0) {
    return { totalDiscount: 0, itemDiscounts: {} }
  }

  const cartTotal = items.reduce((sum, item) => {
    const itemTotal = item.discountedPrice * item.quantity;
    return sum + itemTotal;
  }, 0);

  if (cartTotal <= 0) {
    return { totalDiscount: 0, itemDiscounts: {} }
  }
 
  let totalCouponDiscount = 0;
  if (coupon.discountType === "percentage") {
    totalCouponDiscount = (cartTotal * coupon.discountValue) / 100;
    if (coupon.maxDiscountValue) {
      totalCouponDiscount = Math.min(totalCouponDiscount, coupon.maxDiscountValue);
    }
  } else {
    totalCouponDiscount = Math.min(coupon.discountValue, cartTotal);
  }

  const itemDiscounts = {};

  items.forEach((item) => {
    const itemTotal = item.discountedPrice * item.quantity;
    const proportion = itemTotal / cartTotal;
    
    const itemDiscount = Math.round((totalCouponDiscount * proportion) * 100) / 100;
    
    const finalDiscount = Math.min(itemDiscount, itemTotal);

    itemDiscounts[item.product.toString()] = {
      amount: finalDiscount,
      proportion: proportion
    };
  });

  const actualTotalDiscount = Object.values(itemDiscounts)
    .reduce((sum, discount) => sum + discount.amount, 0);

  return {
    totalDiscount: actualTotalDiscount,
    itemDiscounts
  }
}

const calculateFinalItemPrice = (item, order = null) => {
  try {
    const originalPrice = item.price || item.priceAtAddition;
    const quantity = item.quantity || 1;
    const subtotal = originalPrice * quantity;
    
    const offerDiscount = item.offerDiscount || 0;
    const priceAfterOffer = (item.discountedPrice || originalPrice) * quantity;
    
    let couponDiscount = 0;
    let couponProportion = 0;
    
    if (order && order.couponDiscount > 0 && item.priceBreakdown?.couponProportion) {
      couponProportion = item.priceBreakdown.couponProportion;
      couponDiscount = order.couponDiscount * couponProportion;
    }
    
    const finalPrice = priceAfterOffer - couponDiscount;
    
    return {
      originalPrice,
      quantity,
      subtotal,
      offerDiscount,
      priceAfterOffer,
      couponDiscount,
      couponProportion,
      finalPrice: Math.max(0, Number(finalPrice.toFixed(2)))
    };
  } catch (error) {
    console.error('Error in calculateFinalItemPrice:', error);
    return {
      originalPrice: item.price || 0,
      quantity: item.quantity || 1,
      subtotal: (item.price || 0) * (item.quantity || 1),
      offerDiscount: 0,
      priceAfterOffer: (item.price || 0) * (item.quantity || 1),
      couponDiscount: 0,
      couponProportion: 0,
      finalPrice: (item.price || 0) * (item.quantity || 1)
    };
  }
};


const getItemPriceDetails = (item, couponInfo = null) => {
  const originalPrice = item.price || item.priceAtAddition
  const quantity = item.quantity
  const subtotal = originalPrice * quantity
  
  // Get offer discount
  const offerDiscount = item.offerDiscount || 0
  const priceAfterOffer = item.discountedPrice * quantity

  // Get coupon discount
  const couponDiscount = couponInfo ? couponInfo.amount : 0
  
  // Calculate final price
  const finalPrice = priceAfterOffer - couponDiscount

  return {
    originalPrice,
    quantity,
    subtotal,
    offerDiscount,
    priceAfterOffer,
    couponDiscount,
    finalPrice,
    couponProportion: couponInfo ? couponInfo.proportion : 0
  }
}


const getActiveOffersForProducts = async (products) => {
  try {
    const offerMap = {}

    for (const product of products) {
      const offer = await getActiveOfferForProduct(
        product._id.toString(),
        product.category ? product.category.toString() : null,
        product.price,
      )

      if (offer) {
        offerMap[product._id.toString()] = calculateDiscount(offer, product.price)
      }
    }

    return offerMap
  } catch (error) {
    console.error("Error fetching offers for products:", error)
    return {}
  }
}


const isOfferActive = (offer) => {
  if (!offer || !offer.isActive) return false

  const now = new Date()
  const startDate = new Date(offer.startDate)
  const endDate = new Date(offer.endDate)

  return startDate <= now && endDate >= now
}



const getOfferStatus = (offer) => {
  if (!offer) return "No Offer"

  const now = new Date()
  const startDate = new Date(offer.startDate)
  const endDate = new Date(offer.endDate)

  if (!offer.isActive) return "Inactive"
  if (endDate < now) return "Expired"
  if (startDate > now) return "Upcoming"
  return "Active"
}


const getOfferPriority = (offer) => {
  switch (offer.appliesTo) {
    case "specific_products":
      return 1
    case "specific_categories":
      return 2
    case "all_products":
      return 3
    case "all_categories":
      return 4
    default:
      return 5
  }
}


const getUnifiedPriceBreakdown = (item, order = null) => {
  try {
    if (!item) {
      console.warn('getUnifiedPriceBreakdown: item is null or undefined');
      return null;
    }

    const quantity = item.quantity || 1;

    const originalPrice = item.price || item.priceAtAddition || 0;
    const originalTotal = originalPrice * quantity;

    const discountedPrice = item.discountedPrice || originalPrice;
    const offerDiscount = originalPrice - discountedPrice;
    const offerDiscountTotal = offerDiscount * quantity;
    const priceAfterOffer = discountedPrice * quantity;

    let couponDiscount = 0;
    let couponProportion = 0;

    if (item.priceBreakdown && item.priceBreakdown.couponDiscount) {
      couponDiscount = item.priceBreakdown.couponDiscount;
      couponProportion = item.priceBreakdown.couponProportion || 0;
    } else if (item.couponDiscount) {
      couponDiscount = item.couponDiscount;
      couponProportion = item.couponProportion || 0;
    }

    const finalPrice = priceAfterOffer - couponDiscount;

    let taxAmount = 0;
    if (order && order.tax && order.total) {
      const orderSubtotal = order.total - order.tax;
      if (orderSubtotal > 0) {
        const itemProportion = finalPrice / orderSubtotal;
        taxAmount = order.tax * itemProportion;
      }
    }

    const finalTotal = finalPrice + taxAmount;

    return {
      originalPrice,
      originalTotal,
      discountedPrice,
      offerDiscount,
      offerDiscountTotal,
      priceAfterOffer,
      couponDiscount,
      couponProportion,
      finalPrice,
      taxAmount,
      finalTotal,
      quantity,
      formattedOriginalPrice: `₹${originalPrice.toFixed(2)}`,
      formattedOriginalTotal: `₹${originalTotal.toFixed(2)}`,
      formattedDiscountedPrice: `₹${discountedPrice.toFixed(2)}`,
      formattedOfferDiscount: `₹${offerDiscount.toFixed(2)}`,
      formattedPriceAfterOffer: `₹${priceAfterOffer.toFixed(2)}`,
      formattedCouponDiscount: `₹${couponDiscount.toFixed(2)}`,
      formattedFinalPrice: `₹${finalPrice.toFixed(2)}`,
      formattedTaxAmount: `₹${taxAmount.toFixed(2)}`,
      formattedFinalTotal: `₹${finalTotal.toFixed(2)}`
    };
  } catch (error) {
    console.error('Error in getUnifiedPriceBreakdown:', error);
    return {
      originalPrice: 0,
      originalTotal: 0,
      discountedPrice: 0,
      offerDiscount: 0,
      offerDiscountTotal: 0,
      priceAfterOffer: 0,
      couponDiscount: 0,
      couponProportion: 0,
      finalPrice: 0,
      taxAmount: 0,
      finalTotal: 0,
      quantity: item.quantity || 1,
      formattedOriginalPrice: '₹0.00',
      formattedOriginalTotal: '₹0.00',
      formattedDiscountedPrice: '₹0.00',
      formattedOfferDiscount: '₹0.00',
      formattedPriceAfterOffer: '₹0.00',
      formattedCouponDiscount: '₹0.00',
      formattedFinalPrice: '₹0.00',
      formattedTaxAmount: '₹0.00',
      formattedFinalTotal: '₹0.00'
    };
  }
};




const recalculateCartTotals = async (cart) => {
  if (!cart || !cart.items || cart.items.length === 0) {
    return { totalAmount: 0, totalDiscount: 0, itemCount: 0 };
  }

  let totalAmount = 0;
  let totalDiscount = 0;
  let itemCount = 0;

  for (const item of cart.items) {
    if (!item.product) continue;
    
    // Get the product details if not populated
    let product = item.product;
    if (typeof product === 'string') {
      const Product = require("../models/productSchema");
      product = await Product.findById(product);
    }
    
    if (!product || !product.isListed) continue;

    const currentPrice = product.salePrice || product.regularPrice || 0;
    const offer = await getActiveOfferForProduct(
      product._id,
      product.category,
      currentPrice
    );

    if (offer && isOfferActive(offer)) {
      const { finalPrice, discountAmount } = calculateDiscount(offer, currentPrice);
      totalAmount += item.quantity * finalPrice;
      totalDiscount += item.quantity * discountAmount;
    } else {
      totalAmount += item.quantity * currentPrice;
    }
    
    itemCount += item.quantity;
    
    // Update priceAtAddition if it differs from current price
    if (item.priceAtAddition !== currentPrice) {
      item.priceAtAddition = currentPrice;
    }
  }

  return {
    totalAmount: Number(totalAmount.toFixed(2)),
    totalDiscount: Number(totalDiscount.toFixed(2)),
    itemCount
  };
};


module.exports = {
    getActiveOfferForProduct,
    calculateDiscount,
    calculateProportionalCouponDiscount,
    calculateFinalItemPrice,
    getItemPriceDetails,
    getActiveOffersForProducts,
    isOfferActive,
    getOfferStatus,
    getOfferPriority,
    getUnifiedPriceBreakdown,
    recalculateCartTotals
}