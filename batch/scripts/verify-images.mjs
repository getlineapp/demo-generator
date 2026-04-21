#!/usr/bin/env node
// HEAD-check every external image URL in festivals.json. Null out broken ones.
// Keeps local asset paths untouched.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, '..', ...p);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0 Safari/537.36';
const TIMEOUT_MS = 6000;
const limit = pLimit(8);

async function headCheck(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return true; // local path, assume ok
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
    if (res.status === 405 || res.status === 403) {
      // Some CDNs block HEAD — try GET with Range: bytes=0-0
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': UA, 'Range': 'bytes=0-0' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
    }
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));

const checks = [];
for (const fest of festivals) {
  for (const a of (fest.artists || [])) {
    if (!a.image || typeof a.image !== 'string') continue;
    if (!/^https?:\/\//i.test(a.image)) continue; // local, skip
    checks.push({ fest: fest.slug, artist: a.name, url: a.image, ref: a });
  }
}

console.log(`HEAD-checking ${checks.length} external image URLs…`);
const results = await Promise.all(checks.map(c => limit(async () => {
  const ok = await headCheck(c.url);
  if (!ok) c.ref.image = null;
  return { ...c, ok };
})));

const byFest = {};
for (const r of results) {
  byFest[r.fest] = byFest[r.fest] || { ok: 0, bad: 0 };
  byFest[r.fest][r.ok ? 'ok' : 'bad']++;
}
for (const [slug, stats] of Object.entries(byFest)) {
  if (stats.bad) console.log(`  ${slug}: ${stats.ok} ok, ${stats.bad} broken → nulled`);
}

const totalBad = results.filter(r => !r.ok).length;
console.log(`\nTotal nulled: ${totalBad}/${checks.length}`);

writeFileSync(cwd('festivals.json'), JSON.stringify(festivals, null, 2) + '\n');
console.log('Updated festivals.json. Template will fall back to picsum.photos seed-based placeholders.');
