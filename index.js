#!/usr/bin/env node
// Silence stdout during initialization to prevent polluting MCP protocol
const originalLog = console.log;
console.log = () => { };
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
console.log = originalLog;

const sql = require('mssql');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');

// SQL Server Configuration
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT || '1433'),
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

// Initialize MCP Server
const server = new Server(
  {
    name: "mssql-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Global pool variable
let pool = null;

async function getPool() {
  if (pool) return pool;
  try {
    pool = await sql.connect(dbConfig);
    console.error(`Connected to SQL Server: ${dbConfig.server}, Database: ${dbConfig.database}`);
    return pool;
  } catch (err) {
    console.error('Database connection failed:', err);
    throw err;
  }
}

// Helper to format rows for output
function formatResult(result) {
  if (!result.recordset) return "No results";
  return JSON.stringify(result.recordset, null, 2);
}

// List Resources: Expose tables as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const p = await getPool();
    const result = await p.request().query(`
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);

    return {
      resources: result.recordset.map(row => ({
        uri: `mssql://${row.TABLE_SCHEMA}/${row.TABLE_NAME}`,
        name: `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`,
        mimeType: "application/json",
        description: `Table ${row.TABLE_SCHEMA}.${row.TABLE_NAME} in database`
      }))
    };
  } catch (error) {
    console.error("Error listing resources:", error);
    return { resources: [] };
  }
});

// Read Resource: Get first 100 rows of a table
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const pathParts = url.pathname.split('/');

  const schema = url.hostname;
  const table = url.pathname.replace(/^\//, '');

  if (!schema || !table) {
    throw new Error("Invalid resource URI. Expected mssql://schema/table");
  }

  try {
    const p = await getPool();
    const safeSchema = schema.replace(/\]/g, ']]');
    const safeTable = table.replace(/\]/g, ']]');

    const result = await p.request().query(`SELECT TOP 100 * FROM [${safeSchema}].[${safeTable}]`);

    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(result.recordset, null, 2)
      }]
    };
  } catch (error) {
    throw new Error(`Failed to read resource: ${error.message}`);
  }
});

// List Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_tables",
        description: "List all tables in the database. Use schema='all' to list all schemas.",
        inputSchema: {
          type: "object",
          properties: {
            schema: {
              type: "string",
              description: "Filter tables by schema name, or use 'all' to list all schemas"
            },
            limit: {
              type: "number",
              description: "(Optional) Maximum number of tables to return"
            },
            search: {
              type: "string",
              description: "(Optional) Fuzzy search for table names"
            }
          },
          required: ["schema"],
        },
      },
      {
        name: "get_table_schema",
        description: "Get the column definitions for a specific table",
        inputSchema: {
          type: "object",
          properties: {
            tableName: { type: "string", description: "Name of the table (e.g. 'Users' or 'dbo.Users')" },
          },
          required: ["tableName"],
        },
      },
      {
        name: "execute_query",
        description: "Execute a custom SQL query (SELECT, INSERT, UPDATE, DELETE)",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The T-SQL query to execute" },
          },
          required: ["query"],
        },
      },
    ],
  };
});

// Call Tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error(`[MCP] Executing tool: ${request.params.name}`);
  const p = await getPool();

  switch (request.params.name) {
    case "list_tables": {
      const schemaFilter = request.params.arguments?.schema;
      const limit = request.params.arguments?.limit;
      const search = request.params.arguments?.search;

      let query = "SELECT ";
      if (limit) {
        query += "TOP (@limit) ";
      }
      query += `TABLE_SCHEMA, TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE'
      `;

      const req = p.request();
      if (limit) {
        req.input('limit', sql.Int, limit);
      }

      // Only filter by schema if it's not 'all'
      if (schemaFilter && schemaFilter.toLowerCase() !== 'all') {
        query += " AND TABLE_SCHEMA = @schema";
        req.input('schema', sql.NVarChar, schemaFilter);
      }

      if (search) {
        query += " AND TABLE_NAME LIKE @search";
        req.input('search', sql.NVarChar, `%${search}%`);
      }

      // Add ordering for deterministic results
      query += " ORDER BY TABLE_SCHEMA, TABLE_NAME";

      const result = await req.query(query);
      return {
        content: [{ type: "text", text: formatResult(result) }],
      };
    }

    case "get_table_schema": {
      const tableNameInput = request.params.arguments.tableName;
      let schema = 'dbo';
      let table = tableNameInput;
      if (tableNameInput.includes('.')) {
        [schema, table] = tableNameInput.split('.');
      }

      const result = await p.request().input('schema', sql.NVarChar, schema)
        .input('table', sql.NVarChar, table)
        .query(`
          SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        `);
      return {
        content: [{ type: "text", text: formatResult(result) }],
      };
    }

    case "execute_query": {
      const query = request.params.arguments.query;
      try {
        const result = await p.request().query(query);
        if (result.recordset) {
          return {
            content: [{ type: "text", text: JSON.stringify(result.recordset, null, 2) }],
          };
        } else {
          return {
            content: [{ type: "text", text: `Query executed. Rows affected: ${JSON.stringify(result.rowsAffected)}` }],
          };
        }
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error executing query: ${err.message}` }],
        };
      }
    }

    default:
      throw new Error("Unknown tool");
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MSSQL MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
