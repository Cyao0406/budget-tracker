import {
  WEEKDAY, uid, debounce, pad2, toKey, fromKey, addDays, addMonths, addYears,
  startOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear,
  isSameDay, formatMoney, shortDate, formatTime, escapeHtml
} from './utils.js';
import { stageImportCsv } from './csv.js';
import { CURRENT_VERSION, CHANGELOG } from './changelog-data.js';
import {
  cloudUser, enqueueSync, diffAndPush, queueCloudSync, initCloudSync, signInGoogle, signOutCloud
} from './sync.js';
import {
  renderCategoryEditList, cleanupDuplicateCategories, openReclassifySheet, closeReclassifySheet,
  applyReclassify, renderReclassifySourceOptions, renderReclassifyPreview, updateReclassifyCountLabel,
  initSettingsModule
} from './settings.js';

(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
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
      signInGoogle().catch(function (e) {
        showToast('登入失敗：' + (e && e.message ? e.message : '未知錯誤'));
      });
    });
    els.signOutBtn.addEventListener('click', function () {
      // 登出後直接整頁重整：保證畫面狀態一定是乾淨的，不會有「登出了但畫面/記憶體裡
      // 還殘留雲端帳號資料」這種曖昧狀態，跟「清除所有資料」用同一個防禦邏輯。
      signOutCloud().finally(function () { location.reload(); });
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
    initCloudSync({ state: state, els: els, STORAGE: STORAGE, showToast: showToast, renderAll: renderAll, categoriesFreshlySeeded: categoriesFreshlySeeded });
    initSettingsModule({
      state: state, els: els, saveRecords: saveRecords, saveCategories: saveCategories, renderAll: renderAll, showToast: showToast,
      catsOfType: catsOfType, findCat: findCat, fallbackCat: fallbackCat, guessCategory: guessCategory, catDisplayName: catDisplayName,
      SERIES_SLOTS: SERIES_SLOTS, PASTEL_SLOTS: PASTEL_SLOTS
    });

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
