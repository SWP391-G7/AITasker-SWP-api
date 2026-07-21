# AITasker API (`aitasker-swp-api`)

The backend RESTful API & Real-time WebSocket server for AITasker, built with Node.js, Express, and PostgreSQL. It manages user authentication, project workflows, proposals, escrow payment handling, milestone tracking, real-time messaging, file uploads, and admin oversight.

---

## Key Features

- **Authentication & Security**: JWT-based authentication, bcrypt password hashing, Google OAuth token verification, and role-based access control middleware.
- **Database & Migration Tools**: PostgreSQL connection pool (`pg`) with SQL schema initialization (`schema.sql`), database seed scripts (`seedDb.js`), and migration utilities.
- **Real-Time Communication**: WebSocket server (`ws`) handling live chat messaging and notifications.
- **Media Uploads**: File and image upload management using `multer` and `cloudinary`.
- **Email Notifications**: Transactional emails (verification, notifications, resets) using `nodemailer`.
- **API Documentation**: Interactive Swagger UI documentation served via `swagger-ui-express`.

---

## Tech Stack & External Packages

- **Runtime & Framework**: [Node.js](https://nodejs.org/), [Express 5](https://expressjs.com/)
- **Database**: [PostgreSQL](https://www.postgresql.org/) (`pg` driver)
- **Real-Time WebSockets**: [ws](https://github.com/websockets/ws)
- **Security & Auth**: [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken), [bcryptjs](https://github.com/dcodeIO/bcrypt.js), [google-auth-library](https://github.com/googleapis/google-api-nodejs-client)
- **File & Media Storage**: [multer](https://github.com/expressjs/multer), [cloudinary](https://cloudinary.com/)
- **Emailing**: [nodemailer](https://nodemailer.com/)
- **API Docs**: [swagger-ui-express](https://github.com/scottie1984/swagger-ui-express)
- **Environment Management**: [dotenv](https://github.com/motdotla/dotenv)
- **Development Tooling**: [nodemon](https://nodemon.io/)

---

## Project Structure

```
AITasker-SWP-api/
├── src/
│   ├── app.js                 # Express application initialization & middleware setup
│   ├── server.js              # Server entry point (HTTP & WebSocket listener)
│   ├── swagger.json           # OpenAPI / Swagger specification
│   ├── config/                # Configuration modules
│   │   ├── db.js              # PostgreSQL pool setup
│   │   ├── cloudinary.js      # Cloudinary credentials configuration
│   │   ├── setupDb.js         # DB initialization helper
│   │   └── wsClients.js       # WebSocket connected clients manager
│   ├── controllers/           # Route logic controllers
│   │   ├── adminController.js
│   │   ├── authController.js
│   │   ├── conversationController.js
│   │   ├── jobController.js
│   │   ├── messageController.js
│   │   ├── paymentController.js
│   │   ├── projectController.js
│   │   ├── proposalController.js
│   │   ├── serviceController.js
│   │   ├── userController.js
│   │   └── ...
│   ├── middleware/            # Auth, Error handling, Upload middlewares
│   │   ├── authMiddleware.js
│   │   ├── errorMiddleware.js
│   │   └── uploadMiddleware.js
│   ├── routes/                # Express API route declarations
│   └── utils/                 # Utilities (email service, notification helper, token tools)
├── schema.sql                 # Database table definitions & schema
├── seedDb.js                  # Database seed script for dummy/testing data
├── resetDb.js                 # Database reset utility
├── migrate_client_budget.js   # DB migration scripts
├── .env.example               # Environment variable templates
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- PostgreSQL database server instance

### Installation & Setup

1. Navigate to the API directory:
   ```bash
   cd AITasker-SWP-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Copy `.env.example` to `.env` and fill in your details:
   ```env
   PORT=5000
   DATABASE_URL=postgresql://username:password@localhost:5432/aitasker_db
   JWT_SECRET=your_jwt_secret
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   SMTP_HOST=smtp.gmail.com
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=your_email_password
   ```

4. Database Setup & Seeding:
   Ensure PostgreSQL is running, then execute seed/reset scripts if needed:
   ```bash
   node seedDb.js
   ```

5. Start the Server:
   - Development mode (with auto-reload):
     ```bash
     npm run dev
     ```
   - Production mode:
     ```bash
     npm start
     ```

6. API Documentation:
   Access Swagger UI documentation at `http://localhost:5000/api-docs` after launching the server.
