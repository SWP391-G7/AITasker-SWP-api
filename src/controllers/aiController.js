const { pool } = require('../config/db');

// Map prompt templates based on use cases
const getPromptTemplate = (type, text, context = '') => {
  const contextString = context ? `\nTarget context details (e.g. task requirements or service details):\n"${context}"` : '';
  switch (type) {
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

    case 'request':
      return `Generate a clear, direct, and concise client service request summary based on this casual draft: "${text}".${contextString}
Do NOT use formal letter salutations. Respond with a direct, short coverage of your project needs.
You must respond with a JSON object containing exactly one string field:
- "coverLetter": A concise summary of your project requirements, customization needs, and target timeline, specifically tailored to the target service details if provided.

Example JSON:
{
  "coverLetter": "We need to integrate the Stripe payment checkout module with your existing e-commerce setup, aiming for completion by next Friday..."
}`;

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

    default:
      return `Polishing and extending the following draft: "${text}". 
Respond with a JSON object containing exactly one string field:
- "coverLetter": The polished and extended text.`;
  }
};

// Map route types to database enum: 'job_assistant' or 'service_generator'
const getModuleType = (type) => {
  if (['job_description', 'proposal', 'request'].includes(type)) {
    return 'job_assistant';
  }
  return 'service_generator';
};

/**
 * @desc    Generate structured form fields using Gemini AI
 * @route   POST /api/ai/generate
 * @access  Private
 */
const generateFormFields = async (req, res, next) => {
  const userId = req.user.id;
  const { text, type, context } = req.body;

  // 1. Validation
  if (!text || typeof text !== 'string' || text.trim() === '') {
    const err = new Error('Text input is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!type || typeof type !== 'string') {
    const err = new Error('Request type is required');
    err.statusCode = 400;
    return next(err);
  }

  // Check key availability
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI Core busy');
    err.statusCode = 500;
    return next(err);
  }

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const promptText = getPromptTemplate(type, text.trim(), context);
  const moduleType = getModuleType(type);

  try {
    // 2. Call Google Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
            responseMimeType: 'application/json',
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini REST API Error response:', data);
      const err = new Error('AI Core busy');
      err.statusCode = response.status || 500;
      return next(err);
    }

    const candidate = data.candidates?.[0];

    // Exception 2: Content Filter / Safety match
    if (candidate?.finishReason === 'SAFETY') {
      const err = new Error('Safety filter matched. Please revise your text.');
      err.statusCode = 400;
      return next(err);
    }

    const outputText = candidate?.content?.parts?.[0]?.text;

    if (!outputText) {
      const err = new Error('AI Core busy');
      err.statusCode = 500;
      return next(err);
    }

    // Try parsing generated text to verify valid JSON with robust cleaning fallback
    let parsedJson;
    let cleanText = outputText.trim();

    // 1. Strip markdown code block wrappers if present
    if (cleanText.startsWith("```")) {
      const firstNewline = cleanText.indexOf("\n");
      if (firstNewline !== -1) {
        cleanText = cleanText.substring(firstNewline + 1);
      }
      if (cleanText.endsWith("```")) {
        cleanText = cleanText.substring(0, cleanText.length - 3).trim();
      }
    }

    // 2. Attempt parsing with recovery strategies
    try {
      parsedJson = JSON.parse(cleanText);
    } catch (parseError) {
      let success = false;
      const firstBrace = cleanText.indexOf("{");
      const lastBrace = cleanText.lastIndexOf("}");

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        let tempText = cleanText.substring(firstBrace, lastBrace + 1);
        try {
          parsedJson = JSON.parse(tempText);
          success = true;
        } catch (innerErr) {
          // If that fails, try recursively stripping trailing braces or characters
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
                // Continue stripping from the end
              }
            } else {
              break;
            }
          }
        }
      }

      if (!success) {
        console.error("Failed to parse Gemini JSON output after all recovery attempts. Original:", outputText);
        const err = new Error("AI Core busy");
        err.statusCode = 500;
        return next(err);
      }
    }

    // 3. Write record into database logs (ai_logs table)
    try {
      await pool.query(
        `INSERT INTO ai_logs (user_id, module_type, input_prompt, ai_output)
         VALUES ($1, $2, $3, $4)`,
        [userId, moduleType, text.trim(), outputText.trim()]
      );
    } catch (dbError) {
      // Don't block client response if logging fails, but log it on server
      console.error('Failed to log AI execution to database:', dbError);
    }

    // 4. Return result
    return res.status(200).json({
      success: true,
      data: parsedJson,
    });
  } catch (error) {
    console.error('Gemini request error:', error);
    const err = new Error('AI Core busy');
    err.statusCode = 500;
    return next(err);
  }
};

module.exports = {
  generateFormFields,
};
