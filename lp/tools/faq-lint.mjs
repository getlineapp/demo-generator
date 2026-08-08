import {createRequire} from 'module';
import {resolve} from 'path';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const file = process.argv[2];
if (!file) { console.error('usage: node faq-lint.mjs <file.html>'); process.exit(2); }

const norm = s => s.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, '-').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + resolve(file));
const dom = await page.evaluate(() => [...document.querySelectorAll('.faq details')].map(d => {
  const s = d.querySelector('summary').cloneNode(true);
  s.querySelectorAll('.plus').forEach(x => x.remove());
  return {q: s.textContent, a: d.querySelector('.ans').textContent};
}));
const ld = await page.evaluate(() => {
  for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
    const data = JSON.parse(sc.textContent);
    const nodes = data['@graph'] || [data];
    for (const n of nodes) if (n['@type'] === 'FAQPage') return n.mainEntity.map(m => ({q: m.name, a: m.acceptedAnswer.text}));
  }
  return null;
});
await browser.close();

let fail = false;
if (!ld) { console.error('FAIL: no FAQPage JSON-LD'); process.exit(1); }
if (dom.length !== ld.length) { console.error(`FAIL: count DOM=${dom.length} vs LD=${ld.length}`); fail = true; }
const n = Math.min(dom.length, ld.length);
for (let i = 0; i < n; i++) {
  const dq = norm(dom[i].q), lq = norm(ld[i].q), da = norm(dom[i].a), la = norm(ld[i].a);
  if (dq !== lq) { console.error(`FAIL Q${i+1}:\n  DOM: ${dq}\n  LD : ${lq}`); fail = true; }
  if (da !== la) { console.error(`FAIL A${i+1}:\n  DOM: ${da}\n  LD : ${la}`); fail = true; }
}
if (fail) process.exit(1);
console.log(`FAQ OK: ${dom.length} pairs, DOM == JSON-LD`);
