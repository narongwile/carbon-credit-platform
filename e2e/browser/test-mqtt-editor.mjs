import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function loginAs(page, email) {
  await page.goto('http://localhost:3901/', { waitUntil: 'networkidle' });
  // find login form fields
  await page.fill('input[type="email"], input[name="email"], input[type="text"]', email).catch(() => {});
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });

async function runAs(role, email) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[console:${role}]`, m.text()); });

  // Seed localStorage auth directly (established pattern: mock backend returns
  // a fake token/user; app reads from localStorage for session).
  await page.goto('http://localhost:3901/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ role, email }) => {
    const user = { id: 'u1', username: email, email, role, orgId: role === 'admin' ? 'org-1' : undefined, name: email };
    localStorage.setItem('oneops_token', 'faketoken');
    localStorage.setItem('eternity_user', JSON.stringify(user));
  }, { role, email });

  await page.goto('http://localhost:3901/admin/pending', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const bodyText = await page.textContent('body');
  const hasBrokerSection = bodyText.includes('Broker connection');
  const hasHost = bodyText.includes('mqtt.fromserver.example');
  const hasEditButton = await page.locator('button:has-text("Edit")').count();

  console.log(`\n=== ${role} (${email}) ===`);
  console.log('Broker connection section present:', hasBrokerSection);
  console.log('Fetched mock host value visible (mqtt.fromserver.example):', hasHost);
  console.log('Edit button count near broker card:', hasEditButton);

  if (role === 'superadmin') {
    // click Edit, verify modal opens pre-filled with mock values, then save new values
    const editButtons = page.locator('button:has-text("Edit")');
    let clicked = false;
    const count = await editButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = editButtons.nth(i);
      const txt = await btn.textContent();
      if (txt && txt.includes('Edit')) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    console.log('Clicked an Edit button:', clicked);
    await page.waitForTimeout(500);

    const modalVisible = await page.locator('text=MQTT connection').count();
    console.log('Modal heading "MQTT connection" visible:', modalVisible > 0);

    const hostInput = page.locator('input').filter({ hasText: '' }).first();
    // Grab all input values in the modal
    const inputs = await page.locator('div.fixed input[type="text"], div.fixed input:not([type])').all();
    const values = [];
    for (const inp of inputs) values.push(await inp.inputValue());
    console.log('Modal input values (host, port, username, password):', values);

    // Edit host and port, then save
    if (inputs.length >= 2) {
      await inputs[0].fill('new-broker.example.com');
      await inputs[1].fill('8883');
      const saveBtn = page.locator('button:has-text("Save")');
      await saveBtn.click();
      await page.waitForTimeout(800);
      const afterText = await page.textContent('body');
      console.log('After save, card shows new host (new-broker.example.com):', afterText.includes('new-broker.example.com'));
      console.log('After save, card shows new port (8883):', afterText.includes('8883'));
      const modalStillOpen = await page.locator('div.fixed.inset-0').count();
      console.log('Modal overlay closed after save:', modalStillOpen === 0);
    }
  }

  await ctx.close();
}

await runAs('superadmin', 'superadmin');
await runAs('admin', 'admin@org1.example');

await browser.close();
