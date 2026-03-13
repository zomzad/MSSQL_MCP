const sql = require('mssql'); // 模仿 index.js 引入 mssql
const msnodesql = require('msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function runSimulation() {
    console.log('--- SIMULATION START ---');
    
    // 1. 模仿 index.js 的變數定義
    const odbcDriver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
    const escapedPassword = (process.env.DB_PASSWORD || '').replace(/{/g, '{{').replace(/}/g, '}}');
    
    // 2. 模仿 index.js 的連線字串
    const rawConnectionString = `Driver={${odbcDriver}};Server=${process.env.DB_SERVER},${process.env.DB_PORT || '1433'};Database=${process.env.DB_DATABASE};Uid=${process.env.DB_USER};Pwd={${escapedPassword}};Encrypt=yes;TrustServerCertificate=yes;ColumnEncryption=Enabled;`;

    console.log('Connection String:', rawConnectionString);

    // 3. 模仿 index.js 的查詢函數
    function executeRawQuery(query) {
        return new Promise((resolve, reject) => {
            msnodesql.query(rawConnectionString, query, (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    // 4. 執行查詢
    try {
        console.log('Executing query via msnodesqlv8...');
        const rows = await executeRawQuery("SELECT TOP 1 ID_NO FROM COMM_Person");
        
        if (rows.length > 0) {
            const val = rows[0].ID_NO;
            if (Buffer.isBuffer(val)) {
                console.log('❌ RESULT IS BUFFER (Encrypted)');
                console.log('Length:', val.length);
            } else {
                console.log('✅ RESULT IS STRING (Decrypted)');
                console.log('Value:', val);
            }
        } else {
            console.log('No rows returned');
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

runSimulation();
