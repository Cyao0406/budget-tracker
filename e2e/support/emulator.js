// Firebase Local Emulator Suite helpers for the e2e suite.
// Endpoints verified against official Firebase docs (2026-08-19):
// https://firebase.google.com/docs/emulator-suite/connect_firestore
// https://firebase.google.com/docs/emulator-suite/connect_auth
//
// Hard rule: these helpers only ever talk to localhost emulator ports. There is
// no production fallback path anywhere in this file - if a check fails, callers
// must abort/skip Firebase-dependent tests, never silently point at prod.

const PROJECT_ID = 'demo-budget-tracker';
const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;

export const emulatorConfig = { PROJECT_ID, FIRESTORE_PORT, AUTH_PORT };

async function isReachable(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    // Emulator endpoints return various status codes when alive (200/404/etc) -
    // what matters is we got a real HTTP response at all, not a connection error.
    return res.status !== undefined;
  } catch {
    return false;
  }
}

// Required preflight before any Firebase-dependent test: confirm both emulators
// are actually reachable. Do not assume "configured for localhost" == "running".
export async function checkEmulatorHealth() {
  const firestoreUp = await isReachable(`http://localhost:${FIRESTORE_PORT}/`);
  const authUp = await isReachable(`http://localhost:${AUTH_PORT}/`);
  return {
    healthy: firestoreUp && authUp,
    firestoreUp,
    authUp,
  };
}

// Clears all Firestore documents in the emulator for this project. Suite-level
// reset - call before each spec file's tests, not shared across runs.
export async function resetFirestoreEmulator() {
  const url = `http://localhost:${FIRESTORE_PORT}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Firestore emulator reset failed: HTTP ${res.status}`);
  }
}

// Clears all Auth accounts in the emulator for this project.
// Known issue (github.com/firebase/firebase-tools#3013): some firebase-tools
// versions have returned an auth error on this endpoint. If this throws, the
// caller must treat it as "reset failed -> block Firebase-dependent tests",
// never retry against production.
export async function resetAuthEmulator() {
  const url = `http://localhost:${AUTH_PORT}/emulator/v1/projects/${PROJECT_ID}/accounts`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Auth emulator reset failed: HTTP ${res.status}`);
  }
}

// Creates a disposable emulator-only test user via the Auth emulator's
// Identity Toolkit REST surface (signUp endpoint), bypassing the real Google
// redirect flow entirely - this is what lets e2e tests simulate "signed in as
// an allowed user" deterministically instead of fighting popup/redirect UI.
// The email must be one of ALLOWED_CLOUD_EMAILS (see sync.js) or the app will
// immediately sign the user back out. Returns the Identity Toolkit signUp
// response, which includes `localId` - this IS the Firebase uid, needed to
// seed Firestore documents under users/{uid}/... before sign-in.
export async function createEmulatorTestUser(email, password) {
  const url = `http://localhost:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    throw new Error(`Emulator test user creation failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ---------- Firestore REST document seeding (arrange step for sync-logic tests) ----------
// Converts a plain JS object into Firestore's typed REST field format. Only
// covers the value types actually used by this app's data model (string,
// boolean, array of strings) - not a general-purpose converter.
function toFirestoreValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (v === null || v === undefined) return { nullValue: null };
  throw new Error(`seedFirestoreDocument: unsupported value type for ${JSON.stringify(v)}`);
}

// Writes a document directly to the Firestore emulator via its REST API,
// bypassing the app entirely. Used to pre-populate "cloud already has this
// category from another device/session" state BEFORE sign-in, which is
// required to actually exercise handleSignedIn()'s pushLocalOnly() and
// reconcileCategoryIdsWithCloud() code paths (see sync.js) - resetting to an
// empty cloud and only using the app's own sign-in flow can only ever hit the
// cloudEmpty && localHasData first-migration branch, which is a DIFFERENT
// code path from the one that actually fixed the v2.4/v2.6 regressions.
//
// firestore.rules is enforced even against emulator REST calls, so this needs
// an Authorization header carrying a real ID token for the target uid (an
// unauthenticated PATCH is correctly rejected with 403 PERMISSION_DENIED,
// same as it would be against production) - pass the idToken returned by
// createEmulatorTestUser().
export async function seedFirestoreDocument(uid, idToken, collectionName, docId, data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = toFirestoreValue(value);
  const url = `http://localhost:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/${collectionName}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Firestore emulator seed failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function resetEmulatorState() {
  await resetFirestoreEmulator();
  await resetAuthEmulator();
}
