# CLAUDE.md

給 Claude Code 用的專案導覽。每次在這個目錄啟動時會自動讀取，目標是不用重新探索就能直接開始改東西。

## 專案說明

個人記帳 PWA。核心體驗：打一行字（例如「早餐 全家 150」）就自動判斷金額、依關鍵字猜分類、記一筆帳；日/週/月報表用圓餅圖看各分類佔比。

**已實作功能：**
- 頂部日期列（前後一天 + 自訂月曆彈窗）選日期
- 快速輸入自動解析金額 + 關鍵字猜分類，猜錯可即時點色塊改
- 日 / 週 / 月分頁，圓餅圖 + 圖例（支出/收入分開看）
- 點紀錄可編輯（改日期/分類/金額/備註/收支類型）或刪除
- 設定裡可管理分類：改名、改關鍵字、改顏色（16 色可選）、刪除（含預設分類，刪除收容分類會自動遞補一個新的）
- CSV 匯出/匯入（單機資料的備份手段），匯入自動偵測並支援兩種格式：本 App 自己的匯出格式，以及 MoneyNote App 匯出的多區段 CSV（`#DAILY_DATAS` + `#CATEGORIES`）
- PWA：manifest + service worker，可加入手機主畫面

**部署：**
- GitHub repo：https://github.com/Cyao0406/budget-tracker
- 線上網址（GitHub Pages）：https://cyao0406.github.io/budget-tracker/
- 手機用 Safari 開網址 →「加入主畫面」即可像 App 一樣使用

## 技術架構

純前端 vanilla HTML/CSS/JS，**沒有框架、沒有建置工具、沒有 npm 依賴**。所有邏輯都在一個 IIFE 裡（`app.js`），用一個全域 `state` 物件手動管理狀態，每次操作後呼叫對應的 `render*()` 函式重繪，不是 reactive framework。

```
index.html     頁面結構（含所有 sheet/modal 的 markup）
style.css      樣式，含 CSS 變數（design tokens）
app.js         全部邏輯：資料模型、解析、分類、圖表、CRUD、事件綁定
manifest.json  PWA manifest
sw.js          Service worker（快取策略見下方「已知眉角」）
icons/         PWA 圖示（192/512/maskable，用 PowerShell + System.Drawing 產生）
README.md      面向使用者/開發者的簡短說明
```

**資料模型（存在瀏覽器 `localStorage`，單機不跨裝置同步）：**
- `budgetapp.records` — `[{id, date:'YYYY-MM-DD', type:'expense'|'income', categoryId, amount, note, createdAt}]`
- `budgetapp.categories` — `[{id, type, name, colorVar, keywords:[string], fallback:boolean}]`。`fallback` 標記該類型的「收容分類」，刪別的分類時歸不到的紀錄會轉進去；每個 type 永遠恰好有一個 fallback（刪除邏輯會自動遞補，見 `app.js` 的 `.del-cat-btn` handler）。
- `budgetapp.theme` — `'light'|'dark'`，不存代表跟隨系統

**自動分類邏輯**（`parseQuickInput` + `guessCategory`，在 `app.js`）：輸入字串裡最後一個純數字 token 當金額，其餘文字當備註；備註對每個分類的 `keywords` 陣列做 substring 比對（不分大小寫），第一個命中的分類獲勝，都沒命中就用該 type 的 fallback。

## 風格規範

**顏色系統（CSS 變數，`style.css` 最上方 `:root`）：**
- `--series-1` ~ `--series-8`：分類識別色，8 色一組，light/dark 主題各有對應值（來自驗證過 CVD 安全性的色階）。目前是分類自動配色（`nextColorVar`）跟圖表預設用色的來源，**不要**隨意改變這 8 個的色相順序或增減數量。
- `--pastel-1` ~ `--pastel-8`：使用者手動選色的「淺色」選項，均勻分布在整個色相環（每 45° 一色），**跨主題固定不變**（不放進 dark mode 區塊），因為本來就是要淺、要跟深色系分開一組。
- `--expense-color` / `--income-color`：金額正負號用色，跟分類識別色是分開的語意（別混用）。

**主題：** `prefers-color-scheme` 自動 + `data-theme` 手動覆寫雙軌並存（右上角圖示切換），兩邊都要顧到，改 CSS 變數時記得三處都要改（`:root` 內的 `@media dark` 區塊 + `:root[data-theme="dark"]` 區塊）。

**版面：** 手機優先，`.app` 容器 `max-width: 480px`（桌面 560px），大量用 `sheet`（底部彈出面板）模式做 modal，而不是置中 dialog。

**命名慣例：** CSS class 用 kebab-case；JS 函式/變數用 camelCase；`els` 物件集中存所有 DOM 參照（`cacheEls()` 一次抓齊，不要在各處零星 `getElementById`）。

**文案語氣：** 全繁體中文，簡短口語化，避免生硬的翻譯腔。

## 常用指令

```bash
# 本機測試伺服器（RECOMMENDED：用 python，專案內沒有 package.json / npm）
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; python -m http.server 8791
# 開 http://localhost:8791

# 部署（改完code後）
git add -A; git commit -m "說明這次改了什麼"; git push
# push 後 GitHub Pages 會自動重新部署，通常 1-2 分鐘生效
```

**Git 慣例：** 每完成一個獨立功能/修正就各自 commit + push，不要把好幾個改動囤在一起才存 —— 使用者明確要求要有清楚的版本記錄可以回退（`git revert <hash>`），不要用 `git reset --hard` 改寫歷史除非使用者特別要求。

## 已知眉角

- **Service worker 快取**：`sw.js` 目前是「有快取先回快取、背景再更新」的策略，且只在 `location.hostname === 'localhost'` 或 https 才會註冊（用區網 IP 測試手機時不會註冊，所以那個管道不會有快取問題）。如果在 `localhost` 測試時「改了程式碼但畫面沒變」，先重新整理兩次或清 site data，不是程式壞了。
- **確認對話框**：刪除紀錄/分類目前用瀏覽器原生 `window.confirm()`，不是自訂 UI，故意保持簡單。
- **測試方式**：這個環境沒辦法對瀏覽器截圖，驗證功能都是用 `javascript_tool` 直接操作 DOM（設值、dispatch 事件、讀 innerText/localStorage）取代真人點擊，之後如果继续開發建議延用這個模式驗證，比較快也比較穩定。
- **MoneyNote CSV 匯入**：`importMoneyNoteCsv()`（`app.js`）故意把來源 App 的分類原樣建成新分類（例如「飲食費」「工資」），**不會**強行對應到本 App 預設的 8+4 個分類，避免扭曲使用者的歷史分類。只有名稱剛好相同的分類（目前是「獎金」「投資」）才會重用既有分類。若之後想改成自動合併相近分類，要先跟使用者確認規則，這是刻意的設計決定不是遺漏。
