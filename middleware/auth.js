const express = require('express');
const crypto = require('crypto');
const path = require('path');


const sessions = new Map();

// Configuration - Add these to your .env file
const AUTH_CONFIG = {
    username: process.env.DB_AUTH_USERNAME || 'admin',
    password: process.env.DB_AUTH_PASSWORD || 'your_secure_password_here',
    secretKey: process.env.DB_AUTH_SECRET || 'your-secret-key-here-change-in-production',
    sessionTimeout: parseInt(process.env.DB_SESSION_TIMEOUT) || 30 * 60 * 1000 // 30 minutes
};

// Generate secure session ID
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

// Hash password with salt
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

// Verify password
function verifyPassword(password, hash, salt) {
    const hashToVerify = hashPassword(password, salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashToVerify, 'hex'));
}

// Create session
function createSession(userId) {
    const sessionId = generateSessionId();
    const session = {
        id: sessionId,
        userId: userId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        isValid: true
    };
    
    sessions.set(sessionId, session);
    
    // Clean up expired sessions
    cleanupExpiredSessions();
    
    return sessionId;
}

// Validate session
function validateSession(sessionId) {
    const session = sessions.get(sessionId);
    
    if (!session || !session.isValid) {
        return null;
    }
    
    // Check if session has expired
    if (Date.now() - session.lastActivity > AUTH_CONFIG.sessionTimeout) {
        sessions.delete(sessionId);
        return null;
    }
    
    // Update last activity
    session.lastActivity = Date.now();
    return session;
}

// Clean up expired sessions
function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActivity > AUTH_CONFIG.sessionTimeout) {
            sessions.delete(sessionId);
        }
    }
}

// Logout session
function destroySession(sessionId) {
    sessions.delete(sessionId);
}

// Authentication middleware
function requireAuth(req, res, next) {
    const sessionId = req.cookies?.db_session;
    
    if (!sessionId) {
        return redirectToLogin(req, res);
    }
    
    const session = validateSession(sessionId);
    if (!session) {
        // Clear invalid cookie
        res.clearCookie('db_session');
        return redirectToLogin(req, res);
    }
    
    // Add user info to request
    req.user = { id: session.userId, sessionId: sessionId };
    next();
}

// Redirect to login helper
function redirectToLogin(req, res) {
    // For API requests, return JSON error
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ 
            error: 'Authentication required',
            message: 'Please log in to access this resource'
        });
    }
    
    // For regular requests, redirect to login page
    return res.redirect(`/api/db/login?redirect=${encodeURIComponent(req.originalUrl)}`);
}

// Create router for auth routes
const authRouter = express.Router();

// Login page
authRouter.get('/login', (req, res) => {
    const redirect = req.query.redirect || '/api/db';
    const error = req.query.error;
    
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Database Login - CloudSoftware.tn</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
            <style>
                .login-gradient {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .glass-effect {
                    background: rgba(255, 255, 255, 0.25);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.18);
                }
            </style>
        </head>
        <body class="login-gradient min-h-screen flex items-center justify-center p-4">
            <div class="glass-effect rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <!-- Logo/Brand -->
                <div class="text-center mb-8">
                    <div class="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i class="fas fa-database text-white text-2xl"></i>
                    </div>
                    <h1 class="text-2xl font-bold text-white mb-2">Database Access</h1>
                    <p class="text-white text-opacity-80">CloudSoftware.tn</p>
                </div>

                <!-- Error Message -->
                ${error ? `
                <div class="bg-red-500 bg-opacity-20 border border-red-400 border-opacity-30 rounded-lg p-3 mb-6">
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-exclamation-triangle text-red-200"></i>
                        <span class="text-red-200 text-sm">${escapeHtml(error)}</span>
                    </div>
                </div>
                ` : ''}

                <!-- Login Form -->
                <form method="POST" action="/api/db/login" class="space-y-6">
                    <input type="hidden" name="redirect" value="${escapeHtml(redirect)}">
                    
                    <div>
                        <label for="username" class="block text-white text-sm font-medium mb-2">
                            <i class="fas fa-user mr-2"></i>Username
                        </label>
                        <input 
                            type="text" 
                            id="username" 
                            name="username" 
                            required
                            class="w-full px-4 py-3 bg-white bg-opacity-20 border border-white border-opacity-30 rounded-lg text-white placeholder-white placeholder-opacity-60 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 focus:border-transparent"
                            placeholder="Enter your username"
                            autocomplete="username"
                        >
                    </div>

                    <div>
                        <label for="password" class="block text-white text-sm font-medium mb-2">
                            <i class="fas fa-lock mr-2"></i>Password
                        </label>
                        <div class="relative">
                            <input 
                                type="password" 
                                id="password" 
                                name="password" 
                                required
                                class="w-full px-4 py-3 bg-white bg-opacity-20 border border-white border-opacity-30 rounded-lg text-white placeholder-white placeholder-opacity-60 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50 focus:border-transparent pr-12"
                                placeholder="Enter your password"
                                autocomplete="current-password"
                            >
                            <button 
                                type="button" 
                                onclick="togglePassword()" 
                                class="absolute right-3 top-1/2 transform -translate-y-1/2 text-white text-opacity-60 hover:text-opacity-100"
                            >
                                <i id="passwordToggleIcon" class="fas fa-eye"></i>
                            </button>
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        class="w-full bg-white text-purple-600 font-semibold py-3 px-4 rounded-lg hover:bg-opacity-90 transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white focus:ring-opacity-50"
                    >
                        <i class="fas fa-sign-in-alt mr-2"></i>
                        Sign In
                    </button>
                </form>

                <!-- Security Notice -->
                <div class="mt-8 text-center">
                    <p class="text-white text-opacity-60 text-xs">
                        <i class="fas fa-shield-alt mr-1"></i>
                        This is a secure area. Access is logged and monitored.
                    </p>
                </div>
            </div>

            <script>
                function togglePassword() {
                    const passwordInput = document.getElementById('password');
                    const toggleIcon = document.getElementById('passwordToggleIcon');
                    
                    if (passwordInput.type === 'password') {
                        passwordInput.type = 'text';
                        toggleIcon.className = 'fas fa-eye-slash';
                    } else {
                        passwordInput.type = 'password';
                        toggleIcon.className = 'fas fa-eye';
                    }
                }

                // Focus on first input
                document.getElementById('username').focus();

                // Handle form submission
                document.querySelector('form').addEventListener('submit', function(e) {
                    const submitBtn = e.target.querySelector('button[type="submit"]');
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing In...';
                    submitBtn.disabled = true;
                });
            </script>
        </body>
        </html>
    `);
});

// Login POST handler
authRouter.post('/login', express.urlencoded({ extended: true }), (req, res) => {
    const { username, password, redirect = '/api/db' } = req.body;
    
    // Rate limiting check (basic implementation)
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Simple rate limiting (store in memory, use Redis in production)
    if (!global.loginAttempts) global.loginAttempts = new Map();
    const attempts = global.loginAttempts.get(clientIP) || { count: 0, lastAttempt: 0 };
    
    // Reset attempts if more than 15 minutes have passed
    if (now - attempts.lastAttempt > 15 * 60 * 1000) {
        attempts.count = 0;
    }
    
    if (attempts.count >= 5) {
        return res.redirect(`/api/db/login?error=${encodeURIComponent('Too many failed attempts. Please try again later.')}&redirect=${encodeURIComponent(redirect)}`);
    }
    
    // Validate credentials
    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
        // Success - create session
        const sessionId = createSession(username);
        
        // Set secure cookie
        res.cookie('db_session', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: AUTH_CONFIG.sessionTimeout
        });
        
        // Reset failed attempts
        global.loginAttempts.delete(clientIP);
        
        // Log successful login
        console.log(`[AUTH] Successful login for user "${username}" from ${clientIP}`);
        
        return res.redirect(redirect);
    } else {
        // Failed login
        attempts.count++;
        attempts.lastAttempt = now;
        global.loginAttempts.set(clientIP, attempts);
        
        // Log failed attempt
        console.log(`[AUTH] Failed login attempt for user "${username}" from ${clientIP}`);
        
        return res.redirect(`/api/db/login?error=${encodeURIComponent('Invalid username or password')}&redirect=${encodeURIComponent(redirect)}`);
    }
});

// Logout handler
authRouter.post('/logout', requireAuth, (req, res) => {
    destroySession(req.user.sessionId);
    res.clearCookie('db_session');
    
    console.log(`[AUTH] User "${req.user.id}" logged out`);
    
    // For API requests
    if (req.headers.accept?.includes('application/json')) {
        return res.json({ message: 'Logged out successfully' });
    }
    
    // Redirect to login
    res.redirect('/api/db/login');
});

// Session status endpoint
authRouter.get('/session-status', requireAuth, (req, res) => {
    const session = sessions.get(req.user.sessionId);
    res.json({
        authenticated: true,
        user: req.user.id,
        sessionCreated: new Date(session.createdAt).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
        expiresAt: new Date(session.lastActivity + AUTH_CONFIG.sessionTimeout).toISOString()
    });
});

// HTML escape helper
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
    requireAuth,
    authRouter,
    AUTH_CONFIG,
    createSession,
    validateSession,
    destroySession
};