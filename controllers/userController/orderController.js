const User = require("../../models/userSchema");
const Order = require("../../models/orderSchema");
const Product = require("../../models/productSchema");
const path = require("path");


const getOrders = async(req,res)=>{
    try {
        if(!req.session.user_id){
            return res.redirect("/login")
        }

        const userId = req.session.user_id;

        const user = await User.findById(userId,"fullname email profileImage").lean();
        if(!user){
            return res.redirect("/login");
        }

            const page = parseInt(req.query.page) || 1;
            const limit = 5;
            const skip = (page - 1) * limit; 
    } catch (error) {
        
    }
}



module.exports = {
    getOrders,
}


