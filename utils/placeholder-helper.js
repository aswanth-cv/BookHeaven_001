/**
 * Utility functions for generating placeholder image URLs
 */

const getPlaceholderUrl = (width, height, type = 'default') => {
  return `/api/placeholder/${width}/${height}?type=${type}`;
};

const getProfilePlaceholder = (size = 120) => {
  return getPlaceholderUrl(size, size, 'profile');
};

const getBookPlaceholder = (width = 600, height = 800) => {
  return getPlaceholderUrl(width, height, 'book');
};

const getProductPlaceholder = (width = 600, height = 800) => {
  return getBookPlaceholder(width, height);
};

module.exports = {
  getPlaceholderUrl,
  getProfilePlaceholder,
  getBookPlaceholder,
  getProductPlaceholder
};