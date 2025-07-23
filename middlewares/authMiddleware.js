
const isAuthenticated = (req, res, next) => {
     if (req.session && req.session.user_id) {
       return next();
     }
     return res.redirect('/login');
   };
   

   const isNotAuthenticated = (req, res, next) => {
     if (req.session && req.session.user_id) {
       return res.redirect('/');
     }
     return next();
   };
   

   const preventBackButtonCache = (req, res, next) => {
     res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
     res.header('Pragma', 'no-cache');
     res.header('Expires', '0');
     next();
   };
   
   module.exports = {
     isAuthenticated,
     isNotAuthenticated,
     preventBackButtonCache
   };