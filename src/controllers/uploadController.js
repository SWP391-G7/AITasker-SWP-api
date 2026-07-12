const { PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const s3Client = require('../config/s3Client');

const uploadImage = async (req, res, next) => {
  try {
    // Support both upload.single('fieldname') and upload.any() (req.files)
    const file = req.file || (req.files && req.files[0]);

    if (!file) {
      const err = new Error('No file uploaded');
      err.statusCode = 400;
      return next(err);
    }

    // 1. Generate a unique name for the file in S3 to prevent collisions
    const fileExtension = file.originalname.split('.').pop();
    const uniqueKey = `${crypto.randomUUID()}.${fileExtension}`;

    // 2. PutObjectCommand settings
    const s3Params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: uniqueKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    const command = new PutObjectCommand(s3Params);
    await s3Client.send(command);

    // 3. Construct the public file URL
    const fileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueKey}`;

    return res.status(200).json({
      success: true,
      url: fileUrl,
      key: uniqueKey,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { uploadImage };
