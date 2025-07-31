const Address = require("../../models/addressSchema");
const User = require("../../models/userSchema");



const getAddress = async(req,res)=>{
    try {
        res.render("address")
    } catch (error) {
        console.error("Address error",error);
    }
}


module.exports = {
    getAddress
}