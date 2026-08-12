import {
  auth, db, googleProvider,
  signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  collection, doc, onSnapshot, writeBatch, getDocs
} from './firebase-config.js';

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  // 給家人/自己看的白話版更新紀錄，完整技術細節在 CLAUDE.md。新增版本時陣列開頭插入一筆，
  // CURRENT_VERSION 記得跟著更新（設定頁的版本號、標籤都是抓這個常數）。
  var CURRENT_VERSION = 'v2.2';
  var CHANGELOG = [
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
  var WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
  var SERIES_SLOTS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];
  var PASTEL_SLOTS = ['--pastel-1', '--pastel-2', '--pastel-3', '--pastel-4', '--pastel-5', '--pastel-6', '--pastel-7', '--pastel-8'];

  var DEFAULT_EXPENSE_CATS = [
    { name: '餐飲', colorVar: '--series-1', keywords: ['早餐', '午餐', '晚餐', '消夜', '宵夜', '咖啡', '飲料', '超商', '全家', '7-11', '711', '7-eleven', '萊爾富', 'ok超商', '餐廳', '小吃', '火鍋', '便當', '飲品', '手搖', '星巴克', '麥當勞', '肯德基', '拉麵', '牛肉麵', '早午餐', '外送', 'foodpanda', 'ubereats', '飲食費'] },
    { name: '交通', colorVar: '--series-2', keywords: ['捷運', '公車', '計程車', 'uber', '加油', '停車', '高鐵', '台鐵', '悠遊卡', '機車', '油錢', '過路費', '停車費', '火車', '客運', '交通費'] },
    { name: '購物', colorVar: '--series-3', keywords: ['網購', '蝦皮', 'momo', '衣服', '鞋子', '日用品', '大賣場', 'costco', '好市多', '家樂福', '全聯', '寶雅', '無印良品', 'ikea', '購物', '美容'] },
    { name: '娛樂', colorVar: '--series-4', keywords: ['電影', '遊戲', 'ktv', '唱歌', '旅遊', '訂閱', 'netflix', 'spotify', 'disney', '展覽', '演唱會', '娛樂費', '訂閱類娛樂費', '旅遊費'] },
    { name: '居家', colorVar: '--series-5', keywords: ['房租', '水電', '瓦斯', '網路費', '管理費', '家具', '電費', '水費', '房貸', '水電費', '電話費', '房費', '家庭開銷'] },
    { name: '醫療', colorVar: '--series-6', keywords: ['藥局', '醫院', '診所', '健保', '掛號費', '牙醫', '眼科', '醫療費'] },
    { name: '教育', colorVar: '--series-7', keywords: ['學費', '書籍', '課程', '補習', '文具', '教材', '教育費'] },
    { name: '其他', colorVar: '--series-8', keywords: [], fallback: true }
  ];
  var DEFAULT_INCOME_CATS = [
    { name: '薪資', colorVar: '--series-1', keywords: ['薪水', '薪資', '工資'] },
    { name: '獎金', colorVar: '--series-2', keywords: ['獎金', '紅包', '分紅'] },
    { name: '投資', colorVar: '--series-3', keywords: ['股息', '配息', '利息', '投資', '股票'] },
    { name: '其他收入', colorVar: '--series-4', keywords: [], fallback: true }
  ];

  // MoneyNote 匯出檔的分類名稱 -> 對應本 App 既有分類（真的是同一件事才合併，不是同一件事的一律保留原名各自成類）
  var MONEYNOTE_MERGE_MAP = {
    expense: {
      '飲食費': '餐飲', '交通費': '交通', '日用品': '購物', '衣服': '購物', '美容': '購物',
      '醫療費': '醫療', '教育費': '教育',
      '水電費': '居家', '電話費': '居家', '房費': '居家', '家庭開銷': '居家',
      '娛樂費': '娛樂', '訂閱類娛樂費': '娛樂', '旅遊費': '娛樂'
    },
    income: {
      '工資': '薪資', '零花錢': '其他收入', '副業': '其他收入', '臨時收入': '其他收入'
    }
  };
  // 沒有對應既有分類、會新建成獨立分類的項目，先給合理的關鍵字，別讓它空著
  var MONEYNOTE_NEW_CATEGORY_KEYWORDS = {
    '交際費': ['交際', '應酬', '聚餐', '禮金', '紅包', '送禮'],
    '煙酒': ['煙', '菸', '香菸', '酒', '啤酒', '紅酒', '威士忌', '檳榔']
  };

  // ---------- utils ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fromKey(key) { var p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function addMonths(d, n) { var r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
  function startOfWeek(d) { var r = new Date(d); r.setDate(r.getDate() - r.getDay()); r.setHours(0, 0, 0, 0); return r; }
  function endOfWeek(d) { return addDays(startOfWeek(d), 6); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function formatMoney(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function shortDate(d) { return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); }

  // ---------- state ----------
  var state = {
    records: [],
    categories: [],
    selectedDate: new Date(),
    period: 'day',
    addType: 'expense',
    chartType: 'expense',
    tempCategoryOverride: null,
    manualCategoryTouched: false,
    calendarMonth: new Date(),
    editingCategoryContext: 'expense',
    categoryPickContext: 'quickadd',
    editingRecordId: null,
    editRecordType: 'expense'
  };

  // ---------- storage ----------
  function loadCategories() {
    var raw = localStorage.getItem(STORAGE.categories);
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { /* fall through to defaults */ }
    }
    var cats = [];
    DEFAULT_EXPENSE_CATS.forEach(function (c) { cats.push(Object.assign({ id: uid(), type: 'expense' }, c)); });
    DEFAULT_INCOME_CATS.forEach(function (c) { cats.push(Object.assign({ id: uid(), type: 'income' }, c)); });
    localStorage.setItem(STORAGE.categories, JSON.stringify(cats));
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

  function diffAndPush(name, currentArr) {
    if (!cloudUser) return Promise.resolve();
    var lastArr = lastSynced[name];
    var lastById = {};
    (lastArr || []).forEach(function (x) { lastById[x.id] = x; });
    var currentById = {};
    currentArr.forEach(function (x) { currentById[x.id] = x; });
    var batch = writeBatch(db);
    var writes = 0;
    currentArr.forEach(function (item) {
      var prev = lastById[item.id];
      if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) {
        batch.set(doc(cloudCollection(name), item.id), item);
        writes++;
      }
    });
    (lastArr || []).forEach(function (item) {
      if (!currentById[item.id]) { batch.delete(doc(cloudCollection(name), item.id)); writes++; }
    });
    if (writes === 0) { lastSynced[name] = currentArr.map(function (x) { return Object.assign({}, x); }); return Promise.resolve(); }
    return batch.commit().then(function () {
      lastSynced[name] = currentArr.map(function (x) { return Object.assign({}, x); });
    });
  }
  function queueCloudSync(name) {
    if (!cloudUser || applyingRemoteChange) return;
    var arr = name === 'records' ? state.records : state.categories;
    diffAndPush(name, arr).catch(function (e) { console.error('cloud sync (' + name + ') failed', e); showToast('雲端同步失敗，稍後會自動重試'); });
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
      var cloudEmpty = results[0].empty && results[1].empty;
      var localHasData = state.records.length > 0 || state.categories.length > 0;
      if (!cloudEmpty || !localHasData) {
        startCloudListeners();
        return;
      }
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
      Promise.all([diffAndPush('categories', state.categories), diffAndPush('records', state.records)]).then(function () {
        showToast('已上傳到雲端');
        startCloudListeners();
      }).catch(function (e) {
        console.error('migration push failed', e);
        showToast('上傳雲端失敗，本機資料不受影響，可以到設定重新登入再試一次');
        signOut(auth);
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
  function getRange() {
    var d = state.selectedDate;
    if (state.period === 'day') return [d, d];
    if (state.period === 'week') return [startOfWeek(d), endOfWeek(d)];
    return [startOfMonth(d), endOfMonth(d)];
  }
  function filteredRecords() {
    var range = getRange();
    var startKey = toKey(range[0]), endKey = toKey(range[1]);
    return state.records.filter(function (r) { return r.date >= startKey && r.date <= endKey; })
      .sort(function (a, b) { return a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1); });
  }
  function periodLabelText() {
    var d = state.selectedDate;
    if (state.period === 'day') return isSameDay(d, new Date()) ? '今天 ' + shortDate(d) : shortDate(d) + ' (' + WEEKDAY[d.getDay()] + ')';
    if (state.period === 'week') { var r = getRange(); return shortDate(r[0]) + ' - ' + shortDate(r[1]); }
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  }

  // ---------- DOM refs ----------
  var els = {};
  function cacheEls() {
    ['themeToggleBtn', 'settingsBtn', 'datePrevBtn', 'dateDisplayBtn', 'dateDisplayText', 'dateNextBtn', 'todayBtn',
      'calendarPopup', 'calPrevMonth', 'calNextMonth', 'calMonthLabel', 'calendarGrid', 'periodTabs',
      'periodRangeLabel', 'statExpense', 'statIncome', 'statBalance', 'pieChart', 'chartEmpty', 'chartLegend',
      'quickAddForm', 'quickInput', 'addBtn', 'parsePreview', 'parseAmount', 'parseNote', 'parseCategoryChip',
      'advancedToggle', 'advancedFields', 'manualCategory', 'manualAmount', 'manualNote',
      'categoryPickSheet', 'categoryPickBackdrop', 'categoryPickGrid', 'categoryPickClose',
      'recordsList', 'exportBtn', 'settingsSheet', 'settingsBackdrop', 'settingsCloseBtn', 'categoryEditList',
      'addCategoryBtn', 'settingsExportBtn', 'importFileInput', 'resetDataBtn', 'toast',
      'editRecordSheet', 'editRecordBackdrop', 'editRecordCloseBtn', 'editDate', 'editCategory',
      'editAmount', 'editNote', 'editDeleteBtn', 'editSaveBtn',
      'mergeCategorySheet', 'mergeCategoryBackdrop', 'mergeCategoryTitle', 'mergeCategoryGrid', 'mergeCategoryCancel',
      'authSignedOut', 'authSignedIn', 'authEmail', 'googleSignInBtn', 'signOutBtn',
      'currentVersionTag', 'changelogBtn', 'changelogSheet', 'changelogBackdrop', 'changelogCloseBtn', 'changelogList'
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
      var len = Math.max(frac * circumference - gap, 0);
      var circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
      circle.setAttribute('fill', 'none');
      circle.style.stroke = 'var(' + seg.colorVar + ')';
      circle.setAttribute('stroke-width', sw);
      circle.setAttribute('stroke-dasharray', len + ' ' + (circumference - len));
      circle.setAttribute('stroke-dashoffset', String(-offset));
      circle.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
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
  function renderSummary() {
    var recs = filteredRecords();
    var totalExpense = 0, totalIncome = 0;
    recs.forEach(function (r) { if (r.type === 'expense') totalExpense += r.amount; else totalIncome += r.amount; });
    els.statExpense.textContent = formatMoney(totalExpense);
    els.statIncome.textContent = formatMoney(totalIncome);
    els.statBalance.textContent = formatMoney(totalIncome - totalExpense);
    els.periodRangeLabel.textContent = periodLabelText();
    document.querySelector('.records-head h2').textContent = '紀錄・' + periodLabelText();

    var byCat = {};
    recs.forEach(function (r) {
      if (r.type !== state.chartType) return;
      byCat[r.categoryId] = (byCat[r.categoryId] || 0) + r.amount;
    });
    var data = Object.keys(byCat).map(function (id) {
      var cat = findCat(id);
      return { name: cat ? cat.name : '（已刪除分類）', colorVar: cat ? cat.colorVar : '--series-8', value: byCat[id] };
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
        '<span class="pct">' + pct + '%</span>';
      els.chartLegend.appendChild(li);
    });
  }

  // ---------- render: records list ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function renderRecordsList() {
    var recs = filteredRecords();
    els.recordsList.innerHTML = '';
    if (!recs.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-msg';
      empty.textContent = '這段期間還沒有紀錄，開始記一筆吧！';
      els.recordsList.appendChild(empty);
      return;
    }
    var lastDateKey = null;
    recs.forEach(function (r) {
      if (state.period !== 'day' && r.date !== lastDateKey) {
        lastDateKey = r.date;
        var label = document.createElement('div');
        label.className = 'day-group-label';
        var dObj = fromKey(r.date);
        label.textContent = isSameDay(dObj, new Date()) ? ('今天 ' + shortDate(dObj)) : (shortDate(dObj) + ' (' + WEEKDAY[dObj.getDay()] + ')');
        els.recordsList.appendChild(label);
      }
      var cat = findCat(r.categoryId);
      var row = document.createElement('div');
      row.className = 'record-row';
      row.innerHTML =
        '<span class="record-dot" style="background:var(' + (cat ? cat.colorVar : '--series-8') + ')"></span>' +
        '<span class="record-main">' +
          '<div class="record-cat">' + escapeHtml(cat ? cat.name : '（已刪除分類）') + '</div>' +
          (r.note ? '<div class="record-note">' + escapeHtml(r.note) + '</div>' : '') +
        '</span>' +
        '<span class="record-amt ' + r.type + '">' + (r.type === 'expense' ? '-' : '+') + formatMoney(r.amount).replace('-', '') + '</span>' +
        '<span class="record-chevron">›</span>' +
        '<button type="button" class="record-del" aria-label="刪除">✕</button>';
      row.querySelector('.record-del').addEventListener('click', function (e) {
        e.stopPropagation();
        var label = (cat ? cat.name : '') + ' ' + formatMoney(r.amount);
        if (window.confirm('刪除這筆紀錄？\n' + label)) {
          state.records = state.records.filter(function (x) { return x.id !== r.id; });
          saveRecords();
          renderAll();
        }
      });
      row.addEventListener('click', function () { openEditRecord(r.id); });
      els.recordsList.appendChild(row);
    });
  }

  // ---------- render: quick-add preview ----------
  function updateQuickPreview() {
    var val = els.quickInput.value;
    var parsed = parseQuickInput(val);
    if (!val.trim()) {
      els.parsePreview.classList.add('hidden');
      if (!state.manualCategoryTouched) state.tempCategoryOverride = null;
      syncManualCategorySelect();
      return;
    }
    els.parsePreview.classList.remove('hidden');
    els.parseAmount.textContent = parsed.amount != null ? formatMoney(parsed.amount) : '尚未偵測到金額';
    els.parseNote.textContent = parsed.note || '（無備註）';
    var cat = effectiveCategory();
    els.parseCategoryChip.textContent = cat.name;
    els.parseCategoryChip.style.background = 'var(' + cat.colorVar + ')';
    syncManualCategorySelect();
  }
  function syncManualCategorySelect() {
    var cat = effectiveCategory();
    if (els.manualCategory.value !== cat.id) els.manualCategory.value = cat.id;
  }
  function populateManualCategorySelect() {
    var cats = catsOfType(state.addType);
    els.manualCategory.innerHTML = cats.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; }).join('');
    syncManualCategorySelect();
  }

  // ---------- category pick sheet ----------
  function openCategoryPick(context) {
    state.categoryPickContext = context;
    var cats = catsOfType(state.addType);
    var current = effectiveCategory();
    els.categoryPickGrid.innerHTML = '';
    cats.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      if (c.id === current.id) btn.classList.add('selected');
      btn.innerHTML = '<span class="dot" style="background:var(' + c.colorVar + ')"></span><span>' + escapeHtml(c.name) + '</span>';
      btn.addEventListener('click', function () {
        state.tempCategoryOverride = c.id;
        state.manualCategoryTouched = true;
        els.categoryPickSheet.classList.add('hidden');
        updateQuickPreview();
      });
      els.categoryPickGrid.appendChild(btn);
    });
    els.categoryPickSheet.classList.remove('hidden');
  }

  // ---------- edit record ----------
  function populateEditCategorySelect(type, selectedId) {
    var cats = catsOfType(type);
    els.editCategory.innerHTML = cats.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; }).join('');
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
    els.editAmount.value = r.amount;
    els.editNote.value = r.note || '';
    els.editRecordSheet.classList.remove('hidden');
  }
  function closeEditRecord() { els.editRecordSheet.classList.add('hidden'); state.editingRecordId = null; }

  // ---------- settings: category management ----------
  function openMergeCategorySheet(c, siblings) {
    els.mergeCategoryTitle.textContent = '刪除「' + c.name + '」— 紀錄要轉移到哪個分類？';
    els.mergeCategoryGrid.innerHTML = '';
    siblings.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<span class="dot" style="background:var(' + s.colorVar + ')"></span><span>' + escapeHtml(s.name) + (s.fallback ? '（收容分類）' : '') + '</span>';
      btn.addEventListener('click', function () { mergeDeleteCategory(c, s); });
      els.mergeCategoryGrid.appendChild(btn);
    });
    els.mergeCategorySheet.classList.remove('hidden');
  }
  function mergeDeleteCategory(c, target) {
    if (!window.confirm('刪除「' + c.name + '」，紀錄轉移到「' + target.name + '」？')) return;
    if (c.fallback) target.fallback = true;
    state.records.forEach(function (r) { if (r.categoryId === c.id) r.categoryId = target.id; });
    state.categories = state.categories.filter(function (x) { return x.id !== c.id; });
    saveCategories(); saveRecords();
    els.mergeCategorySheet.classList.add('hidden');
    renderCategoryEditList();
    renderAll();
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

      var nameInput = item.querySelector('input');
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
  function parseCsvLine(line) {
    var out = [], cur = '', inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }
  function findOrCreateCategoryByName(type, name, keywordsIfCreated) {
    var cat = state.categories.find(function (c) { return c.type === type && c.name === name; });
    if (!cat) {
      cat = { id: uid(), type: type, name: name || (type === 'expense' ? '其他' : '其他收入'), colorVar: nextColorVar(type), keywords: keywordsIfCreated ? keywordsIfCreated.slice() : [], fallback: false };
      state.categories.push(cat);
    }
    return cat;
  }
  function normalizeImportDate(str) {
    str = (str || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    var m = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) return m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
    return null;
  }
  function importOwnFormatCsv(lines) {
    var count = 0;
    for (var i = 1; i < lines.length; i++) {
      var cols = parseCsvLine(lines[i]);
      var date = normalizeImportDate(cols[0]);
      var type = cols[1], catName = cols[2], amount = parseFloat(cols[3]), note = cols[4] || '';
      if (!date || (type !== 'expense' && type !== 'income') || isNaN(amount)) continue;
      var cat = findOrCreateCategoryByName(type, catName);
      state.records.push({ id: uid(), date: date, type: type, categoryId: cat.id, amount: amount, note: note, createdAt: Date.now() });
      count++;
    }
    return count;
  }
  // "MoneyNote" app export: multiple #SECTION blocks in one file. We only need
  // #DAILY_DATAS (the transactions) and #CATEGORIES (numeric categoryId -> name/type).
  function importMoneyNoteCsv(lines) {
    var dailyStart = -1, catStart = -1;
    lines.forEach(function (line, idx) {
      var t = line.trim();
      if (t === '#DAILY_DATAS') dailyStart = idx;
      else if (t === '#CATEGORIES') catStart = idx;
    });
    var categoryMap = {};
    if (catStart >= 0) {
      for (var j = catStart + 2; j < lines.length; j++) {
        var cline = lines[j];
        if (!cline || !cline.trim() || cline.trim().charAt(0) === '#') break;
        var ccols = parseCsvLine(cline);
        if (!ccols[0]) continue;
        categoryMap[ccols[0]] = { name: ccols[1], type: ccols[4] === '1' ? 'income' : 'expense' };
      }
    }
    var count = 0;
    if (dailyStart >= 0) {
      for (var k = dailyStart + 2; k < lines.length; k++) {
        var dline = lines[k];
        if (!dline || !dline.trim() || dline.trim().charAt(0) === '#') break;
        var dcols = parseCsvLine(dline);
        var date = normalizeImportDate(dcols[0]);
        var amount = parseFloat(dcols[1]);
        var typeCode = dcols[4];
        if (!date || isNaN(amount) || (typeCode !== '0' && typeCode !== '1')) continue;
        var type = typeCode === '1' ? 'income' : 'expense';
        var info = categoryMap[dcols[3]];
        var rawName = info ? info.name : null;
        var mergedName = rawName && MONEYNOTE_MERGE_MAP[type][rawName];
        var cat = findOrCreateCategoryByName(type, mergedName || rawName, MONEYNOTE_NEW_CATEGORY_KEYWORDS[rawName]);
        var createdAtMs = Date.parse(dcols[5]);
        state.records.push({
          id: uid(), date: date, type: type, categoryId: cat.id, amount: amount,
          note: (dcols[2] || '').replace(/\\n/g, ' ').trim(),
          createdAt: isNaN(createdAtMs) ? Date.now() : createdAtMs
        });
        count++;
      }
    }
    return count;
  }
  function importCsv(text) {
    var normalized = text.replace(/^﻿/, '');
    var lines = normalized.split(/\r?\n/);
    var count = /^#DAILY_DATAS\s*$/m.test(normalized)
      ? importMoneyNoteCsv(lines)
      : importOwnFormatCsv(lines.filter(function (l) { return l.trim(); }));
    saveCategories(); saveRecords();
    return count;
  }

  // ---------- toast ----------
  var toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 1800);
  }

  // ---------- master render ----------
  function renderAll() {
    renderDateBar();
    renderSummary();
    renderRecordsList();
    populateManualCategorySelect();
    updateQuickPreview();
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

    Array.prototype.forEach.call(document.querySelectorAll('.chart-toggle-btn'), function (btn) {
      btn.addEventListener('click', function () {
        state.chartType = btn.dataset.chartType;
        Array.prototype.forEach.call(document.querySelectorAll('.chart-toggle-btn'), function (b) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        renderSummary();
      });
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
        populateManualCategorySelect();
        updateQuickPreview();
      });
    });

    els.quickInput.addEventListener('input', function () {
      state.manualCategoryTouched = false;
      state.tempCategoryOverride = null;
      updateQuickPreview();
    });
    els.parseCategoryChip.addEventListener('click', function () { openCategoryPick('quickadd'); });
    els.manualCategory.addEventListener('change', function () {
      state.tempCategoryOverride = els.manualCategory.value;
      state.manualCategoryTouched = true;
      updateQuickPreview();
    });
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
      if (!amount || amount <= 0) { showToast('請輸入有效金額'); els.editAmount.focus(); return; }
      var dateVal = els.editDate.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) { showToast('請選擇日期'); return; }
      r.type = state.editRecordType;
      r.date = dateVal;
      r.categoryId = els.editCategory.value;
      r.amount = amount;
      r.note = els.editNote.value.trim();
      saveRecords();
      closeEditRecord();
      renderAll();
      showToast('已更新紀錄');
    });
    els.editDeleteBtn.addEventListener('click', function () {
      var r = state.records.find(function (x) { return x.id === state.editingRecordId; });
      if (!r) return;
      var cat = findCat(r.categoryId);
      if (!window.confirm('刪除這筆紀錄？\n' + (cat ? cat.name : '') + ' ' + formatMoney(r.amount))) return;
      state.records = state.records.filter(function (x) { return x.id !== r.id; });
      saveRecords();
      closeEditRecord();
      renderAll();
      showToast('已刪除');
    });

    els.quickAddForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var parsed = parseQuickInput(els.quickInput.value);
      var amount = parsed.amount;
      var note = parsed.note;
      var manualAmt = parseFloat(els.manualAmount.value);
      if (!isNaN(manualAmt) && manualAmt > 0) amount = manualAmt;
      if (els.manualNote.value.trim()) note = els.manualNote.value.trim();
      if (!amount || amount <= 0) { showToast('請輸入有效金額'); els.quickInput.focus(); return; }
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
        var count = importCsv(String(reader.result));
        showToast('已匯入 ' + count + ' 筆紀錄');
        renderCategoryEditList();
        renderAll();
        els.importFileInput.value = '';
      };
      reader.readAsText(file, 'UTF-8');
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
        Promise.all([diffAndPush('records', []), diffAndPush('categories', [])]).then(afterClear).catch(afterClear);
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
      state.editingCategoryContext = state.addType;
      Array.prototype.forEach.call(document.querySelectorAll('.type-toggle-btn[data-settype]'), function (b) {
        b.classList.toggle('active', b.dataset.settype === state.editingCategoryContext);
      });
      renderCategoryEditList();
      els.settingsSheet.classList.remove('hidden');
    });
    els.settingsCloseBtn.addEventListener('click', function () { els.settingsSheet.classList.add('hidden'); });
    els.settingsBackdrop.addEventListener('click', function () { els.settingsSheet.classList.add('hidden'); });

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
      var cat = { id: uid(), type: state.editingCategoryContext, name: '新分類', colorVar: nextColorVar(state.editingCategoryContext), keywords: [], fallback: false };
      state.categories.push(cat);
      saveCategories();
      renderCategoryEditList();
      var inputs = els.categoryEditList.querySelectorAll('.category-edit-item-head input[type="text"]');
      var last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });
  }

  // ---------- init ----------
  function init() {
    cacheEls();
    var savedTheme = localStorage.getItem(STORAGE.theme);
    if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    state.categories = loadCategories();
    state.records = loadRecords();
    populateManualCategorySelect();
    bindEvents();
    renderAll();
    renderChangelog();
    initCloudSync();

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
