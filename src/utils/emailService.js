/**
 * Backend module: utils/emailService.js
 *
 * Vai trò: Utility email Service: đóng gói logic dùng lại ở nhiều controller.
 * Luồng chính: Nhận tham số rõ ràng, thực hiện một nhiệm vụ hẹp và trả kết quả hoặc ném lỗi cho caller xử lý.
 * Lưu ý bảo trì: Giữ utility độc lập với HTTP response nếu không thật sự cần thiết để dễ kiểm thử.
 */
const nodemailer = require('nodemailer')
require('dotenv').config()

let transporter

// Thực hiện phần logic “initialize email service” trong phạm vi trách nhiệm của module hiện tại.
const initializeEmailService = async () => {
  const hasSmtpConfig = Boolean(process.env.SMTP_HOST || process.env.SMTP_USER)

  if (hasSmtpConfig || process.env.NODE_ENV === 'production') {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com'
    const port = parseInt(process.env.SMTP_PORT, 10) || 587
    const secure = process.env.SMTP_SECURE === 'true'

    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })

    console.log(`[EmailService] Initialized real SMTP transporter (${host}:${port}) for user: ${process.env.SMTP_USER || 'none'}`)
  } else {
    console.log('[EmailService] SMTP credentials not set in environment. Generating Ethereal test account...')
    try {
      const testAccount = await nodemailer.createTestAccount()
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      })
      console.log(`[EmailService] Ethereal test account created: ${testAccount.user}`)
    } catch (err) {
      console.error('[EmailService] Failed to create Ethereal test account:', err.message)
    }
  }
}

const getSenderAddress = () => {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM
  if (process.env.SMTP_USER) return `"AITasker" <${process.env.SMTP_USER}>`
  return 'noreply@aitasker.com'
}
// Tạo hoặc gửi dữ liệu cho nghiệp vụ “send verification code”, đồng thời chuyển lỗi về caller/UI theo cơ chế của module.

const sendVerificationCode = async (email, code) => {
  try {
    if (!transporter) {
      await initializeEmailService()
    }

    const mailOptions = {
      from: getSenderAddress(),
      to: email,
      subject: 'Email Verification Code - AITasker',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to AITasker</h2>
          <p>Thank you for registering! Please verify your email address to get started.</p>
          <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666; font-size: 14px;">Your verification code is:</p>
            <p style="margin: 10px 0; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">${code}</p>
            <p style="margin: 10px 0; color: #666; font-size: 14px;">This code will expire in 15 minutes.</p>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't create this account, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">© 2026 AITasker. All rights reserved.</p>
        </div>
      `
    }

    const info = await transporter.sendMail(mailOptions)

    const previewUrl = nodemailer.getTestMessageUrl(info)
    if (previewUrl) {
      console.log('[EmailService] Ethereal Preview URL: %s', previewUrl)
    } else {
      console.log('[EmailService] Verification email sent successfully to:', email)
    }

    return info
  } catch (err) {
    console.error('Error sending verification email:', err)
    throw err
  }
}

// Tạo hoặc gửi dữ liệu cho nghiệp vụ “send password reset email”, đồng thời chuyển lỗi về caller/UI theo cơ chế của module.
const sendPasswordResetEmail = async (email, code) => {
  try {
    if (!transporter) {
      await initializeEmailService()
    }

    const mailOptions = {
      from: getSenderAddress(),
      to: email,
      subject: 'Password Reset Code - AITasker',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>We received a request to reset your password for your AITasker account.</p>
          <div style="background-color: #f0f0f0; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <p style="margin: 0; color: #666; font-size: 14px;">Your password reset code is:</p>
            <p style="margin: 10px 0; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">${code}</p>
            <p style="margin: 10px 0; color: #666; font-size: 14px;">This code will expire in 15 minutes.</p>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't request a password reset, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">© 2026 AITasker. All rights reserved.</p>
        </div>
      `
    }

    const info = await transporter.sendMail(mailOptions)

    const previewUrl = nodemailer.getTestMessageUrl(info)
    if (previewUrl) {
      console.log('[EmailService] Ethereal Preview URL: %s', previewUrl)
    } else {
      console.log('[EmailService] Password reset email sent successfully to:', email)
    }

    return info
  } catch (err) {
    console.error('Error sending password reset email:', err)
    throw err
  }
}

module.exports = {
  initializeEmailService,
  sendVerificationCode,
  sendPasswordResetEmail
};


