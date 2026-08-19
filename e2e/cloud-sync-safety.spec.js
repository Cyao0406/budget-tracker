// Regression cases for the cloud-sync merge/migration logic in sync.js's handleSignedIn():
// - v2.4: "修正登入雲端同步後，分類 emoji 圖示會消失的問題" - fixed by pushLocalOnly() running
//   BEFORE startCloudListeners() so a locally-made change (while logged out) is not overwritten
//   by a stale cloud snapshot.
// - v2.6: "修正雲端登入後分類會重複出現的問題" - fixed by reconcileCategoryIdsWithCloud()
//   rewriting a local category id to match an existing cloud category with the same
//   type+name, so pushLocalOnly() updates it instead of creating a duplicate.
// - CLAUDE.md 已知眉角: first-login migration must never let a transitional empty remote
//   snapshot be misread as "user deleted everything" and wipe local data - the most
//   safety-critical invariant in the whole sync design (see SYNC.md skill).
//
// IMPORTANT: the v2.4/v2.6 fixes only run when handleSignedIn() takes the general
// reconcile+pushLocalOnly branch, NOT the cloudEmpty&&localHasData first-migration branch -
// those are genuinely different code paths (see sync.js). Resetting the emulator to an empty
// cloud and simply signing in only ever exercises the migration branch, which would make a
// test pass in a way that proves nothing - it would still pass even if the v2.4/v2.6 fixes
// were reverted. The two tests below deliberately seed the cloud with pre-existing data via
// the Firestore emulator REST API before sign-in, so the actual fixed code paths are exercised.
//
// Uses the Firebase Emulator Suite only. Hard rule: if the emulator is not reachable, these
// tests must be skipped/blocked, never silently fall back to the production Firebase project.
import { test, expect } from '@playwright/test';
import { checkEmulatorHealth, resetEmulatorState, createEmulatorTestUser, seedFirestoreDocument, emulatorConfig } from './support/emulator.js';

const TEST_EMAIL = 'dogd989312@gmail.com'; // must be in sync.js's ALLOWED_CLOUD_EMAILS
const TEST_PASSWORD = 'e2e-disposable-test-password-only';

test.beforeAll(async () => {
  const health = await checkEmulatorHealth();
  test.skip(!health.healthy, `Firebase emulator not reachable (firestore=${health.firestoreUp}, auth=${health.authUp}) - start it with: firebase emulators:start --project ${emulatorConfig.PROJECT_ID}`);
});

test.beforeEach(async ({ page }) => {
  await resetEmulatorState();
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// Signs in against the Auth emulator by reaching into the app's own already-connected auth
// singleton (same module URL resolves to the same instance under the browser's ES module
// cache), instead of driving the real signInWithRedirect UI flow, which the emulator does not
// meaningfully exercise anyway (see firebase-config.js: emulator selection is purely by
// hostname === localhost).
async function signInAsTestUser(page, email, password) {
  await page.evaluate(async ({ email, password }) => {
    const { auth } = await import('/firebase-config.js');
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js');
    await signInWithEmailAndPassword(auth, email, password);
  }, { email, password });
}

// Category rows render name/icon as <input value="..."> (settings.js renderCategoryEditList),
// which do NOT show up in .textContent - must read them via inputValue() per row.
async function readCategoryEditRows(page) {
  const rows = page.locator('.category-edit-item');
  const count = await rows.count();
  const result = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const icon = await row.locator('.icon-input').inputValue();
    const name = await row.locator('.category-edit-item-head input[type="text"]:not(.icon-input)').inputValue();
    result.push({ name, icon });
  }
  return result;
}

async function getLocalCategory(page, name) {
  return page.evaluate((name) => {
    const cats = JSON.parse(localStorage.getItem('budgetapp.categories') || '[]');
    return cats.find((c) => c.name === name) || null;
  }, name);
}

// app.js imports sync.js, which imports firebase-config.js, which does top-level `await
// import(...)` for the Firebase SDK from a CDN - this can delay the whole module graph's
// evaluation (including init()'s default-category seeding) past the point where
// page.reload() resolves (that only waits for the browser 'load' event, not for deferred
// module top-level awaits to finish). Poll instead of assuming categories exist immediately.
async function waitForLocalCategory(page, name) {
  await expect(async () => {
    const cat = await getLocalCategory(page, name);
    expect(cat).toBeTruthy();
  }).toPass({ timeout: 10000 });
  return getLocalCategory(page, name);
}

async function setLocalCategoryIcon(page, name, icon) {
  await page.evaluate(({ name, icon }) => {
    const cats = JSON.parse(localStorage.getItem('budgetapp.categories') || '[]');
    const cat = cats.find((c) => c.name === name);
    if (cat) cat.icon = icon;
    localStorage.setItem('budgetapp.categories', JSON.stringify(cats));
  }, { name, icon });
}

test('locally changed category emoji made while logged out is pushed to cloud before listeners start, not overwritten by stale cloud data (v2.4 regression)', async ({ page }) => {
  const localFood = await waitForLocalCategory(page, '餐飲');
  expect(localFood.icon).toBe('🍚'); // sanity check on the shipped default

  const signUp = await createEmulatorTestUser(TEST_EMAIL, TEST_PASSWORD);
  // Seed cloud with the SAME id but the pre-change icon. This makes cloudCategories non-empty
  // (skips the cloudEmpty&&localHasData first-migration branch entirely) while keeping
  // reconcileCategoryIdsWithCloud a no-op (ids already match), isolating pushLocalOnly as the
  // only mechanism that can make this test pass.
  await seedFirestoreDocument(signUp.localId, signUp.idToken, 'categories', localFood.id, {
    id: localFood.id, type: 'expense', name: '餐飲', colorVar: '--series-1',
    icon: '🍚', keywords: [], fallback: false,
  });

  // While still logged out, change the local icon, simulating a user customizing the emoji
  // before logging back in - the exact scenario the v2.4 fix protects against.
  await setLocalCategoryIcon(page, '餐飲', '🍜');
  await page.reload();

  page.on('dialog', (d) => d.accept()); // auto-accept any confirm() dialog
  await signInAsTestUser(page, TEST_EMAIL, TEST_PASSWORD);
  await page.waitForTimeout(2000); // let pushLocalOnly + listener settle

  await page.click('#settingsBtn');
  await page.click('#categorySettingsBtn');
  const rows = await readCategoryEditRows(page);
  const food = rows.find((r) => r.name === '餐飲');
  expect(food, 'no food row found after sign-in').toBeTruthy();
  expect(food.icon).toBe('🍜'); // must NOT have reverted to the stale cloud value
});

test('local category with a freshly generated id is reconciled to the existing cloud category with the same name instead of creating a duplicate (v2.6 regression)', async ({ page }) => {
  const localFood = await waitForLocalCategory(page, '餐飲');

  const signUp = await createEmulatorTestUser(TEST_EMAIL, TEST_PASSWORD);
  const cloudOnlyId = 'cat-cloud-food-seed'; // deliberately different from localFood.id
  await seedFirestoreDocument(signUp.localId, signUp.idToken, 'categories', cloudOnlyId, {
    id: cloudOnlyId, type: 'expense', name: '餐飲', colorVar: '--series-1',
    icon: '🍚', keywords: [], fallback: false,
  });

  page.on('dialog', (d) => d.accept());
  await signInAsTestUser(page, TEST_EMAIL, TEST_PASSWORD);
  await page.waitForTimeout(2000);

  // Assert via the app's own local state, which is what reconcileCategoryIdsWithCloud is
  // supposed to rewrite, not just "no duplicate visible in the UI". This proves actual
  // reconciliation happened rather than some other accidental reason there's only one row.
  const foodAfter = await getLocalCategory(page, '餐飲');
  expect(foodAfter, 'food category vanished after sign-in').toBeTruthy();
  expect(foodAfter.id).toBe(cloudOnlyId);

  await page.click('#settingsBtn');
  await page.click('#categorySettingsBtn');
  const rows = await readCategoryEditRows(page);
  const foodRows = rows.filter((r) => r.name === '餐飲');
  expect(foodRows).toHaveLength(1);
});

test('first-login migration never wipes local data (false-empty snapshot protection)', async ({ page }) => {
  // Local data exists, cloud is empty (fresh emulator reset in beforeEach) - this is exactly
  // the cloud-empty-plus-local-has-data migration path in handleSignedIn(), the highest-risk
  // case: if startCloudListeners() ever fires before the migration push is fully awaited, the
  // first empty snapshot can be misread as "user deleted everything" and wipe state.records.
  await page.fill('#quickInput', '早餐 50');
  await page.click('#addBtn');
  await page.fill('#quickInput', '晚餐 200');
  await page.click('#addBtn');
  await page.click('[data-tab="calendar"]');
  await expect(page.locator('#recordsList')).toContainText('早餐');
  await expect(page.locator('#recordsList')).toContainText('晚餐');

  await createEmulatorTestUser(TEST_EMAIL, TEST_PASSWORD);
  page.on('dialog', (d) => d.accept()); // accept the migration confirm()
  await signInAsTestUser(page, TEST_EMAIL, TEST_PASSWORD);

  // Poll for several seconds rather than a single fixed wait - the failure mode this guards
  // against is a transient wipe (records disappear then never come back), so check repeatedly.
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    const stillPresent = await page.locator('#recordsList').textContent();
    expect(stillPresent, `records vanished after login at check number ${i}`).toContain('早餐');
    expect(stillPresent).toContain('晚餐');
  }
});
