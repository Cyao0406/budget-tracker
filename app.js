import {
  auth, db, googleProvider,
  signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  collection, doc, onSnapshot, writeBatch, getDocs
} from './firebase-config.js';
import {
  WEEKDAY, uid, debounce, pad2, toKey, fromKey, addDays, addMonths, addYears,
  startOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  isSameDay, formatMoney, shortDate, formatTime, escapeHtml
} from './utils.js';
import { stageImportCsv } from './csv.js';

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  // 給家人/自己看的白話版更新紀錄，完整技術細節在 CLAUDE.md。新增版本時陣列開頭插入一筆，
  // CURRENT_VERSION 記得跟著更新（設定頁的版本號、標籤都是抓這個常數）。
  var CURRENT_VERSION = 'v2.8';
  var CHANGELOG = [
    { version: 'v2.8', name: '資料安全與可靠性強化', date: '2026-08-14', notes: [
      '清除所有資料時，雲端刪除失敗會保留本機資料並跳出錯誤提示，不會清一半',
      '大量資料的雲端同步（例如換新裝置搬遷）改成自動分批，不會因為筆數太多整批失敗',
      '修正快速連續操作時，雲端同步可能互相覆蓋、舊資料蓋掉新資料的問題',
      'CSV 匯入改成「先預覽再確認」，會列出有效筆數、新增分類數、略過原因',
      '修正 CSV 匯入偶爾會把備註裡的換行內容弄壞的問題',
      'CSV 匯出加強安全性，避免內容被試算表誤判成公式執行',
      '修正 App 更新後，加到主畫面的版本有時候會一直吃到舊版快取的問題',
      '搜尋紀錄加上防抖動，資料量大時輸入更順暢，並支援「減少動態效果」系統設定',
      '彈出視窗補上鍵盤與螢幕報讀器的操作支援',
      'App 圖示配色改成跟主畫面一致的金色主題'
    ] },
    { version: 'v2.7', name: '開場載入畫面、日曆格線、報表月份篩選、搜尋進階條件', date: '2026-08-13', notes: [
      'App 開啟時新增載入畫面，確認是最新版本才會進入',
      '日曆分頁的月曆格子加上格線設計，區隔每一天',
      '分類 drill-down 頁的近 6 個月趨勢長條圖可以點選單一月份，只看該月的紀錄',
      '紀錄列表的日期分組改成色塊樣式，顯示當天收支淨額，配色跟主題反過來（不會刺眼）',
      '日曆分頁搜尋新增進階篩選：金額區間、日期區間，可以跟關鍵字一起用'
    ] },
    { version: 'v2.6', name: '介面比照參考截圖、修正分類重複問題', date: '2026-08-13', notes: [
      '報表分頁改成「月度報告／年度報告」，可以往前後切換月份或年度',
      '輸入分頁「進階選項」的分類改成直接點格子選，不用再打開下拉選單',
      '日曆分頁的星期標題、月份導覽列、下方收支合計比照參考畫面重新設計',
      '報表分頁的分類列表加上分隔線，跟圓餅圖區塊分開',
      '金額可以輸入 0 了',
      '修正雲端登入後分類會重複出現的問題，設定裡新增「清理重複分類」按鈕可以一次清乾淨',
      '刪除分類新增「不指定分類」選項，沒有紀錄的分類可以直接刪除不用選轉移對象',
      '設定裡新增「重新套用關鍵字分類」工具，關鍵字改過後可以幫舊紀錄重新判斷分類',
      '修正刪除分類時，轉移選單會被設定面板蓋住看不到的問題'
    ] },
    { version: 'v2.5', name: '介面拆成三個頁面', date: '2026-08-13', notes: [
      '主畫面拆成「輸入／日曆／報表」三個分頁，底部新增分頁列可以切換',
      '日曆分頁全新設計：整個月的格子直接顯示每天的收支金額，點某一天可以只看那天的紀錄，下方也有搜尋框',
      '報表分頁的圓餅圖改成點一下跳出金額泡泡（不會整頁篩選），點分類列表會另外開一頁看那個分類近 6 個月的趨勢長條圖和逐筆紀錄',
      '一行文字快速記帳（例如「早餐 全家 150」）維持不變，還是輸入分頁的主要記帳方式'
    ] },
    { version: 'v2.4', name: '修正與微調', date: '2026-08-12', notes: [
      '修正登入雲端同步後，分類 emoji 圖示會消失的問題',
      '新增「訂閱費」分類，跟娛樂費分開（Netflix、Spotify、Claude、Cursor、健身房會費等訂閱制支出）',
      '刪除紀錄新增輕微震動回饋（iOS Safari 不支援震動，其他平台會有感覺）',
      '搜尋紀錄時，不論目前選的是日/週/月分頁都會顯示每筆紀錄的日期，日期文字也調大、調亮方便閱讀'
    ] },
    { version: 'v2.3', name: '五項小功能更新', date: '2026-08-12', notes: [
      '紀錄列表顯示記帳時間，編輯紀錄時可以手動調整（例如隔天才補記，可以改回實際發生的時間）',
      '分類可以加一個 emoji 圖示（設定裡分類名稱旁邊），列表項目更好辨認',
      '刪除紀錄改成「已刪除」提示 + 復原按鈕，取代原本要再按一次確認的彈窗',
      '紀錄列表新增搜尋框，可以用分類、備註關鍵字或金額找到任何一筆紀錄，不限目前選的日/週/月',
      '圓餅圖或圖例可以點選單一分類篩選，只看該分類的金額與紀錄，再點一次或按「清除篩選」恢復'
    ] },
    { version: 'v2.2', name: '介面改成金色主題', date: '2026-08-12', notes: [
      '按鈕、選中狀態、連結文字等介面強調色改成呼應主畫面圖示的金色，跟分類自己的顏色是分開的，不會動到你設定過的分類色'
    ] },
    { version: 'v2.1', name: '圖示改版', date: '2026-08-12', notes: [
      '主畫面圖示重新設計，改成金幣造型的 $ 符號圖示'
    ] },
    { version: 'v2.0', name: '雲端同步上線', date: '2026-08-12', notes: [
      '新增「登入 Google 帳號」選用功能，登入後資料自動同步到雲端，換手機、加裝置都不怕資料不見',
      '不登入完全不受影響，單機模式一樣正常使用',
      '離線快取邏輯改成「有網路優先拿最新版本」，之後更新只要關掉 App 重開就會是最新版'
    ] },
    { version: 'v1.2', name: '支援匯入舊記帳 App 資料', date: '2026-08-07', notes: [
      '「匯入 CSV」可以直接讀取 MoneyNote App 匯出的資料，自動判斷分類、金額、日期',
      '匯入時同性質的分類會自動合併，不會產生一堆重複分類',
      '分類刪除時可以選要把紀錄轉移到哪一個分類，不是固定丟進「其他」'
    ] },
    { version: 'v1.1', name: '分類顏色更多選擇', date: '2026-08-07', notes: [
      '分類顏色從 8 種增加到 16 種，新增一組淺色系選項'
    ] },
    { version: 'v1.0', name: '記帳 App 上線', date: '2026-08-07', notes: [
      '快速輸入一行文字自動判斷金額並猜測分類',
      '日 / 週 / 月報表，圓餅圖呈現各分類佔比',
      '紀錄可以點開編輯或刪除，分類可自訂名稱、顏色、關鍵字',
      'CSV 匯出備份，支援加入手機主畫面像 App 一樣使用'
    ] }
  ];
  var STORAGE = {
    records: 'budgetapp.records',
    categories: 'budgetapp.categories',
    theme: 'budgetapp.theme'
  };
  var SERIES_SLOTS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];
  var PASTEL_SLOTS = ['--pastel-1', '--pastel-2', '--pastel-3', '--pastel-4', '--pastel-5', '--pastel-6', '--pastel-7', '--pastel-8'];

  var DEFAULT_EXPENSE_CATS = [
    { name: '餐飲', colorVar: '--series-1', icon: '🍚', keywords: ['早餐', '午餐', '晚餐', '消夜', '宵夜', '咖啡', '飲料', '超商', '全家', '7-11', '711', '7-eleven', '萊爾富', 'ok超商', '餐廳', '小吃', '火鍋', '便當', '飲品', '手搖', '星巴克', '麥當勞', '肯德基', '拉麵', '牛肉麵', '早午餐', '外送', 'foodpanda', 'ubereats', '飲食費'] },
    { name: '交通', colorVar: '--series-2', icon: '🚗', keywords: ['捷運', '公車', '計程車', 'uber', '加油', '停車', '高鐵', '台鐵', '悠遊卡', '機車', '油錢', '過路費', '停車費', '火車', '客運', '交通費'] },
    { name: '購物', colorVar: '--series-3', icon: '🛒', keywords: ['網購', '蝦皮', 'momo', '衣服', '鞋子', '日用品', '大賣場', 'costco', '好市多', '家樂福', '全聯', '寶雅', '無印良品', 'ikea', '購物', '美容'] },
    { name: '娛樂', colorVar: '--series-4', icon: '🎮', keywords: ['電影', '遊戲', 'ktv', '唱歌', '旅遊', '展覽', '演唱會', '娛樂費', '旅遊費'] },
    { name: '訂閱費', colorVar: '--pastel-6', icon: '💳', keywords: ['netflix', 'spotify', 'disney', 'disney+', 'youtube premium', 'icloud', 'apple one', 'google one', 'microsoft 365', 'office 365', 'chatgpt', 'claude', 'claude pro', 'cursor', 'openai', 'notion', 'dropbox', 'adobe', 'kkbox', 'friday影音', 'myvideo', 'hbo', 'prime', 'overleaf', 'genspark', 'hamivideo', 'speak', '健身房', '健身房會費', '會員費', '月費', '年費', '訂閱', '訂閱類娛樂費', 'gym'] },
    { name: '居家', colorVar: '--series-5', icon: '🏠', keywords: ['房租', '水電', '瓦斯', '網路費', '管理費', '家具', '電費', '水費', '房貸', '水電費', '電話費', '房費', '家庭開銷'] },
    { name: '醫療', colorVar: '--series-6', icon: '💊', keywords: ['藥局', '醫院', '診所', '健保', '掛號費', '牙醫', '眼科', '醫療費'] },
    { name: '教育', colorVar: '--series-7', icon: '📚', keywords: ['學費', '書籍', '課程', '補習', '文具', '教材', '教育費'] },
    { name: '其他', colorVar: '--series-8', icon: '📦', keywords: [], fallback: true }
  ];
  var DEFAULT_INCOME_CATS = [
    { name: '薪資', colorVar: '--series-1', icon: '💰', keywords: ['薪水', '薪資', '工資'] },
    { name: '獎金', colorVar: '--series-2', icon: '🎁', keywords: ['獎金', '紅包', '分紅'] },
    { name: '投資', colorVar: '--series-3', icon: '📈', keywords: ['股息', '配息', '利息', '投資', '股票'] },
    { name: '其他收入', colorVar: '--series-4', icon: '💵', keywords: [], fallback: true }
  ];

  // 定義「沒有套用任何進階篩選條件」長什麼樣子，只寫一份——state 初始值跟「清除篩選條件」
  // 按鈕都呼叫這個，之後如果要多加篩選欄位，只要改這裡一個地方，不會漏改到其中一處。
  function emptySearchFilters() { return { amountMin: null, amountMax: null, dateFrom: null, dateTo: null }; }

  // ---------- state ----------
  var state = {
    records: [],
    categories: [],
    selectedDate: new Date(),
    period: 'month',
    reportDate: new Date(),
    addType: 'expense',
    chartType: 'expense',
    tempCategoryOverride: null,
    manualCategoryTouched: false,
    calendarMonth: new Date(),
    editingCategoryContext: 'expense',
    categoryPickContext: 'quickadd',
    editingRecordId: null,
    editRecordType: 'expense',
    searchQuery: '',
    searchFilters: emptySearchFilters(),
    activeTab: 'input',
    calendarTabMonth: new Date(),
    calendarSelectedDay: null,
    categoryDrilldown: null,
    drilldownMonthFilter: null,
    chartTooltipCategoryId: null,
    reclassifyType: 'expense',
    reclassifyPreview: [],
    pendingImportStaged: null
  };

  // ---------- storage ----------
  // 這台裝置這次開機，分類是不是剛用預設清單冷啟動生成的（localStorage 原本是空的）——
  // 例如無痕視窗、清過瀏覽器資料、全新裝置。handleSignedIn 登入時如果偵測到這個是 true，
  // 就不會把這批預設分類當成「本機異動」推上雲端，避免跟雲端帳號原有的分類疊出重複。
  var categoriesFreshlySeeded = false;
  function loadCategories() {
    var raw = localStorage.getItem(STORAGE.categories);
    var cats = null;
    if (raw) {
      try { cats = JSON.parse(raw); } catch (e) { cats = null; }
    }
    if (!cats) {
      categoriesFreshlySeeded = true;
      cats = [];
      DEFAULT_EXPENSE_CATS.forEach(function (c) { cats.push(Object.assign({ id: uid(), type: 'expense' }, c)); });
      DEFAULT_INCOME_CATS.forEach(function (c) { cats.push(Object.assign({ id: uid(), type: 'income' }, c)); });
      localStorage.setItem(STORAGE.categories, JSON.stringify(cats));
      return cats;
    }
    // 既有使用者（本機已經有資料）：後來才新增進 DEFAULT_EXPENSE_CATS 的分類不會自動出現，
    // 用固定 id 補一次——固定 id 是故意的，不是隨機 uid()，這樣就算好幾台裝置各自在還沒
    // 同步的情況下都補了這筆，之後同步時會收斂成同一份文件，不會變成好幾筆重複分類。
    var hasSubscription = cats.some(function (c) { return c.type === 'expense' && c.name === '訂閱費'; });
    if (!hasSubscription) {
      var def = DEFAULT_EXPENSE_CATS.find(function (c) { return c.name === '訂閱費'; });
      cats.push(Object.assign({ id: 'cat-subscription-default', type: 'expense' }, def));
      localStorage.setItem(STORAGE.categories, JSON.stringify(cats));
    }
    return cats;
  }
  function saveCategories() { localStorage.setItem(STORAGE.categories, JSON.stringify(state.categories)); queueCloudSync('categories'); }
  function loadRecords() {
    var raw = localStorage.getItem(STORAGE.records);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  function saveRecords() { localStorage.setItem(STORAGE.records, JSON.stringify(state.records)); queueCloudSync('records'); }

  // ---------- cloud sync ----------
  // 設計原則：localStorage 永遠是「畫面立刻看到」的來源，雲端只是背景同步層。
  // 沒登入時完全不受影響，行為跟純單機版一模一樣。
  var cloudUser = null;
  var lastSynced = { records: null, categories: null }; // null = 尚未建立同步基準
  var applyingRemoteChange = false;
  var unsubscribers = [];

  function cloudCollection(name) { return collection(db, 'users', cloudUser.uid, name); }

  // Firestore 一個 writeBatch 最多 500 個操作，超過會整批直接失敗。記帳資料用久了很容易破
  // 500 筆（尤其是第一次搬遷、或本機離線很久才重新連上要把差異一次補齊的時候），所以寫入
  // 一律先拆成陣列、每 CHUNK_SIZE 筆一批，依序（不是平行）送出——依序送出是故意的：平行送出
  // 等於好幾個 batch 同時在跑，一旦某批失敗，不容易判斷實際上寫到雲端的確切狀態在哪；依序送出
  // 至少能保證「失敗那批之前的都已經確定成功」，狀態單純很多。
  var BATCH_CHUNK_SIZE = 450;
  function commitWritesInChunks(name, writes) {
    if (writes.length === 0) return Promise.resolve();
    var chunks = [];
    for (var i = 0; i < writes.length; i += BATCH_CHUNK_SIZE) chunks.push(writes.slice(i, i + BATCH_CHUNK_SIZE));
    var chain = Promise.resolve();
    chunks.forEach(function (chunk) {
      chain = chain.then(function () {
        var batch = writeBatch(db);
        chunk.forEach(function (w) {
          if (w.type === 'set') batch.set(doc(cloudCollection(name), w.id), w.data);
          else batch.delete(doc(cloudCollection(name), w.id));
        });
        return batch.commit();
      });
    });
    return chain;
  }
  function diffAndPush(name, currentArr) {
    if (!cloudUser) return Promise.resolve();
    var lastArr = lastSynced[name];
    var lastById = {};
    (lastArr || []).forEach(function (x) { lastById[x.id] = x; });
    var currentById = {};
    currentArr.forEach(function (x) { currentById[x.id] = x; });
    var writes = [];
    currentArr.forEach(function (item) {
      var prev = lastById[item.id];
      if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) writes.push({ type: 'set', id: item.id, data: item });
    });
    (lastArr || []).forEach(function (item) {
      if (!currentById[item.id]) writes.push({ type: 'delete', id: item.id });
    });
    if (writes.length === 0) { lastSynced[name] = currentArr.map(function (x) { return Object.assign({}, x); }); return Promise.resolve(); }
    return commitWritesInChunks(name, writes).then(function () {
      lastSynced[name] = currentArr.map(function (x) { return Object.assign({}, x); });
    });
  }
  // 每個 collection 各自一條隊伍，同一個 collection 同時間只會有一個同步請求真的在跑——
  // 不然快速連續存檔（例如手滑連點兩次、或短時間內編輯又刪除）會同時發出好幾個 diffAndPush，
  // 各自根據呼叫當下的 lastSynced 算出差異，最後完成的那個 commit 有可能用比較舊的內容把
  // 比較新的內容蓋掉。排進同一條隊伍、上一個 settle 了才輪到下一個執行，且執行時才去讀當下
  // 最新的 state，能確保呼叫順序不會影響最終寫進雲端的結果。
  var syncQueue = { records: Promise.resolve(), categories: Promise.resolve() };
  // 任何會寫雲端的動作都要走這個隊列，不能只有 queueCloudSync 排、其他寫入路徑（登入搬遷、
  // 一般登入的 pushLocalOnly、清除所有資料）直接呼叫 diffAndPush/commitWritesInChunks——
  // 不然序列化只保護到一半，這些沒排隊的路徑還是可能跟排隊中的寫入互相競速、蓋掉彼此。
  function enqueueSync(name, taskFn) {
    syncQueue[name] = syncQueue[name].catch(function () {}).then(taskFn);
    return syncQueue[name];
  }
  function queueCloudSync(name) {
    if (!cloudUser || applyingRemoteChange) return;
    enqueueSync(name, function () {
      if (!cloudUser || applyingRemoteChange) return;
      var arr = name === 'records' ? state.records : state.categories;
      return diffAndPush(name, arr).catch(function (e) { console.error('cloud sync (' + name + ') failed', e); showToast('雲端同步失敗，稍後會自動重試'); });
    });
  }

  // 注意：listener 一定要等「搬遷這件事已經有結論」之後才能開始掛，不然雲端第一次讀到的
  // 空集合（還沒搬遷完成前，雲端本來就是空的）會被 onSnapshot 誤判成「使用者把資料全刪了」，
  // 反過來把本機資料蓋成空的——這是最需要避免的資料遺失情境，順序不能反過來寫。
  function startCloudListeners() {
    ['records', 'categories'].forEach(function (name) {
      var unsub = onSnapshot(cloudCollection(name), function (snap) {
        if (snap.metadata.hasPendingWrites) return; // 忽略自己剛寫入、還在等伺服器確認的回音
        var arr = [];
        snap.forEach(function (d) { arr.push(d.data()); });
        applyingRemoteChange = true;
        if (name === 'records') state.records = arr; else state.categories = arr;
        lastSynced[name] = arr.map(function (x) { return Object.assign({}, x); });
        localStorage.setItem(name === 'records' ? STORAGE.records : STORAGE.categories, JSON.stringify(arr));
        applyingRemoteChange = false;
        renderAll();
      }, function (err) { console.error(name + ' listener error', err); });
      unsubscribers.push(unsub);
    });
  }
  function stopCloudListeners() {
    unsubscribers.forEach(function (fn) { fn(); });
    unsubscribers = [];
    lastSynced = { records: null, categories: null };
  }

  function renderAuthUi() {
    if (!els.authSignedOut) return;
    els.authSignedOut.classList.toggle('hidden', !!cloudUser);
    els.authSignedIn.classList.toggle('hidden', !cloudUser);
    if (cloudUser) els.authEmail.textContent = cloudUser.email || cloudUser.displayName || '（已登入）';
  }

  // 應用層再多一道防線：不管 Google OAuth 同意畫面那邊的「測試中」限制實際上是否有正確擋人，
  // 這裡直接白名單擋掉非本人帳號，登入後立刻自動登出，不會進到搬遷/同步流程。
  var ALLOWED_CLOUD_EMAILS = ['dogd989312@gmail.com', 'yinrongyao84@gmail.com'];
  function handleSignedIn(user) {
    if (user.email && ALLOWED_CLOUD_EMAILS.indexOf(user.email.toLowerCase()) === -1) {
      showToast('這個帳號不是授權帳號，已自動登出');
      signOut(auth);
      return;
    }
    cloudUser = user;
    renderAuthUi();
    Promise.all([getDocs(cloudCollection('records')), getDocs(cloudCollection('categories'))]).then(function (results) {
      var cloudRecords = []; results[0].forEach(function (d) { cloudRecords.push(d.data()); });
      var cloudCategories = []; results[1].forEach(function (d) { cloudCategories.push(d.data()); });
      var cloudEmpty = cloudRecords.length === 0 && cloudCategories.length === 0;
      var localHasData = state.records.length > 0 || state.categories.length > 0;

      if (cloudEmpty && localHasData) {
        // 第一次搬遷：雲端這個帳號完全是空的、本機卻有資料，問過使用者才動作，
        // 而且搬遷寫入要「等完成」才開始掛 listener，避免上面註解講的競速問題。
        var ok = window.confirm(
          '偵測到這台裝置有 ' + state.records.length + ' 筆本機紀錄，要上傳到雲端帳號嗎？\n\n' +
          '建議先按「取消」，到設定裡用「匯出 CSV」備份一份再回來重新登入觸發這個提示。\n' +
          '這個動作不會刪除本機資料，只是額外複製一份到雲端。'
        );
        if (!ok) {
          showToast('已取消雲端同步');
          signOut(auth);
          return;
        }
        lastSynced.records = [];
        lastSynced.categories = [];
        Promise.all([
          enqueueSync('categories', function () { return diffAndPush('categories', state.categories); }),
          enqueueSync('records', function () { return diffAndPush('records', state.records); })
        ]).then(function () {
          showToast('已上傳到雲端');
          startCloudListeners();
        }).catch(function (e) {
          console.error('migration push failed', e);
          showToast('上傳雲端失敗，本機資料不受影響，可以到設定重新登入再試一次');
          signOut(auth);
        });
        return;
      }

      // 更直接的一道防線：如果這次開機的分類是冷啟動生成的預設值（無痕視窗、清過瀏覽器
      // 資料、全新裝置都會這樣），而這個雲端帳號本來就已經有自己的分類，代表這批預設分類
      // 只是這台裝置暫時性的初始值，不是使用者真的在這台裝置上做的自訂——直接採用雲端既有
      // 的分類，完全不要把預設值推上去，才不會疊出「App 預設 + 雲端原本」的重複。
      var skipCategoryPush = categoriesFreshlySeeded && cloudCategories.length > 0;
      if (skipCategoryPush) {
        // 整批換成雲端分類之前，先把本機紀錄裡指向「即將被捨棄的本機分類 id」的 categoryId
        // 用 type+name 配對改成對應的雲端分類 id——不然這些紀錄會變成找不到分類的孤兒
        // （畫面上會顯示「已刪除分類」）。同名的分類接得上，本機真的有、雲端沒有同名對應的
        // 少數情況接不上，但至少不會不做這一步、讓原本接得上的也一起變孤兒。
        var cloudByKeyForSkip = {};
        cloudCategories.forEach(function (c) { cloudByKeyForSkip[c.type + '::' + c.name] = c; });
        state.categories.forEach(function (localCat) {
          var match = cloudByKeyForSkip[localCat.type + '::' + localCat.name];
          if (match && match.id !== localCat.id) {
            state.records.forEach(function (r) { if (r.categoryId === localCat.id) r.categoryId = match.id; });
          }
        });
        state.categories = cloudCategories.map(function (c) { return Object.assign({}, c); });
        localStorage.setItem(STORAGE.categories, JSON.stringify(state.categories));
        localStorage.setItem(STORAGE.records, JSON.stringify(state.records));
      }

      // 分類重複的根本成因：如果本機這時候的分類清單（不管什麼原因）跟雲端已有的分類
      // 「同名同類型但 id 不一樣」——例如本機剛好在 loadCategories() 用預設清單重新生成過
      // 一次——下面的 pushLocalOnly 只用 id 比對，找不到對應的舊 id 就會當成全新分類寫進
      // 雲端，變成一筆「重複」。這裡在推上去之前，先用「type+name」把本機分類的 id 校正成
      // 雲端既有那筆的 id（保留本機這筆可能剛改過的圖示/關鍵字等內容），這樣 pushLocalOnly
      // 才會判斷成「更新既有分類」而不是「新增一筆」。記得同步修正 state.records 裡指向舊 id
      // 的 categoryId，不然紀錄會變成對不到任何分類。
      var reconcileCategoryIdsWithCloud = function (localCats, cloudCats, records) {
        var cloudIds = {};
        cloudCats.forEach(function (c) { cloudIds[c.id] = true; });
        var cloudByKey = {};
        cloudCats.forEach(function (c) { cloudByKey[c.type + '::' + c.name] = c; });
        var changed = false;
        localCats.forEach(function (c) {
          if (cloudIds[c.id]) return; // 本機這筆的 id 雲端本來就有，不用處理
          var match = cloudByKey[c.type + '::' + c.name];
          if (!match || match.id === c.id) return;
          var oldId = c.id;
          c.id = match.id;
          records.forEach(function (r) { if (r.categoryId === oldId) r.categoryId = match.id; });
          changed = true;
        });
        return changed;
      };
      if (reconcileCategoryIdsWithCloud(state.categories, cloudCategories, state.records)) {
        localStorage.setItem(STORAGE.categories, JSON.stringify(state.categories));
        localStorage.setItem(STORAGE.records, JSON.stringify(state.records));
      }

      // 先把「登出狀態下這台裝置做的本機異動」推上去，才開始監聽——不然沒推上去的本機修改
      // （例如剛設定的分類 emoji、剛編輯的紀錄）會被下面 listener 收到的第一份雲端快照直接
      // 蓋掉，之前分類圖示登入後消失就是這個原因。這裡故意只做「新增/覆寫」，不做「刪除」：
      // 這個時間點沒辦法區分「本機沒有這筆是因為使用者在本機刪掉了」還是「這筆是別的裝置已經
      // 同步上去、這台裝置還沒同步到過」，誤判成前者去刪雲端資料的風險太高。真的在本機刪除的
      // 東西，listener 開始監聽後雲端版本會自動同步回本機——只是慢一輪生效，不是資料遺失。
      // 排進隊列的 task 要等輪到自己才執行，current 故意在 task 裡才去讀 state.records/
      // state.categories（不是呼叫當下就捕捉起來），這樣不管排隊等了多久，實際送出的一定是
      // 執行當下最新的資料，不會因為佇列裡排在前面的東西改了 state 而送出過期的內容。
      var pushLocalOnly = function (name, cloudArr) {
        return enqueueSync(name, function () {
          var current = name === 'records' ? state.records : state.categories;
          var cloudById = {};
          cloudArr.forEach(function (x) { cloudById[x.id] = x; });
          var writes = [];
          current.forEach(function (item) {
            var prev = cloudById[item.id];
            if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) writes.push({ type: 'set', id: item.id, data: item });
          });
          return commitWritesInChunks(name, writes);
        });
      };
      var loginPushes = [pushLocalOnly('records', cloudRecords)];
      if (!skipCategoryPush) loginPushes.push(pushLocalOnly('categories', cloudCategories));
      Promise.all(loginPushes).then(startCloudListeners).catch(function (e) {
        console.error('login sync reconcile failed', e);
        startCloudListeners();
      });
    }).catch(function (e) {
      console.error('cloud init failed', e);
      showToast('連線雲端失敗，暫時以本機資料為準');
    });
  }

  function initCloudSync() {
    // 頁面從 Google 導回來後檢查一次 redirect 的結果，這裡才抓得到 redirect 流程本身的錯誤
    // （帳號被拒絕、網域未授權等）；正常登入成功與否還是看下面的 onAuthStateChanged。
    getRedirectResult(auth).catch(function (e) {
      console.error('redirect sign-in failed', e);
      showToast('登入失敗：' + (e && e.message ? e.message : '未知錯誤'));
    });
    onAuthStateChanged(auth, function (user) {
      if (user) {
        handleSignedIn(user);
      } else {
        cloudUser = null;
        renderAuthUi();
        stopCloudListeners();
      }
    });
  }

  function catsOfType(type) { return state.categories.filter(function (c) { return c.type === type; }); }
  function findCat(id) { return state.categories.find(function (c) { return c.id === id; }); }
  function fallbackCat(type) {
    var cats = catsOfType(type);
    return cats.find(function (c) { return c.fallback; }) || cats[cats.length - 1];
  }
  function nextColorVar(type) {
    var count = catsOfType(type).length;
    return '--series-' + ((count % 8) + 1);
  }

  // ---------- parsing & auto categorize ----------
  function parseQuickInput(text) {
    text = (text || '').trim();
    if (!text) return { amount: null, note: '' };
    var tokens = text.split(/\s+/);
    var amount = null, amountIdx = -1;
    for (var i = tokens.length - 1; i >= 0; i--) {
      var t = tokens[i].replace(/[,$元]/g, '');
      if (/^\d+(\.\d+)?$/.test(t)) { amount = parseFloat(t); amountIdx = i; break; }
    }
    var noteTokens = tokens.slice();
    if (amountIdx >= 0) noteTokens.splice(amountIdx, 1);
    return { amount: amount, note: noteTokens.join(' ').trim() };
  }
  function guessCategory(note, type) {
    var cats = catsOfType(type);
    var lower = (note || '').toLowerCase();
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      if (c.fallback) continue;
      for (var j = 0; j < c.keywords.length; j++) {
        var kw = c.keywords[j];
        if (kw && lower.indexOf(kw.toLowerCase()) !== -1) return c;
      }
    }
    return fallbackCat(type);
  }
  function effectiveCategory() {
    if (state.tempCategoryOverride) {
      var c = findCat(state.tempCategoryOverride);
      if (c && c.type === state.addType) return c;
    }
    var parsed = parseQuickInput(els.quickInput.value);
    return guessCategory(parsed.note, state.addType);
  }

  // ---------- range ----------
  // 報表頁自己的期間導覽（reportDate）跟輸入分頁的日期列（selectedDate）故意分開，
  // 瀏覽報表的月份/年度不會動到輸入分頁正在記帳的那一天。
  function getRange() {
    var d = state.reportDate;
    if (state.period === 'year') return [startOfYear(d), endOfYear(d)];
    return [startOfMonth(d), endOfMonth(d)];
  }
  function sortRecs(recs) {
    return recs.sort(function (a, b) { return a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1); });
  }
  // 報表頁用：純粹依目前選的日/週/月期間篩選，不管搜尋、不管日曆頁選了哪一天。
  function reportFilteredRecords() {
    var range = getRange();
    var startKey = toKey(range[0]), endKey = toKey(range[1]);
    return sortRecs(state.records.filter(function (r) { return r.date >= startKey && r.date <= endKey; }));
  }
  // 日曆頁用：有搜尋字串或進階篩選條件時故意不限制日期範圍（搜尋的目的就是「不記得是哪一天
  // 記的，用條件找」，限制在目前瀏覽的月份反而失去搜尋的意義）；沒有任何條件時依目前瀏覽的
  // 月份，再看有沒有額外點選單一天要進一步縮小範圍。
  function hasActiveSearchFilters() {
    var f = state.searchFilters;
    return !!(state.searchQuery.trim() || f.amountMin != null || f.amountMax != null || f.dateFrom || f.dateTo);
  }
  function calendarFilteredRecords() {
    var q = state.searchQuery.trim().toLowerCase();
    var f = state.searchFilters;
    var recs;
    if (hasActiveSearchFilters()) {
      recs = state.records.filter(function (r) {
        if (q) {
          var cat = findCat(r.categoryId);
          var catName = cat ? cat.name.toLowerCase() : '';
          var note = (r.note || '').toLowerCase();
          if (note.indexOf(q) === -1 && catName.indexOf(q) === -1 && String(r.amount).indexOf(q) === -1) return false;
        }
        if (f.amountMin != null && r.amount < f.amountMin) return false;
        if (f.amountMax != null && r.amount > f.amountMax) return false;
        if (f.dateFrom && r.date < f.dateFrom) return false;
        if (f.dateTo && r.date > f.dateTo) return false;
        return true;
      });
    } else {
      var monthStartKey = toKey(startOfMonth(state.calendarTabMonth));
      var monthEndKey = toKey(endOfMonth(state.calendarTabMonth));
      recs = state.records.filter(function (r) { return r.date >= monthStartKey && r.date <= monthEndKey; });
      if (state.calendarSelectedDay) {
        recs = recs.filter(function (r) { return r.date === state.calendarSelectedDay; });
      }
    }
    return sortRecs(recs);
  }
  function periodLabelText() {
    var d = state.reportDate;
    if (state.period === 'year') return d.getFullYear() + '年';
    var mEnd = endOfMonth(d).getDate();
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月 (' + (d.getMonth() + 1) + '月1日 - ' + (d.getMonth() + 1) + '月' + mEnd + '日)';
  }

  // ---------- DOM refs ----------
  var els = {};
  function cacheEls() {
    ['appLoading', 'themeToggleBtn', 'settingsBtn', 'datePrevBtn', 'dateDisplayBtn', 'dateDisplayText', 'dateNextBtn', 'todayBtn',
      'calendarPopup', 'calPrevMonth', 'calNextMonth', 'calMonthLabel', 'calendarGrid', 'periodTabs',
      'periodRangeLabel', 'reportPrevBtn', 'reportNextBtn', 'statExpense', 'statIncome', 'statBalance', 'pieChart', 'chartEmpty', 'chartTooltip', 'chartLegend',
      'quickAddForm', 'quickInput', 'addBtn', 'parsePreview', 'parseAmount', 'parseNote', 'parseCategoryChip',
      'advancedToggle', 'advancedFields', 'manualCategoryGrid', 'manualAmount', 'manualNote',
      'categoryPickSheet', 'categoryPickBackdrop', 'categoryPickGrid', 'categoryPickClose',
      'recordsList', 'recordsSearchInput',
      'searchAdvToggle', 'searchAdvPanel', 'searchAmountMin', 'searchAmountMax', 'searchDateFrom', 'searchDateTo', 'searchAdvClearBtn',
      'exportBtn', 'settingsSheet', 'settingsBackdrop', 'settingsCloseBtn',
      'categorySettingsBtn', 'categorySettingsSheet', 'categorySettingsBackdrop', 'categorySettingsCloseBtn',
      'categoryEditList',
      'addCategoryBtn', 'settingsExportBtn', 'importFileInput', 'resetDataBtn', 'toast', 'toastMsg', 'toastUndoBtn',
      'editRecordSheet', 'editRecordBackdrop', 'editRecordCloseBtn', 'editDate', 'editTime', 'editCategory',
      'editAmount', 'editNote', 'editDeleteBtn', 'editSaveBtn',
      'mergeCategorySheet', 'mergeCategoryBackdrop', 'mergeCategoryTitle', 'mergeCategoryGrid', 'mergeCategoryCancel',
      'mergeCategoryNoMergeBtn',
      'authSignedOut', 'authSignedIn', 'authEmail', 'googleSignInBtn', 'signOutBtn',
      'currentVersionTag', 'changelogBtn', 'changelogSheet', 'changelogBackdrop', 'changelogCloseBtn', 'changelogList',
      'bottomTabs', 'tabInput', 'tabCalendar', 'tabReport',
      'calBigPrevMonth', 'calBigNextMonth', 'calBigMonthLabel', 'calendarGridBig',
      'calStatIncome', 'calStatExpense', 'calStatTotal', 'calendarRecordsHead', 'calendarDayClearBtn',
      'reportMainView', 'categoryDrilldownView', 'drilldownBackBtn', 'drilldownTitle', 'trendChart', 'drilldownRecordsList', 'drilldownMonthClearBtn',
      'reclassifyBtn', 'reclassifySheet', 'reclassifyBackdrop', 'reclassifyCloseBtn', 'reclassifyTypeToggle',
      'reclassifySourceSelect', 'reclassifySelectAllRow', 'reclassifySelectAllCheckbox', 'reclassifyCountLabel',
      'reclassifyPreviewList', 'reclassifyEmptyHint', 'reclassifyApplyBtn', 'cleanupDuplicateCatsBtn',
      'importPreviewSheet', 'importPreviewBackdrop', 'importPreviewCloseBtn', 'importPreviewSummary',
      'importPreviewErrors', 'importPreviewCancelBtn', 'importPreviewConfirmBtn'
    ].forEach(function (id) { els[id] = document.getElementById(id); });
  }

  // ---------- render: date bar & calendar ----------
  function renderDateBar() {
    var d = state.selectedDate;
    els.dateDisplayText.textContent = isSameDay(d, new Date()) ? '今天' : (shortDate(d) + ' (' + WEEKDAY[d.getDay()] + ')');
  }
  function renderCalendar() {
    var month = state.calendarMonth;
    els.calMonthLabel.textContent = month.getFullYear() + '年' + (month.getMonth() + 1) + '月';
    var recordDates = {};
    state.records.forEach(function (r) { recordDates[r.date] = true; });
    var gridStart = startOfWeek(startOfMonth(month));
    els.calendarGrid.innerHTML = '';
    var today = new Date();
    for (var i = 0; i < 42; i++) {
      var d = addDays(gridStart, i);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d.getDate();
      if (d.getMonth() !== month.getMonth()) btn.classList.add('muted');
      if (isSameDay(d, today)) btn.classList.add('today');
      if (isSameDay(d, state.selectedDate)) btn.classList.add('selected');
      if (recordDates[toKey(d)]) btn.classList.add('has-record');
      btn.addEventListener('click', function (dateClone) {
        return function () {
          state.selectedDate = dateClone;
          els.calendarPopup.classList.add('hidden');
          renderAll();
        };
      }(d));
      els.calendarGrid.appendChild(btn);
    }
  }

  // ---------- render: pie chart ----------
  function buildDonut(svg, data, total) {
    svg.innerHTML = '';
    var cx = 100, cy = 100, r = 70, sw = 28;
    var circumference = 2 * Math.PI * r;
    var gap = data.length > 1 ? 3 : 0;
    var offset = 0;
    data.forEach(function (seg) {
      var frac = seg.value / total;
      var pct = Math.round(frac * 100);
      var len = Math.max(frac * circumference - gap, 0);
      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
      circle.setAttribute('fill', 'none');
      circle.style.stroke = 'var(' + seg.colorVar + ')';
      circle.setAttribute('stroke-width', sw);
      circle.setAttribute('stroke-dasharray', len + ' ' + (circumference - len));
      circle.setAttribute('stroke-dashoffset', String(-offset));
      circle.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
      circle.style.cursor = 'pointer';
      circle.addEventListener('click', function (seg, pct) {
        return function () { toggleChartTooltip(seg, pct); };
      }(seg, pct));
      svg.appendChild(circle);
      offset += frac * circumference;
    });
    var centerLabel = document.createElementNS(SVG_NS, 'text');
    centerLabel.setAttribute('x', cx); centerLabel.setAttribute('y', cy - 4);
    centerLabel.setAttribute('text-anchor', 'middle');
    centerLabel.style.fill = 'var(--text-muted)';
    centerLabel.style.font = '12px system-ui, sans-serif';
    centerLabel.textContent = state.chartType === 'expense' ? '支出' : '收入';
    svg.appendChild(centerLabel);
    var centerValue = document.createElementNS(SVG_NS, 'text');
    centerValue.setAttribute('x', cx); centerValue.setAttribute('y', cy + 16);
    centerValue.setAttribute('text-anchor', 'middle');
    centerValue.style.fill = 'var(--text-primary)';
    centerValue.style.font = 'bold 16px system-ui, sans-serif';
    centerValue.textContent = formatMoney(total);
    svg.appendChild(centerValue);
  }
  function hideChartTooltip() {
    state.chartTooltipCategoryId = null;
    els.chartTooltip.classList.add('hidden');
  }
  function toggleChartTooltip(seg, pct) {
    if (state.chartTooltipCategoryId === seg.id) { hideChartTooltip(); return; }
    state.chartTooltipCategoryId = seg.id;
    els.chartTooltip.innerHTML =
      '<div class="tooltip-name">' + escapeHtml(seg.name) + '</div>' +
      '<div class="tooltip-amt">' + formatMoney(seg.value) + '</div>' +
      '<div class="tooltip-pct">' + pct + '%</div>';
    els.chartTooltip.classList.remove('hidden');
  }
  function renderReportTab() {
    hideChartTooltip();
    var recs = reportFilteredRecords();
    var totalExpense = 0, totalIncome = 0;
    recs.forEach(function (r) { if (r.type === 'expense') totalExpense += r.amount; else totalIncome += r.amount; });
    els.statExpense.textContent = formatMoney(totalExpense);
    els.statIncome.textContent = formatMoney(totalIncome);
    els.statBalance.textContent = formatMoney(totalIncome - totalExpense);
    els.periodRangeLabel.textContent = periodLabelText();

    var byCat = {};
    recs.forEach(function (r) {
      if (r.type !== state.chartType) return;
      byCat[r.categoryId] = (byCat[r.categoryId] || 0) + r.amount;
    });
    var data = Object.keys(byCat).map(function (id) {
      var cat = findCat(id);
      return { id: id, name: catDisplayName(cat), colorVar: cat ? cat.colorVar : '--series-8', value: byCat[id] };
    }).sort(function (a, b) { return b.value - a.value; });
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);

    if (total > 0) {
      els.chartEmpty.classList.add('hidden');
      buildDonut(els.pieChart, data, total);
    } else {
      els.pieChart.innerHTML = '';
      els.chartEmpty.classList.remove('hidden');
    }
    els.chartLegend.innerHTML = '';
    data.forEach(function (d) {
      var li = document.createElement('li');
      var pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
      li.innerHTML = '<span class="dot" style="background:var(' + d.colorVar + ')"></span>' +
        '<span class="name">' + escapeHtml(d.name) + '</span>' +
        '<span class="amt">' + formatMoney(d.value) + '</span>' +
        '<span class="pct">' + pct + '%</span>' +
        '<span class="legend-chevron">›</span>';
      li.addEventListener('click', function (catId) {
        return function () { openCategoryDrilldown(catId); };
      }(d.id));
      els.chartLegend.appendChild(li);
    });
  }

  // ---------- 報表：分類趨勢 drill-down ----------
  function monthlyTotalsForCategory(categoryId, type, monthsBack) {
    var now = new Date();
    var months = [];
    for (var i = monthsBack - 1; i >= 0; i--) {
      var d = addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -i);
      months.push({ label: (d.getMonth() + 1) + '月', key: d.getFullYear() + '-' + pad2(d.getMonth() + 1) });
    }
    var totals = {};
    months.forEach(function (m) { totals[m.key] = 0; });
    state.records.forEach(function (r) {
      if (r.categoryId !== categoryId || r.type !== type) return;
      var key = r.date.slice(0, 7);
      if (key in totals) totals[key] += r.amount;
    });
    return months.map(function (m) { return { label: m.label, key: m.key, value: totals[m.key] }; });
  }
  // opts.selectedKey：目前被點選篩選中的月份 key，該長條要用不同顏色標出來；
  // opts.onSelect(key)：點某個長條時呼叫，交給呼叫端決定要不要套用篩選。
  function buildTrendChart(svg, data, opts) {
    opts = opts || {};
    svg.innerHTML = '';
    var w = 300, h = 160, padBottom = 22, padTop = 20;
    var max = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1]));
    var gap = w / data.length;
    var barW = gap * 0.5;
    data.forEach(function (d, i) {
      var barH = max > 0 ? (d.value / max) * (h - padTop - padBottom) : 0;
      var x = gap * i + (gap - barW) / 2;
      var y = h - padBottom - barH;
      var rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', barW); rect.setAttribute('height', Math.max(barH, 0));
      rect.setAttribute('rx', 4);
      rect.style.fill = d.key === opts.selectedKey ? 'var(--expense-color)' : 'var(--accent)';
      rect.style.cursor = 'pointer';
      if (opts.onSelect) rect.addEventListener('click', function () { opts.onSelect(d.key); });
      svg.appendChild(rect);
      // 長條本身很細，點擊熱區故意加寬到整個 gap 寬度，手機上比較好點準。
      var hitArea = document.createElementNS(SVG_NS, 'rect');
      hitArea.setAttribute('x', gap * i); hitArea.setAttribute('y', 0);
      hitArea.setAttribute('width', gap); hitArea.setAttribute('height', h);
      hitArea.style.fill = 'transparent';
      hitArea.style.cursor = 'pointer';
      if (opts.onSelect) hitArea.addEventListener('click', function () { opts.onSelect(d.key); });
      svg.appendChild(hitArea);

      if (d.value > 0) {
        var valLabel = document.createElementNS(SVG_NS, 'text');
        valLabel.setAttribute('x', x + barW / 2); valLabel.setAttribute('y', y - 6);
        valLabel.setAttribute('text-anchor', 'middle');
        valLabel.style.fill = 'var(--text-secondary)';
        valLabel.style.font = '10px system-ui, sans-serif';
        valLabel.textContent = formatMoney(d.value);
        svg.appendChild(valLabel);
      }
      var xLabel = document.createElementNS(SVG_NS, 'text');
      xLabel.setAttribute('x', gap * i + gap / 2); xLabel.setAttribute('y', h - 6);
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.style.fill = 'var(--text-muted)';
      xLabel.style.font = '11px system-ui, sans-serif';
      xLabel.textContent = d.label;
      svg.appendChild(xLabel);
    });
  }
  function monthKeyLabel(key) {
    var p = key.split('-');
    return p[0] + '年' + Number(p[1]) + '月';
  }
  function renderDrilldownView() {
    var categoryId = state.categoryDrilldown;
    var cat = findCat(categoryId);
    var monthData = monthlyTotalsForCategory(categoryId, state.chartType, 6);
    buildTrendChart(els.trendChart, monthData, {
      selectedKey: state.drilldownMonthFilter,
      onSelect: function (key) {
        state.drilldownMonthFilter = state.drilldownMonthFilter === key ? null : key;
        renderDrilldownView();
      }
    });

    var recs, labelText;
    if (state.drilldownMonthFilter) {
      recs = sortRecs(state.records.filter(function (r) {
        return r.categoryId === categoryId && r.date.slice(0, 7) === state.drilldownMonthFilter;
      }));
      labelText = monthKeyLabel(state.drilldownMonthFilter);
    } else {
      recs = reportFilteredRecords().filter(function (r) { return r.categoryId === categoryId; });
      labelText = periodLabelText();
    }
    var total = recs.reduce(function (s, r) { return s + r.amount; }, 0);
    els.drilldownTitle.textContent = catDisplayName(cat) + '（' + labelText + '）' + formatMoney(total);
    els.drilldownMonthClearBtn.classList.toggle('hidden', !state.drilldownMonthFilter);
    renderGroupedRecordList(els.drilldownRecordsList, recs, '這段期間這個分類沒有紀錄');
  }
  function openCategoryDrilldown(categoryId) {
    state.categoryDrilldown = categoryId;
    state.drilldownMonthFilter = null;
    els.reportMainView.classList.add('hidden');
    els.categoryDrilldownView.classList.remove('hidden');
    renderDrilldownView();
  }
  function closeDrilldown() {
    state.categoryDrilldown = null;
    state.drilldownMonthFilter = null;
    els.categoryDrilldownView.classList.add('hidden');
    els.reportMainView.classList.remove('hidden');
  }

  // ---------- render: records list ----------
  function catDisplayName(c) {
    if (!c) return '（已刪除分類）';
    return (c.icon ? c.icon + ' ' : '') + c.name;
  }
  function buildRecordRow(r) {
    var cat = findCat(r.categoryId);
    var row = document.createElement('div');
    row.className = 'record-row';
    row.innerHTML =
      '<span class="record-dot" style="background:var(' + (cat ? cat.colorVar : '--series-8') + ')"></span>' +
      '<span class="record-main">' +
        '<div class="record-cat">' + escapeHtml(catDisplayName(cat)) + '</div>' +
        (r.note ? '<div class="record-note">' + escapeHtml(r.note) + '</div>' : '') +
        '<div class="record-time">' + formatTime(r.createdAt) + '</div>' +
      '</span>' +
      '<span class="record-amt ' + r.type + '">' + (r.type === 'expense' ? '-' : '+') + formatMoney(r.amount).replace('-', '') + '</span>' +
      '<span class="record-chevron">›</span>' +
      '<button type="button" class="record-del" aria-label="刪除">✕</button>';
    row.querySelector('.record-del').addEventListener('click', function (e) {
      e.stopPropagation();
      deleteRecordWithUndo(r.id);
    });
    row.addEventListener('click', function () { openEditRecord(r.id); });
    return row;
  }
  // 分組列出紀錄，每筆都會顯示日期──日曆頁跟分類 drill-down 頁共用這個渲染邏輯。
  // recs 必須已經照日期/時間排序好（sortRecs()）。
  function renderGroupedRecordList(container, recs, emptyMsg) {
    container.innerHTML = '';
    if (!recs.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-msg';
      empty.textContent = emptyMsg || '這段期間還沒有紀錄，開始記一筆吧！';
      container.appendChild(empty);
      return;
    }
    var dayTotals = {};
    recs.forEach(function (r) { dayTotals[r.date] = (dayTotals[r.date] || 0) + (r.type === 'expense' ? -r.amount : r.amount); });
    var lastDateKey = null;
    recs.forEach(function (r) {
      if (r.date !== lastDateKey) {
        lastDateKey = r.date;
        var label = document.createElement('div');
        label.className = 'day-group-label';
        var dObj = fromKey(r.date);
        var dateText = dObj.getFullYear() + '年' + (dObj.getMonth() + 1) + '月' + dObj.getDate() + '日 (' + WEEKDAY[dObj.getDay()] + ')';
        if (isSameDay(dObj, new Date())) dateText = '今天 ' + dateText;
        var dayNet = dayTotals[r.date];
        label.innerHTML = '<span class="day-group-date">' + escapeHtml(dateText) + '</span>' +
          '<span class="day-group-total ' + (dayNet < 0 ? 'expense' : 'income') + '">' + formatMoney(dayNet) + '</span>';
        container.appendChild(label);
      }
      container.appendChild(buildRecordRow(r));
    });
  }
  function renderCalendarTab() {
    var month = state.calendarTabMonth;
    var mEnd = endOfMonth(month).getDate();
    els.calBigMonthLabel.textContent = month.getFullYear() + '年' + (month.getMonth() + 1) + '月 (' + (month.getMonth() + 1) + '月1日 - ' + (month.getMonth() + 1) + '月' + mEnd + '日)';

    var dayTotals = {};
    var monthKey = month.getFullYear() + '-' + pad2(month.getMonth() + 1);
    state.records.forEach(function (r) {
      if (r.date.slice(0, 7) !== monthKey) return;
      if (!dayTotals[r.date]) dayTotals[r.date] = { income: 0, expense: 0 };
      dayTotals[r.date][r.type] += r.amount;
    });

    var gridStart = startOfWeek(startOfMonth(month));
    els.calendarGridBig.innerHTML = '';
    var today = new Date();
    for (var i = 0; i < 42; i++) {
      var d = addDays(gridStart, i);
      var key = toKey(d);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'calendar-cell';
      if (d.getMonth() !== month.getMonth()) cell.classList.add('muted');
      if (isSameDay(d, today)) cell.classList.add('today');
      if (state.calendarSelectedDay === key) cell.classList.add('selected');
      var dt = dayTotals[key];
      var amtHtml = '';
      if (dt) {
        var net = dt.income - dt.expense;
        amtHtml = '<span class="cell-amt ' + (net < 0 ? 'expense' : 'income') + '">' + formatMoney(Math.abs(net)) + '</span>';
      }
      cell.innerHTML = '<span class="cell-day">' + d.getDate() + '</span>' + amtHtml;
      cell.addEventListener('click', function (dateKey) {
        return function () {
          state.calendarSelectedDay = state.calendarSelectedDay === dateKey ? null : dateKey;
          renderCalendarTab();
        };
      }(key));
      els.calendarGridBig.appendChild(cell);
    }

    var monthStartKey = toKey(startOfMonth(month)), monthEndKey = toKey(endOfMonth(month));
    var monthIncome = 0, monthExpense = 0;
    state.records.forEach(function (r) {
      if (r.date < monthStartKey || r.date > monthEndKey) return;
      if (r.type === 'income') monthIncome += r.amount; else monthExpense += r.amount;
    });
    els.calStatIncome.textContent = formatMoney(monthIncome);
    els.calStatExpense.textContent = formatMoney(monthExpense);
    els.calStatTotal.textContent = formatMoney(monthIncome - monthExpense);

    var q = state.searchQuery.trim();
    var advActive = hasActiveSearchFilters();
    if (state.calendarSelectedDay && !advActive) {
      var dObj = fromKey(state.calendarSelectedDay);
      els.calendarDayClearBtn.textContent = '篩選：' + shortDate(dObj) + '（' + WEEKDAY[dObj.getDay()] + '）　✕ 清除篩選';
      els.calendarDayClearBtn.classList.remove('hidden');
    } else {
      els.calendarDayClearBtn.classList.add('hidden');
    }
    els.calendarRecordsHead.textContent = advActive ? ('紀錄・篩選中' + (q ? '「' + q + '」' : '')) : '紀錄・' + month.getFullYear() + '年' + (month.getMonth() + 1) + '月';

    renderGroupedRecordList(els.recordsList, calendarFilteredRecords(), '這段期間還沒有紀錄，開始記一筆吧！');
  }

  // ---------- render: quick-add preview ----------
  function updateQuickPreview() {
    var val = els.quickInput.value;
    var parsed = parseQuickInput(val);
    if (!val.trim()) {
      els.parsePreview.classList.add('hidden');
      if (!state.manualCategoryTouched) state.tempCategoryOverride = null;
      syncManualCategoryGrid();
      return;
    }
    els.parsePreview.classList.remove('hidden');
    els.parseAmount.textContent = parsed.amount != null ? formatMoney(parsed.amount) : '尚未偵測到金額';
    els.parseNote.textContent = parsed.note || '（無備註）';
    var cat = effectiveCategory();
    els.parseCategoryChip.textContent = catDisplayName(cat);
    els.parseCategoryChip.style.background = 'var(' + cat.colorVar + ')';
    syncManualCategoryGrid();
  }
  // 進階選項的分類改成跟參考截圖一樣直接點格子選，不用另外開下拉選單/彈窗。
  // renderManualCategoryGrid 整個重繪（分類類型換了、清單本身變動時用）；
  // syncManualCategoryGrid 只更新選中的樣式（每次打字自動猜分類時用，不用整個重建 DOM）。
  function renderCategoryGridInto(container, cats, currentId, onSelect) {
    container.innerHTML = '';
    cats.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.catId = c.id;
      if (c.id === currentId) btn.classList.add('selected');
      btn.innerHTML = '<span class="dot" style="background:var(' + c.colorVar + ')"></span><span>' + escapeHtml(catDisplayName(c)) + '</span>';
      btn.addEventListener('click', function () { onSelect(c); });
      container.appendChild(btn);
    });
  }
  function renderManualCategoryGrid() {
    var cats = catsOfType(state.addType);
    var current = effectiveCategory();
    renderCategoryGridInto(els.manualCategoryGrid, cats, current.id, function (c) {
      state.tempCategoryOverride = c.id;
      state.manualCategoryTouched = true;
      updateQuickPreview();
      renderManualCategoryGrid();
    });
  }
  function syncManualCategoryGrid() {
    var current = effectiveCategory();
    Array.prototype.forEach.call(els.manualCategoryGrid.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('selected', btn.dataset.catId === current.id);
    });
  }

  // ---------- category pick sheet ----------
  function openCategoryPick(context) {
    state.categoryPickContext = context;
    var cats = catsOfType(state.addType);
    var current = effectiveCategory();
    renderCategoryGridInto(els.categoryPickGrid, cats, current.id, function (c) {
      state.tempCategoryOverride = c.id;
      state.manualCategoryTouched = true;
      els.categoryPickSheet.classList.add('hidden');
      updateQuickPreview();
    });
    els.categoryPickSheet.classList.remove('hidden');
  }

  // ---------- edit record ----------
  function populateEditCategorySelect(type, selectedId) {
    var cats = catsOfType(type);
    els.editCategory.innerHTML = cats.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(catDisplayName(c)) + '</option>'; }).join('');
    var stillValid = cats.some(function (c) { return c.id === selectedId; });
    els.editCategory.value = stillValid ? selectedId : fallbackCat(type).id;
  }
  function setEditType(type, selectedCategoryId) {
    state.editRecordType = type;
    Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-edittype]'), function (b) {
      b.classList.toggle('active', b.dataset.edittype === type);
    });
    populateEditCategorySelect(type, selectedCategoryId);
  }
  function openEditRecord(recordId) {
    var r = state.records.find(function (x) { return x.id === recordId; });
    if (!r) return;
    state.editingRecordId = recordId;
    setEditType(r.type, r.categoryId);
    els.editDate.value = r.date;
    els.editTime.value = formatTime(r.createdAt) || '00:00';
    els.editAmount.value = r.amount;
    els.editNote.value = r.note || '';
    els.editRecordSheet.classList.remove('hidden');
  }
  function closeEditRecord() { els.editRecordSheet.classList.add('hidden'); state.editingRecordId = null; }

  // ---------- settings: category management ----------
  // 刪除分類的共用邏輯：target 有給就把紀錄轉過去（順便處理收容分類遞補），
  // target 是 null 代表這個分類底下本來就沒有任何紀錄，直接刪除即可。
  function performCategoryDelete(c, target) {
    if (target) {
      if (c.fallback) target.fallback = true;
      state.records.forEach(function (r) { if (r.categoryId === c.id) r.categoryId = target.id; });
      saveRecords();
    }
    state.categories = state.categories.filter(function (x) { return x.id !== c.id; });
    saveCategories();
    els.mergeCategorySheet.classList.add('hidden');
    renderCategoryEditList();
    renderAll();
  }
  function openMergeCategorySheet(c, siblings) {
    els.mergeCategoryTitle.textContent = '刪除「' + c.name + '」— 紀錄要轉移到哪個分類？';
    els.mergeCategoryGrid.innerHTML = '';
    siblings.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<span class="dot" style="background:var(' + s.colorVar + ')"></span><span>' + escapeHtml(catDisplayName(s)) + (s.fallback ? '（收容分類）' : '') + '</span>';
      btn.addEventListener('click', function () { mergeDeleteCategory(c, s); });
      els.mergeCategoryGrid.appendChild(btn);
    });

    // 不想被迫挑一個轉移目標時（常見情境：手滑多新增了一個空分類）可以直接用這個按鈕跳過選擇。
    // 如果底下真的還有紀錄，不能讓它們憑空變成指不到任何分類，所以自動歸到收容分類，
    // 但文案講清楚會歸去哪裡，不是完全沒交代就消失。
    var recordCount = state.records.filter(function (r) { return r.categoryId === c.id; }).length;
    if (recordCount === 0) {
      els.mergeCategoryNoMergeBtn.textContent = '不指定分類，直接刪除';
    } else {
      var autoTarget = c.fallback ? siblings[0] : fallbackCat(c.type);
      els.mergeCategoryNoMergeBtn.textContent = '不指定分類（' + recordCount + ' 筆紀錄自動歸到「' + catDisplayName(autoTarget) + '」）';
    }
    els.mergeCategoryNoMergeBtn.onclick = function () { deleteCategoryNoMerge(c, siblings, recordCount); };

    els.mergeCategorySheet.classList.remove('hidden');
  }
  function mergeDeleteCategory(c, target) {
    if (!window.confirm('刪除「' + c.name + '」，紀錄轉移到「' + target.name + '」？')) return;
    performCategoryDelete(c, target);
  }
  function deleteCategoryNoMerge(c, siblings, recordCount) {
    if (recordCount === 0) {
      performCategoryDelete(c, null);
      showToast('已刪除「' + c.name + '」');
      return;
    }
    var autoTarget = c.fallback ? siblings[0] : fallbackCat(c.type);
    if (!window.confirm('刪除「' + c.name + '」，底下 ' + recordCount + ' 筆紀錄會自動歸到「' + autoTarget.name + '」，確定嗎？')) return;
    performCategoryDelete(c, autoTarget);
  }
  function swatchGroupHtml(slots, selectedColorVar) {
    return slots.map(function (v) {
      return '<button type="button" class="color-swatch' + (v === selectedColorVar ? ' selected' : '') + '" data-color="' + v + '" style="background:var(' + v + ')" aria-label="選擇這個顏色"></button>';
    }).join('');
  }
  function renderChangelog() {
    els.currentVersionTag.textContent = CURRENT_VERSION;
    els.changelogList.innerHTML = CHANGELOG.map(function (entry) {
      var notes = entry.notes.map(function (n) { return '<li>' + escapeHtml(n) + '</li>'; }).join('');
      return '<div class="changelog-entry">' +
        '<div class="changelog-entry-head">' +
          '<span class="changelog-version">' + escapeHtml(entry.version) + '</span>' +
          '<span class="changelog-name">' + escapeHtml(entry.name) + '</span>' +
          '<span class="changelog-date">' + escapeHtml(entry.date) + '</span>' +
        '</div>' +
        '<ul>' + notes + '</ul>' +
      '</div>';
    }).join('');
  }
  function renderCategoryEditList() {
    var cats = catsOfType(state.editingCategoryContext);
    els.categoryEditList.innerHTML = '';
    cats.forEach(function (c) {
      var item = document.createElement('div');
      item.className = 'category-edit-item';
      item.innerHTML =
        '<div class="category-edit-item-head">' +
          '<button type="button" class="dot color-dot-btn" style="background:var(' + c.colorVar + ')" aria-label="選擇顏色"></button>' +
          '<input type="text" class="icon-input" maxlength="4" placeholder="🏷️" value="' + escapeHtml(c.icon || '') + '" aria-label="分類圖示 emoji（選填）">' +
          '<input type="text" value="' + escapeHtml(c.name) + '">' +
          '<button type="button" class="del-cat-btn">刪除</button>' +
        '</div>' +
        '<div class="color-swatch-row hidden">' +
          '<p class="swatch-group-label">飽和色</p>' +
          '<div class="swatch-group">' + swatchGroupHtml(SERIES_SLOTS, c.colorVar) + '</div>' +
          '<p class="swatch-group-label">淺色</p>' +
          '<div class="swatch-group">' + swatchGroupHtml(PASTEL_SLOTS, c.colorVar) + '</div>' +
        '</div>' +
        '<p class="kw-label">自動分類關鍵字（用逗號分隔）</p>' +
        '<textarea>' + escapeHtml(c.keywords.join('、')) + '</textarea>';

      var iconInput = item.querySelector('.icon-input');
      iconInput.addEventListener('change', function () {
        c.icon = iconInput.value.trim().slice(0, 4);
        saveCategories();
        renderAll();
      });
      var nameInput = item.querySelector('.category-edit-item-head input[type="text"]:not(.icon-input)');
      nameInput.addEventListener('change', function () {
        c.name = nameInput.value.trim() || c.name;
        saveCategories();
        renderAll();
      });
      var kwArea = item.querySelector('textarea');
      kwArea.addEventListener('change', function () {
        c.keywords = kwArea.value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean);
        saveCategories();
      });

      var dotBtn = item.querySelector('.color-dot-btn');
      var swatchRow = item.querySelector('.color-swatch-row');
      dotBtn.addEventListener('click', function () { swatchRow.classList.toggle('hidden'); });
      Array.prototype.forEach.call(item.querySelectorAll('.color-swatch'), function (sw) {
        sw.addEventListener('click', function () {
          c.colorVar = sw.dataset.color;
          saveCategories();
          renderCategoryEditList();
          renderAll();
        });
      });

      item.querySelector('.del-cat-btn').addEventListener('click', function () {
        var siblings = catsOfType(c.type).filter(function (x) { return x.id !== c.id; });
        if (siblings.length === 0) { showToast('至少需保留一個分類'); return; }
        openMergeCategorySheet(c, siblings);
      });

      els.categoryEditList.appendChild(item);
    });
  }

  // ---------- settings: 清理重複分類 ----------
  // 修好 handleSignedIn 的 id 校正 bug 只能擋「以後」不再新增重複，已經在雲端/本機累積出來的
  // 重複分類殼（同 type+name、不同 id）需要這個工具一次清掉：同一組裡優先保留有設定圖示的，
  // 其餘的紀錄併過去、分類殼刪除。跟既有的「刪除分類→挑合併目標」是同一套資料處理邏輯，
  // 只是這裡自動判斷該併去哪一筆、一次處理所有重複組，不用一組一組手動點。
  function cleanupDuplicateCategories() {
    var groups = {};
    state.categories.forEach(function (c) {
      var key = c.type + '::' + c.name;
      (groups[key] = groups[key] || []).push(c);
    });
    var dupGroups = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length > 1; });
    if (dupGroups.length === 0) { showToast('沒有偵測到重複分類'); return; }

    var summary = dupGroups.map(function (g) { return g[0].name + '（' + g.length + ' 筆）'; }).join('、');
    var ok = window.confirm(
      '偵測到 ' + dupGroups.length + ' 組重複分類：' + summary + '\n\n' +
      '會自動保留每組裡有設定圖示的那一筆，其餘紀錄會併過去、多出來的分類殼會刪除，不會刪除任何紀錄本身。\n\n' +
      '確定要合併嗎？'
    );
    if (!ok) return;

    var removedIds = {};
    dupGroups.forEach(function (g) {
      var keeper = g.slice().sort(function (a, b) {
        var aIcon = a.icon ? 1 : 0, bIcon = b.icon ? 1 : 0;
        if (aIcon !== bIcon) return bIcon - aIcon;
        return (b.keywords ? b.keywords.length : 0) - (a.keywords ? a.keywords.length : 0);
      })[0];
      if (g.some(function (c) { return c.fallback; })) keeper.fallback = true;
      g.forEach(function (c) {
        if (c === keeper) return;
        removedIds[c.id] = true;
        state.records.forEach(function (r) { if (r.categoryId === c.id) r.categoryId = keeper.id; });
      });
    });
    state.categories = state.categories.filter(function (c) { return !removedIds[c.id]; });
    saveCategories(); saveRecords();
    renderCategoryEditList();
    renderAll();
    showToast('已合併 ' + dupGroups.length + ' 組重複分類');
  }

  // ---------- settings: 重新套用關鍵字分類 ----------
  // 用途：例如新增了「訂閱費」分類後，舊紀錄還留在當初記帳時唯一能對到的「娛樂」裡，
  // 不會自動回溯改分類。這裡讓使用者挑一個來源分類，對它底下每筆紀錄重新跑一次跟
  // 快速輸入同一套的 guessCategory() 判斷，列出「建議」跟現在不同的紀錄給使用者勾選
  // 確認後才搬移，不會自動全部套用，避免誤搬。
  function renderReclassifySourceOptions() {
    var cats = catsOfType(state.reclassifyType);
    els.reclassifySourceSelect.innerHTML = cats.map(function (c) {
      return '<option value="' + c.id + '">' + escapeHtml(catDisplayName(c)) + '</option>';
    }).join('');
    if (cats.length) els.reclassifySourceSelect.value = cats[0].id;
  }
  function renderReclassifyPreview() {
    var sourceId = els.reclassifySourceSelect.value;
    var sourceCat = findCat(sourceId);
    var preview = [];
    if (sourceCat) {
      state.records.forEach(function (r) {
        if (r.categoryId !== sourceId || r.type !== state.reclassifyType) return;
        var suggestion = guessCategory(r.note, r.type);
        if (suggestion && suggestion.id !== sourceId) preview.push({ record: r, suggestion: suggestion });
      });
      preview.sort(function (a, b) { return (b.record.createdAt || 0) - (a.record.createdAt || 0); });
    }
    state.reclassifyPreview = preview;

    els.reclassifyPreviewList.innerHTML = '';
    var hasItems = preview.length > 0;
    els.reclassifyEmptyHint.classList.toggle('hidden', hasItems);
    els.reclassifySelectAllRow.classList.toggle('hidden', !hasItems);
    els.reclassifyApplyBtn.classList.toggle('hidden', !hasItems);
    els.reclassifySelectAllCheckbox.checked = true;

    preview.forEach(function (item, idx) {
      var r = item.record;
      var row = document.createElement('label');
      row.className = 'reclassify-item';
      row.innerHTML =
        '<input type="checkbox" class="reclassify-item-check" data-idx="' + idx + '" checked>' +
        '<span class="reclassify-item-main">' +
          '<span class="reclassify-item-note">' + escapeHtml(r.note || '（無備註）') + '</span>' +
          '<span class="reclassify-item-meta">' + escapeHtml(r.date) + '　' + formatMoney(r.amount) + '</span>' +
        '</span>' +
        '<span class="reclassify-item-arrow">→ ' + escapeHtml(catDisplayName(item.suggestion)) + '</span>';
      row.querySelector('.reclassify-item-check').addEventListener('change', updateReclassifyCountLabel);
      els.reclassifyPreviewList.appendChild(row);
    });
    updateReclassifyCountLabel();
  }
  function updateReclassifyCountLabel() {
    var boxes = els.reclassifyPreviewList.querySelectorAll('.reclassify-item-check');
    var checked = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).length;
    els.reclassifyCountLabel.textContent = '全選（共 ' + boxes.length + ' 筆建議變動，已勾選 ' + checked + ' 筆）';
    els.reclassifySelectAllCheckbox.checked = boxes.length > 0 && checked === boxes.length;
  }
  function openReclassifySheet() {
    state.reclassifyType = 'expense';
    Array.prototype.forEach.call(els.reclassifyTypeToggle.querySelectorAll('.type-toggle-btn'), function (b) {
      b.classList.toggle('active', b.dataset.rtype === 'expense');
    });
    renderReclassifySourceOptions();
    renderReclassifyPreview();
    els.reclassifySheet.classList.remove('hidden');
  }
  function closeReclassifySheet() { els.reclassifySheet.classList.add('hidden'); }
  function applyReclassify() {
    var boxes = els.reclassifyPreviewList.querySelectorAll('.reclassify-item-check');
    var count = 0;
    Array.prototype.forEach.call(boxes, function (b) {
      if (!b.checked) return;
      var item = state.reclassifyPreview[Number(b.dataset.idx)];
      if (!item) return;
      item.record.categoryId = item.suggestion.id;
      count++;
    });
    if (count === 0) { showToast('沒有勾選任何紀錄'); return; }
    saveRecords();
    renderAll();
    showToast('已更新 ' + count + ' 筆紀錄的分類');
    renderReclassifyPreview();
  }

  // ---------- CSV export / import ----------
  function exportCsv() {
    var rows = [['date', 'type', 'category', 'amount', 'note']];
    state.records.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (r) {
      var cat = findCat(r.categoryId);
      rows.push([r.date, r.type, cat ? cat.name : '', r.amount, r.note || '']);
    });
    var csv = '﻿' + rows.map(function (row) {
      return row.map(function (v) {
        var s = String(v);
        // 開頭是 =/+/-/@ 的欄位在 Excel 等試算表打開時可能被當成公式執行（CSV 公式注入），
        // 前面加一個單引號讓試算表當純文字處理，Excel 顯示時會自動吃掉這個單引號，不影響
        // 使用者看到的內容。金額/日期/type 欄位不會踩到這個規則，只有分類名稱/備註可能。
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '記帳-' + toKey(new Date()) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function applyImportStaged(staged) {
    state.categories = staged.workingCategories;
    state.records = state.records.concat(staged.recordsToAdd);
    saveCategories(); saveRecords();
  }
  function openImportPreview(staged) {
    state.pendingImportStaged = staged;
    var formatLabel = staged.format === 'moneynote' ? 'MoneyNote 匯出格式' : '本 App 格式';
    var lines = ['偵測到「' + formatLabel + '」', '有效紀錄：' + staged.recordsToAdd.length + ' 筆'];
    if (staged.newCategoryCount > 0) lines.push('會新增 ' + staged.newCategoryCount + ' 個分類');
    if (staged.errorCount > 0) lines.push('略過 ' + staged.errorCount + ' 筆（格式錯誤，不會被匯入）');
    els.importPreviewSummary.innerHTML = lines.map(function (l) { return '<p>' + escapeHtml(l) + '</p>'; }).join('');
    els.importPreviewErrors.innerHTML = staged.errorSamples.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
    els.importPreviewErrors.classList.toggle('hidden', staged.errorSamples.length === 0);
    els.importPreviewConfirmBtn.disabled = staged.recordsToAdd.length === 0;
    els.importPreviewConfirmBtn.textContent = staged.recordsToAdd.length === 0 ? '沒有可匯入的紀錄' : '確認匯入';
    els.importPreviewSheet.classList.remove('hidden');
  }

  // ---------- toast ----------
  var toastTimer = null;
  var toastUndoHandler = null;
  function hideToast() {
    els.toast.classList.add('hidden');
    els.toastUndoBtn.classList.add('hidden');
    toastUndoHandler = null;
  }
  function showToast(msg) {
    clearTimeout(toastTimer);
    els.toastMsg.textContent = msg;
    els.toastUndoBtn.classList.add('hidden');
    toastUndoHandler = null;
    els.toast.classList.remove('hidden');
    toastTimer = setTimeout(hideToast, 1800);
  }
  // 帶「復原」按鈕的 toast，時間拉長到 5 秒給使用者足夠時間反應；逾時沒點就當作真的要刪除
  // （其實刪除動作在呼叫這個函式之前就已經做完了，這裡只是留一個「反悔」的窗口）。
  function showUndoToast(msg, onUndo) {
    clearTimeout(toastTimer);
    els.toastMsg.textContent = msg;
    toastUndoHandler = onUndo;
    els.toastUndoBtn.classList.remove('hidden');
    els.toast.classList.remove('hidden');
    toastTimer = setTimeout(hideToast, 5000);
  }
  function deleteRecordWithUndo(recordId) {
    var idx = state.records.findIndex(function (x) { return x.id === recordId; });
    if (idx === -1) return;
    var removed = state.records[idx];
    state.records.splice(idx, 1);
    saveRecords();
    renderAll();
    // 細微震動給刪除動作一點回饋感；iOS Safari 沒有實作 Vibration API，這裡呼叫沒有反應，
    // 是平台限制不是 bug，Android Chrome／桌機瀏覽器才會真的震動。
    if (navigator.vibrate) navigator.vibrate(15);
    var cat = findCat(removed.categoryId);
    showUndoToast('已刪除　' + catDisplayName(cat) + ' ' + formatMoney(removed.amount), function () {
      state.records.push(removed);
      saveRecords();
      renderAll();
    });
  }

  // ---------- tabs ----------
  var TAB_ELS = null; // lazy — els 要等 cacheEls() 跑完才有值
  function switchTab(tab) {
    if (!TAB_ELS) TAB_ELS = { input: els.tabInput, calendar: els.tabCalendar, report: els.tabReport };
    state.activeTab = tab;
    Object.keys(TAB_ELS).forEach(function (key) { TAB_ELS[key].classList.toggle('hidden', key !== tab); });
    Array.prototype.forEach.call(els.bottomTabs.querySelectorAll('.bottom-tab-btn'), function (b) {
      var active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (tab !== 'report') closeDrilldown();
  }

  // ---------- master render ----------
  function renderAll() {
    renderDateBar();
    renderManualCategoryGrid();
    updateQuickPreview();
    renderCalendarTab();
    renderReportTab();
    if (state.categoryDrilldown) renderDrilldownView();
  }

  // ---------- events ----------
  function bindEvents() {
    els.themeToggleBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = cur ? cur === 'dark' : systemDark;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE.theme, next);
    });

    els.datePrevBtn.addEventListener('click', function () { state.selectedDate = addDays(state.selectedDate, -1); renderAll(); });
    els.dateNextBtn.addEventListener('click', function () { state.selectedDate = addDays(state.selectedDate, 1); renderAll(); });
    els.todayBtn.addEventListener('click', function () { state.selectedDate = new Date(); renderAll(); });

    els.dateDisplayBtn.addEventListener('click', function () {
      var willShow = els.calendarPopup.classList.contains('hidden');
      els.calendarPopup.classList.toggle('hidden');
      if (willShow) { state.calendarMonth = startOfMonth(state.selectedDate); renderCalendar(); }
    });
    document.addEventListener('click', function (e) {
      if (els.calendarPopup.classList.contains('hidden')) return;
      if (els.calendarPopup.contains(e.target) || els.dateDisplayBtn.contains(e.target)) return;
      els.calendarPopup.classList.add('hidden');
    });
    els.calPrevMonth.addEventListener('click', function () { state.calendarMonth = addMonths(state.calendarMonth, -1); renderCalendar(); });
    els.calNextMonth.addEventListener('click', function () { state.calendarMonth = addMonths(state.calendarMonth, 1); renderCalendar(); });

    Array.prototype.forEach.call(els.periodTabs.querySelectorAll('.period-tab'), function (btn) {
      btn.addEventListener('click', function () {
        state.period = btn.dataset.period;
        Array.prototype.forEach.call(els.periodTabs.querySelectorAll('.period-tab'), function (b) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        renderAll();
      });
    });
    els.reportPrevBtn.addEventListener('click', function () {
      state.reportDate = state.period === 'year' ? addYears(state.reportDate, -1) : addMonths(state.reportDate, -1);
      renderAll();
    });
    els.reportNextBtn.addEventListener('click', function () {
      state.reportDate = state.period === 'year' ? addYears(state.reportDate, 1) : addMonths(state.reportDate, 1);
      renderAll();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.chart-toggle-btn'), function (btn) {
      btn.addEventListener('click', function () {
        state.chartType = btn.dataset.chartType;
        Array.prototype.forEach.call(document.querySelectorAll('.chart-toggle-btn'), function (b) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        closeDrilldown();
        renderReportTab();
      });
    });

    // 搜尋框跟金額篩選都是每打一個字就觸發，紀錄多了之後每次都整個重新掃描+重繪列表會卡，
    // 加個短暫的 debounce：state 本身還是每個字都同步更新（畫面上的輸入框本來就是瀏覽器
    // 自己即時顯示，不需要等），只有比較貴的重繪動作延後到打字停下來一小段時間才真的執行。
    var debouncedRenderCalendarTab = debounce(function () { renderCalendarTab(); }, 150);
    ['input', 'search'].forEach(function (evt) {
      els.recordsSearchInput.addEventListener(evt, function () {
        state.searchQuery = els.recordsSearchInput.value;
        debouncedRenderCalendarTab();
      });
    });
    els.searchAdvToggle.addEventListener('click', function () {
      els.searchAdvPanel.classList.toggle('hidden');
    });
    function bindAmountFilterInput(input, key) {
      input.addEventListener('input', function () {
        var v = input.value.trim();
        var n = parseFloat(v);
        // isNaN 防護：正常透過 number input 打字瀏覽器會擋掉無效字元，但貼上/IME 組字過程
        // 中途、或用程式改 .value 再觸發 input 事件，還是可能讓 v 變成解析不出數字的字串。
        // 沒防護的話 amountMin/amountMax 會變成 NaN，hasActiveSearchFilters() 判斷成「有篩選」
        // 但實際比較 r.amount < NaN 恆為 false，篩選條件形同虛設，畫面上卻顯示成正在篩選中。
        state.searchFilters[key] = (v === '' || isNaN(n)) ? null : n;
        debouncedRenderCalendarTab();
      });
    }
    bindAmountFilterInput(els.searchAmountMin, 'amountMin');
    bindAmountFilterInput(els.searchAmountMax, 'amountMax');
    function bindDateFilterInput(input, key) {
      input.addEventListener('change', function () {
        state.searchFilters[key] = input.value || null;
        renderCalendarTab();
      });
    }
    bindDateFilterInput(els.searchDateFrom, 'dateFrom');
    bindDateFilterInput(els.searchDateTo, 'dateTo');
    els.searchAdvClearBtn.addEventListener('click', function () {
      state.searchFilters = emptySearchFilters();
      els.searchAmountMin.value = ''; els.searchAmountMax.value = '';
      els.searchDateFrom.value = ''; els.searchDateTo.value = '';
      renderCalendarTab();
    });

    Array.prototype.forEach.call(els.bottomTabs.querySelectorAll('.bottom-tab-btn'), function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });
    els.calBigPrevMonth.addEventListener('click', function () {
      state.calendarTabMonth = addMonths(state.calendarTabMonth, -1);
      state.calendarSelectedDay = null;
      renderCalendarTab();
    });
    els.calBigNextMonth.addEventListener('click', function () {
      state.calendarTabMonth = addMonths(state.calendarTabMonth, 1);
      state.calendarSelectedDay = null;
      renderCalendarTab();
    });
    els.calendarDayClearBtn.addEventListener('click', function () {
      state.calendarSelectedDay = null;
      renderCalendarTab();
    });
    els.drilldownBackBtn.addEventListener('click', closeDrilldown);
    els.drilldownMonthClearBtn.addEventListener('click', function () {
      state.drilldownMonthFilter = null;
      renderDrilldownView();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-type]'), function (btn) {
      btn.addEventListener('click', function () {
        state.addType = btn.dataset.type;
        state.tempCategoryOverride = null;
        state.manualCategoryTouched = false;
        Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-type]'), function (b) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        renderManualCategoryGrid();
        updateQuickPreview();
      });
    });

    els.quickInput.addEventListener('input', function () {
      state.manualCategoryTouched = false;
      state.tempCategoryOverride = null;
      updateQuickPreview();
    });
    els.parseCategoryChip.addEventListener('click', function () { openCategoryPick('quickadd'); });
    els.advancedToggle.addEventListener('click', function () {
      els.advancedFields.classList.toggle('hidden');
      els.advancedToggle.textContent = els.advancedFields.classList.contains('hidden') ? '進階選項 ▾' : '進階選項 ▴';
    });

    els.categoryPickBackdrop.addEventListener('click', function () { els.categoryPickSheet.classList.add('hidden'); });
    els.categoryPickClose.addEventListener('click', function () { els.categoryPickSheet.classList.add('hidden'); });

    els.mergeCategoryBackdrop.addEventListener('click', function () { els.mergeCategorySheet.classList.add('hidden'); });
    els.mergeCategoryCancel.addEventListener('click', function () { els.mergeCategorySheet.classList.add('hidden'); });

    Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-edittype]'), function (btn) {
      btn.addEventListener('click', function () { setEditType(btn.dataset.edittype, els.editCategory.value); });
    });
    els.editRecordBackdrop.addEventListener('click', closeEditRecord);
    els.editRecordCloseBtn.addEventListener('click', closeEditRecord);
    els.editSaveBtn.addEventListener('click', function () {
      var r = state.records.find(function (x) { return x.id === state.editingRecordId; });
      if (!r) return;
      var amount = parseFloat(els.editAmount.value);
      if (isNaN(amount) || amount < 0) { showToast('請輸入有效金額'); els.editAmount.focus(); return; }
      var dateVal = els.editDate.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) { showToast('請選擇日期'); return; }
      var timeVal = els.editTime.value || '00:00';
      var dp = dateVal.split('-').map(Number);
      var tp = timeVal.split(':').map(Number);
      r.type = state.editRecordType;
      r.date = dateVal;
      r.categoryId = els.editCategory.value;
      r.amount = amount;
      r.note = els.editNote.value.trim();
      r.createdAt = new Date(dp[0], dp[1] - 1, dp[2], tp[0] || 0, tp[1] || 0).getTime();
      saveRecords();
      closeEditRecord();
      renderAll();
      showToast('已更新紀錄');
    });
    els.editDeleteBtn.addEventListener('click', function () {
      var recordId = state.editingRecordId;
      if (!recordId) return;
      closeEditRecord();
      deleteRecordWithUndo(recordId);
    });

    els.quickAddForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var parsed = parseQuickInput(els.quickInput.value);
      var amount = parsed.amount;
      var note = parsed.note;
      var manualAmt = parseFloat(els.manualAmount.value);
      if (!isNaN(manualAmt) && manualAmt >= 0) amount = manualAmt;
      if (els.manualNote.value.trim()) note = els.manualNote.value.trim();
      if (amount === null || isNaN(amount) || amount < 0) { showToast('請輸入有效金額'); els.quickInput.focus(); return; }
      var cat = effectiveCategory();
      state.records.push({ id: uid(), date: toKey(state.selectedDate), type: state.addType, categoryId: cat.id, amount: amount, note: note, createdAt: Date.now() });
      saveRecords();
      els.quickInput.value = ''; els.manualAmount.value = ''; els.manualNote.value = '';
      state.tempCategoryOverride = null; state.manualCategoryTouched = false;
      renderAll();
      showToast('已新增一筆' + (state.addType === 'expense' ? '支出' : '收入'));
    });

    els.exportBtn.addEventListener('click', exportCsv);
    els.settingsExportBtn.addEventListener('click', exportCsv);
    els.importFileInput.addEventListener('change', function () {
      var file = els.importFileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        openImportPreview(stageImportCsv(String(reader.result), state.categories));
        els.importFileInput.value = '';
      };
      reader.readAsText(file, 'UTF-8');
    });
    function closeImportPreview() { els.importPreviewSheet.classList.add('hidden'); state.pendingImportStaged = null; }
    els.importPreviewBackdrop.addEventListener('click', closeImportPreview);
    els.importPreviewCloseBtn.addEventListener('click', closeImportPreview);
    els.importPreviewCancelBtn.addEventListener('click', closeImportPreview);
    els.importPreviewConfirmBtn.addEventListener('click', function () {
      var staged = state.pendingImportStaged;
      if (!staged) return;
      applyImportStaged(staged);
      var count = staged.recordsToAdd.length;
      closeImportPreview();
      showToast('已匯入 ' + count + ' 筆紀錄');
      renderCategoryEditList();
      renderAll();
    });
    els.resetDataBtn.addEventListener('click', function () {
      var msg = cloudUser ? '確定要清除所有記帳資料嗎？這會同時清除雲端上的資料，此動作無法復原。' : '確定要清除所有記帳資料嗎？此動作無法復原。';
      if (!window.confirm(msg)) return;
      var afterClear = function () {
        localStorage.removeItem(STORAGE.records);
        localStorage.removeItem(STORAGE.categories);
        location.reload();
      };
      if (cloudUser) {
        // 只有雲端真的確認刪除成功才清本機——失敗就保留本機資料，不能讓使用者以為清除完成了，
        // 結果雲端其實還在，之後同步回來時舊資料又跑出來，變成「清除了但沒清乾淨」的詭異狀態。
        // 排進 enqueueSync 隊列而不是直接呼叫 diffAndPush：不然如果使用者剛好在按下清除前一刻
        // 才編輯過一筆紀錄，那筆存檔的同步跟這裡的清除是各自獨立發出的兩個請求，誰先送到伺服器
        // 誰就贏，有可能清除反而沒清乾淨（剛編輯的那筆同步晚到，把清除蓋掉）。排進同一條隊列，
        // 保證一定是「先前排隊中的存檔全部做完」之後，清除才會執行。
        Promise.all([
          enqueueSync('records', function () { return diffAndPush('records', []); }),
          enqueueSync('categories', function () { return diffAndPush('categories', []); })
        ]).then(afterClear).catch(function (e) {
          console.error('清除雲端資料失敗', e);
          showToast('清除雲端資料失敗，本機資料還保留著，請檢查網路連線後再試一次');
        });
      } else {
        afterClear();
      }
    });

    els.googleSignInBtn.addEventListener('click', function () {
      // 用 redirect 不用 popup：iOS Safari（尤其加到主畫面的 PWA 獨立模式）常常沒辦法讓
      // 彈出視窗把登入結果傳回原頁面，畫面會卡一下然後跳回去、但沒有真的登入。redirect
      // 是整頁導去 Google 再導回來，不依賴跳出視窗跟原頁面之間的溝通，比較穩。
      signInWithRedirect(auth, googleProvider).catch(function (e) {
        showToast('登入失敗：' + (e && e.message ? e.message : '未知錯誤'));
      });
    });
    els.signOutBtn.addEventListener('click', function () {
      // 登出後直接整頁重整：保證畫面狀態一定是乾淨的，不會有「登出了但畫面/記憶體裡
      // 還殘留雲端帳號資料」這種曖昧狀態，跟「清除所有資料」用同一個防禦邏輯。
      signOut(auth).finally(function () { location.reload(); });
    });

    els.settingsBtn.addEventListener('click', function () {
      els.settingsSheet.classList.remove('hidden');
    });
    els.settingsCloseBtn.addEventListener('click', function () { els.settingsSheet.classList.add('hidden'); });
    els.settingsBackdrop.addEventListener('click', function () { els.settingsSheet.classList.add('hidden'); });

    // 分類與關鍵字設定拆成獨立子頁面，從主設定頁點進來，保持主設定頁乾淨、不用一打開就看到
    // 一長串分類列表。開啟時才做分類清單的初始化跟渲染，跟其他子 sheet（重新套用關鍵字分類等）
    // 「開啟時才 render」的模式一致。
    els.categorySettingsBtn.addEventListener('click', function () {
      state.editingCategoryContext = state.addType;
      Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-settype]'), function (b) {
        b.classList.toggle('active', b.dataset.settype === state.editingCategoryContext);
      });
      renderCategoryEditList();
      els.categorySettingsSheet.classList.remove('hidden');
    });
    els.categorySettingsCloseBtn.addEventListener('click', function () { els.categorySettingsSheet.classList.add('hidden'); });
    els.categorySettingsBackdrop.addEventListener('click', function () { els.categorySettingsSheet.classList.add('hidden'); });

    els.changelogBtn.addEventListener('click', function () { els.changelogSheet.classList.remove('hidden'); });
    els.changelogBackdrop.addEventListener('click', function () { els.changelogSheet.classList.add('hidden'); });
    els.changelogCloseBtn.addEventListener('click', function () { els.changelogSheet.classList.add('hidden'); });
    Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-settype]'), function (btn) {
      btn.addEventListener('click', function () {
        state.editingCategoryContext = btn.dataset.settype;
        Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-settype]'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderCategoryEditList();
      });
    });
    els.addCategoryBtn.addEventListener('click', function () {
      var cat = { id: uid(), type: state.editingCategoryContext, name: '新分類', colorVar: nextColorVar(state.editingCategoryContext), icon: '', keywords: [], fallback: false };
      state.categories.push(cat);
      saveCategories();
      renderCategoryEditList();
      var inputs = els.categoryEditList.querySelectorAll('.category-edit-item-head input[type="text"]:not(.icon-input)');
      var last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });

    els.toastUndoBtn.addEventListener('click', function () {
      if (toastUndoHandler) toastUndoHandler();
      hideToast();
    });

    els.cleanupDuplicateCatsBtn.addEventListener('click', cleanupDuplicateCategories);
    els.reclassifyBtn.addEventListener('click', openReclassifySheet);
    els.reclassifyCloseBtn.addEventListener('click', closeReclassifySheet);
    els.reclassifyBackdrop.addEventListener('click', closeReclassifySheet);
    Array.prototype.forEach.call(els.reclassifyTypeToggle.querySelectorAll('.type-toggle-btn'), function (btn) {
      btn.addEventListener('click', function () {
        state.reclassifyType = btn.dataset.rtype;
        Array.prototype.forEach.call(els.reclassifyTypeToggle.querySelectorAll('.type-toggle-btn'), function (b) {
          b.classList.toggle('active', b === btn);
        });
        renderReclassifySourceOptions();
        renderReclassifyPreview();
      });
    });
    els.reclassifySourceSelect.addEventListener('change', renderReclassifyPreview);
    els.reclassifySelectAllCheckbox.addEventListener('change', function () {
      var checked = els.reclassifySelectAllCheckbox.checked;
      Array.prototype.forEach.call(els.reclassifyPreviewList.querySelectorAll('.reclassify-item-check'), function (b) {
        b.checked = checked;
      });
      updateReclassifyCountLabel();
    });
    els.reclassifyApplyBtn.addEventListener('click', applyReclassify);
  }

  // ---------- sheet 無障礙：dialog 語意、開關時處理焦點、focus trap、Escape 關閉 ----------
  // App 裡有七八個底部彈出的 sheet（設定、編輯紀錄、分類挑選、匯入預覽……），各自的開關
  // 邏輯散在很多地方（有的用專屬 open/close 函式、有的在 click handler 裡直接
  // classList.add/remove('hidden')）。與其每個 sheet 各自補一套 focus trap，這裡用
  // MutationObserver 統一在「.hidden 這個 class 被加上/拿掉」的當下處理，不用去改動任何
  // 既有的開關呼叫點，新增 sheet 時也不用特別記得要加無障礙邏輯。
  function setupSheetAccessibility() {
    var lastFocusedBeforeOpen = null;
    function focusableEls(container) {
      return Array.prototype.slice.call(
        container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    }
    function onSheetOpen(sheetEl) {
      lastFocusedBeforeOpen = document.activeElement;
      var body = sheetEl.querySelector('.sheet-body');
      if (body && !body.hasAttribute('tabindex')) body.setAttribute('tabindex', '-1');
      var targets = body ? focusableEls(body) : [];
      (targets[0] || body || sheetEl).focus();
    }
    function onSheetClose() {
      if (lastFocusedBeforeOpen && document.body.contains(lastFocusedBeforeOpen)) lastFocusedBeforeOpen.focus();
      lastFocusedBeforeOpen = null;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (sheetEl) {
      sheetEl.setAttribute('role', 'dialog');
      sheetEl.setAttribute('aria-modal', 'true');
      var wasHidden = sheetEl.classList.contains('hidden');
      new MutationObserver(function () {
        var isHidden = sheetEl.classList.contains('hidden');
        if (wasHidden && !isHidden) onSheetOpen(sheetEl);
        else if (!wasHidden && isHidden) onSheetClose();
        wasHidden = isHidden;
      }).observe(sheetEl, { attributes: true, attributeFilter: ['class'] });
    });
    document.addEventListener('keydown', function (e) {
      // 有些 sheet 是疊在另一個 sheet 上面開的（例如分類與關鍵字設定疊在主設定上面），
      // 這時候畫面上不只一個 .sheet 沒有 .hidden。DOM 順序等於疊層順序（後面的蓋在上面，
      // 跟這次 session 稍早修過的 z-index 疊層 bug 是同一個約定），所以要挑「最後一個」
      // 符合的，不能用 querySelector 只抓第一個，不然 Escape/Tab 會作用在背景那層。
      var openSheets = document.querySelectorAll('.sheet:not(.hidden)');
      var openSheetEl = openSheets.length ? openSheets[openSheets.length - 1] : null;
      if (!openSheetEl) return;
      if (e.key === 'Escape') {
        // 每個 sheet 都已經有 .sheet-backdrop 掛著點擊關閉的邏輯，直接模擬點一下，
        // 不用另外去猜每個 sheet 的關閉按鈕 id 叫什麼。
        var backdrop = openSheetEl.querySelector('.sheet-backdrop');
        if (backdrop) backdrop.click();
        return;
      }
      if (e.key === 'Tab') {
        var body = openSheetEl.querySelector('.sheet-body') || openSheetEl;
        var f = focusableEls(body);
        if (f.length === 0) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // ---------- init ----------
  function init() {
    cacheEls();
    var savedTheme = localStorage.getItem(STORAGE.theme);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    state.categories = loadCategories();
    state.records = loadRecords();
    renderManualCategoryGrid();
    bindEvents();
    setupSheetAccessibility();
    switchTab('input');
    renderAll();
    renderChangelog();
    initCloudSync();

    // 開場的載入畫面：等 service worker 檢查更新的動作做過一輪才收起。老實說 reg.update()
    // 完成只代表「檢查過 sw.js 有沒有變」，不代表這次載入的頁面內容就一定是新版——真正的
    // service worker 生效時機是新的 worker 真的接管這個分頁（觸發 controllerchange），這件事
    // 可能發生在 reg.update() 之後。所以這裡分兩層：載入畫面本身只是「檢查過一輪、不要一直
    // 卡著」，真的偵測到版本切換時另外強制重新整理一次，才能保證畫面上執行的 HTML/JS 也真的
    // 換成新版，不是自己騙自己。網路不通或檢查卡住時 2.5 秒逾時還是要放行，不能卡死使用者。
    var loadingHidden = false;
    function hideAppLoading() {
      if (loadingHidden) return;
      loadingHidden = true;
      var el = els.appLoading;
      if (!el) return;
      el.classList.add('app-loading-hide');
      setTimeout(function () { el.remove(); }, 300);
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      // 這個分頁「載入當下」本來就已經被某個 service worker 控制著、後來又換成另一個，
      // 才代表是真的版本切換，需要重新整理一次才能保證這次抓到的頁面內容也是新版。
      // 如果原本沒有 controller（第一次啟用 service worker），不算更新，不用重整。
      var hadControllerAtLoad = !!navigator.serviceWorker.controller;
      var reloadedForUpdate = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadControllerAtLoad || reloadedForUpdate) return;
        reloadedForUpdate = true;
        location.reload();
      });
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        return reg.update().catch(function () {});
      }).catch(function () {}).then(hideAppLoading);
      setTimeout(hideAppLoading, 2500);
    } else {
      hideAppLoading();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
