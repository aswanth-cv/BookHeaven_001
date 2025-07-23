const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/userSchema");
require("dotenv").config();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3005/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          if (user.isBlocked) {
            return done(null, false, {
              message: "Your account is blocked. Please contact support.",
            });
          }
          return done(null, user);
        }

        user = await User.findOne({ email: profile.emails[0].value });

        if (user) {
          if (user.isBlocked) {
            return done(null, false, {
              message: "Your account is blocked. Please contact support.",
            });
          }
          user.googleId = profile.id;
          user.isVerified = true; 
          await user.save();
          return done(null, user);
        }

      
        const newUser = new User({
          fullName: profile.displayName,
          email: profile.emails[0].value,
          googleId: profile.id,
          isVerified: true,
          isBlocked: false,
        });
        await newUser.save();
        return done(null, newUser);
      } catch (err) {
        console.error("Error in Google Strategy:", err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    if (!user) {
      return done(null, false);
    }
    if (user.isBlocked) {
      return done(null, false, {
        message: "Your account is blocked. Please contact support.",
      });
    }
    done(null, user);
  } catch (err) {
    console.error("Error in deserializeUser:", err);
    done(err, null);
  }
});

module.exports = passport;