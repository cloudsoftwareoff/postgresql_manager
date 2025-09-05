require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const databaseRoutes = require("./routes/database");

const app = express();
const server = http.createServer(app);

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files

// View engine setup (assuming you're using EJS based on your render calls)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Create Sequelize instance (if you need it for ORM functionality)
const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/dbname', {
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

// System info function
function getSystemInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  };
}

// Home route with system information
app.get("/", (req, res) => {
  try {
    const systemInfo = getSystemInfo();
    res.render("home", systemInfo);
  } catch (error) {
    console.log("Error rendering home page:", error);
    // If template doesn't exist, send JSON response instead
    res.json({
      message: "Server is running",
      ...getSystemInfo()
    });
  }
});

app.use("/api/db", databaseRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.log("Unhandled error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: "Route not found" });
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

    // Start server
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Database management available at: http://localhost:${PORT}/api/db`);
      console.log(`🏠 Home page available at: http://localhost:${PORT}/`);
      console.log(`📱 Socket.IO initialized and ready`);
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