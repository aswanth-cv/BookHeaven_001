
const { HttpStatus } = require("../../helpers/status-code");



const logout = async (req, res) => {
  try {
    if (typeof req.logout === 'function') {
      try {
        await new Promise((resolve, reject) => {
          req.logout({ keepSessionInfo: true }, (err) => {
            if (err) {
              console.error('Passport logout error:', err);
              resolve();
            } else {
              resolve();
            }
          });
        });
      } catch (passportError) {
        console.error('Passport logout failed:', passportError);
      }
    }
    
    delete req.session.user_id;
    delete req.session.user_email;
    
    if (req.session.passport) {
      delete req.session.passport.user;
    }
    
    req.session.save((err) => {
      if (err) {
        console.error("Error saving session after user logout:", err);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Logout failed");
      }
      
      res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
      
      res.redirect("/login");
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Internal Server Error");
  }
};

module.exports = { logout };