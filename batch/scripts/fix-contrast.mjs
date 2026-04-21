#!/usr/bin/env node
// Audit every festival palette. Guarantee readable contrast without swapping the
// festival's brand hue when possible:
//   • If primary is null → deterministic preset from slug.
//   • If near-white (s<10, l>85) → keep (white-on-dark works).
//   • Else: boost L to >=55 and S to >=35 (keeps hue, drops muddy grays).
//   • Re-derive background (hue-tinted near-black) and text (hue-tinted near-white).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, '..', ...p);

const PRESETS = [
  { primaryColor: '#ff8f7a', backgroundColor: '#240306', textColor: '#ffdede' },
  { primaryColor: '#7aafff', backgroundColor: '#031224', textColor: '#dee8ff' },
  { primaryColor: '#7aff8f', backgroundColor: '#032406', textColor: '#deffde' },
  { primaryColor: '#b07aff', backgroundColor: '#0e0324', textColor: '#e8deff' },
  { primaryColor: '#ffc77a', backgroundColor: '#241403', textColor: '#ffedde' },
];

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
function presetForSlug(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PRESETS[h % PRESETS.length];
}

// Luminance + contrast (WCAG relative luminance, simplified)
function relLum(hex) {
  hex = hex.replace('#','');
  const c = [0,2,4].map(i => parseInt(hex.substring(i, i+2), 16) / 255);
  const [r, g, b] = c.map(v => v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function contrast(hex1, hex2) {
  const l1 = relLum(hex1), l2 = relLum(hex2);
  const lo = Math.min(l1, l2), hi = Math.max(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// Light-mode presets: primary mid-dark, bg near-white, text near-black
const LIGHT_PRESETS = [
  { primaryColor: '#e54b6f', backgroundColor: '#fdf7f9', textColor: '#1a0a0f' },
  { primaryColor: '#3c6fd4', backgroundColor: '#f7f9fd', textColor: '#0a0f1a' },
  { primaryColor: '#2f9a4a', backgroundColor: '#f7fdf9', textColor: '#0a1a0f' },
  { primaryColor: '#8647d4', backgroundColor: '#faf7fd', textColor: '#0f0a1a' },
  { primaryColor: '#d48000', backgroundColor: '#fdfaf5', textColor: '#1a0f0a' },
];

function fixPalette(primary, slug) {
  if (!primary) {
    const p = LIGHT_PRESETS[[...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0) % LIGHT_PRESETS.length];
    return { primary: p.primaryColor, background: p.backgroundColor, text: p.textColor };
  }
  const hsl = hexToHsl(primary);
  let { h, s, l } = hsl;

  // Light mode rules:
  // - Primary must contrast against near-white bg → force L into [35, 55]
  // - Ensure saturation so the brand colour still reads (muddy grays become branded)
  if (l < 35) l = 45;
  if (l > 55) l = 50;
  if (s < 25) s = 60;

  // Background: very light, barely tinted with the brand hue so it feels branded, not sterile.
  const bg = hslToHex(h, Math.min(s * 0.15, 10), 97);
  // Text: near-black, slight hue warm so it feels softer than pure black.
  const text = hslToHex(h, Math.min(s * 0.3, 20), 12);

  // Hues with naturally high luminance (yellow/green/cyan ≈ 40-200°) can still
  // fall below WCAG AA on white. Iteratively darken primary until contrast ≥ 3.5.
  let fixedPrimary = hslToHex(h, s, l);
  while (contrast(fixedPrimary, bg) < 3.5 && l > 15) {
    l -= 4;
    fixedPrimary = hslToHex(h, s, l);
  }

  return { primary: fixedPrimary, background: bg, text };
}

const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));
const report = [];

for (const fest of festivals) {
  const before = { p: fest.primaryColor, b: fest.backgroundColor, t: fest.textColor };
  const { primary, background, text } = fixPalette(fest.primaryColor, fest.slug);
  fest.primaryColor = primary;
  fest.backgroundColor = background;
  fest.textColor = text;

  const pBg = contrast(primary, background).toFixed(2);
  const tBg = contrast(text, background).toFixed(2);
  const changed = before.p !== primary || before.b !== background || before.t !== text;
  report.push({ slug: fest.slug, changed, before, primary, background, text, pBg, tBg });
}

writeFileSync(cwd('festivals.json'), JSON.stringify(festivals, null, 2) + '\n');

const changed = report.filter(r => r.changed).length;
console.log(`Fixed ${changed}/${festivals.length} palettes (contrast-aware).\n`);
console.log('slug                     primary  ↑   bg       text     contrast P/BG  T/BG');
console.log('────────────────────────────────────────────────────────────────────────────');
for (const r of report) {
  const flag = r.changed ? '*' : ' ';
  const pRatio = Number(r.pBg);
  const tRatio = Number(r.tBg);
  const warnP = pRatio < 3.0 ? '⚠' : ' ';
  const warnT = tRatio < 4.5 ? '⚠' : ' ';
  console.log(`${flag} ${r.slug.padEnd(22)}  ${r.primary}  ${r.background}  ${r.text}   ${r.pBg.padStart(5)}${warnP}  ${r.tBg.padStart(5)}${warnT}`);
}
console.log('\nWCAG targets: P/BG ≥ 3.0 (large text/UI), T/BG ≥ 4.5 (body text)');
