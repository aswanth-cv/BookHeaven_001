const User = require("../../models/userSchema");
const OTP = require("../../models/otpSchema");
const {sendOtpEmail} = require("../../helpers/sendMail");
const upload = require("../../helpers/multer");
const path = require("path");
const fs = require("fs");
const { createOtpMessage } = require("../../helpers/email-mask");





const getProfile = async(req,res)=>{
    
    try {
        if(!req.session.user_id){
            return res.status(401).json({
                success:false,
                message:"Please login"
            })
        }

        const user = await User.findOne({_id:req.session.user_id}).lean();
        if(!user){
            return res.status(404).json({
                success: false,
                message: "User Not Found"
            })
        }

        res.render("profile",{user});
    } catch (error) {
        console.error("Profile page Error",error);
        return res.status(500).json({
            success:false,
            message:"Something went wrong"
        })
    }
}


const updateProfile = async(req,res)=>{
    try {
        if(!req.session.user_id){
            return res.status(400).json({
                success:false,
                message:"Please login to update profile"
            })
        }

        const {fullName,phone} = req.body;

        if(fullName || fullName.trim().length<3){
            return res.status(400).json({
                success:false,
                message:"Full name must be at least 3 characters"
            })
        }
        const nameWords = fullName.trim().split(/\s+/)
        if(nameWords.length<2){
            return res.status(400).json({
                success:false,
                message:"Please provide first and last name"
            })
        }
        if(!/^[A-Za-z\s'-]+$/.test(fullName.trim())){
            return res.status(400).json({
                success:false,
                message:"Full name contains Invalid characters"
            })
        }
        if(phone){
            const cleanPhone = phone.replace(/\D/g, "");
            if(
                cleanPhone !== 10 && 
                (cleanPhone.length<11 && cleanPhone.lenght>15)
            ){
                return res.status(400).json({
                    success:false,
                    message:"Phone number must be 10 digits or include a valid country code"
                });
            }
            if (
            /^(.)\1+$/.test(cleanPhone) ||
            /^0{10}$/.test(cleanPhone) ||
            /^1{10}$/.test(cleanPhone)
      ){
        return res.status(400).json({
            success:false,
            message:"Invalid phone number format"
        })
      }
      const existingPhone = await User.findOne({phone:phone.trim(),_id:{$ne:req.session.user_id}})

      if(!existingPhone){
        return res.status(400).json({
            success:false,
            message:"Phone number already in use"
        })
      }
        }

        const updatedUser = await User.findByIdAndUpdate(req.session.user_id,{
            fullName:fullName.trim(),
            phone:phone ? phone.trim() : undefined,
        },
        {new:true ,runValidators:true},
    ).lean();

    if(!upadatedUser){
        return res.status(400).json({
            success:false,
            message:"User not found"
        })
    }
    res.status(200).json({
        success:true,
        message:"Profile updated succesfully",
        user:{
            fullName:updatedUser.fullName,
            phone:updatedUser.phone,
            email:updatedUser.email
        }
    })

    } catch (error) {
        console.error("profile Updating Error",error);
        if(error.code == 11000){
            return res.status(400).json({
                success:false,
                message:"Phone number already in use"
            })
        }

        res.status(500).json({
            success:false,
            message:"Faild to update profile"
        })
    }
};



    const uploadProfileImage = async(req,res)=>{
        try {
  if (!req.session.user_id) {
    return res.status(400).json({
      success: false,
      message: "Please login to upload image",
    });
  }

  // Use multer middleware to handle file upload
  upload.single("profileImage")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Failed to upload image",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    // Local file path
    const imagePath = `/uploads/${req.file.filename}`;

    // Update user with local file path
    const updatedUser = await User.findByIdAndUpdate(
      req.session.user_id,
      { profileImage: imagePath },
      { new: true }
    ).lean();

    if (!updatedUser) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile image uploaded successfully",
      profileImage: imagePath,
    });
  });
} catch (error) {
  console.error("Error uploading profile image:", error);
  res.status(500).json({
    success: false,
    message: "Failed to upload profile image",
  });
}

}

const requestEmailUpdate = async(req,res)=>{
    if(!req.session.user_id){
        return res.status(400).json({
            success:false,
            message:"Please login to update email"
        })
    }

    const {email} = req.body;

    if(!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)){
        return res.status(400).json({
            success:false,
            message:"Please provide valid email id"
        })
    }

    const user = await User.findById(req.session.user_id);

    if(!user){
        return res.status(404).json({
            success:false,
            message:"User is not found"
        })
    }
    if(email.toLowerCase() === user.email.toLowerCase()){
        return res.status(400).json({
            success:false,
            message:"New email should be different from current email"
        })
    }

    const existingUser = await User.findOne({email:email.toLowerCase()});

    if(existingUser){
        return res.status(400).json({
            success:false,
            message:"Email id already in use"
        })
    }

    const top = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.deleteMany({
        email:email.toLowerCase(),
        purpose:"Email-update"
    });
    console.log(`Generated OTP: ${otp}`)
}

    



module.exports = {
    getProfile,
    updateProfile,
    uploadProfileImage,
}