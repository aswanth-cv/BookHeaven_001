const User = require("../../models/userSchema");
const bcrypt = require("bcrypt");

const getLogin = async (req, res) => {
  try {

    res.render("login");
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const existingUser = await User.findOne({ email });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "Email Not found",
      });
    }

    if (existingUser.isBlocked) {
      return res.status(400).json({
        success: false,
        message: "Your account is blocked. Please contact support.",
      });
    }

    const verifiedPassword = await bcrypt.compare(
      password,
      existingUser.password
    );

    if (!verifiedPassword) {
      return res.status(400).json({
        success: false,
        message: "Invalid Email or Password",
      });
    }

    req.session.user_id = existingUser._id;
    req.session.user_email = existingUser.email;

    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          success: false,
          message: "Session error",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Welcome to BookHaven",
      });
    });
  } catch (error) {
    console.log("Signin ERROR", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = {
  getLogin,
  postLogin,
};
