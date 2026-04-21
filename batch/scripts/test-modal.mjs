import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.goto('https://demo.getlineapp.com/e8e1b9ed6c79/malta-festival/', { waitUntil: 'load' });
await page.waitForTimeout(800);
// Click first artist card in "Now & Next"
await page.locator('#now-next-list > div').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'qa-screenshots/modal-open.png' });
console.log('modal open:', await page.locator('#artist-modal.open').count() > 0);
// Click X button
await page.locator('#artist-modal button').click();
await page.waitForTimeout(400);
console.log('modal closed:', await page.locator('#artist-modal.open').count() === 0);
await page.screenshot({ path: 'qa-screenshots/modal-closed.png' });
await browser.close();
