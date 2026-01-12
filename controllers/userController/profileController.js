const User = require("../../models/userSchema");
const OTP = require("../../models/otpSchema");
const {sendOtpEmail} = require("../../helpers/sendMail");
const upload = require("../../helpers/multer");
const path = require("path");
const fs = require("fs");
const {validateBasicOtp,validateOtpSession} = require("../../validators/user/basic-otp-validator")
const { createOtpMessage } = require("../../helpers/email-mask");
const { json } = require("stream/consumers");
const { HttpStatus } = require("../../helpers/status-code");





const getProfile = async(req,res)=>{
    
    try {
        if(!req.session.user_id){
            return res.status(HttpStatus.UNAUTHORIZED).json({
                success:false,
                message:"Please login"
            })
        }

        const user = await User.findOne({_id:req.session.user_id}).lean();
        if(!user){
            return res.status(HttpStatus.NOT_FOUND).json({
                success: false,
                message: "User Not Found"
            })
        }

        res.render("profile",{user});
    } catch (error) {
        console.error("Profile page Error",error);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            success:false,
            message:"Something went wrong"
        })
    }
}


const updateProfile = async(req,res)=>{
    try {
        if(!req.session.user_id){
            return res.status(HttpStatus.BAD_REQUEST).json({
                success:false,
                message:"Please login to update profile"
            })
        }

        const {fullName,phone} = req.body;
        

        if(!fullName || fullName.trim().length<3){
            return res.status(HttpStatus.BAD_REQUEST).json({
                success:false,
                message:"Full name must be at least 3 characters"
            })
        }
        const nameWords = fullName.trim().split(/\s+/)
        if(nameWords.length<2){
            return res.status(HttpStatus.BAD_REQUEST).json({
                success:false,
                message:"Please provide first and last name"
            })
        }
        if(!/^[A-Za-z\s'-]+$/.test(fullName.trim())){
            return res.status(HttpStatus.BAD_REQUEST).json({
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
                return res.status(HttpStatus.BAD_REQUEST).json({
                    success:false,
                    message:"Phone number must be 10 digits or include a valid country code"
                });
            }
            if (
            /^(.)\1+$/.test(cleanPhone) ||
            /^0{10}$/.test(cleanPhone) ||
            /^1{10}$/.test(cleanPhone)
      ){
        return res.status(HttpStatus.BAD_REQUEST).json({
            success:false,
            message:"Invalid phone number format"
        })
      }
      const existingPhone = await User.findOne({phone:phone.trim(),_id:{$ne:req.session.user_id}})
      

      if(existingPhone){
        return res.status(HttpStatus.BAD_REQUEST).json({
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

    if(!updatedUser){
        return res.status(HttpStatus.BAD_REQUEST).json({
            success:false,
            message:"User not found"
        })
    }
    res.status(HttpStatus.OK).json({
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
            return res.status(HttpStatus.BAD_REQUEST).json({
                success:false,
                message:"Phone number already in use"
            })
        }

        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            success:false,
            message:"Faild to update profile"
        })
    }
};



    const uploadProfileImage = async(req,res)=>{
        try {
  if (!req.session.user_id) {
    return res.status(HttpStatus.BAD_REQUEST).json({
      success: false,
      message: "Please login to upload image",
    });
  }

  // Use multer middleware to handle file upload
  upload.single("profileImage")(req, res, async (err) => {
    if (err) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: err.message || "Failed to upload image",
      });
    }

    if (!req.file) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "No image file provided",
      });
    }

    // Local file path
    const imagePath = `/uploads/${req.file.filename}`;

    const updatedUser = await User.findByIdAndUpdate(
      req.session.user_id,
      { profileImage: imagePath },
      { new: true }
    ).lean();

    if (!updatedUser) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(HttpStatus.OK).json({
      success: true,
      message: "Profile image uploaded successfully",
      profileImage: imagePath,
    });
  });
} catch (error) {
  console.error("Error uploading profile image:", error);
  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: "Failed to upload profile image",
  });
}

}

const requestEmailUpdate = async(req,res)=>{
    try{
    if(!req.session.user_id){
        return res.status(HttpStatus.BAD_REQUEST).json({
            success:false,
            message:"Please login to update email"
        })
    }

    const {email} = req.body;

    if(!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)){
        return res.status(HttpStatus.BAD_REQUEST).json({
            success:false,
            message:"Please provide valid email id"
        })
    }
    let disposableDomains =[];
    const domain = email.split("@")[1];
    if (disposableDomains.includes(domain)) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Please use a non-disposable email address",
      });
    }

    const user = await User.findById(req.session.user_id);

    if(!user){
        return res.status(HttpStatus.NOT_FOUND).json({
            success:false,
            message:"User is not found"
        })
    }
    if(email.toLowerCase() === user.email.toLowerCase()){
        return res.status(HttpStatus.BAD_REQUEST).json({
            success:false,
            message:"New email should be different from current email"
        })
    }

    const existingUser = await User.findOne({email:email.toLowerCase()});

    if(existingUser){
        return res.status(HttpStatus.BAD_REQUEST).json({
            success:false,
            message:"Email id already in use"
        })
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.deleteMany({
        email:email.toLowerCase(),
        purpose:"Email-update"
    });
    await OTP.create({
        email:email.toLowerCase(),
        otp,
        purpose:"email-update"
    })
    console.log(`Generated OTP: ${otp}`)

    try {
        await sendOtpEmail(
            email,
            user.fullName,
            otp,
            "Email update verification",
            "Email-update"
        );
    } catch (error) {
        console.error("Email delivery faild",error);
        await OTP.deleteMany({
            email:toLowerCase(),
            purpose:"Email-update"
        });
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            success:false,
            message:"Email faild to send,Internal server error"
        })
    }

    req.session.newEmail = email.toLowerCase();

    res.status(HttpStatus.OK).json({
        success:true,
        message:"Email verification code sended"
    })
}catch(error){
    console.error("Error in email updating",error);
    await OTP.deleteMany({
        email:req.body.email?.toLowerCase(),
        purpose:"email-update"
    });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success:false,
        message:'Falid to process email update request'

    })
  }
}


const verifyEmailOtp = async(req,res)=>{
    try {
        const {otp} = req.body;

        const otpValidation = validateBasicOtp(otp);
    if (!otpValidation.isValid) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: otpValidation.message,
      });
    }

    const sessionValidation = validateOtpSession(req, "email-update");
    if (!sessionValidation.isValid) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: sessionValidation.message,
        sessionExpired: sessionValidation.sessionExpired,
      });
    }

    const otpRecord = await OTP.findOne({
      email: req.session.newEmail,
      otp,
      purpose: "email-update",
    });

    if (!otpRecord) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.session.user_id,
      { email: req.session.newEmail, isVerified: true },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
    }

     await OTP.deleteMany({
      email: req.session.newEmail,
      purpose: "email-update",
    });
    delete req.session.newEmail;

    res.status(HttpStatus.OK).json({
      success: true,
      message: "Email updated successfully",
      email: updatedUser.email,
    });



    } catch (error) {

        console.error("Error verifying email OTP:", error);
    if (error.code === 11000) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Email address already in use",
      });
    }
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to verify OTP",
    });
        
    }
}


const resendEmailOtp = async(req,res)=>{
    try {
        if (!req.session.user_id || !req.session.newEmail) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: "Unauthorized or invalid session",
      });
    }

    const user = await User.findById(req.session.user_id);
    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await OTP.deleteMany({
      email: req.session.newEmail,
      purpose: "email-update",
    });
    await OTP.create({
      email: req.session.newEmail,
      otp,
      purpose: "email-update",
    });

    try {
        await sendOtpEmail(
        req.session.newEmail,
        user.fullName,
        otp,
        "Email Update Verification",
        "email-update"
      );
    } catch (error) {
        console.error("Email delivery failed for resend:", error);
      
      await OTP.deleteMany({
        email: req.session.newEmail,
        purpose: "email-update",
      });
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message:
          "Email failed to send. Please check your email service.",
      });
    }

    const otpMessage = createOtpMessage(req.session.newEmail, 'resend');

    res.status(HttpStatus.OK).json({
        success:true,
        message:otpMessage.message
    })


    } catch (error) {

    console.error("Error resending email OTP:", error);
    
    await OTP.deleteMany({
      email: req.session.newEmail,
      purpose: "email-update",
    });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to resend OTP. Please try again.",
    });
        
    }
}


module.exports = {
    getProfile,
    updateProfile,
    uploadProfileImage,
    requestEmailUpdate, 
    verifyEmailOtp,
    resendEmailOtp,
}