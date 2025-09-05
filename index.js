require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cookieParser = require("cookie-parser");
const { Sequelize, DataTypes } = require("sequelize");
const { getSystemInfo } = require("./util/systemInfo");
const databaseRoutes = require("./routes/database");
const { requireAuth, authRouter } = require("./middleware/auth");

const app = express();
const server = http.createServer(app);

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Required for session management
app.use(express.static('public')); 

// View engine setup 
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Trust proxy if behind reverse proxy (for IP logging)
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// Create Sequelize instance (if you need it for ORM functionality)
const sequelize = new Sequelize(process.env.DATABASE_URL , {
  dialect: 'postgres',
  logging: console.log, // Set to false to disable SQL logging
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

// Simple logger object
const logger = {
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  info: (message) => console.info(`[INFO] ${message}`)
};

// Home route (public)
app.get("/", (req, res) => {
  try {
    const systemInfo = getSystemInfo();
    res.render("home", systemInfo);
  } catch (error) {
    console.log("Error rendering home page:", error);
   
    res.json({
      message: "Server is running",
      ...getSystemInfo()
    });
  }
});

// Authentication routes (must come before protected routes)
app.use("/api/db", authRouter);

// Protected database routes
app.use("/api/db", requireAuth, databaseRoutes);

// Security headers middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/db') && !req.path.includes('/login')) {
    // Add security headers for database routes
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Add CSP for database pages
    res.setHeader('Content-Security-Policy', 
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; " +
      "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; " +
      "font-src 'self' https://cdnjs.cloudflare.com; " +
      "img-src 'self' data:; " +
      "connect-src 'self'"
    );
  }
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.log("Unhandled error:", err);
  
  // Don't leak sensitive information in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({ 
    error: "Internal server error",
    message: isDevelopment ? err.message : "Something went wrong",
    ...(isDevelopment && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.url}`);
  
  // For API requests
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    return res.status(404).json({ error: "Route not found" });
  }
  
  // For regular requests, you could render a 404 page
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Page Not Found</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="text-center">
            <h1 class="text-6xl font-bold text-gray-800 mb-4">404</h1>
            <p class="text-xl text-gray-600 mb-8">Page not found</p>
            <a href="/" class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg transition-colors">
                Go Home
            </a>
        </div>
    </body>
    </html>
  `);
});

// Database synchronization and server start
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Test database connection (only if you're using Sequelize ORM)
    if (process.env.USE_SEQUELIZE === 'true') {
      await sequelize.authenticate();
      console.log("Sequelize database connection established successfully");
      
      // Sync database
      await sequelize.sync({ force: false });
      console.log("Database synced successfully");
    } else {
      console.log("Skipping Sequelize setup - using direct PostgreSQL client");
    }

    // Log authentication configuration
    console.log("Authentication Configuration:");
    console.log(`- Username: ${process.env.DB_AUTH_USERNAME || 'admin'}`);
    console.log(`- Session Timeout: ${process.env.DB_SESSION_TIMEOUT || 30} minutes`);
    console.log(`- Environment: ${process.env.NODE_ENV || 'development'}`);

    // Start server
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔒 Protected database management available at: http://localhost:${PORT}/api/db`);
      console.log(`🏠 Home page available at: http://localhost:${PORT}/`);
      console.log(`🔑 Database login at: http://localhost:${PORT}/api/db/login`);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    console.log("Failed to start server:", error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log("HTTP server closed");
    
    if (process.env.USE_SEQUELIZE === 'true') {
      sequelize.close().then(() => {
        console.log("Database connection closed");
        process.exit(0);
      }).catch((err) => {
        console.log("Error closing database connection:", err);
        process.exit(1);
      });
    } else {
      console.log("No Sequelize connection to close");
      process.exit(0);
    }
  });
}

// Start the server
startServer();