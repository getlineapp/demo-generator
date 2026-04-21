#!/usr/bin/env node
// Build: template.html + festivals.json + config.json → dist/{parentHash}/{slug}/index.html
// Plus: dist/{parentHash}/index.html (admin listing, htpasswd-protected in deploy)
// Plus: dist/{parentHash}/.htaccess (protects only the admin index, not per-festival pages)
// Plus: outreach.csv

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = (...p) => resolve(here, ...p);

const config = JSON.parse(readFileSync(cwd('config.json'), 'utf8'));
const festivals = JSON.parse(readFileSync(cwd('festivals.json'), 'utf8'));
const template = readFileSync(cwd('template.html'), 'utf8');

if (!config.parentHash || config.parentHash === 'TBD') {
  console.error('ERROR: parentHash not set. Run: npm run init-hash');
  process.exit(1);
}

const distRoot = cwd('dist', config.parentHash);
if (existsSync(cwd('dist'))) {
  rmSync(cwd('dist'), { recursive: true, force: true });
}
mkdirSync(distRoot, { recursive: true });

// Preset fallback colours (if festival's palette was not scraped yet)
const DEFAULT_PALETTE = { primaryColor: '#ff8f7a', backgroundColor: '#240306', textColor: '#ffdede' };

// Pick a deterministic preset from a slug for a visually varied fallback.
const PRESETS = [
  { primaryColor: '#ff8f7a', backgroundColor: '#240306', textColor: '#ffdede' },
  { primaryColor: '#7aafff', backgroundColor: '#031224', textColor: '#dee8ff' },
  { primaryColor: '#7aff8f', backgroundColor: '#032406', textColor: '#deffde' },
  { primaryColor: '#b07aff', backgroundColor: '#0e0324', textColor: '#e8deff' },
  { primaryColor: '#ffc77a', backgroundColor: '#241403', textColor: '#ffedde' },
];
function presetForSlug(slug) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PRESETS[h % PRESETS.length];
}

// Build mailto for festival
function mailtoFor(fest) {
  const to = config.mailto_address || 'sales@cocolab.pl';
  const subject = (config.mailto_subject_template || 'LineApp demo for {{festival}}')
    .replaceAll('{{festival}}', fest.name);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}`;
}

function calFor(_fest) {
  return config.cal_url || '#';
}

// Fallback images when no logo/banner yet
function fallbackBanner(fest) {
  const seed = encodeURIComponent(fest.slug + '-banner');
  return `https://picsum.photos/seed/${seed}/750/500`;
}
function fallbackLogo(_fest) {
  // transparent 1x1 pixel (hidden by build — template keeps visual logo as text fallback)
  return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==';
}

function renderFestival(fest) {
  const palette = (fest.primaryColor && fest.backgroundColor && fest.textColor)
    ? { primaryColor: fest.primaryColor, backgroundColor: fest.backgroundColor, textColor: fest.textColor }
    : presetForSlug(fest.slug || '');

  // Inject the palette into festival object (for client-side JS)
  const festData = {
    ...fest,
    primaryColor: palette.primaryColor,
    backgroundColor: palette.backgroundColor,
    textColor: palette.textColor,
  };

  // Resolve asset paths (relative to page)
  const logoUrl = fest.logoPath ? `./assets/${asBasename(fest.logoPath)}` : fallbackLogo(fest);
  const bannerUrl = fest.bannerPath ? `./assets/${asBasename(fest.bannerPath)}` : fallbackBanner(fest);

  const mailto = mailtoFor(fest);
  const cal = calFor(fest);

  let html = template;
  html = html.replaceAll('{{NAME}}', escapeAttr(fest.name || ''));
  html = html.replaceAll('{{TAGLINE}}', escapeAttr(fest.tagline || ''));
  html = html.replaceAll('{{DATES}}', escapeAttr(fest.dates || ''));
  html = html.replaceAll('{{LOCATION}}', escapeAttr(fest.location || ''));
  html = html.replaceAll('{{LOGO_URL}}', logoUrl);
  html = html.replaceAll('{{BANNER_URL}}', bannerUrl);
  html = html.replaceAll('{{CAL_URL}}', escapeAttr(cal));
  html = html.replaceAll('{{MAILTO_HREF}}', escapeAttr(mailto));

  // JSON blobs — embed safely. JSON is already JS-safe, but escape </script> just in case.
  html = html.replaceAll('{{FESTIVAL_JSON}}', safeJson(festData));
  html = html.replaceAll('{{CONFIG_JSON}}', safeJson({
    cal_url: config.cal_url || '',
    mailto_address: config.mailto_address || '',
  }));

  return html;
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function asBasename(p) {
  return p.replace(/^.*[\\/]/, '');
}

// Build per-festival pages
let built = 0;
for (const fest of festivals) {
  if (!fest.slug) continue;
  const outDir = join(distRoot, fest.slug);
  mkdirSync(outDir, { recursive: true });

  // Copy assets if available (skip .raw.* originals from scraper)
  const assetsSrc = cwd('assets', fest.slug);
  if (existsSync(assetsSrc)) {
    const assetsDst = join(outDir, 'assets');
    cpSync(assetsSrc, assetsDst, {
      recursive: true,
      filter: (src) => !/\.raw\.[a-z]+$/i.test(src),
    });
  }

  const html = renderFestival(fest);
  writeFileSync(join(outDir, 'index.html'), html);
  built++;
}

// Admin index (listing) — protected by .htaccess + .htpasswd in deploy
const adminIndex = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Admin · Festival Demos</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <style>
    :root { --ring: #ff8f7a; --muted: rgba(255,255,255,0.55); }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', sans-serif;
      background: #0a0a14; color: #f4f4f8;
      padding: 2rem 1rem;
      max-width: 980px; margin: 0 auto;
      line-height: 1.45;
    }
    header { border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 1rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.4rem; font-weight: 700; letter-spacing: -0.01em; }
    .sub { font-size: 0.85rem; color: var(--muted); }
    .sub code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; }
    ol.fest-list { list-style: none; padding: 0; margin: 0; counter-reset: fest; }
    ol.fest-list li {
      counter-increment: fest;
      display: grid;
      grid-template-columns: 2.5rem 1fr auto;
      align-items: center;
      gap: 0.75rem;
      padding: 0.8rem 0.6rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      transition: background-color 0.15s ease;
    }
    ol.fest-list li:hover { background: rgba(255,255,255,0.03); }
    ol.fest-list li::before {
      content: counter(fest, decimal-leading-zero);
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8rem;
      text-align: right;
    }
    .body { min-width: 0; }
    .name { font-weight: 600; font-size: 1rem; }
    .meta-row {
      display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem;
      font-size: 0.78rem;
      color: var(--muted);
      margin-top: 0.15rem;
    }
    .meta-row .dot::before { content: '·'; margin-right: 0.75rem; color: rgba(255,255,255,0.3); }
    .meta-row a { color: var(--muted); text-decoration: none; }
    .meta-row a:hover { color: #fff; text-decoration: underline; }
    .notes {
      color: rgba(255,255,255,0.35);
      font-size: 0.72rem;
      margin-top: 0.25rem;
      font-style: italic;
    }
    .open-btn {
      white-space: nowrap;
      background: var(--ring);
      color: #0a0a14;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.82rem;
    }
    .open-btn:hover { background: #ffb49c; }
    @media (max-width: 640px) {
      ol.fest-list li { grid-template-columns: 1.8rem 1fr; }
      .open-btn { grid-column: 1 / -1; justify-self: start; margin-top: 0.25rem; }
      ol.fest-list li::before { align-self: start; padding-top: 2px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Festival Demo Landings (${festivals.length})</h1>
    <div class="sub">Parent hash <code>${config.parentHash}</code> · Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · htpasswd-protected. Per-festival pages are open.</div>
  </header>
  <ol class="fest-list">
  ${festivals.map(f => `
    <li>
      <div class="body">
        <div class="name">${escapeAttr(f.name || f.slug)}</div>
        <div class="meta-row">
          ${f.dates ? `<span>${escapeAttr(f.dates)}</span><span class="dot"></span>` : ''}
          ${f.location ? `<span>${escapeAttr(f.location)}</span><span class="dot"></span>` : ''}
          ${f.contactEmail ? `<a href="mailto:${escapeAttr(f.contactEmail)}">${escapeAttr(f.contactName || f.contactEmail)}</a>` : '<span>no contact</span>'}
        </div>
        ${f.notes ? `<div class="notes">${escapeAttr(f.notes).slice(0, 180)}${(f.notes || '').length > 180 ? '…' : ''}</div>` : ''}
      </div>
      <a class="open-btn" href="../${f.slug}/" target="_blank" rel="noopener">Open demo →</a>
    </li>
  `).join('')}
  </ol>
</body>
</html>
`;
// Put admin in its own subfolder so .htaccess file-level auth doesn't bleed
// into per-festival index.html pages (Apache/LiteSpeed <Files> is recursive).
const adminDir = join(distRoot, '_admin');
mkdirSync(adminDir, { recursive: true });
writeFileSync(join(adminDir, 'index.html'), adminIndex);

const htaccessDir = config.deploy?.base_path?.replace('~', '/home/' + (config.deploy?.user || 'pnut')) || '/home/pnut/domains/demo.getlineapp.com/public_html';
const htaccessAdmin = `# Auto-generated by build.mjs — protects the admin listing
AuthType Basic
AuthName "LineApp Demo Admin"
AuthUserFile ${htaccessDir}/${config.parentHash}/_admin/.htpasswd
Require valid-user
`;
writeFileSync(join(adminDir, '.htaccess'), htaccessAdmin);

// Parent folder .htaccess — override inherited DirectoryIndex index.php (from demo root)
// so that `/{parentHash}/{slug}/` serves index.html by default.
writeFileSync(join(distRoot, '.htaccess'),
  `DirectoryIndex index.html\n` +
  `Options -Indexes\n`
);

// Outreach CSV
const csvHeader = 'festival,slug,url,contact_name,contact_email,country,notes';
const csvRows = festivals.map(f => {
  const url = `https://demo.getlineapp.com/${config.parentHash}/${f.slug}/`;
  return [f.name, f.slug, url, f.contactName || '', f.contactEmail || '', f.country || '', (f.notes || '').replace(/\n/g, ' ')]
    .map(csvEscape).join(',');
});
writeFileSync(cwd('outreach.csv'), [csvHeader, ...csvRows].join('\n') + '\n');

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

console.log(`Built ${built} festival pages + admin index.`);
console.log(`Output: ${distRoot}/`);
console.log(`Admin:  dist/${config.parentHash}/index.html  (htpasswd-protected after deploy)`);
console.log(`CSV:    outreach.csv`);
