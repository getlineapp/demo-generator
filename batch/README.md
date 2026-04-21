# Festival Demo Landings (batch)

Sprzedażowe demo-landingi per festiwal — 24 sztuki pod jednym obfuscated URLem na `demo.getlineapp.com/{parentHash}/{festival-slug}/`.

Linear: https://linear.app/lineapp/project/festival-demo-landings-24-57f98e6024d3

## Setup

```bash
npm install
cp config.example.json config.json        # fill in cal_url, mailto, deploy host
cp festivals.example.json festivals.json   # or populate from your own data
```

`config.json`, `festivals.json`, and `outreach.csv` are gitignored (they contain parent-hash + lead emails).

## Flow

```
init-hash  → scrape  → (review)  → build  → deploy  → qa
```

### 1. Init parentHash (jednorazowe)

```bash
npm run init-hash
```

Generuje 12-char hex do `config.json.parentHash`. Idempotentne — jak już jest, nic nie robi.

### 2. Scrape festival data

```bash
npm run scrape -- --slug=malta-festival  # pojedynczy
npm run scrape -- --all                  # wszystkie 24
```

Pobiera z `festivals.json[].website`:
- Logo, banner
- Primary color (color-thief z logo)
- Lineup 2026 (6-10 artystów)
- Venue (JSON-LD)

Output: `data/{slug}.json` + `assets/{slug}/`

### 3. Review + merge

Dla partial/failed wyników — research (wayback, LinkedIn, agregatory) lub AI-generate plausible example. Patrz Linear APP-870.

Merge `data/{slug}.json` → `festivals.json` (one source of truth).

### 4. Build

```bash
npm run build
```

Generuje `dist/{parentHash}/` z 24 podfolderami + admin index.

### 5. Deploy

```bash
npm run deploy:dry   # sprawdzenie
npm run deploy       # upload do Zenbox
```

**UWAGA:** używa `--delete` tylko w obrębie `{parentHash}/`. Istniejące PHP demo na root nietknięte.

### 6. QA

```bash
npm run qa
```

Playwright screenshot desktop + mobile wszystkich 24 → `qa-screenshots/` + `report.json`.

## Config

`config.json`:
- `parentHash` — obfuscated parent folder (12-hex, generowany raz)
- `cal_url` — Cal.com booking link
- `mailto_address` — CTA "Let's talk" destination
- `mailto_subject_template` — subject z `{{festival}}` placeholder
- `deploy.host` / `deploy.user` — Zenbox SSH

## Structure

```
batch/
├── template.html           # base template (preview-only, z placeholderami)
├── festivals.json          # 24 wpisy — source of truth
├── config.json             # parentHash, CTA links, deploy config
├── scripts/init-hash.mjs   # 12-hex generator
├── scraper.mjs             # per-URL scrape
├── build.mjs               # static generator
├── deploy.sh               # rsync → Zenbox
├── qa.mjs                  # Playwright screenshots
├── data/                   # scraped raw (gitignored)
├── assets/                 # logo/banner/artists (gitignored)
├── dist/                   # output (gitignored)
└── qa-screenshots/         # QA output (gitignored)
```
