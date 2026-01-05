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

      if (user && user.isBlocked) {
        try {
          // Handle passport logout carefully
          if (typeof req.logout === 'function') {
            try {
              await new Promise((resolve, reject) => {
                req.logout({ keepSessionInfo: true }, (err) => {
                  if (err) {
                    console.log('Error during passport logout:', err);
                  }
                  resolve(); // Always resolve to continue with manual cleanup
                });
              });
            } catch (e) {
              console.log('Passport logout failed:', e);
            }
          }
        } catch (e) {
          console.log('Error during passport logout:', e);
        }

        // Only remove user session data, keep admin session intact
        delete req.session.user_id;
        delete req.session.user_email;
        
        // Remove passport user data but keep session structure
        if (req.session.passport) {
          delete req.session.passport.user;
        }
        
        // Save session instead of destroying it
        await new Promise((resolve) => {
          req.session.save(() => resolve());
        });

        const wantsJSON = req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJSON) {
          return res.status(403).json({ success: false, requiresAuth: true, message: 'Your account is blocked. You have been logged out.' });
        }
        return res.redirect('/login?error=blocked');
      }
    } catch (error) {
      console.log("fetching user:", error);
    }
  }
  
  next();
};

module.exports = userMiddleware;