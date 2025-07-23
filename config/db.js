const mongoose = require("mongoose");
const env = require("dotenv").config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Database connection successful");
  } catch (error) {
    console.log(`Database connection failed: ${error.message}`);
  }
};

module.exports = connectDB;
