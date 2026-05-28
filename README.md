# AITasker Backend REST API

This is the Node.js + Express.js REST API backend for the **AITasker** web application. It uses a high-performance **PostgreSQL** database and includes fully implemented user authentication (Registration and Login) with robust validation, secure password hashing, JWT token issuance, and relational profile integrity.

---

## 🚀 Key Features

- **Standard JavaScript ES6+**: Written cleanly using Node.js and Express.
- **PostgreSQL Database Setup**: Integrates with your provided `schema.sql`.
- **Automatic Database Initialization**: Automatically detects if tables exist on startup and runs `schema.sql` to build the DB, then safely alters the `users` table to add a secure `password` column.
- **Relational Integrity Guarantees**: Registration handles database transactions (`BEGIN` and `COMMIT`) to automatically insert matching profiles into `client_profiles` or `expert_profiles` depending on the user's role.
- **Secure Password Storage**: Uses `bcryptjs` for secure password salting and hashing.
- **Token-based Authentication**: Stateless authentication utilizing secure JSON Web Tokens (`jsonwebtoken`).
- **Input Validation**: Custom request validation checks that return formatted JSON errors to the frontend.
- **Centralized Error Handling**: Standardized error response layout so the React frontend can easily display exception messages.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js (v24.15.0)
- **Framework:** Express.js
- **Database Driver:** `pg` (node-postgres)
- **Security:** `bcryptjs`, `jsonwebtoken`, `cors`, `dotenv`
- **Development Tooling:** `nodemon` (hot-reloading)

---

## 📁 Directory Structure

```
├── src/
│   ├── config/
│   │   ├── db.js             # PostgreSQL connection pool configuration
│   │   └── setupDb.js        # Schema loader & table initialization
│   ├── controllers/
│   │   └── authController.js # Auth handlers (Register, Login, getMe)
│   ├── middleware/
│   │   ├── authMiddleware.js # Authorization guards (protect, authorize)
│   │   └── errorMiddleware.js# Custom global exception formatter
│   ├── routes/
│   │   └── authRoutes.js     # Auth endpoint paths mapping
│   ├── utils/
│   │   └── token.js          # JWT helper methods
│   ├── app.js                # Express app structure & middlewares config
│   └── server.js             # Server bootstrapping and port listener
├── schema.sql                # The provided PostgreSQL DDL schema
├── .env                      # Local environment configurations (ignored in git)
├── .env.example              # Sample environment template
├── package.json              # NPM dependencies & scripts
└── testAuth.js               # End-to-end integration test suite
```

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (based on `.env.example`):

```ini
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Connection (Supports either unified connection string or separate values)
# For Supabase, Neon, or other cloud DB:
# DATABASE_URL=postgresql://db_user:db_password@db_host:5432/db_name?sslmode=require

# For standard local DB:
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=12345
DB_NAME=aitasker

# JWT Authentication
JWT_SECRET=aitasker-super-secret-key-2026
JWT_EXPIRES_IN=7d
```

---

## 🛰️ API Endpoint Documentation

All authentication endpoints are prefixed with `/api/auth`.

### 1. User Registration

Creates a new user account, executes a database transaction to build the corresponding profile based on the selected role, and returns an access token.

- **URL**: `/api/auth/register`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body Parameters**:
  ```json
  {
    "fullName": "Alex Expert",
    "email": "alex@example.com",
    "password": "SecurePassword2026",
    "role": "expert" // Must be 'client', 'expert', or 'admin'
  }
  ```
- **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Registration successful",
    "user": {
      "id": "57c2f29c-7525-4ae5-ae22-84e5fcf825c5",
      "fullName": "Alex Expert",
      "email": "alex@example.com",
      "role": "expert",
      "isVerified": false,
      "createdAt": "2026-05-29"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
  ```
- **Error Response (400 Bad Request - Validation Failures)**:
  ```json
  {
    "success": false,
    "message": "Validation failed",
    "errors": {
      "fullName": "Full name is required",
      "email": "A valid email address is required",
      "password": "Password must be at least 6 characters long",
      "role": "Role must be one of: client, expert, admin"
    }
  }
  ```

### 2. User Login

Authenticates user credentials and issues a JSON Web Token.

- **URL**: `/api/auth/login`
- **Method**: `POST`
- **Headers**: `Content-Type: application/json`
- **Body Parameters**:
  ```json
  {
    "email": "alex@example.com",
    "password": "SecurePassword2026"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "user": {
      "id": "57c2f29c-7525-4ae5-ae22-84e5fcf825c5",
      "fullName": "Alex Expert",
      "email": "alex@example.com",
      "role": "expert",
      "isVerified": false,
      "createdAt": "2026-05-29"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
  ```
- **Error Response (401 Unauthorized)**:
  ```json
  {
    "success": false,
    "message": "Invalid email or password"
  }
  ```

### 3. Fetch Current Profile

Private endpoint to fetch the details of the currently logged-in user.

- **URL**: `/api/auth/me`
- **Method**: `GET`
- **Headers**:
  - `Authorization: Bearer <your_jwt_token>`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "user": {
      "id": "57c2f29c-7525-4ae5-ae22-84e5fcf825c5",
      "fullName": "Alex Expert",
      "email": "alex@example.com",
      "role": "expert",
      "isVerified": false,
      "createdAt": "2026-05-29"
    }
  }
  ```

---

## 🏃 Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Set up database credentials
Configure database connection settings inside `.env` to match your local PostgreSQL server parameters.

### 3. Run development server (Hot-reload enabled)
```bash
npm run dev
```

### 4. Run production server
```bash
npm run start
```

---

## 🧪 Testing the APIs

We have built a custom, comprehensive end-to-end integration test suite. Ensure the backend server is running in the background and execute:

```bash
node testAuth.js
```

This script will run multiple validation cases, test duplicate database insertion blocks, check database profile creation inside PostgreSQL directly, and test the `/auth/me` protected route.
