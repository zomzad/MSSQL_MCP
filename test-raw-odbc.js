const msnodesql = require('msnodesqlv8');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const odbcDriver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
const escapedPassword = (process.env.DB_PASSWORD || '').replace(/{/g, '{{').replace(/}/g, '}}');
const connStr = `Driver={${odbcDriver}};Server=${process.env.DB_SERVER},${process.env.DB_PORT || '1433'};Database=${process.env.DB_DATABASE};Uid=${process.env.DB_USER};Pwd={${escapedPassword}};Encrypt=yes;TrustServerCertificate=yes;ColumnEncryption=Enabled;`;

console.log('--- RAW ODBC DRIVER TEST ---');
console.log('Using Connection String...');

const query = "SELECT TOP 1 ID_NO, CHT_NAME FROM COMM_Person";

msnodesql.query(connStr, query, (err, rows) => {
    if (err) {
        console.error('\n❌ RAW ERROR FROM DRIVER:');
        console.error(err);
        return;
    }

    if (rows && rows.length > 0) {
        const row = rows[0];
        console.log('\n--- Result Check ---');
        for (const [key, value] of Object.entries(row)) {
            const isBuffer = Buffer.isBuffer(value);
            console.log(`${key}: ${isBuffer ? '❌ STILL BUFFER' : '✅ DECRYPTED'}`);
            if (!isBuffer) {
                console.log(`   Value: ${value}`);
            } else {
                console.log(`   Buffer Length: ${value.length}`);
            }
        }
    } else {
        console.log('No rows returned.');
    }
});
