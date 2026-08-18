# AGENTS.md

給 Codex 用的專案導覽。每次在這個目錄啟動時會自動讀取，目標是不用重新探索就能直接開始改東西。

## 目前狀態（2026-08-18）

- App 版本 **v2.9**（`app.js` 的 `CURRENT_VERSION`），詳細沿革見 [CHANGELOG.md](CHANGELOG.md)。v2.9 是針對 v2.8 那批改動做的一次嚴格複查（用 8 個角度分別派 agent 重新審查），修掉幾個沒發現的邊界情況：清除資料/登入同步補齊排隊機制、CSV 公式注入防護匯入匯出不對稱、`skipCategoryPush` 沒 remap 紀錄的 categoryId、搜尋金額篩選缺 NaN 防護、日曆週六顏色借用分類識別色。
- **2026-08-18 架構重構（無使用者可見行為變動，純內部拆分，不算版本更新）**：依照使用者提供的 `app_architecture_optimization.md` 分層方法論，掃描現況後只挑「已經有清楚邊界」的三塊分批抽出獨立模組（過度分層、幫還沒做的功能預先蓋空殼都刻意不做，理由詳見下方「技術架構」）：
  1. 批次1：`CURRENT_VERSION`/`CHANGELOG` 純資料搬到 `changelog-data.js`。
  2. 批次2：Google 登入 + Firestore 雲端同步整段搬到 `sync.js`。
  3. 批次3：分類管理／清理重複分類／重新套用關鍵字分類搬到 `settings.js`。
  - `app.js` 從 1880 行降到 1302 行（−31%）。每批只搬檔案、不改任何邏輯，搬移前先列好跨模組依賴清單，搬移後用 grep 確認沒有遺漏引用，再跑 `npm run lint`+`npm test`+瀏覽器手動測試過一輪才 commit，三批各自獨立 commit/deploy。`sync.js`/`settings.js` 都不 import `app.js`（依賴方向單向，`app.js` 是總機），需要的 `state`/`els`/`showToast`/`renderAll` 等協作者透過 `initCloudSync()`/`initSettingsModule()` 在 `init()` 時當參數注入，避免循環依賴。
  - 三批做完後使用者確認過真的 Google 登入正常，接著問「要不要補測試」，答案是：**要補，但不是為了替 `state`/`bindEvents()` 那塊高風險拆分（原本規劃的批次4）鋪路，是因為 `parseQuickInput`/`guessCategory`/`getRange`/`reportFilteredRecords`/`calendarFilteredRecords` 這幾個核心記帳規則本身完全沒測試涵蓋，之後的分類預算上限/固定支出提醒/AI自動分類等功能大概率會動到這裡**。於是把這幾個函式的運算本體抽成 `logic.js`（純函式，跟 `csv.js` 同樣精神），`app.js` 保留讀 `state` 的薄殼、呼叫端簽名不變，補了 15 個單元測試（28→43 個全過）。`state`/`bindEvents()` 本身這次仍然沒有動，維持「等真的有功能逼你去動再拆」的判斷，不是忘記做。
- 雲端登入分類重複的修法（`handleSignedIn` 偵測「本機分類是冷啟動預設值 + 雲端已有分類」就完全採用雲端版本）**使用者已用真實帳號實測過，確認無痕視窗重新登入不會再重複**。如果之後又回報類似狀況，代表還有這個修法沒涵蓋到的情境，要重新排查、不能假設是同一個成因。
- `ROADMAP.md` 裡「時間記錄／圓餅圖篩選（現為泡泡+drill-down）／刪除復原／emoji圖示／搜尋／月趨勢圖」這幾項使用者已在 2026-08-13 確認測試通過，已經打勾。搜尋功能她特別註明「堪用但不夠完善，之後會再優化」，細節待她之後提出，不要自己猜要加什麼篩選條件。
- **2026-08-14 的一次程式碼健檢＋四階段維護**：使用者請另一個 AI 對整個專案做程式碼審查，逐條核對後屬實居多，已依建議分四階段全部做完並部署：
  1. 資料安全：清除雲端失敗不清本機、Firestore batch 分批避免超過 500 上限、同步序列化——用 Firebase emulator 寫 Node 測試腳本驗證過（腳本在 session scratchpad，沒留在 repo，之後要改這塊建議重新寫一版）。
  2. 備份可靠性：CSV 匯入換成完整 RFC4180 parser、改成解析→驗證→預覽→確認→套用、補金額/日期驗證、匯出防公式注入——用真實檔案匯入流程測試過。
  3. 維護成本：`app.js` 拆出 `utils.js`/`csv.js` 兩個純函式模組（`state`/渲染/同步等緊密耦合的部分保留在 `app.js`，沒有勉強全拆）、補最小化單元測試（`test/run.mjs`，27 個測試）、`AGENTS.md` 跟 `CLAUDE.md` 同步。
  4. 體驗細節：修正 service worker 更新邏輯（`controllerchange` 真的偵測到版本切換才 reload）、sheet 補 `role="dialog"`/focus trap/Escape/`prefers-reduced-motion`、manifest 跟 theme-color 改金色、搜尋 debounce。
  - 這次新增了 `package.json`（只有 `"type":"module"`，沒有任何依賴，純粹讓 Node 能正確載入 `utils.js`/`csv.js` 做測試，不影響瀏覽器端部署方式）。

## 專案說明

個人記帳 PWA。核心體驗：打一行字（例如「早餐 全家 150」）就自動判斷金額、依關鍵字猜分類、記一筆帳；日/週/月報表用圓餅圖看各分類佔比。

**已實作功能：**
- 主畫面分成三個分頁（底部分頁列切換）：**輸入**（日期列 + 一行文字快速記帳，主要記帳方式）、**日曆**（整月格狀日曆，每天格子直接顯示當天淨收支，可點單一天篩選 + 搜尋框 + 紀錄列表）、**報表**（日/週/月圓餅圖 + 圖例，點圖表跳出金額泡泡，點分類列表另開頁面看該分類近 6 個月趨勢圖＋當期逐筆紀錄）
- 快速輸入自動解析金額 + 關鍵字猜分類，猜錯可即時點色塊改
- 點紀錄可編輯（改日期/時間/分類/金額/備註/收支類型）或刪除（刪除是「已刪除+復原」toast，5 秒內可復原，取代原本的 `confirm()`）
- 分類可設定 emoji 圖示（設定頁分類名稱旁邊的小輸入框），列表/選單顯示分類時都會帶出來
- 設定裡可管理分類：改名、改圖示、改關鍵字、改顏色（16 色可選）、刪除（含預設分類）——刪除時會跳出選單讓你挑紀錄要併入哪個分類（不是固定丟進收容分類），刪的剛好是收容分類時，選中的目標會自動遞補成新的收容分類
- CSV 匯出/匯入（單機資料的備份手段），匯入自動偵測並支援兩種格式：本 App 自己的匯出格式，以及 MoneyNote App 匯出的多區段 CSV（`#DAILY_DATAS` + `#CATEGORIES`）
- PWA：manifest + service worker，可加入手機主畫面
- **雲端同步（選用，Firebase）**：不登入完全不受影響、行為跟純單機版一樣；登入 Google 帳號後資料會背景同步到 Firestore，其他登入同帳號的裝置也會即時收到更新。見下方「雲端同步架構」。

**部署：**
- GitHub repo：https://github.com/Cyao0406/budget-tracker（原始碼保留在這裡，`git push` 照舊）
- **正式線上網址：https://budget-tracker-8edd1.firebaseapp.com/**（Firebase Hosting，不是 GitHub Pages 了——原因見下方「已知眉角」的登入那段，`authDomain` 要跟網站同源，GitHub Pages 的 `cyao0406.github.io` 做不到這件事）
- GitHub Pages（`cyao0406.github.io/budget-tracker/`）程式碼還在、還能開，但**雲端登入在那個網址上不會正常運作**，不要再拿那個網址給使用者用
- 部署方式：改完程式碼先 `git push`（保留版本記錄），再 `firebase deploy --only hosting` 才會真的更新正式站
- 手機用 Safari 開 `.firebaseapp.com` 那個網址 →「加入主畫面」即可像 App 一樣使用
- Firebase 專案：`budget-tracker-8edd1`，`firebase-config.js` 已填入真實 config；本機/emulator 測試不受影響（見下方指令）

## 技術架構

前端 vanilla HTML/CSS/JS，**沒有建置工具**（雲端功能用 CDN 直接載入 Firebase SDK，不是透過 bundler；瀏覽器端完全不需要 npm）。`index.html` 的 `<script>` 是 `type="module"`，`app.js` 內部仍維持一個 IIFE 包住主要邏輯、用全域 `state` 物件手動管理狀態，每次操作後呼叫對應的 `render*()` 函式重繪，不是 reactive framework；import 語句必須放在 IIFE 外層（ES module 的硬性規定）。

**模組拆分現況（2026-08-14 起累積到 2026-08-18）**：`utils.js`（日期/格式化/字串等通用工具）、`csv.js`（CSV 剖析與匯入邏輯）、`changelog-data.js`（版本紀錄純資料）、`logic.js`（快速輸入解析/自動分類/期間計算/紀錄篩選的核心記帳規則）四個是完全不碰 `state`/DOM/Firebase 的純函式或純資料模組，這幾個的函式都可以直接被 `test/run.mjs` import 進來測試。`sync.js`（Google 登入 + Firestore 雲端同步）跟 `settings.js`（分類管理/清理重複分類/重新套用關鍵字分類）則是「跟畫面/state 有耦合、但邊界本來就清楚」的兩塊，2026-08-18 依 `app_architecture_optimization.md` 的方法論分批抽出（過程見上方「目前狀態」）——這兩個模組刻意設計成**不 import `app.js`**（依賴方向單向：`app.js` 是總機，import 它們；它們不反過來 import `app.js`），需要用到的 `state`/`els`/`showToast`/`renderAll`/`saveCategories` 等協作者，改成 `app.js` 在 `init()` 時透過 `initCloudSync(deps)`/`initSettingsModule(deps)` 當參數注入，不是用 import 硬綁——這樣之後不管哪個模組要單獨測試或替換，都不用擔心循環依賴。`state` 本體、渲染（report/calendar/records list/drilldown）、事件綁定 `bindEvents()`（仍有 ~340 行）這幾塊耦合最深，還留在 `app.js` 裡沒有拆——如果之後要繼續拆這塊，`CLAUDE.md` 之前就記錄過要先幫 `parseQuickInput`/`guessCategory`/`getRange` 這類邏輯補單元測試（目前 28 個測試完全沒碰這裡），不要在沒有測試護欄的情況下硬拆。

```
index.html          頁面結構（含所有 sheet/modal 的 markup，含登入畫面 UI）
style.css            樣式，含 CSS 變數（design tokens）
app.js               主要邏輯：state、渲染、事件綁定、CRUD（雲端同步/分類設定/版本資料/CSV解析已拆到下面幾個模組）
utils.js             純函式工具（日期運算、格式化、escapeHtml、debounce……），不碰 state/DOM
csv.js               CSV 剖析＋匯入的解析/驗證/暫存邏輯（stageImportCsv 等），不碰 state/DOM
changelog-data.js    CURRENT_VERSION + CHANGELOG，純資料沒有邏輯
sync.js              Google 登入 + Firestore 雲端同步（diffAndPush、批次分批、同步佇列序列化、
                      搬遷/reconcile 邏輯），透過 initCloudSync(deps) 注入協作者，不 import app.js
settings.js          分類管理（新增/改名/改圖示/改顏色/刪除/合併）、清理重複分類、重新套用關鍵字，
                      透過 initSettingsModule(deps) 注入協作者，不 import app.js
logic.js             核心記帳規則的純函式版本：快速輸入解析、自動分類、期間計算、紀錄篩選
                      （parseQuickInput/guessCategoryIn/getRangeFor/sortRecs/
                      reportFilteredRecordsIn/hasActiveSearchFiltersIn/calendarFilteredRecordsIn），
                      不碰 state/DOM；app.js 保留同名/相近名稱的薄殼呼叫這裡
firebase-config.js   Firebase 初始化 + emulator/正式環境切換（見下方）
firestore.rules      Firestore 安全規則（每個使用者只能讀寫自己 uid 底下的資料）
firebase.json        Firebase CLI / emulator 設定
manifest.json        PWA manifest
sw.js                Service worker（快取策略見下方「已知眉角」，ASSETS 清單要包含所有上述 .js 模組）
icons/               PWA 圖示（192/512/maskable，用 PowerShell + System.Drawing 產生）
package.json         只有 "type":"module"，讓 Node 能把 utils.js/csv.js 等模組當 ES module 載入來測試；
                      沒有任何 npm 依賴，瀏覽器不會讀這個檔案，跟正式站部署方式無關
test/run.mjs         最小化單元測試（`npm test` 或 `node test/run.mjs`），只測 utils.js/csv.js
                      這種純函式，不需要測試框架；`npm run lint` 是 `node --check` 這種語法檢查
README.md            面向使用者/開發者的簡短說明
ROADMAP.md           未來規劃與技術債
VENDOR_RISK.md       Firebase 等第三方服務的風險與退場計畫（政策/定價變動時怎麼辦）
```

**資料模型：**
- `budgetapp.records` — `[{id, date:'YYYY-MM-DD', type:'expense'|'income', categoryId, amount, note, createdAt}]`。`createdAt` 是完整時間戳（ms），紀錄列表會顯示時間、編輯紀錄可以手動調整（見 `editSaveBtn` handler，把 `editDate`+`editTime` 兩個欄位合併回一個新的 `createdAt`）。
- `budgetapp.categories` — `[{id, type, name, colorVar, icon:string, keywords:[string], fallback:boolean}]`。`icon` 是選填的 emoji 字串（`catDisplayName(c)` 統一組出「icon + 空格 + name」給各處顯示用，沒設 icon 就只顯示名稱）。`fallback` 標記該類型的「收容分類」，刪別的分類時歸不到的紀錄會轉進去；每個 type 永遠恰好有一個 fallback（刪除邏輯會自動遞補，見 `app.js` 的 `.del-cat-btn` handler）。預設分類清單（`DEFAULT_EXPENSE_CATS`/`DEFAULT_INCOME_CATS`）新增項目時，`loadCategories()` 會用**固定 id**（例如 `cat-subscription-default`）幫既有使用者一次性補上，不是隨機 uid——這樣多台裝置各自補漏也會收斂成同一份文件，不會重複。
- `budgetapp.theme` — `'light'|'dark'`，不存代表跟隨系統；主題偏好**不同步到雲端**，純本機。
- localStorage 永遠是畫面即時渲染的來源，不管有沒有登入都一樣；登入雲端同步只是在背景多一層。

**自動分類邏輯**（`parseQuickInput` + `guessCategory`，在 `app.js`）：輸入字串裡最後一個純數字 token 當金額，其餘文字當備註；備註對每個分類的 `keywords` 陣列做 substring 比對（不分大小寫），第一個命中的分類獲勝，都沒命中就用該 type 的 fallback。

## 三分頁介面架構（v2.5，2026-08-13）

主畫面從「單頁堆疊全部功能」改成三個分頁，靠 `state.activeTab`（`'input'|'calendar'|'report'`）+ `switchTab(tab)` 切換顯示/隱藏，底部 `.bottom-tabs` 是固定定位（`position: fixed`）的分頁列。三個分頁對應 `index.html` 裡的 `#tabInput`/`#tabCalendar`/`#tabReport`。

- **輸入分頁**：跟改版前一樣是主要記帳方式——日期列（挑要記到哪一天）+ 一行文字快速輸入卡片。**這個維持不變是使用者明確要求的**，改版時曾經考慮過改成參考圖片裡的點選式輸入，使用者選擇保留文字輸入為主。
- **日曆分頁**：全新元件，跟原本「date-bar 上那個小的日期選擇 popup」（`calendarPopup`/`calendarGrid`，還留著給輸入分頁用）是兩個獨立的東西，不要搞混。用 `state.calendarTabMonth`（瀏覽哪個月）+ `state.calendarSelectedDay`（有沒有點選單一天）驅動 `renderCalendarTab()`：整月格子（`calendarGridBig`）每格直接顯示當天淨收支金額；下方月總計 + 搜尋框 + 紀錄列表共用 `calendarFilteredRecords()`（沒搜尋時依月份/選中的天篩選，一有搜尋字串就無視月份範圍搜全部紀錄，跟改版前的搜尋語意一致）。
- **報表分頁**：日/週/月圓餅圖沿用改版前的 `state.period`/`getRange()`，但**互動方式整個換掉**：原本「點圖表整頁篩選成單一分類」的做法（`state.chartFilterCategoryId`）已經拿掉，改成參考使用者提供的截圖（`功能及介面參考資料/`，四張圖，只在使用者電腦本機，沒進 git）——點圓餅圖只跳出一個金額/百分比小泡泡（`toggleChartTooltip()`，`#chartTooltip`，再點同一塊會收起來），圖例列表永遠顯示全部分類，點一列會用 `openCategoryDrilldown(categoryId)` 另開一個子頁面（`#categoryDrilldownView`，蓋掉 `#reportMainView`），裡面是該分類近 6 個月的長條趨勢圖（`buildTrendChart()`，固定抓近 6 個月，跟 `state.period` 選的日/週/月無關）+ 當期（`state.period` 範圍內）該分類的逐筆紀錄。這個 drill-down 頁面等於順便把 ROADMAP 的「月趨勢圖」需求也做掉了，但目前**只在分類 drill-down 情境下看得到**，還沒有一個獨立的「整體月趨勢」視圖。
- **共用元件**：`buildRecordRow(r)`（單筆紀錄的 DOM）+ `renderGroupedRecordList(container, recs, emptyMsg)`（依日期分組、永遠顯示日期標籤）是日曆分頁跟分類 drill-down 頁共用的渲染邏輯，改任何一筆紀錄的顯示樣式只要改這裡。

## 雲端同步架構

**程式碼位置（2026-08-18 起）：** 這一節講的邏輯全部在 `sync.js`，不在 `app.js` 裡了。`app.js` 只在 `init()` 呼叫一次 `initCloudSync({ state, els, STORAGE, showToast, renderAll, categoriesFreshlySeeded })` 注入協作者，之後就是呼叫 `sync.js` export 出來的 `queueCloudSync`/`enqueueSync`/`diffAndPush`/`signInGoogle`/`signOutCloud`，還有讀取 `sync.js` export 的 `cloudUser`（ES module live binding，`sync.js` 內部重新賦值時 `app.js` 讀到的值會自動同步更新，不用額外包 getter）。

**設計原則：** localStorage 永遠是「畫面立刻看到」的來源；Firestore 是背景同步層，不影響未登入時的行為。這樣不用把每個 CRUD 呼叫點都改成 async Firestore 呼叫——利用一個既有的事實：**所有**會修改 `state.records`/`state.categories` 的地方，最後都會呼叫 `saveRecords()`/`saveCategories()`（唯一例外是 `resetDataBtn`，已個別處理），所以只要在這兩個函式尾端掛一個 `queueCloudSync()` 就能涵蓋全部寫入路徑，不用改動任何既有的 UI handler。

- **Firestore 結構**：`users/{uid}/records/{id}`、`users/{uid}/categories/{id}`。規則見 `firestore.rules`：`request.auth.uid == uid` 才能讀寫。
- **同步方式**：`diffAndPush(name, currentArr)`（`app.js`）比對目前陣列跟 `lastSynced[name]`（上次成功同步的快照），只寫入真的變動的文件（新增/內容不同→`set`，消失→`delete`），用 `writeBatch` 一次送出，不是整個集合覆寫。
- **接收端**：`startCloudListeners()` 對兩個集合掛 `onSnapshot`，`hasPendingWrites` 為真時忽略（那是自己剛寫入、還沒被伺服器確認的回音），避免無限迴圈；收到真的遠端變動才更新 `state` + `localStorage` + `renderAll()`（用 `applyingRemoteChange` 旗標防止這個更新又觸發一次 `queueCloudSync`）。
- **一次性搬遷（`handleSignedIn()`）**：登入後先用 `getDocs`（一次性讀取，不是 listener）檢查雲端這個帳號是否完全是空的；只有「雲端全空 + 本機有資料」才問使用者要不要搬遷。**關鍵順序**：搬遷的 `diffAndPush` 一定要 `await` 完成、資料確實寫入雲端之後，才呼叫 `startCloudListeners()` 開始監聽。如果順序反過來（曾經是真的 bug，已修正），`onSnapshot` 第一次讀到的空集合會被誤判成「使用者刪光了」，反過來把本機資料蓋成空的——這是絕對要避免的資料遺失情境，之後改這段程式碼務必保持這個順序。使用者若在搬遷提示按「取消」，會直接登出（避免卡在「已登入但沒同步」的曖昧狀態），下次重新登入會再問一次。

## 風格規範

**顏色系統（CSS 變數，`style.css` 最上方 `:root`）：**
- `--accent`：介面強調色（金色，呼應主畫面圖示），light `#96650c` / dark `#b8860b`。所有「按鈕、選中狀態、連結文字、focus 外框」等 UI chrome 用這個，**故意跟 `--series-1`（分類識別色的藍）分開**——2026-08-12 之前這些 UI 元件是直接借用 `--series-1`，導致「介面主題色」跟「餐飲分類的顏色」綁死在一起，改分類顏色會意外動到介面主題色，反之亦然。之後要調整介面強調色只改這一個變數，不要碰 `--series-*`。
- `--series-1` ~ `--series-8`：分類識別色，8 色一組，light/dark 主題各有對應值（來自驗證過 CVD 安全性的色階）。目前是分類自動配色（`nextColorVar`）跟圖表預設用色的來源，**不要**隨意改變這 8 個的色相順序或增減數量。
- `--pastel-1` ~ `--pastel-8`：使用者手動選色的「淺色」選項，均勻分布在整個色相環（每 45° 一色），**跨主題固定不變**（不放進 dark mode 區塊），因為本來就是要淺、要跟深色系分開一組。目前也被「訂閱費」這個預設分類拿來當固定顏色用（`--pastel-6`），因為 8 個 `--series-*` 都已經被其他預設分類佔滿了。
- `--expense-color` / `--income-color`：金額正負號用色，跟分類識別色是分開的語意（別混用）。

**主題：** `prefers-color-scheme` 自動 + `data-theme` 手動覆寫雙軌並存（右上角圖示切換），兩邊都要顧到，改 CSS 變數時記得三處都要改（`:root` 內的 `@media dark` 區塊 + `:root[data-theme="dark"]` 區塊）。

**版面：** 手機優先，`.app` 容器 `max-width: 480px`（桌面 560px），大量用 `sheet`（底部彈出面板）模式做 modal，而不是置中 dialog。

**命名慣例：** CSS class 用 kebab-case；JS 函式/變數用 camelCase；`els` 物件集中存所有 DOM 參照（`cacheEls()` 一次抓齊，不要在各處零星 `getElementById`）。

**文案語氣：** 全繁體中文，簡短口語化，避免生硬的翻譯腔。

## 常用指令

```bash
# 本機測試伺服器（RECOMMENDED：用 python，瀏覽器端不需要 npm）
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; python -m http.server 8791
# 開 http://localhost:8791

# 單元測試 + 語法檢查（2026-08-14 新增，只測 utils.js/csv.js 這種純函式，不用測試框架）
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; npm test
npm run lint

# 部署（改完code後，兩個都要跑，順序不重要）
git add -A; git commit -m "說明這次改了什麼"; git push
firebase deploy --only hosting
# git push 只是保留版本記錄／備份，正式站（.firebaseapp.com）要 firebase deploy 才會真的更新
# GitHub Pages 那個網址雖然 push 後也還是會自動重新部署，但不要拿來測登入功能

# 雲端同步本機測試（Firebase Local Emulator Suite，不用真帳號、不用連外網）
# 需要先裝好：Node.js、firebase-tools（npm i -g firebase-tools）、Java 21+（emulator 依賴）
cd "C:\Users\user\OneDrive\桌面\10-19_System_Automation\15 App Projects\budget_tracker_2026"; firebase emulators:start --project demo-budget-tracker
# Auth: http://localhost:9099　Firestore: http://localhost:8080　Emulator UI: http://localhost:4000
# firebase-config.js 偵測到 hostname 是 localhost 就會自動接去 emulator，不用改任何設定
```

**Git 慣例：** 每完成一個獨立功能/修正就各自 commit + push，不要把好幾個改動囤在一起才存 —— 使用者明確要求要有清楚的版本記錄可以回退（`git revert <hash>`），不要用 `git reset --hard` 改寫歷史除非使用者特別要求。

**部署工作流程（2026-08-13 使用者確認）：** 每次改完程式碼，先用本機伺服器（`localhost:8791`）搭配假資料（`javascript_tool` 直接操作 DOM/`localStorage`，不要碰使用者真實帳號的 Firestore）驗證功能正常，接著可以**直接 commit + push + `firebase deploy --only hosting` 部署到正式站，不用每次都先問過才部署**——這是使用者明確授權的日常節奏，不算需要另外確認的「風險操作」。前提只有一個：**不能動到使用者的真實資料**（例如不要在正式站上用假帳號操作真實 Firestore、不要寫任何會清空/覆蓋使用者既有資料的搬遷邏輯又沒讓她過目）。如果某次改動的風險特別高（例如直接改雲端同步的資料搬遷/合併邏輯、可能造成資料遺失），還是要照本機/emulator 驗證過的謹慎程度衡量，但「要不要現在部署」這件事本身不用再開口問。

## 已知眉角

- **Service worker 快取**：`sw.js` 改成 network-first（有網路一定拿最新版本，只有離線才退回用快取）——一開始是 cache-first（先回快取、背景才更新），導致使用者關掉重開看到的還是舊版，要重整兩次才會是新的，造成不少困惑，2026-08-12 改掉了。只在 `location.hostname === 'localhost'` 或 https 才會註冊（用區網 IP 測試手機時不會註冊）。改 `sw.js` 本身或快取策略時記得同步把 `CACHE_NAME` 往上加版號，強制舊快取失效；`ASSETS` 陣列新增檔案時（例如 2026-08-14 拆出的 `utils.js`/`csv.js`）也要記得同步加進去，不然離線模式讀不到。2026-08-13 又發現一個更隱密的坑：就算改成 network-first，`fetch(event.request)` 這行如果沒有帶 `{ cache: 'no-store' }`，還是會被瀏覽器自己的 HTTP 快取擋下來（跟 service worker 的快取策略是兩層不同的東西），造成「PWA 加到主畫面後長時間吃到舊版、要重新加入主畫面才會更新」，已經修掉，這個測試環境沒辦法真的註冊 service worker（見下面那條），沒辦法在這裡驗證，只能部署後請使用者在真實裝置確認。
- **確認對話框**：刪除紀錄/分類目前用瀏覽器原生 `window.confirm()`，不是自訂 UI，故意保持簡單。
- **測試方式**：這個環境沒辦法對瀏覽器截圖，驗證功能都是用 `javascript_tool` 直接操作 DOM（設值、dispatch 事件、讀 innerText/localStorage）取代真人點擊，之後如果继续開發建議延用這個模式驗證，比較快也比較穩定。
- **MoneyNote CSV 匯入的分類合併**：`MONEYNOTE_MERGE_MAP`（`app.js`）是一份「MoneyNote 分類名稱 → 本 App 既有分類」的白名單對照表，只有**確定是同一件事、只是換個名字**的才會合併（例如「醫療費」→「醫療」、「飲食費」→「餐飲」）。真的沒有對應概念的（目前是「交際費」「煙酒」）會建成獨立新分類，並在 `MONEYNOTE_NEW_CATEGORY_KEYWORDS` 給預設關鍵字，不要空著。之後如果來源 App 的分類名稱變了，或想調整合併規則，改這兩個常數即可，不用動解析邏輯本身。
- **分類刪除＝可指定合併目標**：刪除分類不是寫死併入收容分類，而是跳出 `mergeCategorySheet` 讓使用者挑一個既有分類當作合併目的地，`mergeDeleteCategory()` 負責搬移紀錄、必要時把目標升格為新的收容分類。這個機制同時也是使用者在「已經匯入過、資料已經在 localStorage 裡」的情況下手動整併重複分類的唯一管道（改了合併對照表不會回溯套用到已存在的分類上）。
- **Google 登入：正式站是 Firebase Hosting（`budget-tracker-8edd1.firebaseapp.com`），不是 GitHub Pages**：登入這條路踩了好幾層坑，照發生順序記錄，之後不要走回頭路：
  1. 一開始用 `signInWithPopup` + GitHub Pages（`cyao0406.github.io`），iOS Safari（尤其加到主畫面的 PWA 獨立模式）上會卡在「輸入完帳密、驗證通過、頁面轉一下又跳回去，但沒有真的登入」——popup 視窗沒辦法把結果透過 `postMessage` 傳回原頁面。
  2. 改成 `signInWithRedirect`，手機好了，但電腦 Chrome 出現一樣症狀——真正原因是 `authDomain`（`budget-tracker-8edd1.firebaseapp.com`）跟網站網域（`cyao0406.github.io`）不同源，2024 年中之後 Chrome/Firefox/Safari 全部收緊跨網域第三方儲存空間存取，popup 或 redirect 都一樣會卡，跟用哪個 API 無關。
  3. 搬去 Firebase Hosting 想讓兩邊同源，但一開始用 `budget-tracker-8edd1.web.app` 這個網址，結果 Google 回「要求無效」——因為 Firebase 啟用 Google 登入時，OAuth 用戶端的「已授權重新導向 URI」預設只註冊了 `.firebaseapp.com`，`.web.app` 沒有自動註冊進去。
  4. 最終解法：`authDomain` 跟使用者實際打開的網址都固定用 **`.firebaseapp.com`**（Firebase 預設、不用手動去 Google Cloud Console 加東西的那個），兩者統一之後才真的正常。`.web.app` 純粹別用來當作雲端同步的入口。
  - **`.git/` 差點被公開部署**：`firebase.json` 的 hosting ignore 一開始只寫 `"**/.*"`，實測沒有真的排除 `.git/` 底下的內容（第一次部署後 `curl .../,git/config` 回 200），已改成明確加 `.git/**` 才修好，之後要調整 ignore 清單記得用 curl 驗證幾個關鍵路徑，不要只看 glob 寫得對不對。
  - **同一個坑踩第二次：`.claude/worktrees/` 也曾經公開部署過（2026-08-14）**：`"**/.*"` 這個 glob 只會擋掉「檔名本身開頭是 `.`」的東西，擋不住「路徑裡某一層資料夾開頭是 `.`、但裡面的檔案本身不是」這種情況——`Agent` 工具用 `isolation: "worktree"` 開背景審查 agent 時，會在 `.claude/worktrees/agent-*/` 底下建立完整的 repo checkout，這些 worktree 目錄下的 `app.js`、`index.html` 等檔名都不是以 `.` 開頭，`"**/.*"` 完全擋不住，直接被 `firebase deploy` 一起發布到正式站（實測 `curl .../.claude/worktrees/agent-xxx/app.js` 回 200）。已經明確加一條 `.claude/**` 才擋乾淨。**教訓：`"**/.*"` 這種只認檔名開頭的 glob，只要中間任何一層資料夾本身是需要整個排除的（`.git`、`.claude` 這類工具產生的目錄），一定要另外明確加 `目錄名/**` 這種完整路徑規則，不能只靠萬用字元「應該」擋得住。之後如果又用到會在專案資料夾裡產生新隱藏目錄的工具，部署前記得比對一次 `firebase deploy` 印出的「found N files」數字是不是突然暴增（正常是 15~20 出頭，這次暴增到 197 才注意到）。**
- **Firebase 專案設定走 CLI，不是網頁介面**：使用者在 Firebase Console 網頁上設定 Firestore 規則時卡住（畫面顯示「鎖定狀態」但實際上規則編輯不了、資料庫甚至沒真的建立成功），改用 `firebase login`（device code flow，使用者自己在瀏覽器授權）→ `firebase deploy --only firestore:rules` / `firebase deploy --only hosting` 解決。這台電腦上 `firebase apps:list` / `firebase apps:sdkconfig` / `firebase use --add` 有個已知的 Windows 相關 crash（`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`），但通常在噴出這個 assertion 之前，實際要的資訊已經印出來了（或該做的事已經做完只是沒寫檔，例如 `.firebaserc` 要自己手動補），看 stdout 內容通常夠用，不影響指令本身的效果。
- **`ALLOWED_CLOUD_EMAILS` 白名單（`app.js` 的 `handleSignedIn()`）**：Google Cloud OAuth 同意畫面設定確認是正確的（發布狀態「測試中」、測試使用者只有使用者本人一個信箱），但實測非測試帳號還是能完成登入，原因不明、沒有再花時間往 Google 那邊查。既然 Firestore 規則本來就是照 uid 隔離（不同帳號登入只會各自建立自己空的 uid 資料夾，本來就碰不到別人的資料，不是資料外洩風險），就在應用層加一道自己可驗證的防線：登入後先比對 email 是否在白名單裡，不是就立刻 `signOut()`，不會進到搬遷/同步邏輯。之後如果使用者換 Google 帳號或想開放給家人用，改這個陣列即可。
- **這個測試環境的瀏覽器 pane 對「module script 靜態 import 跨網域 URL」的處理有問題**：`<script type="module" src="app.js">` 頁面載入時，若 `app.js`（或它 import 的檔案）用**靜態** `import ... from 'https://...'` 直接 import gstatic.com 的網址，會出現 `ERR_NAME_NOT_RESOLVED`；但同一個網址用 `fetch()`、`javascript_tool` 主控台打的 `import()`、或直接瀏覽器網址列導航，全部都正常。目前解法是 `firebase-config.js` 內部一律用**動態** `import()`（`await import(url)`）載入 Firebase SDK，`app.js` 只對同源的 `firebase-config.js` 做靜態 import——這是標準 ES 語法，在真實瀏覽器（含 iOS Safari）行為完全一樣，不是 workaround 出來的偏門寫法，之後要加其他 CDN 依賴時延用同一個模式（動態 import、集中包在一個同源檔案裡）比較不會踩到這個 pane 的限制。
- **這個測試環境也沒辦法真的註冊 service worker**：`navigator.serviceWorker.register('sw.js')` 在這個瀏覽器 pane 裡一律失敗，錯誤訊息是同一句 `An unknown error occurred when fetching the script`（跟上面那條「跨網域 module import」的錯誤字串一樣，但這次 `sw.js` 是同源檔案，不是跨網域問題，應該是這個 pane 本身對 `fetch script`/`register` 這類請求的另一種限制）。代表 `sw.js` 的快取策略（例如 2026-08-13 把 fetch handler 加上 `cache: 'no-store'` 修正「PWA 加到主畫面後吃到瀏覽器 HTTP 快取、更新不會生效」的那次改動）沒辦法在這裡實測，只能靠讀程式碼判斷邏輯正確、部署後請使用者在真實裝置上確認。
- **雲端功能的驗證方式分兩軌**：(1) 同步演算法/安全規則（`diffAndPush`、`firestore.rules`、搬遷時序）是用獨立的 Node.js 腳本，透過 npm 版 `firebase` SDK 直接打 emulator 測的，不依賴瀏覽器 pane，可以完整測到 CVD-safe 那種等級的正確性驗證；(2) DOM/UI 那端（登入畫面顯示切換、按鈕綁定、既有功能沒有因為改成 module 而壞掉）是把 `firebase-config.js` 暫時換成一個純本機假實作（no-op 版）測的，測完要記得換回真正的 `firebase-config.js`。目前沒辦法在這個瀏覽器 pane 裡做「真正串 emulator + 真的 Google 登入」的全端到端測試，這步只能請使用者在自己的真實瀏覽器上做。
- **搬遷/同步邏輯的測試腳本**：位於系統暫存的 scratchpad（session 專屬、不在專案 repo 裡），如果之後要改 `diffAndPush`/`handleSignedIn`/`firestore.rules`，建議重新寫一版類似的 Node 測試腳本（連 emulator、建假帳號、驗證 diff 寫入筆數、驗證 rules 擋掉跨帳號存取、驗證搬遷時序不會讓 listener 看到過渡態的空集合），不要只靠肉眼看程式碼，這塊風險太高值得跑一次真的測試。
- **登入後本機異動會被雲端快照覆蓋（2026-08-13 修正）**：`handleSignedIn()` 原本只在「雲端全空+本機有資料」才做搬遷 push，其他情況（雲端本來就有資料，例如重新登入）直接跳去 `startCloudListeners()`——這代表「登出狀態下在本機做的修改（例如剛設定的分類 emoji）」從沒機會推上雲端，登入後第一份雲端快照直接把這些本機異動蓋掉。修法：一般登入（非首次搬遷）也要先做一次 push，但只做「新增/覆寫」不做「刪除」（用 `pushLocalOnly()`，不是共用的 `diffAndPush()`）——因為這個時間點沒辦法區分「本機真的刪除了」還是「這筆是別的裝置已經同步上去、這台裝置還沒同步過」，誤刪風險太高，所以刪除只交給後續 listener 自然同步回來。
- **Emoji 圖示挑選要考慮跨平台一致性**：分類 emoji（`DEFAULT_EXPENSE_CATS`/`DEFAULT_INCOME_CATS` 的 `icon` 欄位）曾經用過 🛍️（購物袋），實測在部分系統顯示不穩定，已換成 🛒（購物車）。之後要加新的預設 emoji，優先選 Unicode 6.0 左右、單一 codepoint、沒有 ZWJ 組合序列的常見 emoji，避免挑太新或需要 variation selector 的。
- **`navigator.vibrate()` 只是加分，不是必要**：刪除紀錄時會呼叫震動 API 加回饋感（`deleteRecordWithUndo()`），iOS Safari（含加到主畫面的 PWA 模式）完全沒實作這個 API，呼叫了沒有任何反應也不會報錯，是平台限制不是 bug，不用特別處理或提示使用者。
- **`功能及介面參考資料/` 資料夾**：使用者提供的介面設計參考截圖（記帳app 的輸入/日曆/回報介面 4 張圖），只存在使用者本機，**沒有加進 git**（都是 binary 圖片，非原始碼）。v2.5 的三分頁改版就是照這幾張圖設計的，之後如果使用者又丟新的參考圖進這個資料夾，要記得去看一下裡面有什麼，但不要自作主張把這個資料夾加進版本控制。
