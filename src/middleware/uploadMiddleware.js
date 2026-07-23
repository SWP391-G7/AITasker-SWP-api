/**
 * Backend module: middleware/uploadMiddleware.js
 *
 * Vai trò: Middleware upload Middleware: xử lý yêu cầu dùng chung trước hoặc sau controller.
 * Luồng chính: Đọc request, bổ sung context hoặc chuẩn hóa lỗi rồi gọi next để chuyển sang bước kế tiếp.
 * Lưu ý bảo trì: Middleware phải kết thúc response hoặc gọi next đúng một lần để tránh request bị treo.
 */
const multer = require('multer');

const storage = multer.memoryStorage();

// Thực hiện phần logic “file filter” trong phạm vi trách nhiệm của module hiện tại.
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;
