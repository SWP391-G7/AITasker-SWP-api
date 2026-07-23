/**
 * Backend module: config/cloudinary.js
 *
 * Vai trò: Cấu hình cloudinary: khởi tạo kết nối hoặc tài nguyên hạ tầng dùng chung của backend.
 * Luồng chính: Đọc biến môi trường, tạo client/pool và export instance cho controller hoặc utility tái sử dụng.
 * Lưu ý bảo trì: Không hard-code secret; mọi credential phải lấy từ environment.
 */
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
