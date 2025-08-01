const User = require("../models/userSchema");

const userMiddleware = async (req, res, next) => {
  res.locals.user = null;

  if (req.isAuthenticated() && req.user) {
    res.locals.user = req.user;

   
    if (!req.session.user_id) {
      req.session.user_id = req.user._id;
         
    }
  } 
  
  if (req.session && req.session.user_id) {
    try {
      const user = await User.findById(req.session.user_id);
      res.locals.user = user;
    } catch (error) {
      console.log("fetching user:", error);
    }
  }
  
  next();
};

module.exports = userMiddleware;