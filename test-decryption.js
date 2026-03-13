const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testDecryption() {
    const odbcDriver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
    const connectionString = `Driver={${odbcDriver}};Server=${process.env.DB_SERVER},${process.env.DB_PORT || '1433'};Database=${process.env.DB_DATABASE};Uid=${process.env.DB_USER};Pwd={${process.env.DB_PASSWORD}};Encrypt=yes;TrustServerCertificate=yes;ColumnEncryption=Enabled;`;

    console.log('--- FORCED DECRYPTION TEST (COMM_Person) ---');
    try {
        const pool = await sql.connect(connectionString);
        console.log('✅ Connected');

        // 強制讀取 ID_NO (這是加密欄位)
        const result = await pool.request().query("SELECT TOP 1 ID_NO, CHT_NAME FROM COMM_Person");
        
        const row = result.recordset[0];
        console.log('\nID_NO Status:', Buffer.isBuffer(row.ID_NO) ? '❌ STILL BUFFER (Failed)' : '✅ DECRYPTED (Success)');
        if (!Buffer.isBuffer(row.ID_NO)) {
            console.log('Decrypted Value:', row.ID_NO);
        } else {
            console.log('Buffer Length:', row.ID_NO.length);
        }

        await pool.close();
    } catch (err) {
        console.error('❌ ERROR:', err.message);
    }
}

testDecryption();
