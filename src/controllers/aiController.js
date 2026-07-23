/**
 * Backend module: controllers/aiController.js
 *
 * Vai trò: Controller ai Controller: tiếp nhận request đã đi qua route/middleware, kiểm tra dữ liệu đầu vào và điều phối nghiệp vụ.
 * Luồng chính: Đọc req/user/params/body, làm việc với PostgreSQL hoặc dịch vụ ngoài, sau đó trả JSON chuẩn hoặc chuyển lỗi cho error middleware.
 * Lưu ý bảo trì: Khi sửa controller cần giữ status code, quyền truy cập, transaction và cấu trúc response đồng nhất với frontend.
 */
// Pool PostgreSQL được dùng ở cuối request để lưu lịch sử sử dụng AI.
const { pool } = require('../config/db');

/**
 * Chọn prompt theo `type` mà frontend gửi lên.
 *
 * Mỗi prompt yêu cầu Gemini trả đúng một JSON object với schema cố định.
 * Nhờ vậy frontend có thể gán trực tiếp từng field vào form thay vì phải
 * phân tích một đoạn văn tự do. `context` chỉ dùng ở các luồng cần thông tin
 * về job/service đích như proposal hoặc service request.
 */
const getPromptTemplate = (type, text, context = '') => {
  // Không đưa dòng context rỗng vào prompt để tránh làm model hiểu nhầm.
  const contextString = context ? `\nTarget context details (e.g. task requirements or service details):\n"${context}"` : '';

  switch (type) {
    // Create Job Post: sinh đồng thời title, scope, skills và requirements.
    case 'job_description':
      return `Generate a high-fidelity technical job posting based on this casual draft: "${text}".
You must respond with a JSON object containing exactly four string fields:
- "title": A descriptive, professional job title.
- "description": A detailed, structured technical project scope with project overview, key deliverables, and client expectations. Must be at least 100 characters.
- "skills": A comma-separated list of required technical skills and tools. Limit this list strictly to around 3-4 items only (e.g., python, llm, reactjs).
- "requirements": A detailed bulleted description of developer requirements and qualifications (e.g. minimum experience, background, availability).

Example JSON:
{
  "title": "React Frontend Developer for SaaS Dashboard",
  "description": "We are seeking a skilled React developer to build a modern SaaS dashboard...",
  "skills": "ReactJS, TypeScript, Chart.js",
  "requirements": "- Minimum 3 years experience with ReactJS\n- Experience building dashboard metrics and visualizations\n- Availability for weekly progress calls"
}`;

    // Create Service: tạo nội dung bán dịch vụ và tag tìm kiếm.
    case 'service_description':
      return `Generate a compelling, professional service offering listing based on this casual draft: "${text}".
You must respond with a JSON object containing exactly three string fields:
- "title": An eye-catching, professional service title. Do NOT start the title with "I will" or "i will" (e.g. use "Full-Stack Web Development & API Integration" instead of "I will build a full stack website").
- "description": A detailed explanation of your service, your process, benefits, and deliverables.
- "tags": A comma-separated list of search tags or skills. Limit this list strictly to around 3-4 items only (e.g., python, llm, reactjs).

Example JSON:
{
  "title": "Full-Stack Web Development & API Integration",
  "description": "I offer high-quality full-stack web development services...",
  "tags": "Node.js, ReactJS, PostgreSQL"
}`;

    // Proposal: dùng thêm context của job để nội dung bám sát yêu cầu khách hàng.
    case 'proposal':
      return `Generate a highly professional, concise project proposal summary and implementation approach based on this casual draft: "${text}".${contextString}
Do NOT use formal letter salutations (such as "Dear Hiring Manager", "Sincerely", or signatures). Respond with a direct, short coverage of what you can do and why you are the best fit.
You must respond with a JSON object containing exactly two string fields:
- "coverLetter": A concise, persuasive summary of your capabilities and why you are the best fit, specifically tailored to the target task/job details if provided.
- "implementationApproach": A structured list of milestones, tools, and technical delivery details, tailored to the target task/job details if provided.

Example JSON:
{
  "coverLetter": "I can build the React dashboard using Redux Toolkit and Chart.js, ensuring full responsiveness and integration with your Node.js API within two weeks...",
  "implementationApproach": "1. Setup & Tailwind configuration; 2. State management & API routing; 3. Testing & staging deployment"
}`;

    // Service Request: Client mô tả yêu cầu tùy chỉnh cho một service cụ thể.
    case 'request':
      return `Generate a clear, direct, and concise client service request summary based on this casual draft: "${text}".${contextString}
Do NOT use formal letter salutations. Respond with a direct, short coverage of your project needs.
You must respond with a JSON object containing exactly one string field:
- "coverLetter": A concise summary of your project requirements, customization needs, and target timeline, specifically tailored to the target service details if provided.

Example JSON:
{
  "coverLetter": "We need to integrate the Stripe payment checkout module with your existing e-commerce setup, aiming for completion by next Friday..."
}`;

    // Prompt cũ dùng cho onboarding Expert; được giữ lại để không phá luồng hiện có.
    case 'bio':
      return `Generate a professional, engaging bio and professional title based on this casual draft: "${text}".
You must respond with a JSON object containing exactly three string fields:
- "professionalTitle": A concise professional title (e.g. Senior Machine Learning Engineer).
- "skills": A comma-separated list of core expertise skills. Limit this list strictly to around 3-4 items only (e.g., python, llm, reactjs).
- "bio": An engaging, professional summary of qualifications and experience.

Example JSON:
{
  "professionalTitle": "Senior AI Integration Developer",
  "skills": "Python, Gemini API, ReactJS",
  "bio": "Passionate software engineer specializing in building intelligent systems..."
}`;

    /**
     * Edit Profile của Expert.
     * Quy tắc "không bịa" rất quan trọng vì đây là thông tin công khai dùng
     * để khách hàng đánh giá năng lực và độ tin cậy của chuyên gia.
     */
    case 'profile_expert':
      return `Polish this AI expert profile draft while preserving all truthful details supplied by the user: "${text}".
You must respond with a JSON object containing exactly three string fields:
- "professionalTitle": A concise, credible professional title.
- "skills": A comma-separated list of 3-4 core skills grounded only in the draft.
- "bio": An engaging first-person professional summary of the expert's experience, strengths, and value to clients. Do not invent employers, qualifications, metrics, or years of experience.

Example JSON:
{
  "professionalTitle": "Senior AI Integration Developer",
  "skills": "Python, Gemini API, ReactJS",
  "bio": "I specialize in building reliable AI-powered applications and integrating intelligent workflows into modern web products..."
}`;

    /**
     * Edit Profile của Client.
     * Schema riêng tránh dùng nhầm professionalTitle/skills của Expert và
     * đảm bảo frontend nhận đúng companyName/industry/bio.
     */
    case 'profile_client':
      return `Polish this client or company profile draft while preserving all truthful details supplied by the user: "${text}".
You must respond with a JSON object containing exactly three string fields:
- "companyName": A clean company or client display name based on the draft. Do not invent a new company name.
- "industry": A concise industry label based on the draft.
- "bio": An engaging company overview describing its focus, typical projects, and mission. Do not invent achievements, metrics, locations, or services not present in the draft.

Example JSON:
{
  "companyName": "AITasker",
  "industry": "Artificial Intelligence",
  "bio": "AITasker connects organizations with experienced AI professionals to deliver practical, high-impact technology projects..."
}`;

    // Fallback an toàn cho type chưa có template chuyên biệt.
    default:
      return `Polishing and extending the following draft: "${text}". 
Respond with a JSON object containing exactly one string field:
- "coverLetter": The polished and extended text.`;
  }
};

/**
 * Bảng ai_logs chỉ chấp nhận enum `job_assistant` hoặc `service_generator`
 * cho các tính năng đang dùng ở controller này. Hàm này ánh xạ type chi tiết
 * của API về enum tổng quát để câu INSERT không vi phạm constraint của DB.
 */
const getModuleType = (type) => {
  if (['job_description', 'proposal', 'request', 'profile_client'].includes(type)) {
    return 'job_assistant';
  }
  return 'service_generator';
};

/**
 * @desc    Generate structured form fields using Gemini AI
 * @route   POST /api/ai/generate
 * @access  Private
 *
 * Middleware `protect` chạy trước controller nên `req.user.id` đã được lấy
 * từ access token hợp lệ. Controller chỉ chịu trách nhiệm validate nội dung,
 * gọi Gemini, chuẩn hóa JSON, ghi log và trả kết quả.
 */
const generateFormFields = async (req, res, next) => {
  // userId phục vụ audit log; text/type/context là payload từ AIExtendButton.
  const userId = req.user.id;
  const { text, type, context } = req.body;

  // Bước 1: chặn prompt trống để không tốn quota AI và trả lỗi 400 rõ ràng.
  if (!text || typeof text !== 'string' || text.trim() === '') {
    const err = new Error('Text input is required');
    err.statusCode = 400;
    return next(err);
  }

  // Type là khóa chọn schema output, vì vậy bắt buộc phải là chuỗi.
  if (!type || typeof type !== 'string') {
    const err = new Error('Request type is required');
    err.statusCode = 400;
    return next(err);
  }

  // Không để lộ tình trạng API key cho client; mọi lỗi hạ tầng dùng thông báo chung.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI Core busy');
    err.statusCode = 500;
    return next(err);
  }

  // Cho phép đổi model bằng biến môi trường mà không cần sửa source code.
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  // Trim input trước khi nhúng vào prompt và trước khi ghi log.
  const promptText = getPromptTemplate(type, text.trim(), context);
  const moduleType = getModuleType(type);

  try {
    // Bước 2: gọi REST API của Gemini bằng model và API key đã cấu hình.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Gemini nhận hội thoại dưới dạng contents -> parts.
          contents: [
            {
              parts: [
                {
                  text: promptText,
                },
              ],
            },
          ],
          generationConfig: {
            // Yêu cầu MIME JSON để tăng xác suất model trả output parse được.
            responseMimeType: 'application/json',
            // Temperature vừa phải: nội dung tự nhiên nhưng không quá ngẫu nhiên.
            temperature: 0.7,
            // Giới hạn output để kiểm soát độ dài, độ trễ và chi phí.
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    // Gemini vẫn trả body JSON khi HTTP status là lỗi, nên đọc body trước khi check.
    const data = await response.json();

    // Ghi chi tiết lỗi ở server, nhưng chỉ trả thông báo ổn định cho frontend.
    if (!response.ok) {
      console.error('Gemini REST API Error response:', data);
      const err = new Error('AI Core busy');
      err.statusCode = response.status || 500;
      return next(err);
    }

    // Ứng dụng chỉ yêu cầu một candidate nên lấy phần tử đầu tiên.
    const candidate = data.candidates?.[0];

    // Safety match là lỗi do nội dung đầu vào, trả 400 để người dùng sửa draft.
    if (candidate?.finishReason === 'SAFETY') {
      const err = new Error('Safety filter matched. Please revise your text.');
      err.statusCode = 400;
      return next(err);
    }

    // Nội dung text thực tế nằm trong candidate.content.parts[0].
    const outputText = candidate?.content?.parts?.[0]?.text;

    // Candidate không có text được xem là lỗi upstream, không trả object rỗng.
    if (!outputText) {
      const err = new Error('AI Core busy');
      err.statusCode = 500;
      return next(err);
    }

    /**
     * Bước 3: parse và phục hồi JSON.
     * Dù đã yêu cầu responseMimeType JSON, model đôi khi vẫn bọc kết quả bằng
     * markdown fence hoặc thêm ký tự thừa. Các fallback dưới đây xử lý những
     * trường hợp đó trước khi kết luận output không hợp lệ.
     */
    let parsedJson;
    let cleanText = outputText.trim();

    // Loại bỏ ```json ... ``` nhưng giữ nguyên phần JSON bên trong.
    if (cleanText.startsWith("```")) {
      const firstNewline = cleanText.indexOf("\n");
      if (firstNewline !== -1) {
        cleanText = cleanText.substring(firstNewline + 1);
      }
      if (cleanText.endsWith("```")) {
        cleanText = cleanText.substring(0, cleanText.length - 3).trim();
      }
    }

    // Thử đường chuẩn trước vì phần lớn response đã là JSON hợp lệ.
    try {
      parsedJson = JSON.parse(cleanText);
    } catch (parseError) {
      // Nếu có prose/ký tự thừa, lấy vùng từ dấu { đầu tiên đến } cuối cùng.
      let success = false;
      const firstBrace = cleanText.indexOf("{");
      const lastBrace = cleanText.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        let tempText = cleanText.substring(firstBrace, lastBrace + 1);
        try {
          parsedJson = JSON.parse(tempText);
          success = true;
        } catch (innerErr) {
          /**
           * Một số response có nhiều dấu } dư ở cuối. Vòng lặp thu ngắn
           * từng object candidate và thử parse lại cho đến khi thành công
           * hoặc không còn dấu đóng object hợp lệ.
           */
          while (tempText.endsWith("}") && tempText.length > 2) {
            tempText = tempText.slice(0, -1).trim();
            const nextLastBrace = tempText.lastIndexOf("}");
            if (nextLastBrace !== -1) {
              tempText = tempText.substring(0, nextLastBrace + 1);
              try {
                parsedJson = JSON.parse(tempText);
                success = true;
                break;
              } catch (retryErr) {
                // Chưa hợp lệ: tiếp tục bỏ candidate ở cuối trong vòng lặp.
              }
            } else {
              break;
            }
          }
        }
      }

      // Không bao giờ chuyển raw text lỗi cho frontend vì schema form sẽ bị phá vỡ.
      if (!success) {
        console.error("Failed to parse Gemini JSON output after all recovery attempts. Original:", outputText);
        const err = new Error("AI Core busy");
        err.statusCode = 500;
        return next(err);
      }
    }

    /**
     * Bước 4: ghi audit log AI.
     * Log lưu input gốc và output gốc để theo dõi chất lượng hoặc điều tra lỗi.
     * Đây là tác vụ phụ: lỗi DB log không được làm thất bại kết quả AI hợp lệ.
     */
    try {
      await pool.query(
        `INSERT INTO ai_logs (user_id, module_type, input_prompt, ai_output)
         VALUES ($1, $2, $3, $4)`,
        [userId, moduleType, text.trim(), outputText.trim()]
      );
    } catch (dbError) {
      // Chỉ log phía server; người dùng vẫn nhận được nội dung vừa tạo.
      console.error('Failed to log AI execution to database:', dbError);
    }

    // Bước 5: trả object đã parse để frontend merge vào form hiện tại.
    return res.status(200).json({
      success: true,
      data: parsedJson,
    });
  } catch (error) {
    // Bắt lỗi mạng, timeout, JSON body upstream hoặc lỗi runtime ngoài dự kiến.
    console.error('Gemini request error:', error);
    const err = new Error('AI Core busy');
    err.statusCode = 500;
    return next(err);
  }
};

// Route aiRoutes import controller qua CommonJS.
module.exports = {
  generateFormFields,
};
