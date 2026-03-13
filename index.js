#!/usr/bin/env node
// Silence stdout during initialization to prevent polluting MCP protocol
const originalLog = console.log;
console.log = () => { };
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
console.log = originalLog;

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Load raw ODBC driver
const msnodesql = require('msnodesqlv8');

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

// Helper to get connection string from env
function getConnectionString() {
  const odbcDriver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
  const escapedPassword = (process.env.DB_PASSWORD || '').replace(/{/g, '{{').replace(/}/g, '}}');
  
  return `Driver={${odbcDriver}};Server=${process.env.DB_SERVER},${process.env.DB_PORT || '1433'};Database=${process.env.DB_DATABASE};Uid=${process.env.DB_USER};Pwd={${escapedPassword}};Encrypt=yes;TrustServerCertificate=yes;ColumnEncryption=Enabled;`;
}

// Execute query using raw msnodesqlv8 driver
// We open a fresh connection for each query to ensure Always Encrypted metadata is correctly loaded
async function executeRawQuery(query) {
  const connStr = getConnectionString();

  return new Promise((resolve, reject) => {
    msnodesql.open(connStr, (err, conn) => {
      if (err) {
        console.error(`Database Connection Error: ${err.message}`);
        return reject(err);
      }

      conn.query(query, (qErr, rows) => {
        if (qErr) {
          console.error(`SQL Execution Error: ${qErr.message}`);
          conn.close(() => {}); // Ensure connection is closed on error
          return reject(qErr);
        }

        conn.close(() => {
          resolve(rows);
        });
      });
    });
  });
}

// Helper to check environment
async function ensureEnvironment() {
    if (!process.env.DB_SERVER) {
        throw new Error("Missing DB_SERVER environment variable");
    }
    return true;
}

// List Resources: Expose tables as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    await ensureEnvironment();
    const rows = await executeRawQuery(`
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);

    return {
      resources: rows.map(row => ({
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
  const schema = url.hostname;
  const table = url.pathname.replace(/^\//, '');

  if (!schema || !table) {
    throw new Error("Invalid resource URI. Expected mssql://schema/table");
  }

  try {
    await ensureEnvironment();
    const safeSchema = schema.replace(/'/g, "''");
    const safeTable = table.replace(/'/g, "''");

    const rows = await executeRawQuery(`SELECT TOP 100 * FROM [${safeSchema}].[${safeTable}]`);

    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(rows, null, 2)
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
  await ensureEnvironment();

  switch (request.params.name) {
    case "list_tables": {
      const schemaFilter = request.params.arguments?.schema;
      const limit = request.params.arguments?.limit;
      const search = request.params.arguments?.search;

      let query = "SELECT ";
      if (limit) query += `TOP ${parseInt(limit)} `;
      query += `TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;

      if (schemaFilter && schemaFilter.toLowerCase() !== 'all') {
        query += ` AND TABLE_SCHEMA = '${schemaFilter.replace(/'/g, "''")}'`;
      }
      if (search) {
        query += ` AND TABLE_NAME LIKE '%${search.replace(/'/g, "''")}%'`;
      }
      query += " ORDER BY TABLE_SCHEMA, TABLE_NAME";

      const rows = await executeRawQuery(query);
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    }

    case "get_table_schema": {
      const tableNameInput = request.params.arguments.tableName;
      let schema = 'dbo';
      let table = tableNameInput;
      if (tableNameInput.includes('.')) {
        [schema, table] = tableNameInput.split('.');
      }

      const query = `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}'
      `;
      const rows = await executeRawQuery(query);
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    }

    case "execute_query": {
      const query = request.params.arguments.query;
      try {
        const rows = await executeRawQuery(query);
        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        };
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
  console.error("MSSQL MCP Server (Raw ODBC Mode) running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
