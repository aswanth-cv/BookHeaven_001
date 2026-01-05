const { json } = require("express");
const Address = require("../../models/addressSchema");
const User = require("../../models/userSchema");



const getAddress = async(req,res)=>{
    try {
        const userId = req.session.user_id;
        const user = await User.findById(userId)
        const addresses = await Address.find({ userId }).sort({
        isDefault: -1,
        updatedAt: -1,
    });
    const returnTo = req.query.returnTo || "";
    res.render("address", { user, addresses, returnTo });
    } catch (error) {
        console.error("Error in address rendering",error);
        res.status(500).render("Error",{message:"Internal server error"}); 
    }
}

const addresses = async(req,res)=>{
    try {
        const userId = req.session.user_id;
        const data = req.validatedData || req.body;
        const {
            fullName,
            phone,
            pincode,
            district,
            state,
            street,
            landmark,
            isDefault,
            returnTo
        } = data;

        const makeDefault = isDefault === true || isDefault === 'true' || isDefault === 'on';

        if (makeDefault) {
          await Address.updateMany({ userId }, { isDefault: false });
        }

        const newAddress = new Address({
          userId,
          fullName,
          phone,
          pincode,
          district,
          state,
          street,
          landmark,
          isDefault: makeDefault,
        });
        await newAddress.save();
        
        const shouldRedirectToCheckout = returnTo === "checkout" || req.session.redirectToCheckout;
        
        if (shouldRedirectToCheckout) {
          // Clear the session flag
          delete req.session.redirectToCheckout;
          
          return res.status(201).json({
            success: true,
            message: "Address added successfully",
            address: newAddress,
            redirect: "/checkout",
          });
        }

        res.status(201).json({
          success: true,
          message: "Address added successfully",
          address: newAddress,
        });



    } catch (error) {
        console.error("Error in adding address",error);
        res.status(500).json({
            success:false,
            message:"Faild to add address"
        })
    }
}

const updateAddress = async(req,res)=>{
    try {
        const userId = req.session.user_id;
         const addressId = req.params.id;

        const {
            fullName,
            phone,
            pincode,
            district,
            state,
            street,
            landmark,
            isDefault,
        } = req.body;


        if(!fullName || !phone || !pincode || !district || !state || !street){
            return res.status(400).json({
                success:false,
                message:"All required field must be filled"
            })
        }

        const address = await Address.findById(addressId);
        if(!address){
           return  res.status(404).json({
                success:false,
                message:"Address not found"
            })
        }

        if (address.userId.toString() !== userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized access" });
    }
    
    if (isDefault) {
      await Address.updateMany({ userId }, { isDefault: false });
    }

    address.fullName = fullName;
    address.phone = phone;
    address.pincode = pincode;
    address.district = district;
    address.state = state;
    address.street = street;
    address.landmark = landmark;
    address.isDefault = isDefault || false;

    await address.save();

    res.json({
        success:true,
        message:"Address added successfully",
        address
    });


    } catch (error) {
        console.log("Error updating address",error)

        return res.status(500).json({
            success:false,
            message:"Faild to add address"
        })
    }
}


const deleteAddress = async(req,res)=>{
    try {
        const userId = req.session.user_id;
        const addressId = req.params.id;

        const address = await Address.findById(addressId);
        if(!address){
            return res.status(404).json({
                success:false,
                message:"Address not found"
            });
        }

        if (address.userId.toString() !== userId) {
      return res
        .status(401).json({ success: false, message: "Unauthorized access" });
    }

    await Address.findByIdAndDelete(addressId);

    res.json({ success: true, message: "Address deleted successfully" });

    } catch (error) {
        console.log("Error delete address",error);
        res.status(500).json({
            success:false,
            message:"Faild to delete address"
        })
    }
}

const setDefaultAddress = async(req,res)=>{
    try {
        const userId = req.session.user_id;
        const addressId = req.params.id;

        const address = await Address.findById(addressId);

        if(!address){
            return res.status(404).json({
                success:false,
                message:"Address not found"
            })
        }

        if (address.userId.toString() !== userId) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    await Address.updateMany({userId} , {isDefault:false})
    address.isDefault = true;
    await address.save();

   return res.json({
        success:true,
        message:"Address set as default successfully"
    })



    } catch (error) {
       console.log("Error setting default address:", error);
    res.status(500).json({
        success: false,
        message: "Failed to set default address" }); 
    }
}

const getAddressById = async (req, res) => {
  try {
    const userId = req.session.user_id;
    const addressId = req.params.id;

    const address = await Address.findById(addressId);
    if (!address) {
      return res.status(404).json({
         success: false,
          message: "Address not found" });
    }
    if (address.userId.toString() !== userId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized access" });
    }

    res.json({ success: true, address });
  } catch (error) {
    console.log("Error fetching address:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch address" });
  }
};


module.exports = {
    getAddress,
    addresses,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    getAddressById,
}