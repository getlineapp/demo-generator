#!/usr/bin/env node
// Merge data/{slug}.json (scraper output) into festivals.json.
// Only merges: logoPath, bannerPath, primaryColor, backgroundColor, textColor, venue, scraping_status.
// DOES NOT touch artists / schedule / faqs — those are curated separately.
// Usage: node scripts/merge-scraper.mjs [--overwrite]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, '..', ...p);

const overwrite = process.argv.includes('--overwrite');
const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));
let merged = 0;

for (const fest of festivals) {
  const dataPath = cwd('data', `${fest.slug}.json`);
  if (!existsSync(dataPath)) continue;
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));

  const fields = ['logoPath', 'bannerPath', 'primaryColor', 'backgroundColor', 'textColor', 'venue', 'scraping_status'];
  for (const f of fields) {
    if (data[f] != null && (overwrite || fest[f] == null || fest[f] === '' || fest[f] === 'pending')) {
      fest[f] = data[f];
    }
  }
  merged++;
}

writeFileSync(cwd('festivals.json'), JSON.stringify(festivals, null, 2) + '\n');
console.log(`Merged scraper data for ${merged}/${festivals.length} festivals.`);
console.log('Artists and schedule are NOT touched — curate separately.');
