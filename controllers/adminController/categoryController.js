const Category = require("../../models/categorySchema");
const fs = require("fs");
const { HttpStatus } = require("../../helpers/status-code");

const getCategory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const skip = (page - 1) * limit;

    const query = {
         
      $or: [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ],
    };

    const totalCategories = await Category.countDocuments(query);
    const categories = await Category.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.render("categories", {
      categories,
      currentPage: page,
      totalPages: Math.ceil(totalCategories / limit),
      search,
    });
  } catch (error) {
    console.error("Error in rendering Categories Page:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).send("Server Error");
  }
};


const addCategory = async (req, res) => {
  try {
    const { name, description, isListed } = req.body;

    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingCategory) {
      return res.status(HttpStatus.OK).json({
        warning: true,
        message: "This category already exists in the database."
      });
    }

    // Check if image is provided
    if (!req.file) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Category image is required. Please upload an image."
      });
    }

    const imageUrl = '/uploads/' + req.file.filename;

    const category = new Category({
      name,
      description,
      image: imageUrl,
      isListed: isListed === "on",
    });

    await category.save();
    res.status(HttpStatus.CREATED).json({ message: "Category added successfully" });
  } catch (error) {
    console.error("Error adding category:", error);
    
    // Provide more specific error messages
    if (error.name === 'ValidationError') {
      const errorMessages = Object.values(error.errors).map(err => err.message);
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        error: "Validation failed", 
        details: errorMessages 
      });
    }
    
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Server Error" });
  }
};

const editCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isListed } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: "Category not found" });
    }

    const existingCategory = await Category.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      _id: { $ne: id }
    });
    if (existingCategory) {
      return res.status(HttpStatus.OK).json({
        warning: true,
        message: "Another category with this name already exists."
      });
    }

    // Update basic fields
    category.name = name;
    category.description = description;
    category.isListed = isListed === "on";

    // Only update image if a new file is uploaded
    if (req.file) {
      // Delete old image file if it exists
      if (category.image && category.image.startsWith('/uploads/')) {
        const oldImagePath = `public${category.image}`;
        try {
          if (fs.existsSync(oldImagePath)) {
            fs.unlinkSync(oldImagePath);
          }
        } catch (fileError) {
          console.warn("Could not delete old image file:", fileError.message);
        }
      }
      
      // Set new image
      category.image = '/uploads/' + req.file.filename;
    }
    // If no new file is uploaded, keep the existing image

    await category.save();
    res.json({ message: "Category updated successfully" });
  } catch (error) {
    console.error("Error editing category:", error);
    
    // Provide more specific error messages
    if (error.name === 'ValidationError') {
      const errorMessages = Object.values(error.errors).map(err => err.message);
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        error: "Validation failed", 
        details: errorMessages 
      });
    }
    
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Server Error" });
  }
};

const toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id);
    if (!category) {
      return res.status(HttpStatus.CREATED).json({ error: "Category not found" });
    }

    category.isListed = !category.isListed;
    await category.save();
    res.json({
      message: `Category ${
        category.isListed ? "listed" : "unlisted"
      } successfully`,
    });
  } catch (error) {
    console.error("Error toggling category status:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Server Error" });
  }
};

module.exports = {
  getCategory,
  addCategory,
  editCategory,
  toggleCategoryStatus,
};