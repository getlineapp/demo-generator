import {readFileSync, writeFileSync} from 'fs';
import {execSync} from 'child_process';
import {resolve} from 'path';

const inFile = process.argv[2], outFile = process.argv[3];
if (!inFile || !outFile) { console.error('usage: node artifact-build.mjs <in.html> <out.html>'); process.exit(2); }
let html = readFileSync(resolve(inFile), 'utf8');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sizes = [];

function fetchBuf(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const buf = execSync(`curl -sS --fail --max-time 60 -A "${UA}" "${url}"`, {encoding: 'buffer', maxBuffer: 64 * 1024 * 1024});
      if (buf.length) return buf;
    } catch (e) { if (i === 3) throw new Error('fetch failed: ' + url + ' :: ' + e.message); }
    execSync('sleep ' + (i + 1));
  }
}

/* 1. fonty bunny -> inline woff2 (latin + latin-ext) */
const linkM = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.bunny\.net\/css[^"]+)">/);
if (linkM) {
  const cssUrl = linkM[1].replace(/&amp;/g, '&');
  let css = fetchBuf(cssUrl).toString('utf8');
  // zostaw tylko bloki latin/latin-ext
  const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*@font-face\s*\{[^}]+\}/g)]
    .filter(m => m[1] === 'latin' || m[1] === 'latin-ext').map(m => m[0]);
  let out = blocks.join('\n');
  let i = 0;
  out = out.replace(/url\((https:\/\/fonts\.bunny\.net\/[^)]+\.woff2)\)/g, (mm, u) => {
    const buf = fetchBuf(u);
    sizes.push(['font ' + (++i), buf.length]);
    return `url(data:font/woff2;base64,${buf.toString('base64')})`;
  });
  out = out.replace(/,\s*url\([^)]*\)\s*format\(['"]woff['"]\)/g, '');
  out = out.replace(/font-display:\s*\w+/g, 'font-display:block');
  if (!/font-display/.test(out)) out = out.replace(/@font-face\s*\{/g, '@font-face{font-display:block;');
  html = html.replace(linkM[0], '<style>\n' + out + '\n</style>');
  html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.bunny\.net">\s*/, '');
}

/* 2. obrazy -> data URI (src i data-src; meta og/twitter zostaja URL-ami) */
const imgUrls = new Set();
for (const m of html.matchAll(/(?:src|data-src)="(https:\/\/festival-data-shock\.getlineapp\.com\/[^"]+)"/g)) imgUrls.add(m[1]);
for (const u of imgUrls) {
  const buf = fetchBuf(u);
  sizes.push([u.split('/').pop(), buf.length]);
  const dataUri = `data:image/webp;base64,${buf.toString('base64')}`;
  html = html.split(`data-src="${u}"`).join(`src="${dataUri}"`);
  html = html.split(`src="${u}"`).join(`src="${dataUri}"`);
}

writeFileSync(resolve(outFile), html);
const total = Buffer.byteLength(html);
for (const [n, s] of sizes) console.log(`  ${(s / 1024).toFixed(1).padStart(8)} KB  ${n}`);
console.log(`TOTAL: ${(total / 1024 / 1024).toFixed(2)} MB (limit 16 MB)`);
if (total > 16 * 1024 * 1024) { console.error('OVER BUDGET'); process.exit(1); }
