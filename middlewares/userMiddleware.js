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
          if (typeof req.logout === 'function') {
            await new Promise((resolve, reject) => {
              req.logout((err) => (err ? reject(err) : resolve()));
            });
          }
        } catch (e) {
          console.log('Error during passport logout:', e);
        }

        await new Promise((resolve) => {
          if (req.session) {
            req.session.destroy(() => resolve());
          } else {
            resolve();
          }
        });
        try {
          res.clearCookie('connect.sid');
        } catch (_) {}

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