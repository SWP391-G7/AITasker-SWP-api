const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Prevent upload of potentially malicious executable scripts/binaries
  const forbiddenExtensions = /\.(exe|bat|msi|cmd|sh|lnk|sys)$/i;
  if (forbiddenExtensions.test(file.originalname)) {
    cb(new Error('Executable and system files are not allowed'), false);
  } else {
    cb(null, true);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit as requested
});

module.exports = upload;
