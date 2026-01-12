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
  
  // Create a simple SVG placeholder
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f8f9fa"/>
      <rect x="2" y="2" width="${width-4}" height="${height-4}" fill="none" stroke="#dee2e6" stroke-width="2" stroke-dasharray="5,5"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="14" fill="#6c757d" text-anchor="middle" dy=".3em">
        ${query} ${width}×${height}
      </text>
    </svg>
  `;
  
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
