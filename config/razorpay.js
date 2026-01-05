
const RAZORPAY = require("razorpay");

const razorpay = new RAZORPAY({
    key_id : process.env.RAZORPAY_KEY_ID,
    key_secret : process.env.RAZORPAY_KEY_SECRET
})


module.exports = razorpay;