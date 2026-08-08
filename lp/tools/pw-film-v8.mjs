import {createRequire} from 'module';
import {resolve} from 'path';
import {mkdirSync} from 'fs';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const file = process.argv[2];
const outDir = process.argv[3] || 'film';
const offline = process.argv.includes('--offline');
if (!file) { console.error('usage: node pw-film-v8.mjs <file.html> [outDir] [--offline]'); process.exit(2); }
const url = 'file://' + resolve(file);
mkdirSync(outDir, {recursive: true});

const failures = [];
const note = (ok, msg) => { console.log((ok?'  ok  ':'  FAIL') + ' ' + msg); if(!ok) failures.push(msg); };
const proxy = process.env.HTTPS_PROXY && !offline ? {server: process.env.HTTPS_PROXY} : undefined;
const browser = await chromium.launch({args:['--ignore-certificate-errors'], ...(proxy?{proxy}:{})});

// klatki stage do filmstripu + oczekiwane stany
const FRAMES = [
  {P:.02,  scene:'hero'},
  {P:.09,  scene:'hero'},
  {P:.16,  scene:'feed', feed:'0'},
  {P:.25,  scene:'feed', feed:'1'},
  {P:.33,  scene:'feed', feed:'2'},
  {P:.43,  scene:'brand'},
  {P:.49,  scene:'brand'},
  {P:.54,  scene:'brand'},
  {P:.59,  scene:'push'},
  {P:.67,  scene:'push', phase:'compose'},
  {P:.74,  scene:'push'},
  {P:.79,  scene:'push', phase:'landed'},
  {P:.86,  scene:'crisis'},
  {P:.95,  scene:'crisis'},
];
const SECTIONS = ['receipts','offline','how','trust','proof','faq-s','foot'];

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
  await page.waitForTimeout(400);

  const gotoP = async P => {
    await page.evaluate((P) => {
      const st = document.getElementById('stage');
      scrollTo(0, st.offsetTop + P * (st.offsetHeight - innerHeight));
    }, P);
    await page.waitForTimeout(140);
  };

  if (!reduced) {
    for (const f of FRAMES) {
      await gotoP(f.P);
      const st = await page.evaluate(() => {
        const v = document.getElementById('stageVp');
        const isl = document.getElementById('island');
        return {scene: v.dataset.scene, feed: v.dataset.feed, phase: v.dataset.phase,
                pp: v.style.getPropertyValue('--pp'), isl: isl ? isl.dataset.stateFull || isl.dataset.state : '?'};
      });
      if (f.scene) note(st.scene === f.scene, `${name} P=${f.P}: scene=${st.scene} (want ${f.scene}) isl=${st.isl}`);
      if (f.feed)  note(st.feed === f.feed,   `${name} P=${f.P}: feed=${st.feed} (want ${f.feed})`);
      if (f.phase) note(st.phase === f.phase, `${name} P=${f.P}: phase=${st.phase} (want ${f.phase})`);
      await page.screenshot({path: `${outDir}/${name}-P${String(f.P).replace('.','')}.png`});
    }
    // typewriter + kaskada na końcu pusha
    await gotoP(.79);
    const cms = await page.evaluate(() => document.getElementById('cmsText')?.textContent || '');
    note(cms.includes('except everyone'), `${name}: typewriter done ("${cms.slice(-18)}")`);
    const pp = await page.evaluate(() => parseFloat(document.getElementById('stageVp').style.getPropertyValue('--pp')));
    note(pp > .9, `${name}: cascade --pp=${pp}`);
    // island zmienia stany
    const states = new Set();
    for (const P of [.02,.2,.45,.67,.79,.9]) { await gotoP(P); await page.waitForTimeout(420);
      states.add(await page.evaluate(() => document.getElementById('island').dataset.stateFull || document.getElementById('island').dataset.state)); }
    note(states.size >= 5, `${name}: island states seen = ${[...states].join(',')}`);
  }

  // sekcje po stage
  for (const id of SECTIONS) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({block:'start'}), id);
    await page.waitForTimeout(reduced ? 200 : 600);
    await page.screenshot({path: `${outDir}/${name}-${id}.png`});
  }

  // widoczność sekcji po stage (regresja fx: IO musi kickować silnik)
  await page.evaluate(() => document.getElementById('receipts')?.scrollIntoView({block:'start'}));
  await page.waitForTimeout(700);
  const h2op = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#receipts h2')).opacity));
  note(h2op > .8, `${name}: receipts h2 visible (opacity=${h2op})`);

  // countery
  await page.evaluate(() => document.getElementById('statGrid')?.scrollIntoView({block:'center'}));
  await page.waitForTimeout(reduced ? 300 : 1900);
  const counts = await page.evaluate(() => [...document.querySelectorAll('#statGrid .n')].map(n => n.textContent.trim()));
  note(JSON.stringify(counts) === JSON.stringify(['92.5%','~1,425','49.5%','99.7%']), `${name}: counters ${JSON.stringify(counts)}`);

  // FAQ single-open
  const faqOk = await page.evaluate(async () => {
    const ds = [...document.querySelectorAll('.faq details')];
    if (ds.length !== 8) return 'count=' + ds.length;
    ds[0].open = true; await new Promise(r => setTimeout(r, 60));
    ds[1].querySelector('summary').click(); await new Promise(r => setTimeout(r, 120));
    return (!ds[0].open && ds[1].open) ? true : 'both-open';
  });
  note(faqOk === true, `${name}: FAQ single-open (${faqOk})`);

  // overflow poziomy
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  note(sw <= iw + 1, `${name}: no horizontal overflow (${sw} <= ${iw})`);

  const netErrors = errors.filter(e => e.includes('Failed to load resource'));
  const realErrors = errors.filter(e => !e.includes('Failed to load resource'));
  if (netErrors.length) console.log('  warn ' + name + ': ' + netErrors.length + ' network resource failures (env/proxy)');
  note(realErrors.length === 0, `${name}: zero JS errors${realErrors.length ? ' -> ' + realErrors.slice(0,3).join(' | ') : ''}`);
  await ctx.close();
}

const only = process.argv.find(a => a.startsWith('--only='));
const passes = only ? only.slice(7).split(',') : ['desktop','mobile','reduced'];
if (passes.includes('desktop')) await pass('desktop', {viewport:{width:1440,height:900}, deviceScaleFactor:2});
if (passes.includes('mobile'))  await pass('mobile', {viewport:{width:390,height:844}, isMobile:true, hasTouch:true}, {mobile:true});
if (passes.includes('reduced')) await pass('reduced', {viewport:{width:1440,height:900}, reducedMotion:'reduce'}, {reduced:true});

await browser.close();
if (failures.length) { console.error('\nFAILURES: ' + failures.length); process.exit(1); }
console.log('\nALL GREEN');
