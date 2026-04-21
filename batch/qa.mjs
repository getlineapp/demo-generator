#!/usr/bin/env node
// QA: Playwright screenshots (desktop + mobile) of every festival demo.
// Works against either local dist/ (use --local) or live URL.
//
// Usage:
//   node qa.mjs --local           # screenshots from dist/ via file://
//   node qa.mjs                   # screenshots from deployed URL
//   node qa.mjs --slug=malta-festival --local

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, ...p);

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

const config = JSON.parse(readFileSync(cwd('config.json'), 'utf8'));
const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));

const local = !!args.local;
const baseUrl = local
  ? `file://${cwd('dist', config.parentHash)}`
  : `https://demo.getlineapp.com/${config.parentHash}`;

let targets = festivals;
if (args.slug) {
  targets = festivals.filter(f => f.slug === args.slug);
}

const outDir = cwd('qa-screenshots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const report = [];

for (const fest of targets) {
  const url = `${baseUrl}/${fest.slug}/${local ? 'index.html' : ''}`;
  const entry = { slug: fest.slug, url, errors: [] };

  for (const mode of ['desktop', 'mobile']) {
    const viewport = mode === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
    const ctx = await browser.newContext({
      viewport,
      isMobile: mode === 'mobile',
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => entry.errors.push(`${mode}:pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') entry.errors.push(`${mode}:console: ${m.text()}`);
    });

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      // Give Tailwind CDN + fonts a moment
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: resolve(outDir, `${fest.slug}-${mode}.png`),
        fullPage: mode === 'desktop',
      });
    } catch (err) {
      entry.errors.push(`${mode}:navigate: ${err.message}`);
    }
    await ctx.close();
  }

  entry.ok = entry.errors.length === 0;
  report.push(entry);
  console.log(`  [${entry.ok ? 'ok  ' : 'FAIL'}] ${fest.slug}${entry.errors.length ? ' — ' + entry.errors.slice(0, 2).join('; ') : ''}`);
}

await browser.close();

writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));

const okCount = report.filter(r => r.ok).length;
console.log(`\nQA: ${okCount}/${report.length} ok. Output: qa-screenshots/`);
