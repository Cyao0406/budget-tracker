// 用動態 import() 載入 Firebase SDK（而不是靜態 import），純粹是因為部分自動化測試環境對
// 「module script 裡直接 import 跨網域 URL」的處理比較怪；動態 import() 是標準 ES 語法，
// 在所有現代瀏覽器（含 iOS Safari）行為完全一樣，不是走偏門。
var FIREBASE_VERSION = '12.17.1';
var CDN = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';

var appMod = await import(CDN + 'firebase-app.js');
var authMod = await import(CDN + 'firebase-auth.js');
var fsMod = await import(CDN + 'firebase-firestore.js');

var isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

// 本機開發／測試一律連本機模擬器，用一個 demo- 開頭的假 project id 就好，
// 不需要真的 Firebase 專案、不需要登入 firebase CLI。
//
// 正式環境用的是使用者自己的 Firebase 專案 budget-tracker-8edd1（2026-08-12 用 firebase CLI
// 建立 web app 取得，見 firebase apps:sdkconfig）。這組值本來就是設計成可以放在前端程式碼裡
// 公開的，不是密碼——真正的存取控制在 firestore.rules。
var firebaseConfig = isLocalDev
  ? { apiKey: 'demo-api-key', authDomain: 'localhost', projectId: 'demo-budget-tracker' }
  : {
    apiKey: 'AIzaSyAIJoNBYqwIzjOOqAxzw3al2L1H1GSu_uc',
    // 用 .firebaseapp.com（不是 .web.app）：這是 Firebase 啟用 Google 登入時預設、
    // 自動幫你把 OAuth 重新導向 URI 註冊好的網域，不用再手動去 Google Cloud Console
    // 加東西。網站本身也要透過這個網域打開才會同源，見下面 index.html / 使用說明。
    authDomain: 'budget-tracker-8edd1.firebaseapp.com',
    projectId: 'budget-tracker-8edd1',
    storageBucket: 'budget-tracker-8edd1.firebasestorage.app',
    messagingSenderId: '412181679584',
    appId: '1:412181679584:web:8b75dd9850e826dae3af85'
  };

export var firebaseApp = appMod.initializeApp(firebaseConfig);
export var auth = authMod.getAuth(firebaseApp);
export var db = fsMod.getFirestore(firebaseApp);
export var googleProvider = new authMod.GoogleAuthProvider();
// 強制每次都跳出 Google 帳號選擇畫面，不要自動沿用瀏覽器記住的上一個帳號——
// 不然被允許名單擋掉登出後，再按登入會直接又用同一個被拒絕的帳號，選不到別的帳號。
googleProvider.setCustomParameters({ prompt: 'select_account' });

if (isLocalDev) {
  authMod.connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  fsMod.connectFirestoreEmulator(db, 'localhost', 8080);
}
fsMod.enableIndexedDbPersistence(db).catch(function () { /* multiple tabs open, or unsupported browser - app still works online */ });

export var signInWithRedirect = authMod.signInWithRedirect;
export var getRedirectResult = authMod.getRedirectResult;
export var signOut = authMod.signOut;
export var onAuthStateChanged = authMod.onAuthStateChanged;
export var collection = fsMod.collection;
export var doc = fsMod.doc;
export var onSnapshot = fsMod.onSnapshot;
export var writeBatch = fsMod.writeBatch;
export var getDocs = fsMod.getDocs;
