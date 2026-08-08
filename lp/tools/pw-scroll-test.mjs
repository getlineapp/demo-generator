import {createRequire} from 'module';
import {resolve} from 'path';
import {mkdirSync} from 'fs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const file = process.argv[2];
const outDir = process.argv[3] || resolve(process.cwd(), 'shots');
const offline = process.argv.includes('--offline');
if (!file) { console.error('usage: node pw-scroll-test.mjs <file.html> [outDir] [--offline]'); process.exit(2); }
const url = 'file://' + resolve(file);
mkdirSync(outDir, {recursive: true});

const SECTIONS = ['top','ch1','ch2','why','meta-down','social','receipts','offline','how','trust','proof','faq-s','foot'];
const failures = [];
const note = (ok, msg) => { console.log((ok?'  ok  ':'  FAIL') + ' ' + msg); if(!ok) failures.push(msg); };

const proxy = process.env.HTTPS_PROXY && !offline ? {server: process.env.HTTPS_PROXY} : undefined;
const browser = await chromium.launch({args:['--ignore-certificate-errors'], ...(proxy?{proxy}:{})});

async function pass(name, ctxOpts, {mobile=false, reduced=false} = {}) {
  console.log('== pass: ' + name);
  const ctx = await browser.newContext({ignoreHTTPSErrors:true, ...ctxOpts});
  if (offline) await ctx.route(/^https?:/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(url, {waitUntil: 'load'});
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
  await page.evaluate(() => document.fonts.ready).catch(()=>{});
  await page.waitForTimeout(300);

  // full scroll w krokach ~0.5 viewportu
  await page.evaluate(async () => {
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const step = Math.round(innerHeight * 0.5);
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y); await raf(); await raf();
    }
  });

  // horizontal overflow
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  note(sw <= iw + 1, `${name}: no horizontal overflow (scrollWidth ${sw} <= ${iw})`);

  if (!reduced) {
    // CH1: deterministyczny stan przy p~0.8
    await page.evaluate(() => {
      const el = document.getElementById('ch1');
      const top = el.offsetTop, span = el.offsetHeight - innerHeight;
      scrollTo(0, top + span * 0.8);
    });
    await page.waitForTimeout(150);
    const step1 = await page.evaluate(() => document.querySelector('#ch1 .scene-feed')?.dataset.step);
    note(step1 === '2', `${name}: ch1 reaches data-step=2 (got ${step1})`);

    // CH3: landed przy p~0.95
    await page.evaluate(() => {
      const el = document.getElementById('why');
      const top = el.offsetTop, span = el.offsetHeight - innerHeight;
      scrollTo(0, top + span * 0.95);
    });
    await page.waitForTimeout(150);
    const phase = await page.evaluate(() => document.querySelector('#why .scene-push')?.dataset.phase);
    note(phase === 'landed', `${name}: ch3 reaches data-phase=landed (got ${phase})`);

    // typewriter pełny
    const cms = await page.evaluate(() => document.getElementById('cmsText')?.textContent || '');
    note(cms.includes('except everyone'), `${name}: cms typewriter completed ("${cms.slice(-20)}")`);
  }

  // countery
  await page.evaluate(() => document.getElementById('statGrid')?.scrollIntoView({block:'center'}));
  await page.waitForTimeout(reduced ? 300 : 1800);
  const counts = await page.evaluate(() => [...document.querySelectorAll('#statGrid .n')].map(n => n.textContent.trim()));
  const expected = ['92.5%','~1,425','49.5%','99.7%'];
  note(JSON.stringify(counts) === JSON.stringify(expected), `${name}: counters final ${JSON.stringify(counts)}`);

  // FAQ single-open
  const faqOk = await page.evaluate(async () => {
    const ds = [...document.querySelectorAll('.faq details')];
    if (ds.length !== 8) return 'count=' + ds.length;
    ds[0].open = true;
    await new Promise(r => setTimeout(r, 60));
    ds[1].querySelector('summary').click();
    await new Promise(r => setTimeout(r, 120));
    return (!ds[0].open && ds[1].open) ? true : 'both-open';
  });
  note(faqOk === true, `${name}: FAQ single-open (${faqOk})`);

  // how steps
  const howOk = await page.evaluate(() => {
    const st = [...document.querySelectorAll('#steps .step')];
    if (st.length !== 4) return 'count';
    st[2].click();
    const pg = [...document.querySelectorAll('#howScr .scr-page')];
    return st[2].classList.contains('act') && pg[2].classList.contains('on') && !pg[0].classList.contains('on') ? true : 'sync';
  });
  note(howOk === true, `${name}: how steps drive phone (${howOk})`);

  // screenshoty sekcji
  for (const id of SECTIONS) {
    try {
      await page.evaluate((i) => document.getElementById(i)?.scrollIntoView(), id);
      await page.waitForTimeout(450);
      await page.screenshot({path: `${outDir}/${name}-${id}.png`});
    } catch (e) { note(false, `${name}: screenshot ${id} (${e.message})`); }
  }

  const netErrors = errors.filter(e => e.includes('Failed to load resource'));
  const realErrors = errors.filter(e => !e.includes('Failed to load resource'));
  if (netErrors.length) console.log('  warn ' + name + ': ' + netErrors.length + ' network resource failures (env/proxy)');
  note(realErrors.length === 0, `${name}: zero JS errors${realErrors.length ? ' -> ' + realErrors.join(' | ') : ''}`);
  await ctx.close();
}

const desktopOnly = process.argv.includes('--desktop-only');
const mobileOnly = process.argv.includes('--mobile-only');
if (!mobileOnly) await pass('desktop', {viewport: {width:1440, height:900}, deviceScaleFactor: 2});
if (!desktopOnly) await pass('mobile', {viewport: {width:390, height:844}, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'}, {mobile:true});
if (!mobileOnly) await pass('reduced', {viewport: {width:1440, height:900}, reducedMotion: 'reduce'}, {reduced:true});

await browser.close();
if (failures.length) { console.error('\nFAILURES: ' + failures.length); process.exit(1); }
console.log('\nALL GREEN');
