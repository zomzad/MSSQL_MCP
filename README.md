# MSSQL MCP Server

這是一個自定義的 Model Context Protocol (MCP) 伺服器，用於連接 Microsoft SQL Server。它可以讓您的 AI 助手（如 Claude Desktop 或 Cursor）直接查詢資料庫結構、讀取資料或執行 SQL 指令。

## 安裝與設定

1.  **安裝 ODBC Driver for SQL Server**
    
    此 MCP 伺服器需要 Microsoft ODBC Driver 17 或 18 for SQL Server 來支援 Always Encrypted 功能。
    
    下載連結：https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server
    
    安裝後，可以在命令提示字元執行以下指令確認：
    ```bash
    odbcad32
    ```
    在「驅動程式」標籤中應該可以看到「ODBC Driver 17 for SQL Server」或「ODBC Driver 18 for SQL Server」。

2.  **安裝依賴**
    在當前目錄下執行：
    ```bash
    npm install
    ```

3.  **設定環境變數**
    複製 `.env.example` 為 `.env`，並填入您的資料庫連線資訊：
    ```bash
    cp .env.example .env
    ```
    編輯 `.env` 檔案：
    ```ini
    DB_USER=sa
    DB_PASSWORD=您的密碼
    DB_SERVER=localhost
    DB_DATABASE=您的資料庫名稱
    DB_PORT=1433
    DB_ENCRYPT=true
    DB_TRUST_SERVER_CERTIFICATE=true
    ```

## 在 Claude Desktop 中使用

編輯您的 Claude Desktop 設定檔 (通常位於 `%APPDATA%\Claude\claude_desktop_config.json`)，新增以下內容：

```json
{
  "mcpServers": {
    "mssql": {
      "command": "node",
      "args": ["D:/MCP/MSSQL_MCP/index.js"]
    }
  }
}
```

## 功能

此 MCP 伺服器提供以下功能：

### Resources (資源)
- `mssql://{schema}/{table}`: 讀取指定資料表的前 100 筆資料。
  - 例如: `mssql://dbo/Users`

### Tools (工具)
- **list_tables**: 列出資料庫中所有的資料表。
  - 參數 (可選): `schema` (篩選架構), `limit` (限制筆數)
- **get_table_schema**: 查詢指定資料表的欄位結構。
  - 參數: `tableName` (例如 "dbo.Users")
- **execute_query**: 執行任意 T-SQL 指令 (SELECT, INSERT, UPDATE, DELETE)。
  - 參數: `query` (例如 "SELECT * FROM Users WHERE ID = 1")

## 安全性注意事項
- 此伺服器允許執行任意 SQL 指令，請確保不要在生產環境中隨意執行破壞性指令 (DROP, DELETE 等)。
- 請勿將包含密碼的 `.env` 檔案提交到版本控制系統。

## Always Encrypted 支援限制
此 MCP 伺服器使用 Node.js 的 `mssql` 套件（基於 Tedious 驅動），目前**無法解密 SQL Server Always Encrypted 欄位**。

查詢包含 Always Encrypted 欄位的資料表時，加密欄位會顯示為 `[ENCRYPTED - Always Encrypted column cannot be decrypted by Node.js mssql driver]`。

如需查詢加密欄位的實際內容，請使用：
- SQL Server Management Studio (SSMS)
- Azure Data Studio
- 支援 Always Encrypted 的 .NET 應用程式
- 其他支援 Always Encrypted 的資料庫工具
