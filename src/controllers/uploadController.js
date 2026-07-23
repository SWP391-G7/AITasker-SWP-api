/**
 * Backend module: controllers/uploadController.js
 *
 * Vai trò: Controller upload Controller: tiếp nhận request đã đi qua route/middleware, kiểm tra dữ liệu đầu vào và điều phối nghiệp vụ.
 * Luồng chính: Đọc req/user/params/body, làm việc với PostgreSQL hoặc dịch vụ ngoài, sau đó trả JSON chuẩn hoặc chuyển lỗi cho error middleware.
 * Lưu ý bảo trì: Khi sửa controller cần giữ status code, quyền truy cập, transaction và cấu trúc response đồng nhất với frontend.
 */
const cloudinary = require('../config/cloudinary');

// Tạo hoặc gửi dữ liệu cho nghiệp vụ “upload image”, đồng thời chuyển lỗi về caller/UI theo cơ chế của module.
const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error('No file uploaded');
      err.statusCode = 400;
      return next(err);
    }

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'aitasker', resource_type: 'image' },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    return res.status(200).json({
      success: true,
      url: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { uploadImage };
