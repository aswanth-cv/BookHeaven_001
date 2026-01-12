const Coupon = require("../../models/couponSchema");
const User = require("../../models/userSchema");
const { HttpStatus } = require("../../helpers/status-code");



const getUserCoupons = async (req,res)=>{
    try {
        
        const userId = req.session.user_id;
        
        if(!userId){
            return res.status(HttpStatus.BAD_REQUEST).json({
                success : false,
                message : "Please log in to view coupons"
            })
        }

        const user = await User.findById(userId).lean();
        if(!user){
            return res.status(HttpStatus.BAD_REQUEST).json({
                success : false,
                message : "User not found!"
            })
        }
        if(user.isBlocked){
            return res.status(HttpStatus.BAD_REQUEST).json({
                success : false,
                message : "Your account is blocked"
            })
        }
        const page = parseInt(req.query.page) || 1;
        const limit = 6;
        const skip = (page - 1) * limit;

        const currentDate = new Date();

        const coupons = await Coupon.find({
            isActive : true,
            startDate : {$lte : currentDate},
            expiryDate : {$gte : currentDate}
        })
        .populate("applicableCategories","name")
        .populate("applicableProducts","title")
        .lean()

        const filteredCoupons = coupons.filter((coupon) =>{
            if(
                coupon.usageLimitGlobal && 
                coupon. usedCount >= coupon.usageLimitGlobal
            ){
                return false;
            }

            const userUsage = coupon.usedBy.find(
           (usage) => usage.userId.toString() === userId.toString()
           );
           if (userUsage && userUsage.count >= coupon.usageLimitPerUser) {
            return false;
           }
           return true;
        })

        const totalCoupons = filteredCoupons.length;
        const totalPages = Math.ceil(totalCoupons / limit);
        const start = totalCoupons > 0 ? skip + 1 : 0;
        const end = Math.min(skip + limit, totalCoupons);


        if (page < 1 || (page > totalPages && totalPages > 0)) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, message: "Page not found" });
    }

    const paginatedCoupons = filteredCoupons.slice(skip, skip + limit);

    const formattedCoupons = paginatedCoupons.map((coupon) => {
      const userUsage = coupon.usedBy.find(
        (usage) => usage.userId.toString() === userId.toString()
      );
      const remainingUses =
        coupon.usageLimitPerUser - (userUsage ? userUsage.count : 0);
      const discountDisplay =
        coupon.discountType === "percentage"
          ? `${coupon.discountValue}% OFF${
              coupon.maxDiscountValue
                ? ` (up to ₹${coupon.maxDiscountValue})`
                : ""
            }`
          : `₹${coupon.discountValue} OFF`;
      const applicabilityDisplay =
        coupon.applicableCategories.length > 0
          ? `Applicable on: ${coupon.applicableCategories
              .map((cat) => cat.name)
              .join(", ")}`
          : coupon.applicableProducts.length > 0
          ? `Applicable on: ${coupon.applicableProducts
              .map((prod) => prod.title)
              .join(", ")}`
          : "Applicable on all products";

      return {
        ...coupon,
        discountDisplay,
        applicabilityDisplay,
        validityText: `Valid till: ${coupon.expiryDate.toLocaleDateString(
          "en-US",
          { month: "short", day: "numeric", year: "numeric" }
        )}`,
        minOrderText:
          coupon.minOrderAmount > 0
            ? `Min. order: ₹${coupon.minOrderAmount}`
            : "",
        remainingUses:
          remainingUses > 0 && coupon.usageLimitPerUser > 1
            ? `Uses left: ${remainingUses}`
            : "",
      };
    });

     formattedCoupons.sort(
      (a, b) => new Date(a.expiryDate) - new Date(b.expiryDate)
    );

    // Pagination metadata
    const pagination = {
      currentPage: page,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevPage: page - 1,
      nextPage: page + 1,
      pages: Array.from({ length: totalPages }, (_, i) => i + 1),
      start,
      end,
      totalCoupons,
    };

    res.render("user-coupons", {
      coupons: formattedCoupons,
      user,
      noCoupons: totalCoupons === 0,
      pagination,
      title: "Available Coupons",
      currentPage: "coupons",
      isAuthenticated: true,
    });


    } catch (error) {
         console.error("Error fetching user coupons:", error);
       res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ success: false, message: "Internal server error" });
    }
}


module.exports = {
    getUserCoupons
}