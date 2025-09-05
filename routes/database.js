const express = require('express');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const caCertPath = process.env.CA_CERT_PATH || path.join(__dirname, '../ca-certificate.pem');

// Database Configuration
let dbConfigFromEnv;
if (process.env.DB_SSL_ENABLED === 'true') {
    if (fs.existsSync(caCertPath)) {
        console.log('🔒 Using provided CA certificate for SSL connection.');
        dbConfigFromEnv = {
            connectionString: process.env.DATABASE_URL,
            ssl: {
                ca: fs.readFileSync(caCertPath).toString(),
                rejectUnauthorized: true
            }
        };
    } else {
        console.log('🔒 Using SSL without custom CA certificate.');
        dbConfigFromEnv = {
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        };
    }
} else {
    console.log('📡 Using standard connection (no SSL).');
    dbConfigFromEnv = {
        connectionString: process.env.DATABASE_URL,
        ssl: false
    };
}

// Helper Functions
function getNewClient() {
    return new Client(dbConfigFromEnv);
}

// Enhanced error handling
function handleDatabaseError(err, res, context = 'Database operation') {
    console.error(`${context} error:`, err.stack);
    
    const errorMessages = {
        '42P01': 'Table not found',
        '42703': 'Column not found',
        '23505': 'Duplicate key violation',
        '23502': 'Not null violation',
        '23503': 'Foreign key violation',
        '42601': 'Syntax error in SQL',
        '42P07': 'Table already exists',
        'ECONNREFUSED': 'Database connection refused',
        'ENOTFOUND': 'Database host not found',
        '28P01': 'Authentication failed'
    };

    const userFriendlyMessage = errorMessages[err.code] || 'Database operation failed';
    
    res.status(500).json({
        error: userFriendlyMessage,
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
        code: err.code
    });
}

// Root page - Enhanced dashboard
router.get('/', async (req, res) => {
    const client = getNewClient();
    let tables = [];
    let error = null;
    let dbStats = {};

    try {
        await client.connect();
        
        // Fetch tables
        const tablesResult = await client.query(`
            SELECT tablename, schemaname
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename;
        `);
        tables = tablesResult.rows.map(row => row.tablename);

        // Get database statistics
        const statsResult = await client.query(`
            SELECT 
                (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as table_count,
                (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') as column_count,
                (SELECT pg_size_pretty(pg_database_size(current_database()))) as db_size,
                (SELECT version()) as pg_version;
        `);
        
        if (statsResult.rows.length > 0) {
            dbStats = statsResult.rows[0];
        }

    } catch (err) {
        console.error('Error fetching dashboard data:', err.stack);
        error = 'Failed to fetch database information.';
    } finally {
        await client.end();
    }

    res.render('db/index', { 
        tables: tables, 
        error: error, 
        queryResult: null, 
        queryError: null,
        dbStats: dbStats
    });
});

// API Endpoint: Get enhanced table list with metadata
// FIXED: Changed from '/api/tables' to '/tables'
router.get('/tables', async (req, res) => {
    const client = getNewClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 
                t.tablename,
                t.schemaname,
                obj_description(c.oid) as table_comment,
                (SELECT count(*) FROM information_schema.columns 
                 WHERE table_name = t.tablename AND table_schema = t.schemaname) as column_count
            FROM pg_tables t
            LEFT JOIN pg_class c ON c.relname = t.tablename
            WHERE t.schemaname = 'public'
            ORDER BY t.tablename;
        `);
        
        const tablesWithMetadata = result.rows.map(row => ({
            name: row.tablename,
            schema: row.schemaname,
            comment: row.table_comment,
            columnCount: parseInt(row.column_count)
        }));
        
        res.json({ tables: tablesWithMetadata });
    } catch (err) {
        handleDatabaseError(err, res, 'API Error fetching tables');
    } finally {
        await client.end();
    }
});

// API Endpoint: Get table schema information
// FIXED: Changed from '/api/schema/:tableName' to '/schema/:tableName'
router.get('/schema/:tableName', async (req, res) => {
    const { tableName } = req.params;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name provided' });
    }

    const client = getNewClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length,
                numeric_precision,
                numeric_scale,
                col_description(pgc.oid, cols.ordinal_position) as column_comment
            FROM information_schema.columns cols
            LEFT JOIN pg_class pgc ON pgc.relname = cols.table_name
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position;
        `, [tableName]);

        // Get primary key information
        const pkResult = await client.query(`
            SELECT a.attname as column_name
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary;
        `, [tableName]);

        const primaryKeys = pkResult.rows.map(row => row.column_name);

        res.json({
            tableName: tableName,
            columns: result.rows,
            primaryKeys: primaryKeys
        });
    } catch (err) {
        handleDatabaseError(err, res, `API Error fetching schema for table ${tableName}`);
    } finally {
        await client.end();
    }
});

// Enhanced API Endpoint: Get data with pagination and filtering
// FIXED: Changed from '/api/data/:tableName' to '/data/:tableName'
router.get('/data/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const { page = 1, limit = 100, search, sortBy, sortOrder = 'asc' } = req.query;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name provided' });
    }

    const client = getNewClient();
    try {
        await client.connect();
        
        // Build query with optional search and sorting
        let baseQuery = `SELECT * FROM "${tableName}"`;
        let countQuery = `SELECT COUNT(*) FROM "${tableName}"`;
        let queryParams = [];
        let paramCount = 0;

        // Add search functionality
        if (search) {
            // Get column names first
            const columnsResult = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 AND table_schema = 'public'
            `, [tableName]);
            
            const textColumns = columnsResult.rows
                .filter(col => ['text', 'varchar', 'char'].some(type => col.data_type.includes(type)))
                .map(col => `"${col.column_name}"::text`);
            
            if (textColumns.length > 0) {
                const searchCondition = textColumns
                    .map(() => `${textColumns[paramCount]} ILIKE $${++paramCount}`)
                    .join(' OR ');
                
                baseQuery += ` WHERE (${searchCondition})`;
                countQuery += ` WHERE (${searchCondition})`;
                
                // Add search parameters for each text column
                textColumns.forEach(() => queryParams.push(`%${search}%`));
            }
        }

        // Add sorting
        if (sortBy && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sortBy)) {
            const validOrder = ['asc', 'desc'].includes(sortOrder.toLowerCase()) ? sortOrder : 'asc';
            baseQuery += ` ORDER BY "${sortBy}" ${validOrder.toUpperCase()}`;
        }

        // Add pagination
        const offset = (parseInt(page) - 1) * parseInt(limit);
        baseQuery += ` LIMIT $${++paramCount} OFFSET $${++paramCount}`;
        queryParams.push(parseInt(limit), offset);

        // Execute queries
        const [dataResult, countResult] = await Promise.all([
            client.query(baseQuery, queryParams.slice(0, -2).concat([parseInt(limit), offset])),
            client.query(countQuery, queryParams.slice(0, -2))
        ]);

        res.json({
            tableName: tableName,
            data: dataResult.rows,
            pagination: {
                currentPage: parseInt(page),
                limit: parseInt(limit),
                totalRows: parseInt(countResult.rows[0].count),
                totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit))
            }
        });
    } catch (err) {
        handleDatabaseError(err, res, `API Error fetching data from table ${tableName}`);
    } finally {
        await client.end();
    }
});

// Enhanced view route with better error handling
router.get('/view/:tableName', async (req, res) => {
    const { tableName } = req.params;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).send('Invalid table name.');
    }

    const client = getNewClient();
    let tableData = [];
    let error = null;
    let columnNames = [];
    let tableStats = {};
    let columnInfo = [];
    let primaryKeys = [];

    try {
        await client.connect();
        
        // Get table data with limit
        const dataQuery = `SELECT * FROM "${tableName}" LIMIT 100;`;
        console.log(`Fetching data from table: ${tableName}`);
        const result = await client.query(dataQuery);
        tableData = result.rows;
        columnNames = result.fields ? result.fields.map(field => field.name) : [];

        // Get column information
        const columnInfoResult = await client.query(`
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default,
                character_maximum_length,
                numeric_precision,
                numeric_scale
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position;
        `, [tableName]);
        columnInfo = columnInfoResult.rows;

        // Get primary key information
        const pkResult = await client.query(`
            SELECT a.attname as column_name
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary;
        `, [tableName]);
        primaryKeys = pkResult.rows.map(row => row.column_name);

        // Get table statistics
        const statsQuery = `
            SELECT 
                (SELECT count(*) FROM "${tableName}") as total_rows,
                (SELECT pg_size_pretty(pg_total_relation_size('"${tableName}"'))) as table_size,
                (SELECT count(*) FROM information_schema.columns 
                 WHERE table_name = $1 AND table_schema = 'public') as column_count;
        `;
        const statsResult = await client.query(statsQuery, [tableName]);
        if (statsResult.rows.length > 0) {
            tableStats = statsResult.rows[0];
        }

    } catch (err) {
        console.error(`Error fetching data from table ${tableName}:`, err.stack);
        error = err.message;
    } finally {
        await client.end();
    }

    res.render('db/table', { 
        tableName: tableName, 
        data: tableData, 
        columns: columnNames, 
        columnInfo: columnInfo,
        primaryKeys: primaryKeys,
        error: error,
        tableStats: tableStats
    });
});

// API Endpoint: Create new record
// FIXED: Changed from '/api/data/:tableName' to '/data/:tableName'
router.post('/data/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const recordData = req.body;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name provided' });
    }

    const client = getNewClient();
    try {
        await client.connect();
        
        const columns = Object.keys(recordData);
        const values = Object.values(recordData);
        const placeholders = values.map((_, index) => `$${index + 1}`);

        const query = `
            INSERT INTO "${tableName}" (${columns.map(col => `"${col}"`).join(', ')})
            VALUES (${placeholders.join(', ')})
            RETURNING *;
        `;

        const result = await client.query(query, values);
        
        res.json({
            message: 'Record created successfully',
            data: result.rows[0]
        });
    } catch (err) {
        handleDatabaseError(err, res, `Error creating record in table ${tableName}`);
    } finally {
        await client.end();
    }
});

// API Endpoint: Update record
// FIXED: Changed from '/api/data/:tableName/:id' to '/data/:tableName/:id'
router.put('/data/:tableName/:id', async (req, res) => {
    const { tableName, id } = req.params;
    const recordData = req.body;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name provided' });
    }

    const client = getNewClient();
    try {
        await client.connect();
        
        // Get primary key column
        const pkResult = await client.query(`
            SELECT a.attname as column_name
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary
            LIMIT 1;
        `, [tableName]);

        if (pkResult.rows.length === 0) {
            return res.status(400).json({ error: 'Table has no primary key defined' });
        }

        const pkColumn = pkResult.rows[0].column_name;
        const columns = Object.keys(recordData);
        const values = Object.values(recordData);
        
        const setClause = columns.map((col, index) => `"${col}" = $${index + 1}`).join(', ');
        
        const query = `
            UPDATE "${tableName}"
            SET ${setClause}
            WHERE "${pkColumn}" = $${values.length + 1}
            RETURNING *;
        `;

        const result = await client.query(query, [...values, id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json({
            message: 'Record updated successfully',
            data: result.rows[0]
        });
    } catch (err) {
        handleDatabaseError(err, res, `Error updating record in table ${tableName}`);
    } finally {
        await client.end();
    }
});

// API Endpoint: Delete record
// FIXED: Changed from '/api/data/:tableName/:id' to '/data/:tableName/:id'
router.delete('/data/:tableName/:id', async (req, res) => {
    const { tableName, id } = req.params;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name provided' });
    }

    const client = getNewClient();
    try {
        await client.connect();
        
        // Get primary key column
        const pkResult = await client.query(`
            SELECT a.attname as column_name
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary
            LIMIT 1;
        `, [tableName]);

        if (pkResult.rows.length === 0) {
            return res.status(400).json({ error: 'Table has no primary key defined' });
        }

        const pkColumn = pkResult.rows[0].column_name;
        
        const query = `
            DELETE FROM "${tableName}"
            WHERE "${pkColumn}" = $1
            RETURNING *;
        `;

        const result = await client.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.json({
            message: 'Record deleted successfully',
            data: result.rows[0]
        });
    } catch (err) {
        handleDatabaseError(err, res, `Error deleting record from table ${tableName}`);
    } finally {
        await client.end();
    }
});

// API Endpoint: Export table data as CSV
// FIXED: Changed from '/api/export/:tableName' to '/export/:tableName'
router.get('/export/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const { format = 'csv' } = req.query;

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
        return res.status(400).json({ error: 'Invalid table name provided' });
    }

    const client = getNewClient();
    try {
        await client.connect();
        const result = await client.query(`SELECT * FROM "${tableName}";`);
        
        if (format === 'csv') {
            let csv = '';
            if (result.rows.length > 0) {
                // Header
                csv = Object.keys(result.rows[0]).join(',') + '\n';
                
                // Data rows
                result.rows.forEach(row => {
                    const values = Object.values(row).map(value => {
                        if (value === null || value === undefined) return '';
                        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                        return '"' + stringValue.replace(/"/g, '""') + '"';
                    });
                    csv += values.join(',') + '\n';
                });
            }
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
            res.send(csv);
        } else {
            res.json({
                tableName: tableName,
                data: result.rows,
                rowCount: result.rowCount
            });
        }
    } catch (err) {
        handleDatabaseError(err, res, `Export error for table ${tableName}`);
    } finally {
        await client.end();
    }
});

// Enhanced SQL query execution
// FIXED: Changed from '/api/run-query' to '/run-query'
router.post('/run-query', async (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Missing SQL query in request body' });
    }

    // Basic query validation and warnings
    const trimmedQuery = query.trim().toLowerCase();
    const warnings = [];
    
    if (trimmedQuery.includes('drop table') || trimmedQuery.includes('drop database')) {
        warnings.push('⚠️ Destructive operation detected - proceed with caution');
    }
    
    if (trimmedQuery.includes('delete from') && !trimmedQuery.includes('where')) {
        warnings.push('⚠️ DELETE without WHERE clause - this will delete all rows');
    }
    
    if (trimmedQuery.includes('update') && !trimmedQuery.includes('where')) {
        warnings.push('⚠️ UPDATE without WHERE clause - this will update all rows');
    }

    console.log(`Executing query: ${query}`);
    const startTime = Date.now();

    const client = getNewClient();
    let resultData = { rowCount: 0, rows: [], command: '', warnings: warnings };

    try {
        await client.connect();
        const result = await client.query(query);

        const executionTime = Date.now() - startTime;

        // Handle different result types
        if (result.rows && Array.isArray(result.rows)) {
            resultData.rows = result.rows;
            resultData.rowCount = result.rowCount;
        }
        
        resultData.command = result.command;
        resultData.executionTime = executionTime;
        
        if (result.rowCount !== undefined && resultData.rowCount === 0) {
            resultData.rowCount = result.rowCount;
        }

        res.json({
            message: 'Query executed successfully',
            ...resultData
        });
    } catch (err) {
        const executionTime = Date.now() - startTime;
        console.error('Error executing query:', err.stack);
        
        res.status(500).json({
            error: 'Query execution failed',
            details: err.message,
            code: err.code,
            executionTime: executionTime,
            warnings: warnings
        });
    } finally {
        await client.end();
    }
});

// API Endpoint: Get database information
// FIXED: Changed from '/api/database-info' to '/database-info'
router.get('/database-info', async (req, res) => {
    const client = getNewClient();
    try {
        await client.connect();
        
        const infoQuery = `
            SELECT 
                current_database() as database_name,
                current_user as current_user,
                version() as postgresql_version,
                pg_size_pretty(pg_database_size(current_database())) as database_size,
                (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') as table_count,
                (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') as total_columns,
                now() as server_time;
        `;
        
        const result = await client.query(infoQuery);
        res.json(result.rows[0]);
    } catch (err) {
        handleDatabaseError(err, res, 'Database info error');
    } finally {
        await client.end();
    }
});

// API Endpoint: Health check
// FIXED: Changed from '/api/health' to '/health'
router.get('/health', async (req, res) => {
    const client = getNewClient();
    try {
        await client.connect();
        await client.query('SELECT 1');
        res.json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'unhealthy', 
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: err.message
        });
    } finally {
        await client.end();
    }
});

module.exports = router;