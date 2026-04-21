#!/usr/bin/env node
// Merge enrichments/{slug}.json into festivals.json.
// Only touches: tagline, artists, schedule, faqs, notes (append).
// Leaves scraped fields (logoPath, bannerPath, colors, venue, contact) intact.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, '..', ...p);

const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));
const enrichDir = cwd('enrichments');

const available = existsSync(enrichDir)
  ? new Set(readdirSync(enrichDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')))
  : new Set();

let merged = 0;
let missing = [];
for (const fest of festivals) {
  const path = cwd('enrichments', `${fest.slug}.json`);
  if (!existsSync(path)) {
    missing.push(fest.slug);
    continue;
  }
  let enrich;
  try {
    enrich = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Skipping ${fest.slug}: invalid JSON (${err.message})`);
    missing.push(fest.slug);
    continue;
  }

  if (enrich.tagline) fest.tagline = enrich.tagline;
  if (Array.isArray(enrich.artists) && enrich.artists.length) fest.artists = enrich.artists;
  if (Array.isArray(enrich.schedule) && enrich.schedule.length) fest.schedule = enrich.schedule;
  if (Array.isArray(enrich.faqs) && enrich.faqs.length) fest.faqs = enrich.faqs;
  if (enrich.notes) {
    fest.notes = fest.notes ? `${fest.notes} | ${enrich.notes}` : enrich.notes;
  }
  merged++;
}

writeFileSync(cwd('festivals.json'), JSON.stringify(festivals, null, 2) + '\n');
console.log(`Merged enrichments: ${merged}/${festivals.length}`);
if (missing.length) console.log(`Missing enrichments: ${missing.join(', ')}`);

// Stats
const stats = festivals.map(f => ({
  slug: f.slug,
  artists: (f.artists || []).length,
  schedule_days: (f.schedule || []).length,
  faqs: (f.faqs || []).length,
  tagline: !!f.tagline,
}));
console.log('\nPer-festival:');
for (const s of stats) {
  console.log(`  ${s.slug.padEnd(24)} artists:${String(s.artists).padStart(2)} days:${s.schedule_days} faqs:${s.faqs} tagline:${s.tagline ? 'yes' : '-'}`);
}
