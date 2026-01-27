const express = require("express");
const app = express();
const path = require("path");
const env = require("dotenv").config();
const session = require("express-session");
const connectDB = require("./config/db");
const userRouter = require("./routes/userRoutes/userRouter");
const passport = require("./config/passport");
const methodOverride = require('method-override');
const userMiddleware = require("./middlewares/userMiddleware");
const adminRoute = require("./routes/adminRoutes/adminRouter");
const { addHeaderData } = require("./middlewares/headerDataMiddleware");



connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie:{
      secure: false,
      httpOnly: true,
      maxAge: 72 * 60 * 60 * 1000,
    },
  }));


app.use((req, res, next) => {
  res.locals.isAuthenticated = !!req.session.user_id;
  res.locals.user = req.session.user_id ? { id: req.session.user_id } : null;
  next();
});

// Add header data (cart and wishlist counts) to all requests
app.use(addHeaderData);


app.use(passport.initialize());
app.use(passport.session());
app.use(userMiddleware);

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.set("view engine", "ejs");

app.set("views", [
  path.join(__dirname, "views/user"),
  path.join(__dirname, "views/admin"),
  path.join(__dirname, "views")
]);


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/validators', express.static(path.join(__dirname, 'validators')));

app.use(express.static(path.join(__dirname, "public")));
app.use(methodOverride('_method'));

// Simple placeholder image service
app.get('/api/placeholder/:width/:height', (req, res) => {
  const { width, height } = req.params;
  const query = req.query.query || 'placeholder';
  const type = req.query.type || 'default';
  
  let svg;
  
  if (type === 'profile' || query.includes('profile')) {
    // Create a profile placeholder with user icon
    svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="profileGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#e3f2fd;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#bbdefb;stop-opacity:1" />
          </linearGradient>
        </defs>
        <circle cx="${width/2}" cy="${height/2}" r="${Math.min(width, height)/2}" fill="url(#profileGrad)"/>
        <circle cx="${width/2}" cy="${height/2 - height*0.1}" r="${height*0.15}" fill="#90a4ae"/>
        <path d="M ${width*0.25} ${height*0.75} Q ${width*0.5} ${height*0.55} ${width*0.75} ${height*0.75} 
                 Q ${width*0.75} ${height*0.85} ${width*0.5} ${height*0.85} 
                 Q ${width*0.25} ${height*0.85} ${width*0.25} ${height*0.75} Z" fill="#90a4ae"/>
      </svg>
    `;
  } else if (type === 'book' || query.includes('book') || query.includes('product')) {
    // Create a book placeholder
    svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#f5f5f5;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#e0e0e0;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bookGrad)"/>
        <rect x="${width*0.15}" y="${height*0.1}" width="${width*0.7}" height="${height*0.8}" fill="#fff" stroke="#ddd" stroke-width="1"/>
        <rect x="${width*0.15}" y="${height*0.1}" width="${width*0.05}" height="${height*0.8}" fill="#333"/>
        <line x1="${width*0.25}" y1="${height*0.25}" x2="${width*0.75}" y2="${height*0.25}" stroke="#ccc" stroke-width="1"/>
        <line x1="${width*0.25}" y1="${height*0.35}" x2="${width*0.65}" y2="${height*0.35}" stroke="#ccc" stroke-width="1"/>
        <line x1="${width*0.25}" y1="${height*0.45}" x2="${width*0.7}" y2="${height*0.45}" stroke="#ccc" stroke-width="1"/>
        <text x="50%" y="85%" font-family="Arial, sans-serif" font-size="10" fill="#999" text-anchor="middle">
          ${width}×${height}
        </text>
      </svg>
    `;
  } else {
    // Default placeholder
    svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f8f9fa"/>
        <rect x="2" y="2" width="${width-4}" height="${height-4}" fill="none" stroke="#dee2e6" stroke-width="2" stroke-dasharray="5,5"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="14" fill="#6c757d" text-anchor="middle" dy=".3em">
          ${query} ${width}×${height}
        </text>
      </svg>
    `;
  }
  
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  res.send(svg);
});

app.use("/", userRouter);
app.use('/admin', adminRoute)

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

module.exports = app;
