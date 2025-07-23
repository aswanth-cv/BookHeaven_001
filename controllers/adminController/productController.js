const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const fs = require('fs');


const getProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
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
    res.status(500).json({ message: 'Internal Server Error' });
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
      return res.status(500).json({ error: 'Invalid category' });
    }

    console.log('Uploaded Files:', req.files);

    let mainImageUrl = '';
    if (req.files && req.files.mainImage && req.files.mainImage.length > 0) {
      const file = req.files.mainImage[0];
      console.log(`Uploading main image from: ${file.path}`);
      mainImageUrl =  '/uploads/' + file.filename;
    } else {
      return res.status(500).json({ error: 'Main image is required' });
    }

    const subImages = [];
    const processedPaths = new Set(); 
    if (req.files && req.files.subImages && req.files.subImages.length > 0) {
      for (const file of req.files.subImages) {
        let pathname = '/uploads/' + file.filename
        subImages.push(pathname);
        processedPaths.add(pathname);
      }
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
    res.status(201).json({ message: 'Product added successfully' });
  } catch (error) {
    console.error('Error adding product:', error);
    if (error.message.includes('ENOENT')) {
      res.status(500).json({ error: 'File upload failed: File not found on server' });
    } else if (error.name === 'TimeoutError') {
      res.status(500).json({ error: 'Upload timed out. Please try again with a smaller file or check your network.' });
    } else {
      res.status(500).json({ error: 'Server Error' });
    }
  }
};

const toggleProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.isListed = !product.isListed;
    await product.save();
    res.json({
      message: `Product ${product.isListed ? 'listed' : 'unlisted'} successfully`,
    });
  } catch (error) {
    console.error('Error toggling product status:', error);
    res.status(500).json({ error: 'Server Error' });
  }
};

const getEditProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId).populate('category');
    const categories = await Category.find({ isListed: true });

    if (!product || product.isDeleted) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.render('editProduct', { product, categories });
  } catch (error) {
    console.error('Error fetching product for edit:', error);
    res.status(500).json({ error: 'Server Error' });
  }
};

const updateProduct = async (req, res) => {
  console.log('Update request received for productId:', req.params.id);
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

    console.log('Request body:', req.body);
    console.log('Uploaded files:', req.files);

    const product = await Product.findById(productId);
    console.log('Product found:', product);
    if (!product || product.isDeleted) {
      console.log('Product not found or deleted');
      return res.status(404).json({ error: 'Product not found' });
    }

    const categoryExists = await Category.findById(category);
    console.log('Category exists:', categoryExists);
    if (!categoryExists) {
      console.log('Invalid category');
      return res.status(500).json({ error: 'Invalid category' });
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

    console.log( req.files.subImages);
    
    if (req.files && req.files.subImages && req.files.subImages.length > 0) {
      for (const file of req.files.subImages) {
        console.log("lopp 111");
        
        const pathname = '/uploads/' + file.filename
        console.log(`Processing sub image: ${pathname}, original name: ${file.originalname}`);

        if (processedPaths.has(pathname)) {
          console.log(`Skipping duplicate sub image path: ${file.path}`);
          continue;
        }

        newSubImages.push(pathname);
        processedPaths.add(pathname); 
      }
    }

    const updatedSubImages = [...newSubImages, ...OldsubImages].slice(0, 3);


    console.log(updatedSubImages);
    




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
    console.log('Product updated:', product._id);
    res.status(200).json({ message: 'Product updated successfully' });
  } catch (error) {
    console.error('Error updating product:', error);
    if (error.message.includes('ENOENT')) {
      res.status(500).json({ error: 'File upload failed: File not found on server' });
    } else {
      res.status(500).json({ error: 'Server Error' });
    }
  }
};
const softDeleteProduct = async (req, res) => {
  console.log('Soft delete request received for productId:', req.params.id);
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    console.log('Product found:', product);
    if (!product) {
      console.log('Product not found');
      return res.status(404).json({ error: 'Product not found' });
    }

    product.isDeleted = true;
    await product.save();
    console.log('Product soft deleted:', product._id);
    res.status(200).json({ message: 'Product soft deleted successfully' });
  } catch (error) {
    console.error('Error soft deleting product:', error);
    res.status(500).json({ error: 'Server Error' });
  }
};

module.exports = { getProducts, addProduct, toggleProductStatus, getEditProduct, updateProduct, softDeleteProduct };