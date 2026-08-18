# AGENTS.md

給 Codex 用的專案導覽。每次在這個目錄啟動時會自動讀取，目標是不用重新探索就能直接開始改東西。

## 開始工作前

如果 `docs/PROJECT_STATE.md` 存在，**先讀它再繼續**，不用重新調查它裡面已經記錄過的工作（這個檔案是用 `/checkpoint` 這個 skill 在使用者要清 context 前手動產生的，代表接續一段中斷的工作，不是每次都會有）。這個專案的模組拆分較細（`app.js`/`sync.js`/`settings.js`/`logic.js`/`csv.js` 等），`PROJECT_STATE.md` 裡如果有記錄「目前在改哪個模組、依賴清單列到哪」，務必照著繼續，不要因為沒印象就重新掃一次全部檔案。

## 現況

App 版本 **v2.9**（`app.js` 的 `CURRENT_VERSION`），沿革見 [CHANGELOG.md](CHANGELOG.md)。搜尋功能使用者已表示「堪用但不夠完善」，細節待她之後提出，不要自己猜篩選條件（見 [ROADMAP.md](ROADMAP.md)）。

## 專案說明

個人記帳 PWA。核心體驗：打一行字（例如「早餐 全家 150」）就自動判斷金額、依關鍵字猜分類、記一筆帳；日/週/月報表用圓餅圖看各分類佔比。

**已實作功能：**
- 三個分頁（底部分頁列）：**輸入**（日期列 + 一行文字快速記帳，主要記帳方式）、**日曆**（整月格狀日曆，每天格子顯示當天淨收支，可點單一天篩選 + 搜尋框 + 紀錄列表）、**報表**（日/週/月圓餅圖 + 圖例，點圖表跳出金額泡泡，點分類另開頁看該分類近 6 個月趨勢圖＋當期逐筆紀錄）
- 快速輸入自動解析金額 + 關鍵字猜分類，猜錯可即時點色塊改
- 點紀錄可編輯（日期/時間/分類/金額/備註/收支類型）或刪除（刪除是「已刪除+復原」toast，5 秒內可復原）
- 分類可設定 emoji 圖示、改名、改關鍵字、改顏色、刪除（含預設分類）——刪除時跳出選單挑紀錄要併入哪個分類，刪的剛好是收容分類時會自動遞補
- CSV 匯出/匯入，匯入自動偵測本 App 格式或 MoneyNote App 的多區段 CSV
- PWA（manifest + service worker，可加入手機主畫面）
- **雲端同步（選用，Firebase）**：不登入完全不受影響；登入 Google 帳號後背景同步到 Firestore，見下方「雲端同步架構」

**部署：**
- GitHub repo：https://github.com/Cyao0406/budget-tracker
- **正式線上網址：https://budget-tracker-8edd1.firebaseapp.com/**（Firebase Hosting，不是 GitHub Pages——原因見「已知眉角」的登入那條）
- GitHub Pages（`cyao0406.github.io/budget-tracker/`）程式碼還在但**雲端登入不會正常運作**，不要拿這個網址給使用者
- 部署：`git push`（版本記錄）→ `firebase deploy --only hosting`（正式站才會更新，兩者都要跑）
- 手機用 Safari 開 `.firebaseapp.com` 網址 →「加入主畫面」
- Firebase 專案：`budget-tracker-8edd1`，`firebase-config.js` 已填真實 config，本機/emulator 測試不受影響（見下方指令）

## 技術架構

前端 vanilla HTML/CSS/JS，**沒有建置工具**（Firebase SDK 用 CDN 動態 `import()`，瀏覽器端不需要 npm）。`index.html` 的 `<script>` 是 `type="module"`，`app.js` 內部維持一個 IIFE 包主邏輯、用全域 `state` 物件手動管理狀態，每次操作後呼叫對應 `render*()` 重繪，不是 reactive framework；import 語句必須放在 IIFE 外層。

`utils.js`/`csv.js`/`changelog-data.js`/`logic.js` 完全不碰 `state`/DOM/Firebase，是純函式或純資料模組，可以直接被 `test/run.mjs` import 測試。`sync.js`（Google 登入+Firestore 同步）跟 `settings.js`（分類管理）跟畫面/state 有耦合但邊界清楚，刻意設計成**不 import `app.js`**（依賴方向單向：`app.js` 是總機，import 它們；它們不反過來 import `app.js`），需要的 `state`/`els`/`showToast`/`renderAll` 等協作者由 `app.js` 在 `init()` 時透過 `initCloudSync(deps)`/`initSettingsModule(deps)` 注入，避免循環依賴。`state` 本體、渲染（report/calendar/records list/drilldown）、事件綁定 `bindEvents()`（~340 行）耦合最深還沒拆——`parseQuickInput`/`guessCategory`/`getRange` 等核心規則的運算本體已抽到 `logic.js` 並補了測試，但 `state`/`bindEvents()` 本身仍沒有測試涵蓋；之後要繼續拆這塊，先幫這裡補測試，不要在沒有測試護欄下硬拆。

```
index.html          頁面結構（含所有 sheet/modal，含登入畫面 UI）
style.css            樣式，含 CSS 變數（design tokens）
app.js               主要邏輯：state、渲染、事件綁定、CRUD
utils.js             純函式工具（日期運算、格式化、escapeHtml、debounce……）
csv.js               CSV 剖析＋匯入的解析/驗證/暫存邏輯（stageImportCsv 等）
changelog-data.js    CURRENT_VERSION + CHANGELOG，純資料
sync.js              Google 登入 + Firestore 雲端同步，透過 initCloudSync(deps) 注入協作者
settings.js          分類管理/清理重複分類/重新套用關鍵字，透過 initSettingsModule(deps) 注入協作者
logic.js             核心記帳規則的純函式版本：快速輸入解析、自動分類、期間計算、紀錄篩選；
                      app.js 保留同名薄殼呼叫這裡
firebase-config.js   Firebase 初始化 + emulator/正式環境切換
firestore.rules      Firestore 安全規則（每個使用者只能讀寫自己 uid 底下的資料）
firebase.json        Firebase CLI / emulator 設定
manifest.json        PWA manifest
sw.js                Service worker（快取策略見「已知眉角」，ASSETS 清單要包含所有 .js 模組）
icons/               PWA 圖示（192/512/maskable）
package.json         只有 "type":"module"，讓 Node 能把 .js 模組當 ES module 載入測試；瀏覽器不讀這個檔案
test/run.mjs         單元測試（`npm test`），只測 utils.js/csv.js/logic.js 這種純函式；
                      `npm run lint` 是 `node --check` 語法檢查
README.md            面向使用者/開發者的簡短說明
ROADMAP.md           未來規劃與技術債
VENDOR_RISK.md       Firebase 等第三方服務的風險與退場計畫
```

**資料模型：**
- `budgetapp.records` — `[{id, date:'YYYY-MM-DD', type:'expense'|'income', categoryId, amount, note, createdAt}]`。`createdAt` 是完整時間戳（ms），編輯紀錄可手動調整（見 `editSaveBtn` handler，把 `editDate`+`editTime` 合併回新的 `createdAt`）。
- `budgetapp.categories` — `[{id, type, name, colorVar, icon:string, keywords:[string], fallback:boolean}]`。`icon` 是選填 emoji（`catDisplayName(c)` 統一組出顯示字串）。`fallback` 標記該 type 的「收容分類」，每個 type 永遠恰好一個（刪除邏輯自動遞補）。預設分類新增項目用**固定 id**（例如 `cat-subscription-default`），多裝置各自補漏會收斂成同一份文件，不會重複。
- `budgetapp.theme` — `'light'|'dark'`，不存代表跟隨系統，**不同步到雲端**。
- localStorage 永遠是畫面即時渲染的來源，不管有沒有登入都一樣。

**自動分類邏輯**（`parseQuickInput` + `guessCategory`）：輸入字串裡最後一個純數字 token 當金額，其餘文字當備註；備註對每個分類的 `keywords` 做 substring 比對（不分大小寫），第一個命中的分類獲勝，都沒命中就用該 type 的 fallback。

## 三分頁介面架構

`state.activeTab`（`'input'|'calendar'|'report'`）+ `switchTab(tab)` 切換顯示/隱藏，底部 `.bottom-tabs` 固定定位。三個分頁對應 `index.html` 的 `#tabInput`/`#tabCalendar`/`#tabReport`。

- **輸入分頁**：日期列 + 一行文字快速輸入，維持文字輸入為主是使用者明確要求（曾考慮改成點選式輸入，最終保留文字為主）。
- **日曆分頁**：跟 date-bar 上的日期選擇 popup（`calendarPopup`/`calendarGrid`）是兩個獨立元件，不要搞混。`state.calendarTabMonth`/`state.calendarSelectedDay` 驅動 `renderCalendarTab()`；下方月總計 + 搜尋框 + 紀錄列表共用 `calendarFilteredRecords()`（沒搜尋時依月份/選中的天篩選，一有搜尋字串就無視月份範圍搜全部紀錄）。
- **報表分頁**：沿用 `state.period`/`getRange()`。點圓餅圖跳出金額/百分比小泡泡（`toggleChartTooltip()`），不整頁篩選；圖例列表永遠顯示全部分類，點一列用 `openCategoryDrilldown(categoryId)` 開子頁面，裡面是該分類近 6 個月長條趨勢圖（`buildTrendChart()`，固定近 6 個月）+ 當期逐筆紀錄。這個 drill-down 頁面只在點進某分類後才看得到，還沒有獨立的「整體月趨勢」視圖。
- **共用元件**：`buildRecordRow(r)` + `renderGroupedRecordList(container, recs, emptyMsg)` 是日曆分頁跟分類 drill-down 頁共用的渲染邏輯。

## 雲端同步架構

邏輯全部在 `sync.js`，`app.js` 只在 `init()` 呼叫一次 `initCloudSync({ state, els, STORAGE, showToast, renderAll, categoriesFreshlySeeded })` 注入協作者，之後呼叫 `sync.js` export 的 `queueCloudSync`/`enqueueSync`/`diffAndPush`/`signInGoogle`/`signOutCloud`，並讀取 `sync.js` export 的 `cloudUser`（ES module live binding，不用額外包 getter）。

**設計原則：** localStorage 永遠是「畫面立刻看到」的來源；Firestore 是背景同步層。所有會修改 `state.records`/`state.categories` 的地方最後都會呼叫 `saveRecords()`/`saveCategories()`（唯一例外 `resetDataBtn` 已個別處理），所以在這兩個函式尾端掛 `queueCloudSync()` 就涵蓋全部寫入路徑。

- **Firestore 結構**：`users/{uid}/records/{id}`、`users/{uid}/categories/{id}`，規則見 `firestore.rules`（`request.auth.uid == uid` 才能讀寫）。
- **同步方式**：`diffAndPush(name, currentArr)` 比對目前陣列跟 `lastSynced[name]`，只寫入真的變動的文件，用 `writeBatch` 一次送出。
- **接收端**：`startCloudListeners()` 對兩個集合掛 `onSnapshot`，`hasPendingWrites` 為真時忽略（自己剛寫入的回音）；收到真的遠端變動才更新 `state` + `localStorage` + `renderAll()`（`applyingRemoteChange` 旗標防止觸發二次 `queueCloudSync`）。
- **一次性搬遷（`handleSignedIn()`）**：只有「雲端全空 + 本機有資料」才問要不要搬遷。**關鍵順序**：搬遷的 `diffAndPush` 一定要 `await` 完成、資料確實寫入雲端後，才呼叫 `startCloudListeners()`——順序反過來會讓 `onSnapshot` 第一次讀到的空集合被誤判成「使用者刪光了」，反過來清空本機資料，這是絕對要避免的資料遺失情境。使用者在搬遷提示按「取消」會直接登出，下次重新登入再問一次。
- 登入分類重複的偵測邏輯（本機是冷啟動預設值+雲端已有分類→採用雲端版本）已實測修好；若之後又回報類似狀況，代表還有情境沒涵蓋，需重新排查、不要假設同一成因。

## 風格規範

**顏色系統（CSS 變數，`style.css` 最上方 `:root`）：**
- `--accent`：介面強調色（金色）。所有按鈕/選中狀態/連結/focus 外框用這個，**故意跟 `--series-1`（分類識別色）分開**——曾經共用過導致改分類顏色會意外動到介面主題色，之後只改這一個變數，不要碰 `--series-*`。
- `--series-1` ~ `--series-8`：分類識別色，8 色一組（CVD 安全性驗證過），分類自動配色（`nextColorVar`）跟圖表預設用色來源，**不要**改色相順序或增減數量。
- `--pastel-1` ~ `--pastel-8`：使用者手動選色的淺色選項，跨主題固定不變。也被「訂閱費」這個預設分類拿來當固定色（`--pastel-6`），因為 `--series-*` 都被佔滿了。
- `--expense-color` / `--income-color`：金額正負號用色，跟分類識別色分開語意，別混用。

**主題：** `prefers-color-scheme` 自動 + `data-theme` 手動覆寫雙軌並存，改 CSS 變數時三處都要改（`:root`、`@media dark`、`:root[data-theme="dark"]`）。

**版面：** 手機優先，`.app` 容器 `max-width: 480px`（桌面 560px），大量用 `sheet`（底部彈出面板）取代置中 dialog。

**命名慣例：** CSS class 用 kebab-case；JS 函式/變數用 camelCase；`els` 物件集中存所有 DOM 參照（`cacheEls()` 一次抓齊）。

**文案語氣：** 全繁體中文，簡短口語化，避免翻譯腔。

## 常用指令

```bash
# 本機測試伺服器（用 python，瀏覽器端不需要 npm）
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; python -m http.server 8791
# 開 http://localhost:8791

# 單元測試 + 語法檢查
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; npm test
npm run lint

# 部署（改完 code 後兩個都要跑，順序不重要）
git add -A; git commit -m "說明這次改了什麼"; git push
firebase deploy --only hosting
# git push 只是保留版本記錄；正式站（.firebaseapp.com）要 firebase deploy 才會真的更新
# GitHub Pages 網址會自動重新部署，但不要拿來測登入功能

# 雲端同步本機測試（Firebase Local Emulator Suite，不用真帳號、不用連外網）
# 需先裝好：Node.js、firebase-tools（npm i -g firebase-tools）、Java 21+
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; firebase emulators:start --project demo-budget-tracker
# Auth: http://localhost:9099　Firestore: http://localhost:8080　Emulator UI: http://localhost:4000
# firebase-config.js 偵測到 hostname 是 localhost 就會自動接去 emulator
```

**Git 慣例：** 每完成一個獨立功能/修正就各自 commit + push，不要囤在一起——使用者要清楚的版本記錄可以回退（`git revert <hash>`），不要用 `git reset --hard` 改寫歷史除非特別要求。

**部署工作流程：** 改完程式碼先用本機伺服器搭配假資料驗證（`javascript_tool` 操作 DOM/localStorage，不要碰真實帳號的 Firestore），接著可以**直接 commit + push + `firebase deploy --only hosting`，不用每次先問過才部署**——這是使用者明確授權的日常節奏。前提只有一個：**不能動到使用者的真實資料**（不要在正式站用假帳號操作真實 Firestore、不要寫任何會清空/覆蓋既有資料的搬遷邏輯又沒讓她過目）。改動風險特別高時（例如雲端同步的資料搬遷/合併邏輯）還是要照本機/emulator 驗證過的謹慎程度衡量，但「要不要現在部署」本身不用再開口問。

## 已知眉角

- **Service worker 快取**：`sw.js` 是 network-first（有網路一定拿最新版本，只有離線才退回快取），且 `fetch(event.request)` 要帶 `{ cache: 'no-store' }`，否則會被瀏覽器自己的 HTTP 快取擋下（跟 SW 快取策略是兩層不同的東西）。只在 `localhost`/https 才會註冊。改 `sw.js` 或快取策略記得同步把 `CACHE_NAME` 往上加版號；`ASSETS` 陣列新增檔案時也要同步加進去。這個測試環境沒辦法真的註冊 service worker，改動只能部署後請使用者在真實裝置確認。
- **確認對話框**：刪除紀錄/分類用瀏覽器原生 `window.confirm()`，故意保持簡單。
- **測試方式**：這個環境沒辦法對瀏覽器截圖，驗證功能都用 `javascript_tool` 直接操作 DOM（設值、dispatch 事件、讀 innerText/localStorage）取代真人點擊，延用這個模式驗證比較快也比較穩定。
- **MoneyNote CSV 匯入的分類合併**：`MONEYNOTE_MERGE_MAP`（`app.js`）是「MoneyNote 分類名稱 → 本 App 既有分類」白名單，只有確定同一件事、只是換名字的才合併。沒有對應概念的（目前「交際費」「煙酒」）建成獨立新分類，在 `MONEYNOTE_NEW_CATEGORY_KEYWORDS` 給預設關鍵字。之後來源格式變了改這兩個常數即可，不用動解析邏輯。
- **分類刪除＝可指定合併目標**：跳出 `mergeCategorySheet` 讓使用者挑既有分類當合併目的地，`mergeDeleteCategory()` 搬移紀錄、必要時把目標升格為新收容分類。這也是使用者手動整併重複分類的唯一管道（改合併對照表不會回溯套用到已存在的分類）。
- **Google 登入必須用 Firebase Hosting `.firebaseapp.com`，不能用 GitHub Pages 或 `.web.app`**：`authDomain` 要跟網站同源（GitHub Pages 網域做不到），且 Firebase 啟用 Google 登入時 OAuth 用戶端只自動註冊 `.firebaseapp.com`、不含 `.web.app`。之後不要嘗試切回這兩個。
- **部署 ignore 清單要用 curl 驗證，不能只看 glob 寫得對不對**：`"**/.*"` 這種萬用字元只擋「檔名本身開頭是 `.`」，擋不住「路徑中間某層資料夾開頭是 `.`、裡面檔案不是」的情況——`.git/**`、`.claude/**` 都曾經因此被公開部署過（尤其是 `Agent` 工具 `isolation:"worktree"` 會在 `.claude/worktrees/agent-*/` 建立完整 repo checkout）。之後任何會在專案資料夾產生新隱藏目錄的工具，部署前記得比對 `firebase deploy` 印出的「found N files」是不是突然暴增（正常 15~20 出頭）。
- **Firebase 專案設定走 CLI，不是網頁介面**：Firebase Console 網頁上設定規則容易卡在「鎖定狀態」，改用 `firebase login`（device code flow）→ `firebase deploy --only firestore:rules`/`--only hosting`。這台電腦上 `firebase apps:list`/`apps:sdkconfig`/`use --add` 有已知 Windows crash（`UV_HANDLE_CLOSING` assertion），但通常噴出前該印的資訊已經印出來了，看 stdout 內容通常夠用。
- **`ALLOWED_CLOUD_EMAILS` 白名單（`app.js` 的 `handleSignedIn()`）**：Google OAuth 同意畫面設定正確，但實測非測試帳號仍能完成登入，原因不明。應用層加一道自己可驗證的防線：登入後比對 email 是否在白名單，不是就立刻 `signOut()`。使用者換帳號或想開放給家人用，改這個陣列即可。
- **這個測試環境對「module script 靜態 import 跨網域 URL」處理有問題**：靜態 `import ... from 'https://...'` 會 `ERR_NAME_NOT_RESOLVED`，但 `fetch()`/動態 `import()`/瀏覽器網址列導航都正常。解法是 `firebase-config.js` 內部一律用動態 `import()` 載入 Firebase SDK，`app.js` 只對同源檔案做靜態 import——之後加其他 CDN 依賴延用同一模式。
- **這個測試環境也沒辦法真的註冊 service worker**：`navigator.serviceWorker.register()` 一律失敗（`An unknown error occurred when fetching the script`），跟上面的跨網域 import 錯誤字串相同但這次是同源檔案，應該是這個 pane 本身對 fetch script/register 類請求的限制。改動只能靠讀程式碼判斷邏輯，部署後請使用者在真實裝置確認。
- **雲端功能驗證分兩軌**：(1) 同步演算法/安全規則用獨立 Node.js 腳本透過 npm 版 `firebase` SDK 打 emulator 測，不依賴瀏覽器 pane；(2) DOM/UI 那端把 `firebase-config.js` 暫時換成本機假實作測，測完記得換回真正的 config。這裡沒辦法做「真的串 emulator + 真的 Google 登入」的全端到端測試，只能請使用者在自己的瀏覽器上做。
- **搬遷/同步邏輯的測試腳本沒有留在 repo 裡**：如果之後要改 `diffAndPush`/`handleSignedIn`/`firestore.rules`，建議重新寫一版 Node 測試腳本（連 emulator、建假帳號、驗證 diff 寫入筆數、驗證 rules 擋跨帳號存取、驗證搬遷時序不會讓 listener 看到過渡態空集合），不要只靠肉眼看程式碼，這塊風險太高值得跑一次真測試。
- **`handleSignedIn()` 的一般登入只做「新增/覆寫」push（`pushLocalOnly()`），不做刪除**：因為這個時間點沒辦法區分「本機真的刪除」還是「這筆是別的裝置已同步、這台還沒同步過」，誤刪風險太高，刪除只交給後續 listener 自然同步回來。只有「雲端全空+本機有資料」的首次搬遷才用會刪除的 `diffAndPush()`。
- **新增預設 emoji 圖示優先選 Unicode 6.0 左右、單一 codepoint、沒有 ZWJ 組合序列的**，避免挑太新或需要 variation selector 的（曾經用過的購物袋 emoji 在部分系統顯示不穩定）。
- **`navigator.vibrate()` 只是加分，不是必要**：iOS Safari 完全沒實作這個 API，呼叫了沒反應也不會報錯，是平台限制不是 bug。
- **`功能及介面參考資料/` 資料夾**：使用者提供的介面設計參考截圖，只存在本機，**沒有加進 git**，不要自作主張把它加進版本控制。
