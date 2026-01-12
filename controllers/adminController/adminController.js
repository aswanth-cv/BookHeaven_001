const User = require("../../models/userSchema");
const bcrypt = require("bcrypt");
const { HttpStatus } = require("../../helpers/status-code");

const getAdminLogin = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.render("adminLogin");
  } catch (error) {
    console.error("Error loading admin login page:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const postAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await User.findOne({ email, isAdmin: true });

    if (!admin) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: "Admin not found or not authorized",
      });
    }

    if (admin.isBlocked) {
      return res.status(HttpStatus.FORBIDDEN).json({
        success: false,
        message: "This admin account has been blocked",
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    req.session.admin_id = admin._id;

    return res.status(HttpStatus.OK).json({
      success: true,
      message: "Welcome Admin",
      redirectTo: '/admin/adminDashboard',
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Admin login error",
    });
  }
};


const logoutAdminDashboard = async (req, res) => {
  try {
    delete req.session.admin_id;
    
    req.session.save((error) => {
      if (error) {
        console.error('Error saving session after admin logout:', error);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Logout Failed');
      }
      
      res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
      
      res.redirect('/admin/adminLogin');
    });
  } catch (error) {
    console.error('Error in AdminLogout:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Internal Server Error' });
  }
};

module.exports = {
  getAdminLogin,
  postAdminLogin,
  logoutAdminDashboard
};