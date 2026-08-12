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
// 正式上線前，把下面 REPLACE_ME 換成你自己 Firebase 專案「一般設定 -> 你的應用程式」
// 裡看到的 config 物件（這組值本來就是設計成可以放在前端程式碼裡，不是密碼）。
var firebaseConfig = isLocalDev
  ? { apiKey: 'demo-api-key', authDomain: 'localhost', projectId: 'demo-budget-tracker' }
  : {
    apiKey: 'REPLACE_ME',
    authDomain: 'REPLACE_ME.firebaseapp.com',
    projectId: 'REPLACE_ME',
    storageBucket: 'REPLACE_ME.appspot.com',
    messagingSenderId: 'REPLACE_ME',
    appId: 'REPLACE_ME'
  };

export var firebaseApp = appMod.initializeApp(firebaseConfig);
export var auth = authMod.getAuth(firebaseApp);
export var db = fsMod.getFirestore(firebaseApp);
export var googleProvider = new authMod.GoogleAuthProvider();

if (isLocalDev) {
  authMod.connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  fsMod.connectFirestoreEmulator(db, 'localhost', 8080);
}
fsMod.enableIndexedDbPersistence(db).catch(function () { /* multiple tabs open, or unsupported browser - app still works online */ });

export var signInWithPopup = authMod.signInWithPopup;
export var signOut = authMod.signOut;
export var onAuthStateChanged = authMod.onAuthStateChanged;
export var collection = fsMod.collection;
export var doc = fsMod.doc;
export var onSnapshot = fsMod.onSnapshot;
export var writeBatch = fsMod.writeBatch;
export var getDocs = fsMod.getDocs;
