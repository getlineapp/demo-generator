#!/usr/bin/env node
// Scraper: per-festival URL → logo, hero banner, colors, lineup, venue.
// Output: data/{slug}.json + assets/{slug}/
//
// Usage:
//   node scraper.mjs --slug=malta-festival
//   node scraper.mjs --all
//   node scraper.mjs --slugs=malta-festival,opener

import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as cheerio from 'cheerio';
import ColorThief from 'colorthief';
import pLimit from 'p-limit';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, ...p);

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));

let targets;
if (args.all) {
  targets = festivals;
} else if (args.slugs) {
  const set = new Set(args.slugs.split(','));
  targets = festivals.filter(f => set.has(f.slug));
} else if (args.slug) {
  targets = festivals.filter(f => f.slug === args.slug);
} else {
  console.error('Usage: node scraper.mjs --slug=<slug> | --slugs=a,b | --all');
  process.exit(1);
}

if (targets.length === 0) {
  console.error('No matching festivals.');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const limit = pLimit(3);
const TIMEOUT_MS = 12000;

async function fetchText(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', ...opts.headers },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), url: res.url, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadBinary(url, destPath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(destPath), { recursive: true });
    const stream = createWriteStream(destPath);
    await pipeline(Readable.fromWeb(res.body), stream);
    return destPath;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveUrl(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}

function extFromUrl(url) {
  try {
    const u = new URL(url);
    const ext = extname(u.pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'].includes(ext)) return ext;
  } catch {}
  return '';
}

async function pickLogo($, baseUrl) {
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('link[rel="apple-touch-icon"]').attr('href'),
    $('link[rel="icon"][sizes]').attr('href'),
    $('header img').first().attr('src'),
    $('a[href="/"] img').first().attr('src'),
    $('.logo img, .site-logo img, img.logo, img[alt*="logo" i]').first().attr('src'),
  ].map(u => u && resolveUrl(baseUrl, u)).filter(Boolean);

  return candidates[0] || null;
}

async function pickBanner($, baseUrl) {
  const candidates = [
    $('meta[property="og:image:secure_url"]').attr('content'),
    $('meta[property="og:image"]').attr('content'),
    $('.hero img, .banner img, .header img, [class*="hero"] img').first().attr('src'),
    $('main img').first().attr('src'),
    $('img').first().attr('src'),
  ].map(u => u && resolveUrl(baseUrl, u)).filter(Boolean);

  return candidates[0] || null;
}

async function downloadAndProcessImage(url, outDir, filename, opts = {}) {
  if (!url) return null;
  const ext = extFromUrl(url) || '.jpg';
  const tmpPath = resolve(outDir, filename + '.raw' + ext);
  try {
    await downloadBinary(url, tmpPath);
  } catch (err) {
    return null;
  }

  // SVG — keep as-is (sharp can't resize SVG reliably)
  if (ext === '.svg') {
    const finalPath = resolve(outDir, filename + '.svg');
    try {
      const { readFileSync, writeFileSync } = await import('node:fs');
      writeFileSync(finalPath, readFileSync(tmpPath));
      return finalPath;
    } catch { return null; }
  }

  // Resize + optimize
  try {
    const width = opts.width || 1200;
    const finalExt = ext === '.png' ? '.png' : '.jpg';
    const finalPath = resolve(outDir, filename + finalExt);
    let pipeline = sharp(tmpPath).resize({ width, withoutEnlargement: true });
    if (finalExt === '.png') pipeline = pipeline.png({ quality: 85 });
    else pipeline = pipeline.jpeg({ quality: 85 });
    await pipeline.toFile(finalPath);
    return finalPath;
  } catch (err) {
    return null;
  }
}

async function dominantColor(imagePath) {
  if (!imagePath || imagePath.endsWith('.svg')) return null;
  try {
    const rgb = await ColorThief.getColor(imagePath);
    if (!rgb || rgb.length !== 3) return null;
    return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

function hexToHsl(hex) {
  hex = hex.replace('#','');
  const r = parseInt(hex.substring(0,2),16)/255;
  const g = parseInt(hex.substring(2,4),16)/255;
  const b = parseInt(hex.substring(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max===min) { h = s = 0; }
  else {
    const d = max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch (max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return { h: h*360, s: s*100, l: l*100 };
}
function hslToHex(h,s,l) {
  h = ((h%360)+360)%360;
  s = Math.max(0, Math.min(100, s));
  l = Math.max(0, Math.min(100, l));
  const sN = s/100, lN = l/100;
  const c = (1 - Math.abs(2*lN - 1)) * sN;
  const x = c * (1 - Math.abs((h/60)%2 - 1));
  const m = lN - c/2;
  let r,g,b;
  if (h<60)       { r=c; g=x; b=0; }
  else if (h<120) { r=x; g=c; b=0; }
  else if (h<180) { r=0; g=c; b=x; }
  else if (h<240) { r=0; g=x; b=c; }
  else if (h<300) { r=x; g=0; b=c; }
  else            { r=c; g=0; b=x; }
  const toHex = (v) => { const hh = Math.round((v+m)*255).toString(16); return hh.length===1 ? '0'+hh : hh; };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
function deriveBgText(primaryHex) {
  const { h, s } = hexToHsl(primaryHex);
  const bg = hslToHex(h, Math.min(s, 80), 6);     // near-black, hint of hue
  const text = hslToHex(h, Math.min(s, 30), 92);  // near-white, hint of hue
  return { background: bg, text };
}

async function findLineupLinks($, baseUrl) {
  const patterns = [
    /lineup/i, /line-up/i, /artists/i, /artyści/i, /artisti/i, /künstler/i,
    /programm/i, /program/i, /acts/i, /performers/i,
  ];
  const links = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    const text = $(a).text().trim();
    if (!href) return;
    const resolved = resolveUrl(baseUrl, href);
    if (!resolved) return;
    if (patterns.some(p => p.test(href) || p.test(text))) {
      links.add(resolved);
    }
  });
  // Dedupe + cap
  return Array.from(links).slice(0, 3);
}

async function scrapeArtistsFromPage(url) {
  try {
    const { text } = await fetchText(url);
    const $ = cheerio.load(text);
    const found = [];
    // Heuristic: find repeated img+text patterns
    $('img').each((_, img) => {
      if (found.length >= 12) return false;
      const $img = $(img);
      const src = resolveUrl(url, $img.attr('src') || $img.attr('data-src'));
      if (!src) return;
      // Get adjacent text
      const $parent = $img.parent();
      let name = $parent.find('h1, h2, h3, h4, .name, .artist-name').first().text().trim();
      if (!name) name = $img.attr('alt') || '';
      if (!name) name = $parent.text().trim().split('\n')[0].trim();
      if (!name || name.length < 2 || name.length > 60) return;
      if (/^(logo|banner|hero|festival|sponsor|partner)/i.test(name)) return;
      found.push({ name: name.slice(0, 60), image: src });
    });
    // Dedup by name
    const seen = new Set();
    return found.filter(a => {
      const k = a.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 10);
  } catch { return []; }
}

async function scrapeVenue($) {
  const jsonLds = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const data = JSON.parse($(s).text());
      jsonLds.push(data);
    } catch {}
  });
  for (const d of jsonLds) {
    const items = Array.isArray(d) ? d : (d['@graph'] || [d]);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const types = [].concat(item['@type'] || []);
      if (types.some(t => /Event|Festival|Place/i.test(t))) {
        const loc = item.location || item;
        const name = loc.name || item.name || null;
        const address = typeof loc.address === 'string' ? loc.address
          : (loc.address && [loc.address.streetAddress, loc.address.addressLocality, loc.address.addressCountry].filter(Boolean).join(', '))
          || null;
        const lat = loc.geo?.latitude || null;
        const lng = loc.geo?.longitude || null;
        const mapsUrl = lat && lng
          ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
          : name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}` : null;
        if (name || address) return { name, address, lat, lng, mapsUrl };
      }
    }
  }
  return null;
}

// ==========================================
// Main
// ==========================================

async function scrapeOne(fest) {
  const result = {
    slug: fest.slug,
    scraping_status: 'pending',
    scraped_at: new Date().toISOString(),
    warnings: [],
  };

  if (!fest.website) {
    result.scraping_status = 'no_website';
    result.warnings.push('No website in festivals.json');
    return result;
  }

  const outDir = cwd('assets', fest.slug);
  mkdirSync(outDir, { recursive: true });

  let $, baseUrl;
  try {
    const { text, url } = await fetchText(fest.website);
    baseUrl = url;
    $ = cheerio.load(text);
  } catch (err) {
    result.scraping_status = 'failed';
    result.warnings.push('Fetch error: ' + err.message);
    return result;
  }

  // Logo
  const logoUrl = await pickLogo($, baseUrl);
  let logoPath = null;
  if (logoUrl) {
    logoPath = await downloadAndProcessImage(logoUrl, outDir, 'logo', { width: 400 });
  }
  if (!logoPath) result.warnings.push('No logo found');

  // Banner
  const bannerUrl = await pickBanner($, baseUrl);
  let bannerPath = null;
  if (bannerUrl) {
    bannerPath = await downloadAndProcessImage(bannerUrl, outDir, 'banner', { width: 1200 });
  }
  if (!bannerPath) result.warnings.push('No banner found');

  // Colors
  let primary = null;
  if (logoPath) primary = await dominantColor(logoPath);
  if (!primary && bannerPath) primary = await dominantColor(bannerPath);

  let background = null, text = null;
  if (primary) {
    const derived = deriveBgText(primary);
    background = derived.background;
    text = derived.text;
  } else {
    result.warnings.push('No dominant color — preset will be used');
  }

  // Lineup
  const lineupLinks = await findLineupLinks($, baseUrl);
  let artists = [];
  for (const link of lineupLinks) {
    const found = await scrapeArtistsFromPage(link);
    if (found.length > artists.length) artists = found;
    if (artists.length >= 6) break;
  }
  // Download artist images
  if (artists.length) {
    const artistsDir = resolve(outDir, 'artists');
    mkdirSync(artistsDir, { recursive: true });
    const withImages = await Promise.all(artists.map(async (a, i) => {
      const localPath = await downloadAndProcessImage(a.image, artistsDir, String(i), { width: 300 });
      return { ...a, image: localPath ? `assets/${fest.slug}/artists/${basename(localPath)}` : null };
    }));
    artists = withImages.filter(a => a.image);
  }
  if (artists.length === 0) result.warnings.push('No artists scraped');

  // Venue
  const venue = await scrapeVenue($);
  if (!venue) result.warnings.push('No venue JSON-LD');

  // Finalize
  result.logoPath = logoPath ? `assets/${fest.slug}/${basename(logoPath)}` : null;
  result.bannerPath = bannerPath ? `assets/${fest.slug}/${basename(bannerPath)}` : null;
  result.primaryColor = primary;
  result.backgroundColor = background;
  result.textColor = text;
  result.artists = artists;
  result.venue = venue;

  const missingCore = !logoPath || !primary || artists.length === 0;
  result.scraping_status = missingCore ? 'partial' : 'ok';
  return result;
}

console.log(`Scraping ${targets.length} festival(s)…`);
const results = [];
await Promise.all(targets.map(fest => limit(async () => {
  const result = await scrapeOne(fest);
  const outPath = cwd('data', `${fest.slug}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  results.push(result);
  console.log(`  [${result.scraping_status.padEnd(8)}] ${fest.slug} — logo:${result.logoPath ? '✓' : '✗'} color:${result.primaryColor || '—'} artists:${result.artists?.length || 0} venue:${result.venue ? '✓' : '✗'}`);
})));

// Summary
const byStatus = {};
for (const r of results) byStatus[r.scraping_status] = (byStatus[r.scraping_status] || 0) + 1;
console.log('\nSummary:', byStatus);
console.log(`Output: data/*.json + assets/*/`);
