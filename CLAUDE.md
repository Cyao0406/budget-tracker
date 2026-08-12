# CLAUDE.md

給 Claude Code 用的專案導覽。每次在這個目錄啟動時會自動讀取，目標是不用重新探索就能直接開始改東西。

## 專案說明

個人記帳 PWA。核心體驗：打一行字（例如「早餐 全家 150」）就自動判斷金額、依關鍵字猜分類、記一筆帳；日/週/月報表用圓餅圖看各分類佔比。

**已實作功能：**
- 頂部日期列（前後一天 + 自訂月曆彈窗）選日期
- 快速輸入自動解析金額 + 關鍵字猜分類，猜錯可即時點色塊改
- 日 / 週 / 月分頁，圓餅圖 + 圖例（支出/收入分開看）
- 點紀錄可編輯（改日期/分類/金額/備註/收支類型）或刪除
- 設定裡可管理分類：改名、改關鍵字、改顏色（16 色可選）、刪除（含預設分類）——刪除時會跳出選單讓你挑紀錄要併入哪個分類（不是固定丟進收容分類），刪的剛好是收容分類時，選中的目標會自動遞補成新的收容分類
- CSV 匯出/匯入（單機資料的備份手段），匯入自動偵測並支援兩種格式：本 App 自己的匯出格式，以及 MoneyNote App 匯出的多區段 CSV（`#DAILY_DATAS` + `#CATEGORIES`）
- PWA：manifest + service worker，可加入手機主畫面
- **雲端同步（選用，Firebase）**：不登入完全不受影響、行為跟純單機版一樣；登入 Google 帳號後資料會背景同步到 Firestore，其他登入同帳號的裝置也會即時收到更新。見下方「雲端同步架構」。

**部署：**
- GitHub repo：https://github.com/Cyao0406/budget-tracker
- 線上網址（GitHub Pages）：https://cyao0406.github.io/budget-tracker/
- 手機用 Safari 開網址 →「加入主畫面」即可像 App 一樣使用
- Firebase 專案：**尚未建立**，`firebase-config.js` 裡的正式環境設定目前是 `REPLACE_ME` 佔位值，本機/emulator 測試不受影響（見下方指令）。真正要讓雲端同步在正式站上運作，需要使用者本人建立一個免費 Firebase 專案並把 config 貼給我填進去——這步驟需要使用者的 Google 帳號，我沒辦法代勞。

## 技術架構

前端 vanilla HTML/CSS/JS，**沒有建置工具、沒有 npm 依賴**（雲端功能用 CDN 直接載入 Firebase SDK，不是透過 npm/bundler）。`index.html` 的 `<script>` 是 `type="module"`，`app.js` 內部仍維持一個 IIFE 包住主要邏輯、用全域 `state` 物件手動管理狀態，每次操作後呼叫對應的 `render*()` 函式重繪，不是 reactive framework；import 語句必須放在 IIFE 外層（ES module 的硬性規定）。

```
index.html          頁面結構（含所有 sheet/modal 的 markup，含登入畫面 UI）
style.css            樣式，含 CSS 變數（design tokens）
app.js               全部邏輯：資料模型、解析、分類、圖表、CRUD、事件綁定、雲端同步層
firebase-config.js   Firebase 初始化 + emulator/正式環境切換（見下方）
firestore.rules      Firestore 安全規則（每個使用者只能讀寫自己 uid 底下的資料）
firebase.json        Firebase CLI / emulator 設定
manifest.json        PWA manifest
sw.js                Service worker（快取策略見下方「已知眉角」）
icons/               PWA 圖示（192/512/maskable，用 PowerShell + System.Drawing 產生）
README.md            面向使用者/開發者的簡短說明
ROADMAP.md           未來規劃與技術債
```

**資料模型：**
- `budgetapp.records` — `[{id, date:'YYYY-MM-DD', type:'expense'|'income', categoryId, amount, note, createdAt}]`
- `budgetapp.categories` — `[{id, type, name, colorVar, keywords:[string], fallback:boolean}]`。`fallback` 標記該類型的「收容分類」，刪別的分類時歸不到的紀錄會轉進去；每個 type 永遠恰好有一個 fallback（刪除邏輯會自動遞補，見 `app.js` 的 `.del-cat-btn` handler）。
- `budgetapp.theme` — `'light'|'dark'`，不存代表跟隨系統；主題偏好**不同步到雲端**，純本機。
- localStorage 永遠是畫面即時渲染的來源，不管有沒有登入都一樣；登入雲端同步只是在背景多一層。

**自動分類邏輯**（`parseQuickInput` + `guessCategory`，在 `app.js`）：輸入字串裡最後一個純數字 token 當金額，其餘文字當備註；備註對每個分類的 `keywords` 陣列做 substring 比對（不分大小寫），第一個命中的分類獲勝，都沒命中就用該 type 的 fallback。

## 雲端同步架構

**設計原則：** localStorage 永遠是「畫面立刻看到」的來源；Firestore 是背景同步層，不影響未登入時的行為。這樣不用把每個 CRUD 呼叫點都改成 async Firestore 呼叫——利用一個既有的事實：**所有**會修改 `state.records`/`state.categories` 的地方，最後都會呼叫 `saveRecords()`/`saveCategories()`（唯一例外是 `resetDataBtn`，已個別處理），所以只要在這兩個函式尾端掛一個 `queueCloudSync()` 就能涵蓋全部寫入路徑，不用改動任何既有的 UI handler。

- **Firestore 結構**：`users/{uid}/records/{id}`、`users/{uid}/categories/{id}`。規則見 `firestore.rules`：`request.auth.uid == uid` 才能讀寫。
- **同步方式**：`diffAndPush(name, currentArr)`（`app.js`）比對目前陣列跟 `lastSynced[name]`（上次成功同步的快照），只寫入真的變動的文件（新增/內容不同→`set`，消失→`delete`），用 `writeBatch` 一次送出，不是整個集合覆寫。
- **接收端**：`startCloudListeners()` 對兩個集合掛 `onSnapshot`，`hasPendingWrites` 為真時忽略（那是自己剛寫入、還沒被伺服器確認的回音），避免無限迴圈；收到真的遠端變動才更新 `state` + `localStorage` + `renderAll()`（用 `applyingRemoteChange` 旗標防止這個更新又觸發一次 `queueCloudSync`）。
- **一次性搬遷（`handleSignedIn()`）**：登入後先用 `getDocs`（一次性讀取，不是 listener）檢查雲端這個帳號是否完全是空的；只有「雲端全空 + 本機有資料」才問使用者要不要搬遷。**關鍵順序**：搬遷的 `diffAndPush` 一定要 `await` 完成、資料確實寫入雲端之後，才呼叫 `startCloudListeners()` 開始監聽。如果順序反過來（曾經是真的 bug，已修正），`onSnapshot` 第一次讀到的空集合會被誤判成「使用者刪光了」，反過來把本機資料蓋成空的——這是絕對要避免的資料遺失情境，之後改這段程式碼務必保持這個順序。使用者若在搬遷提示按「取消」，會直接登出（避免卡在「已登入但沒同步」的曖昧狀態），下次重新登入會再問一次。

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

# 雲端同步本機測試（Firebase Local Emulator Suite，不用真帳號、不用連外網）
# 需要先裝好：Node.js、firebase-tools（npm i -g firebase-tools）、Java 21+（emulator 依賴）
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; firebase emulators:start --project demo-budget-tracker
# Auth: http://localhost:9099　Firestore: http://localhost:8080　Emulator UI: http://localhost:4000
# firebase-config.js 偵測到 hostname 是 localhost 就會自動接去 emulator，不用改任何設定
```

**Git 慣例：** 每完成一個獨立功能/修正就各自 commit + push，不要把好幾個改動囤在一起才存 —— 使用者明確要求要有清楚的版本記錄可以回退（`git revert <hash>`），不要用 `git reset --hard` 改寫歷史除非使用者特別要求。

## 已知眉角

- **Service worker 快取**：`sw.js` 目前是「有快取先回快取、背景再更新」的策略，且只在 `location.hostname === 'localhost'` 或 https 才會註冊（用區網 IP 測試手機時不會註冊，所以那個管道不會有快取問題）。如果在 `localhost` 測試時「改了程式碼但畫面沒變」，先重新整理兩次或清 site data，不是程式壞了。
- **確認對話框**：刪除紀錄/分類目前用瀏覽器原生 `window.confirm()`，不是自訂 UI，故意保持簡單。
- **測試方式**：這個環境沒辦法對瀏覽器截圖，驗證功能都是用 `javascript_tool` 直接操作 DOM（設值、dispatch 事件、讀 innerText/localStorage）取代真人點擊，之後如果继续開發建議延用這個模式驗證，比較快也比較穩定。
- **MoneyNote CSV 匯入的分類合併**：`MONEYNOTE_MERGE_MAP`（`app.js`）是一份「MoneyNote 分類名稱 → 本 App 既有分類」的白名單對照表，只有**確定是同一件事、只是換個名字**的才會合併（例如「醫療費」→「醫療」、「飲食費」→「餐飲」）。真的沒有對應概念的（目前是「交際費」「煙酒」）會建成獨立新分類，並在 `MONEYNOTE_NEW_CATEGORY_KEYWORDS` 給預設關鍵字，不要空著。之後如果來源 App 的分類名稱變了，或想調整合併規則，改這兩個常數即可，不用動解析邏輯本身。
- **分類刪除＝可指定合併目標**：刪除分類不是寫死併入收容分類，而是跳出 `mergeCategorySheet` 讓使用者挑一個既有分類當作合併目的地，`mergeDeleteCategory()` 負責搬移紀錄、必要時把目標升格為新的收容分類。這個機制同時也是使用者在「已經匯入過、資料已經在 localStorage 裡」的情況下手動整併重複分類的唯一管道（改了合併對照表不會回溯套用到已存在的分類上）。
- **Google 登入用 `signInWithRedirect`，不是 `signInWithPopup`**：一開始寫的是 popup，實測在使用者的 iOS Safari（尤其加到主畫面的 PWA 獨立模式）上會卡在「輸入完帳密、驗證通過、頁面轉一下又跳回去，但沒有真的登入」——這是 popup 視窗沒辦法把結果透過 `postMessage` 傳回原頁面的典型症狀。改用 `signInWithRedirect`（整頁導去 Google 再導回來）解決。如果之後這個也在某些瀏覽器情境下不穩，下一步是讓 `authDomain` 跟網站主體同源（例如改用 Firebase Hosting 或自訂網域），因為目前 `authDomain` 是 `budget-tracker-8edd1.firebaseapp.com`、跟 GitHub Pages 的 `cyao0406.github.io` 不同源，Safari 對這種跨網域第三方儲存空間存取本來就限制較多，redirect 只是繞開了 popup 那層，沒有徹底解決跨網域這件事。
- **Firebase 專案設定走 CLI，不是網頁介面**：使用者在 Firebase Console 網頁上設定 Firestore 規則時卡住（畫面顯示「鎖定狀態」但實際上規則編輯不了、資料庫甚至沒真的建立成功），改用 `firebase login`（device code flow，使用者自己在瀏覽器授權）→ `firebase deploy --only firestore:rules` 一次解決（順便自動建好 Firestore 資料庫）。這台電腦上 `firebase apps:list` / `firebase apps:sdkconfig` 有個已知的 Windows 相關 crash（`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`），但通常在噴出這個 assertion 之前，實際要的資訊已經印出來了，看 stdout 內容通常夠用，不影響指令本身的效果。
- **這個測試環境的瀏覽器 pane 對「module script 靜態 import 跨網域 URL」的處理有問題**：`<script type="module" src="app.js">` 頁面載入時，若 `app.js`（或它 import 的檔案）用**靜態** `import ... from 'https://...'` 直接 import gstatic.com 的網址，會出現 `ERR_NAME_NOT_RESOLVED`；但同一個網址用 `fetch()`、`javascript_tool` 主控台打的 `import()`、或直接瀏覽器網址列導航，全部都正常。目前解法是 `firebase-config.js` 內部一律用**動態** `import()`（`await import(url)`）載入 Firebase SDK，`app.js` 只對同源的 `firebase-config.js` 做靜態 import——這是標準 ES 語法，在真實瀏覽器（含 iOS Safari）行為完全一樣，不是 workaround 出來的偏門寫法，之後要加其他 CDN 依賴時延用同一個模式（動態 import、集中包在一個同源檔案裡）比較不會踩到這個 pane 的限制。
- **雲端功能的驗證方式分兩軌**：(1) 同步演算法/安全規則（`diffAndPush`、`firestore.rules`、搬遷時序）是用獨立的 Node.js 腳本，透過 npm 版 `firebase` SDK 直接打 emulator 測的，不依賴瀏覽器 pane，可以完整測到 CVD-safe 那種等級的正確性驗證；(2) DOM/UI 那端（登入畫面顯示切換、按鈕綁定、既有功能沒有因為改成 module 而壞掉）是把 `firebase-config.js` 暫時換成一個純本機假實作（no-op 版）測的，測完要記得換回真正的 `firebase-config.js`。目前沒辦法在這個瀏覽器 pane 裡做「真正串 emulator + 真的 Google 登入」的全端到端測試，這步只能請使用者在自己的真實瀏覽器上做。
- **搬遷/同步邏輯的測試腳本**：位於系統暫存的 scratchpad（session 專屬、不在專案 repo 裡），如果之後要改 `diffAndPush`/`handleSignedIn`/`firestore.rules`，建議重新寫一版類似的 Node 測試腳本（連 emulator、建假帳號、驗證 diff 寫入筆數、驗證 rules 擋掉跨帳號存取、驗證搬遷時序不會讓 listener 看到過渡態的空集合），不要只靠肉眼看程式碼，這塊風險太高值得跑一次真的測試。
