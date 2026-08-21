import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true });

async function session(role) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log(`  [err:${role}]`, m.text().slice(0, 150)); });
  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((role) => {
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify({ id: 'u1', username: role, email: `${role}@x.com`, role, orgId: 'org-1', name: role }));
  }, role);
  return { ctx, page };
}

console.log('############ as plain admin: no Move control ############');
{
  const { ctx, page } = await session('admin');
  await page.goto('http://localhost:3901/admin/devices', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('tr', { hasText: 'TRA-9F2C' }).first().click();
  await page.waitForTimeout(500);
  const moveBtn = await page.locator('button:has-text("Move")').count();
  console.log('PASS admin sees no Move button:', moveBtn === 0);
  await ctx.close();
}

console.log('\n############ as superadmin: full move flow ############');
{
  const { ctx, page } = await session('superadmin');
  await page.goto('http://localhost:3901/admin/devices', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const bodyBefore = await page.textContent('body');
  console.log('device row visible before move:', bodyBefore.includes('TRA-9F2C'));

  await page.locator('tr', { hasText: 'TRA-9F2C' }).first().click();
  await page.waitForTimeout(500);

  console.log('PASS Edit Device modal opened:', (await page.textContent('body')).includes('Edit Device'));
  console.log('PASS second feed (TRA-9F2C-B) listed:', (await page.textContent('body')).includes('TRA-9F2C-B'));

  const moveBtn = page.locator('button:has-text("Move")').first();
  console.log('PASS Move button visible for superadmin:', await moveBtn.count() > 0);
  await moveBtn.click();
  await page.waitForTimeout(600);

  const modalText = await page.textContent('body');
  console.log('PASS move modal opened:', modalText.includes('Move to another organization'));
  console.log('PASS both group members listed (primary + second feed):', modalText.includes('TRA-9F2C') && modalText.includes('TRA-9F2C-B'));
  console.log('PASS warning about real data relocation shown:', modalText.includes('not reversible'));

  // Move button should be disabled until BOTH a target org is chosen AND "MOVE" typed.
  const confirmMoveBtn = page.locator('button:has-text("Move 2 devices")');
  console.log('PASS confirm button disabled before target/confirm filled:', await confirmMoveBtn.isDisabled());

  await page.locator('select').last().selectOption({ label: 'Eternity' });
  console.log('PASS still disabled with target chosen but no confirm text:', await confirmMoveBtn.isDisabled());

  await page.fill('input[placeholder="MOVE"]', 'move'); // case-insensitive
  await page.waitForTimeout(200);
  console.log('PASS enabled once target + MOVE typed:', !(await confirmMoveBtn.isDisabled()));

  await confirmMoveBtn.click();
  await page.waitForTimeout(1500);

  const afterText = await page.textContent('body');
  console.log('PASS modal closed after move:', !afterText.includes('Move to another organization'));
  console.log('PASS Edit Device modal also closed:', !afterText.includes('Edit Device'));

  // The moved device must disappear from THIS org's device list.
  await page.waitForTimeout(500);
  const finalText = await page.textContent('body');
  console.log('PASS device no longer listed in this org after move:', !finalText.includes('TRA-9F2C'));

  await page.screenshot({ path: './screenshots/move-after.png' });
  await ctx.close();
}

await browser.close();
