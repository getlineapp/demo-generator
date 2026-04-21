import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 1600 },
  httpCredentials: { username: 'admin', password: 'c6fuB9J5hzyWt08' },
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();
await page.goto('https://demo.getlineapp.com/e8e1b9ed6c79/_admin/', { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'qa-screenshots/admin-list.png', fullPage: true });
await browser.close();
console.log('ok');
