// 設定頁：分類管理（新增/改名/改圖示/改顏色/刪除/合併）、清理重複分類、重新套用關鍵字分類。
// 跟 sync.js 一樣，透過 initSettingsModule() 從 app.js 注入需要的協作者，自己不 import
// app.js，依賴方向維持單向，避免循環依賴。escapeHtml/formatMoney 是中立的共用工具，
// 直接從 utils.js import，不需要繞經 app.js。
import { escapeHtml, formatMoney } from './utils.js';

var deps = null;
// { state, els, saveRecords, saveCategories, renderAll, showToast,
//   catsOfType, findCat, fallbackCat, guessCategory, catDisplayName,
//   SERIES_SLOTS, PASTEL_SLOTS }（initSettingsModule 注入）

// ---------- settings: category management ----------
// 刪除分類的共用邏輯：target 有給就把紀錄轉過去（順便處理收容分類遞補），
// target 是 null 代表這個分類底下本來就沒有任何紀錄，直接刪除即可。
function performCategoryDelete(c, target) {
  if (target) {
    if (c.fallback) target.fallback = true;
    deps.state.records.forEach(function (r) { if (r.categoryId === c.id) r.categoryId = target.id; });
    deps.saveRecords();
  }
  deps.state.categories = deps.state.categories.filter(function (x) { return x.id !== c.id; });
  deps.saveCategories();
  deps.els.mergeCategorySheet.classList.add('hidden');
  renderCategoryEditList();
  deps.renderAll();
}
function openMergeCategorySheet(c, siblings) {
  deps.els.mergeCategoryTitle.textContent = '刪除「' + c.name + '」— 紀錄要轉移到哪個分類？';
  deps.els.mergeCategoryGrid.innerHTML = '';
  siblings.forEach(function (s) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<span class="dot" style="background:var(' + s.colorVar + ')"></span><span>' + escapeHtml(deps.catDisplayName(s)) + (s.fallback ? '（收容分類）' : '') + '</span>';
    btn.addEventListener('click', function () { mergeDeleteCategory(c, s); });
    deps.els.mergeCategoryGrid.appendChild(btn);
  });

  // 不想被迫挑一個轉移目標時（常見情境：手滑多新增了一個空分類）可以直接用這個按鈕跳過選擇。
  // 如果底下真的還有紀錄，不能讓它們憑空變成指不到任何分類，所以自動歸到收容分類，
  // 但文案講清楚會歸去哪裡，不是完全沒交代就消失。
  var recordCount = deps.state.records.filter(function (r) { return r.categoryId === c.id; }).length;
  if (recordCount === 0) {
    deps.els.mergeCategoryNoMergeBtn.textContent = '不指定分類，直接刪除';
  } else {
    var autoTarget = c.fallback ? siblings[0] : deps.fallbackCat(c.type);
    deps.els.mergeCategoryNoMergeBtn.textContent = '不指定分類（' + recordCount + ' 筆紀錄自動歸到「' + deps.catDisplayName(autoTarget) + '」）';
  }
  deps.els.mergeCategoryNoMergeBtn.onclick = function () { deleteCategoryNoMerge(c, siblings, recordCount); };

  deps.els.mergeCategorySheet.classList.remove('hidden');
}
function mergeDeleteCategory(c, target) {
  if (!window.confirm('刪除「' + c.name + '」，紀錄轉移到「' + target.name + '」？')) return;
  performCategoryDelete(c, target);
}
function deleteCategoryNoMerge(c, siblings, recordCount) {
  if (recordCount === 0) {
    performCategoryDelete(c, null);
    deps.showToast('已刪除「' + c.name + '」');
    return;
  }
  var autoTarget = c.fallback ? siblings[0] : deps.fallbackCat(c.type);
  if (!window.confirm('刪除「' + c.name + '」，底下 ' + recordCount + ' 筆紀錄會自動歸到「' + autoTarget.name + '」，確定嗎？')) return;
  performCategoryDelete(c, autoTarget);
}
function swatchGroupHtml(slots, selectedColorVar) {
  return slots.map(function (v) {
    return '<button type="button" class="color-swatch' + (v === selectedColorVar ? ' selected' : '') + '" data-color="' + v + '" style="background:var(' + v + ')" aria-label="選擇這個顏色"></button>';
  }).join('');
}
export function renderCategoryEditList() {
  var cats = deps.catsOfType(deps.state.editingCategoryContext);
  deps.els.categoryEditList.innerHTML = '';
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
        '<div class="swatch-group">' + swatchGroupHtml(deps.SERIES_SLOTS, c.colorVar) + '</div>' +
        '<p class="swatch-group-label">淺色</p>' +
        '<div class="swatch-group">' + swatchGroupHtml(deps.PASTEL_SLOTS, c.colorVar) + '</div>' +
      '</div>' +
      '<p class="kw-label">自動分類關鍵字（用逗號分隔）</p>' +
      '<textarea>' + escapeHtml(c.keywords.join('、')) + '</textarea>';

    var iconInput = item.querySelector('.icon-input');
    iconInput.addEventListener('change', function () {
      c.icon = iconInput.value.trim().slice(0, 4);
      deps.saveCategories();
      deps.renderAll();
    });
    var nameInput = item.querySelector('.category-edit-item-head input[type="text"]:not(.icon-input)');
    nameInput.addEventListener('change', function () {
      c.name = nameInput.value.trim() || c.name;
      deps.saveCategories();
      deps.renderAll();
    });
    var kwArea = item.querySelector('textarea');
    kwArea.addEventListener('change', function () {
      c.keywords = kwArea.value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean);
      deps.saveCategories();
    });

    var dotBtn = item.querySelector('.color-dot-btn');
    var swatchRow = item.querySelector('.color-swatch-row');
    dotBtn.addEventListener('click', function () { swatchRow.classList.toggle('hidden'); });
    Array.prototype.forEach.call(item.querySelectorAll('.color-swatch'), function (sw) {
      sw.addEventListener('click', function () {
        c.colorVar = sw.dataset.color;
        deps.saveCategories();
        renderCategoryEditList();
        deps.renderAll();
      });
    });

    item.querySelector('.del-cat-btn').addEventListener('click', function () {
      var siblings = deps.catsOfType(c.type).filter(function (x) { return x.id !== c.id; });
      if (siblings.length === 0) { deps.showToast('至少需保留一個分類'); return; }
      openMergeCategorySheet(c, siblings);
    });

    deps.els.categoryEditList.appendChild(item);
  });
}

// ---------- settings: 清理重複分類 ----------
// 修好 handleSignedIn 的 id 校正 bug 只能擋「以後」不再新增重複，已經在雲端/本機累積出來的
// 重複分類殼（同 type+name、不同 id）需要這個工具一次清掉：同一組裡優先保留有設定圖示的，
// 其餘的紀錄併過去、分類殼刪除。跟既有的「刪除分類→挑合併目標」是同一套資料處理邏輯，
// 只是這裡自動判斷該併去哪一筆、一次處理所有重複組，不用一組一組手動點。
export function cleanupDuplicateCategories() {
  var groups = {};
  deps.state.categories.forEach(function (c) {
    var key = c.type + '::' + c.name;
    (groups[key] = groups[key] || []).push(c);
  });
  var dupGroups = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length > 1; });
  if (dupGroups.length === 0) { deps.showToast('沒有偵測到重複分類'); return; }

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
      deps.state.records.forEach(function (r) { if (r.categoryId === c.id) r.categoryId = keeper.id; });
    });
  });
  deps.state.categories = deps.state.categories.filter(function (c) { return !removedIds[c.id]; });
  deps.saveCategories(); deps.saveRecords();
  renderCategoryEditList();
  deps.renderAll();
  deps.showToast('已合併 ' + dupGroups.length + ' 組重複分類');
}

// ---------- settings: 重新套用關鍵字分類 ----------
// 用途：例如新增了「訂閱費」分類後，舊紀錄還留在當初記帳時唯一能對到的「娛樂」裡，
// 不會自動回溯改分類。這裡讓使用者挑一個來源分類，對它底下每筆紀錄重新跑一次跟
// 快速輸入同一套的 guessCategory() 判斷，列出「建議」跟現在不同的紀錄給使用者勾選
// 確認後才搬移，不會自動全部套用，避免誤搬。
export function renderReclassifySourceOptions() {
  var cats = deps.catsOfType(deps.state.reclassifyType);
  deps.els.reclassifySourceSelect.innerHTML = cats.map(function (c) {
    return '<option value="' + c.id + '">' + escapeHtml(deps.catDisplayName(c)) + '</option>';
  }).join('');
  if (cats.length) deps.els.reclassifySourceSelect.value = cats[0].id;
}
export function renderReclassifyPreview() {
  var sourceId = deps.els.reclassifySourceSelect.value;
  var sourceCat = deps.findCat(sourceId);
  var preview = [];
  if (sourceCat) {
    deps.state.records.forEach(function (r) {
      if (r.categoryId !== sourceId || r.type !== deps.state.reclassifyType) return;
      var suggestion = deps.guessCategory(r.note, r.type);
      if (suggestion && suggestion.id !== sourceId) preview.push({ record: r, suggestion: suggestion });
    });
    preview.sort(function (a, b) { return (b.record.createdAt || 0) - (a.record.createdAt || 0); });
  }
  deps.state.reclassifyPreview = preview;

  deps.els.reclassifyPreviewList.innerHTML = '';
  var hasItems = preview.length > 0;
  deps.els.reclassifyEmptyHint.classList.toggle('hidden', hasItems);
  deps.els.reclassifySelectAllRow.classList.toggle('hidden', !hasItems);
  deps.els.reclassifyApplyBtn.classList.toggle('hidden', !hasItems);
  deps.els.reclassifySelectAllCheckbox.checked = true;

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
      '<span class="reclassify-item-arrow">→ ' + escapeHtml(deps.catDisplayName(item.suggestion)) + '</span>';
    row.querySelector('.reclassify-item-check').addEventListener('change', updateReclassifyCountLabel);
    deps.els.reclassifyPreviewList.appendChild(row);
  });
  updateReclassifyCountLabel();
}
export function updateReclassifyCountLabel() {
  var boxes = deps.els.reclassifyPreviewList.querySelectorAll('.reclassify-item-check');
  var checked = Array.prototype.filter.call(boxes, function (b) { return b.checked; }).length;
  deps.els.reclassifyCountLabel.textContent = '全選（共 ' + boxes.length + ' 筆建議變動，已勾選 ' + checked + ' 筆）';
  deps.els.reclassifySelectAllCheckbox.checked = boxes.length > 0 && checked === boxes.length;
}
export function openReclassifySheet() {
  deps.state.reclassifyType = 'expense';
  Array.prototype.forEach.call(deps.els.reclassifyTypeToggle.querySelectorAll('.type-toggle-btn'), function (b) {
    b.classList.toggle('active', b.dataset.rtype === 'expense');
  });
  renderReclassifySourceOptions();
  renderReclassifyPreview();
  deps.els.reclassifySheet.classList.remove('hidden');
}
export function closeReclassifySheet() { deps.els.reclassifySheet.classList.add('hidden'); }
export function applyReclassify() {
  var boxes = deps.els.reclassifyPreviewList.querySelectorAll('.reclassify-item-check');
  var count = 0;
  Array.prototype.forEach.call(boxes, function (b) {
    if (!b.checked) return;
    var item = deps.state.reclassifyPreview[Number(b.dataset.idx)];
    if (!item) return;
    item.record.categoryId = item.suggestion.id;
    count++;
  });
  if (count === 0) { deps.showToast('沒有勾選任何紀錄'); return; }
  deps.saveRecords();
  deps.renderAll();
  deps.showToast('已更新 ' + count + ' 筆紀錄的分類');
  renderReclassifyPreview();
}

// app.js 的 init() 呼叫一次，注入需要的協作者：
// { state, els, saveRecords, saveCategories, renderAll, showToast,
//   catsOfType, findCat, fallbackCat, guessCategory, catDisplayName, SERIES_SLOTS, PASTEL_SLOTS }
export function initSettingsModule(setupDeps) {
  deps = setupDeps;
}
