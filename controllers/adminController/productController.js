const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const { HttpStatus } = require("../../helpers/status-code");
const fs = require('fs');


const getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const search = req.query.search || '';
    const categoryFilter = req.query.category || '';
    const sortBy = req.query.sort || 'newest';
    const skip = (page - 1) * limit;

    
    const query = { isDeleted: false };

    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
      ];
    }

    if (categoryFilter) {
      query.category = categoryFilter;
    }

    let sortOption = { createdAt: -1 };
    if (sortBy === 'oldest') sortOption = { createdAt: 1 };
    else if (sortBy === 'price-low') sortOption = { salePrice: 1 };
    else if (sortBy === 'price-high') sortOption = { salePrice: -1 };
    else if (sortBy === 'stock-high') sortOption = { stock: -1 };

   
    const totalProducts = await Product.countDocuments(query);
    const products = await Product.find(query)
      .populate('category')
      .sort(sortOption)
      .skip(skip)
      .limit(limit);

    const categories = await Category.find({ isListed: true });

    res.render('getProducts', {
      products,
      categories,
      currentPage: page,
      totalPages: Math.ceil(totalProducts / limit),
      totalProducts,
      search,
      categoryFilter,
      sortBy,
      limit,
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Internal Server Error' });
  }
};

const addProduct = async (req, res) => {
  try {
    const {
      title,
      author,
      description,
      category,
      regularPrice,
      salePrice,
      stock,
      pages,
      language,
      publisher,
      publishedDate,
      isbn,
      isListed,
    } = req.body;

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Invalid category' });
    }


    let mainImageUrl = '';
    if (req.files && req.files.mainImage && req.files.mainImage.length > 0) {
      const file = req.files.mainImage[0];
      mainImageUrl =  '/uploads/' + file.filename;
    } else {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Main image is required' });
    }

    // Validate that all 3 sub-images are provided
    if (!req.files || !req.files.subImages || req.files.subImages.length !== 3) {
      return res.status(HttpStatus.BAD_REQUEST).json({ 
        error: 'All three sub-images are required. Please upload exactly 3 sub-images.' 
      });
    }

    const subImages = [];
    const processedPaths = new Set(); 
    for (const file of req.files.subImages) {
      let pathname = '/uploads/' + file.filename
      subImages.push(pathname);
      processedPaths.add(pathname);
    }



    const product = new Product({
      title: title.trim(),
      author: author.trim(),
      description,
      category,
      regularPrice: parseFloat(regularPrice),
      salePrice: parseFloat(salePrice),
      stock: parseInt(stock),
      pages: parseInt(pages),
      language,
      publisher,
      publishedDate: publishedDate ? new Date(publishedDate) : undefined,
      isbn,
      mainImage: mainImageUrl,
      subImages,
      isListed: isListed === 'on',
      isDeleted: false,
    });

    await product.save();
    res.status(HttpStatus.CREATED).json({ message: 'Product added successfully' });
  } catch (error) {
    console.error('Error adding product:', error);
    if (error.message.includes('ENOENT')) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'File upload failed: File not found on server' });
    } else if (error.name === 'TimeoutError') {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Upload timed out. Please try again with a smaller file or check your network.' });
    } else {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Server Error' });
    }
  }
};

const toggleProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'Product not found' });
    }

    product.isListed = !product.isListed;
    await product.save();
    res.json({
      message: `Product ${product.isListed ? 'listed' : 'unlisted'} successfully`,
    });
  } catch (error) {
    console.error('Error toggling product status:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Server Error' });
  }
};

const getEditProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId).populate('category');
    const categories = await Category.find({ isListed: true });

    if (!product || product.isDeleted) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'Product not found' });
    }

    res.render('editProduct', { product, categories });
  } catch (error) {
    console.error('Error fetching product for edit:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Server Error' });
  }
};

const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const {
      title,
      author,
      description,
      category,
      regularPrice,
      salePrice,
      stock,
      pages,
      language,
      publisher,
      publishedDate,
      isbn,
      isListed,
    } = req.body;

    

    const product = await Product.findById(productId);
    if (!product || product.isDeleted) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'Product not found' });
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Invalid category' });
    }

    let mainImageUrl = product.mainImage;
    if (req.files && req.files.mainImage && req.files.mainImage.length > 0) {
      const file = req.files.mainImage[0];
      let pathname = '/uploads/' + file.filename
      mainImageUrl = pathname;
    }



    const OldsubImages = product.subImages || [];
    const newSubImages = [];
    const processedPaths = new Set(OldsubImages);

    if (req.files && req.files.subImages && req.files.subImages.length > 0) {
      for (const file of req.files.subImages) {
        
        const pathname = '/uploads/' + file.filename

        if (processedPaths.has(pathname)) {
          continue;
        }

        newSubImages.push(pathname);
        processedPaths.add(pathname); 
      }
    }

    const updatedSubImages = [...newSubImages, ...OldsubImages].slice(0, 3);

    product.title = title;
    product.author = author;
    product.description = description;
    product.category = category;
    product.regularPrice = parseFloat(regularPrice);
    product.salePrice = parseFloat(salePrice);
    product.stock = parseInt(stock);
    product.pages = parseInt(pages);
    product.language = language;
    product.publisher = publisher;
    product.publishedDate = publishedDate ? new Date(publishedDate) : undefined;
    product.isbn = isbn;
    product.mainImage = mainImageUrl;
    product.subImages = updatedSubImages;
    product.isListed = isListed === 'on';

    await product.save();
    res.status(HttpStatus.OK).json({ message: 'Product updated successfully' });
  } catch (error) {
    console.error('Error updating product:', error);
    if (error.message.includes('ENOENT')) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'File upload failed: File not found on server' });
    } else {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Server Error' });
    }
  }
};
const softDeleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'Product not found' });
    }

    product.isDeleted = true;
    await product.save();
    res.status(HttpStatus.OK).json({ message: 'Product soft deleted successfully' });
  } catch (error) {
    console.error('Error soft deleting product:', error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Server Error' });
  }
};

module.exports = {
  getProducts,
  addProduct,
  toggleProductStatus,
  getEditProduct,
  updateProduct,
  softDeleteProduct
       };