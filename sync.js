// 雲端同步 + Google 登入/登出（Firebase Auth + Firestore）。這個模組自己 import
// firebase-config.js，不 import app.js——依賴方向維持單向（app.js 是總機，import 這個模組；
//這個模組不反過來 import app.js），避免循環依賴。app.js 需要的 state/els/STORAGE/showToast/
// renderAll 這幾個協作者，透過 initCloudSync() 呼叫時當參數注入，不是用 import 硬綁。
import {
  auth, db, googleProvider,
  signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged,
  collection, doc, onSnapshot, writeBatch, getDocs
} from './firebase-config.js';

// 設計原則：localStorage 永遠是「畫面立刻看到」的來源，雲端只是背景同步層。
// 沒登入時完全不受影響，行為跟純單機版一模一樣。
export var cloudUser = null;
var deps = null; // { state, els, STORAGE, showToast, renderAll, categoriesFreshlySeeded }（initCloudSync 注入）
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
export function commitWritesInChunks(name, writes) {
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
export function diffAndPush(name, currentArr) {
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
export function enqueueSync(name, taskFn) {
  syncQueue[name] = syncQueue[name].catch(function () {}).then(taskFn);
  return syncQueue[name];
}
export function queueCloudSync(name) {
  if (!cloudUser || applyingRemoteChange) return;
  enqueueSync(name, function () {
    if (!cloudUser || applyingRemoteChange) return;
    var arr = name === 'records' ? deps.state.records : deps.state.categories;
    return diffAndPush(name, arr).catch(function (e) { console.error('cloud sync (' + name + ') failed', e); deps.showToast('雲端同步失敗，稍後會自動重試'); });
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
      if (name === 'records') deps.state.records = arr; else deps.state.categories = arr;
      lastSynced[name] = arr.map(function (x) { return Object.assign({}, x); });
      localStorage.setItem(name === 'records' ? deps.STORAGE.records : deps.STORAGE.categories, JSON.stringify(arr));
      applyingRemoteChange = false;
      deps.renderAll();
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
  if (!deps.els.authSignedOut) return;
  deps.els.authSignedOut.classList.toggle('hidden', !!cloudUser);
  deps.els.authSignedIn.classList.toggle('hidden', !cloudUser);
  if (cloudUser) deps.els.authEmail.textContent = cloudUser.email || cloudUser.displayName || '（已登入）';
}

// 應用層再多一道防線：不管 Google OAuth 同意畫面那邊的「測試中」限制實際上是否有正確擋人，
// 這裡直接白名單擋掉非本人帳號，登入後立刻自動登出，不會進到搬遷/同步流程。
var ALLOWED_CLOUD_EMAILS = ['dogd989312@gmail.com', 'yinrongyao84@gmail.com'];
function handleSignedIn(user) {
  if (user.email && ALLOWED_CLOUD_EMAILS.indexOf(user.email.toLowerCase()) === -1) {
    deps.showToast('這個帳號不是授權帳號，已自動登出');
    signOut(auth);
    return;
  }
  cloudUser = user;
  renderAuthUi();
  Promise.all([getDocs(cloudCollection('records')), getDocs(cloudCollection('categories'))]).then(function (results) {
    var cloudRecords = []; results[0].forEach(function (d) { cloudRecords.push(d.data()); });
    var cloudCategories = []; results[1].forEach(function (d) { cloudCategories.push(d.data()); });
    var cloudEmpty = cloudRecords.length === 0 && cloudCategories.length === 0;
    var localHasData = deps.state.records.length > 0 || deps.state.categories.length > 0;

    if (cloudEmpty && localHasData) {
      // 第一次搬遷：雲端這個帳號完全是空的、本機卻有資料，問過使用者才動作，
      // 而且搬遷寫入要「等完成」才開始掛 listener，避免上面註解講的競速問題。
      var ok = window.confirm(
        '偵測到這台裝置有 ' + deps.state.records.length + ' 筆本機紀錄，要上傳到雲端帳號嗎？\n\n' +
        '建議先按「取消」，到設定裡用「匯出 CSV」備份一份再回來重新登入觸發這個提示。\n' +
        '這個動作不會刪除本機資料，只是額外複製一份到雲端。'
      );
      if (!ok) {
        deps.showToast('已取消雲端同步');
        signOut(auth);
        return;
      }
      lastSynced.records = [];
      lastSynced.categories = [];
      Promise.all([
        enqueueSync('categories', function () { return diffAndPush('categories', deps.state.categories); }),
        enqueueSync('records', function () { return diffAndPush('records', deps.state.records); })
      ]).then(function () {
        deps.showToast('已上傳到雲端');
        startCloudListeners();
      }).catch(function (e) {
        console.error('migration push failed', e);
        deps.showToast('上傳雲端失敗，本機資料不受影響，可以到設定重新登入再試一次');
        signOut(auth);
      });
      return;
    }

    // 更直接的一道防線：如果這次開機的分類是冷啟動生成的預設值（無痕視窗、清過瀏覽器
    // 資料、全新裝置都會這樣），而這個雲端帳號本來就已經有自己的分類，代表這批預設分類
    // 只是這台裝置暫時性的初始值，不是使用者真的在這台裝置上做的自訂——直接採用雲端既有
    // 的分類，完全不要把預設值推上去，才不會疊出「App 預設 + 雲端原本」的重複。
    var skipCategoryPush = deps.categoriesFreshlySeeded && cloudCategories.length > 0;
    if (skipCategoryPush) {
      // 整批換成雲端分類之前，先把本機紀錄裡指向「即將被捨棄的本機分類 id」的 categoryId
      // 用 type+name 配對改成對應的雲端分類 id——不然這些紀錄會變成找不到分類的孤兒
      // （畫面上會顯示「已刪除分類」）。同名的分類接得上，本機真的有、雲端沒有同名對應的
      // 少數情況接不上，但至少不會不做這一步、讓原本接得上的也一起變孤兒。
      var cloudByKeyForSkip = {};
      cloudCategories.forEach(function (c) { cloudByKeyForSkip[c.type + '::' + c.name] = c; });
      deps.state.categories.forEach(function (localCat) {
        var match = cloudByKeyForSkip[localCat.type + '::' + localCat.name];
        if (match && match.id !== localCat.id) {
          deps.state.records.forEach(function (r) { if (r.categoryId === localCat.id) r.categoryId = match.id; });
        }
      });
      deps.state.categories = cloudCategories.map(function (c) { return Object.assign({}, c); });
      localStorage.setItem(deps.STORAGE.categories, JSON.stringify(deps.state.categories));
      localStorage.setItem(deps.STORAGE.records, JSON.stringify(deps.state.records));
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
    if (reconcileCategoryIdsWithCloud(deps.state.categories, cloudCategories, deps.state.records)) {
      localStorage.setItem(deps.STORAGE.categories, JSON.stringify(deps.state.categories));
      localStorage.setItem(deps.STORAGE.records, JSON.stringify(deps.state.records));
    }

    // 先把「登出狀態下這台裝置做的本機異動」推上去，才開始監聽——不然沒推上去的本機修改
    // （例如剛設定的分類 emoji、剛編輯的紀錄）會被下面 listener 收到的第一份雲端快照直接
    // 蓋掉，之前分類圖示登入後消失就是這個原因。這裡故意只做「新增/覆寫」，不做「刪除」：
    // 這個時間點沒辦法區分「本機沒有這筆是因為使用者在本機刪掉了」還是「這筆是別的裝置已經
    // 同步上去、這台裝置還沒同步到過」，誤判成前者去刪雲端資料的風險太高。真的在本機刪除的
    // 東西，listener 開始監聽後雲端版本會自動同步回本機——只是慢一輪生效，不是資料遺失。
    // 排進隊列的 task 要等輪到自己才執行，current 故意在 task 裡才去讀 deps.state.records/
    // deps.state.categories（不是呼叫當下就捕捉起來），這樣不管排隊等了多久，實際送出的一定是
    // 執行當下最新的資料，不會因為佇列裡排在前面的東西改了 state 而送出過期的內容。
    var pushLocalOnly = function (name, cloudArr) {
      return enqueueSync(name, function () {
        var current = name === 'records' ? deps.state.records : deps.state.categories;
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
    deps.showToast('連線雲端失敗，暫時以本機資料為準');
  });
}

// app.js 的 init() 呼叫一次，注入需要的協作者：
// { state, els, STORAGE, showToast, renderAll, categoriesFreshlySeeded }
export function initCloudSync(setupDeps) {
  deps = setupDeps;
  // 頁面從 Google 導回來後檢查一次 redirect 的結果，這裡才抓得到 redirect 流程本身的錯誤
  // （帳號被拒絕、網域未授權等）；正常登入成功與否還是看下面的 onAuthStateChanged。
  getRedirectResult(auth).catch(function (e) {
    console.error('redirect sign-in failed', e);
    deps.showToast('登入失敗：' + (e && e.message ? e.message : '未知錯誤'));
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

// 用 redirect 不用 popup：iOS Safari（尤其加到主畫面的 PWA 獨立模式）常常沒辦法讓
// 彈出視窗把登入結果傳回原頁面，畫面會卡一下然後跳回去、但沒有真的登入。redirect
// 是整頁導去 Google 再導回來，不依賴跳出視窗跟原頁面之間的溝通，比較穩。
export function signInGoogle() {
  return signInWithRedirect(auth, googleProvider);
}
// 登出後直接整頁重整：保證畫面狀態一定是乾淨的，不會有「登出了但畫面/記憶體裡
// 還殘留雲端帳號資料」這種曖昧狀態，跟「清除所有資料」用同一個防禦邏輯（呼叫端負責 reload）。
export function signOutCloud() {
  return signOut(auth);
}
