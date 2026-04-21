# Festival Demo Landings — Handover

Built: **2026-04-21**. All 24 festival demo landings live.

> Sprzedażowe demo-appki per festiwal: każdy lead z shortlist outreach dostaje link do "swojej" appki w LineApp UI. Przekaz: "hej, mamy już Twoją appkę, chodź porozmawiajmy".

## TL;DR

- **Live URLs:** `https://demo.getlineapp.com/e8e1b9ed6c79/{slug}/` × 24
- **Admin index:** `https://demo.getlineapp.com/e8e1b9ed6c79/_admin/` (htpasswd-protected; creds w 1Password → `LineApp Festival Demo Landings` w vault `cocolab`)
- **Outreach CSV** dla kampanii: `batch/outreach.csv`
- **Source of truth:** `batch/festivals.json` (24 wpisów, pełny content)
- **Hosting:** Zenbox shared, `ssh pnut@s37.zenbox.pl` (key-based auth)
- **Root `demo.getlineapp.com/`** nietknięty — stary PHP demo dalej działa

Linear project: https://linear.app/lineapp/project/festival-demo-landings-24-57f98e6024d3 (12/12 issues Done)

---

## Architektura

```
lineapp-demo-generator/
├── index.html              ← istniejący interactive configurator (nietknięty)
├── assets/
└── batch/                  ← pipeline dla 24 landingów
    ├── package.json        (node 20+, cheerio, colorthief, sharp, playwright)
    ├── config.json         (parentHash, cal_url, mailto, deploy host)
    ├── festivals.json      (source of truth: 24 × festival data)
    ├── template.html       (preview-only, data-driven, ~41 KB)
    ├── scraper.mjs         (per-URL: logo, banner, kolory, venue)
    ├── build.mjs           (template + festivals.json → dist/)
    ├── deploy.sh           (rsync → Zenbox, NIE tyka root PHP)
    ├── qa.mjs              (Playwright screenshots × 48)
    ├── scripts/
    │   ├── init-hash.mjs       (12-hex parentHash generator, idempotent)
    │   ├── merge-scraper.mjs   (data/*.json → festivals.json, tylko loga/kolory/venue)
    │   ├── merge-enrichments.mjs (enrichments/*.json → festivals.json, lineup/schedule/faq)
    │   ├── htpasswd-gen.mjs    (SHA1 Apache format, admin auth)
    │   └── screenshot-info.mjs (debug helper)
    ├── data/               (raw scraper output, gitignored)
    ├── assets/             (downloaded logos/banners/artists, gitignored)
    ├── enrichments/        (per-festival enrichment JSON, gitignored)
    ├── dist/               (build output, gitignored)
    └── qa-screenshots/     (Playwright PNG, gitignored)
```

### Źródła treści per festiwal

Trzy warstwy (build.mjs merguje w render):
1. **Scraper** (scraper.mjs) — odwiedza oficjalną stronę festiwalu, wyciąga: logo (og:image/twitter:image/apple-touch-icon), hero banner, primaryColor (color-thief na logo), venue (JSON-LD Event/Place).
2. **Enrichment subagents** (odpalone 21.04.2026) — realne 2026 lineupy, schedule, FAQs, taglines, notes (WebSearch + Wayback Machine + festival press).
3. **Build-time defaults** — gdy scraper/enrichment puste: deterministyczny preset koloru z hasha slugu, fallback banner przez picsum.photos.

## Template (`template.html`)

Single-page, self-contained HTML:
- Tailwind CDN + Google Fonts (Epilogue, Manrope) + Material Symbols
- Phone frame 375×812 z dynamic island + status bar + 4 taby (For You, Lineup, Map, Info) + bottom nav
- Inline JSON: `<script id="festival-data">{{FESTIVAL_JSON}}</script>` + `<script id="config-data">{{CONFIG_JSON}}</script>`
- Vanilla JS na dole renderuje: Now & Next carousel, Full Lineup, Venue SVG map, Schedule accordion, FAQ toggles, CTA block
- Interakcja: klik artysta → modal z bio/image, klik dzień schedule → expand events, klik venue → Google Maps

### Placeholdery wypełniane przez build.mjs
- `{{NAME}}`, `{{TAGLINE}}`, `{{DATES}}`, `{{LOCATION}}` — tekst
- `{{LOGO_URL}}`, `{{BANNER_URL}}` — relative paths `./assets/...`
- `{{CAL_URL}}`, `{{MAILTO_HREF}}` — CTA buttons
- `{{FESTIVAL_JSON}}` — cały festival object dla client-side render
- `{{CONFIG_JSON}}` — `{cal_url, mailto_address}` dla CTA fallback logic

### Render kolorów
CSS custom props na `.phone-frame` (--primary, --surface, --on-surface etc.). Pełna paleta derivowana client-side z 3 base colors (primary, background, text) przez HSL manipulation (`derivePalette` w template JS). Paleta poprawnie nadpisuje defaults z CSS.

## Pipeline (as-run)

```
1. npm install                         → deps
2. npm run init-hash                   → generate 12-hex parentHash (idempotent)
3. npm run scrape -- --all             → scraper.mjs × 24 → data/*.json + assets/
4. node scripts/merge-scraper.mjs      → data/ → festivals.json (loga, kolory, venue)
5. [enrichment subagents]              → enrichments/*.json (real 2026 lineups)
6. node scripts/merge-enrichments.mjs  → enrichments/ → festivals.json (artists, schedule, faqs, tagline)
7. npm run build                       → dist/{parentHash}/{slug}/index.html × 24 + _admin + outreach.csv
8. ADMIN_PASS=xxx node scripts/htpasswd-gen.mjs  → dist/{parentHash}/_admin/.htpasswd
9. npm run deploy                      → rsync → Zenbox
10. npm run qa                         → Playwright screenshots × 48
```

### Htaccess routing

Obfuscated parent (`dist/{parentHash}/.htaccess`):

```
DirectoryIndex index.html
Options -Indexes
```

- Nadpisuje inherited `DirectoryIndex index.php` z roota (stary PHP demo)
- Disabled directory listing
- Nie ma auth → per-festival demos open (klik i demo się ładuje)

Admin-only (`dist/{parentHash}/_admin/.htaccess`):

```
AuthType Basic
AuthName "LineApp Demo Admin"
AuthUserFile /home/pnut/domains/demo.getlineapp.com/public_html/e8e1b9ed6c79/_admin/.htpasswd
Require valid-user
```

Scoped file-level auth, nie bleed'uje do sibling folderów (wcześniejszy bug: `<Files "index.html">` w root .htaccess chronił wszystkie 24 per-festival index.html → wszędzie 401).

## Deploy (deploy.sh)

```bash
rsync -avz --delete \
  --exclude ".DS_Store" \
  --exclude "Thumbs.db" \
  "dist/${PARENT_HASH}/" \
  "pnut@s37.zenbox.pl:~/domains/demo.getlineapp.com/public_html/${PARENT_HASH}/"
```

Safety:
- `--delete` ograniczony trailing-slashem — działa tylko w `{parentHash}/`, nie na root
- SSH key-based, key założony 2026-04-21 (`ssh-copy-id`)
- `--dry-run` flag dostępny

## QA (qa.mjs)

- Playwright chromium, `ignoreHTTPSErrors: true` (LiteSpeed cert issue)
- Per festiwal: desktop 1440×900 full-page + mobile 390×844 viewport
- Console/pageerror capture → `qa-screenshots/report.json`
- 24/24 bez JS errors

## Treść 24 festiwali — stan

**Realne 2026 lineupy (confirmed z oficjalnych źródeł):** 20/24
- Malta ("ZA MIŁOŚĆ!"): Beirut, The Blaze, Clementine, HAAi, Blessed Madonna, Two Door Cinema Club
- Open'er: The Cure, Nick Cave & The Bad Seeds, The xx, Calvin Harris
- Colours of Ostrava: Massive Attack, The National, PJ Harvey, Charli XCX, FKA twigs, Sampha
- Kazimiernikejszyn XIII: Łąki Łan, IGO, Turnau, Paktofonika Orkiestra, Natalia Przybysz
- Męskie Granie 2026: pełna trasa 6 miast (Grechuta Herbuta 2.0, Mrozu Unplugged, Zakopower × Miuosh)
- LAS "Last Dance" 10-lecie: Robag Wruhme, JakoJako, Gooral, Tal Fussman
- ZEW się budzi (żyje!): KSU, Pidżama Porno, Vavamuffin, Strachy na Lachy, Closterkeller
- Wildfire UK: Sisters Doll, Midnite City, Thieves of Liberty
- Destination Sheffield: H.E.A.T, Skid Row, Quireboys, Wildhearts, Massive Wagons
- EFG London Jazz: Samara Joy, Fatoumata Diawara, Morcheeba, GoGo Penguin, Kronos Quartet
- WHOLE Festival: HAAi, Juliana Huxtable, Miss Kittin, Octo Octa, Sherelle
- SunIce (Winter + Summer): Amelie Lens, Artbat, KAS:ST, Miss Monique
- EXIT 2026 tour (HR/MK/MT/EG/IN): Loreen, Boris Brejcha, Carl Cox, Solomun, Peggy Gou, Anyma
- Vivo Concerti / Fiera Milano Live: Olivia Dean, Lewis Capaldi, Kings of Leon, Tyler The Creator, Anyma
- Midsumma Melbourne: Courtney Act, Reuben Kaye, Mama Alto, Electric Fields
- Ameba CZ: QOTSA, Royal Blood, IDLES, Viagra Boys, Fontaines D.C.
- Paltoglou → Ejekt Festival: Arctic Monkeys, LCD Soundsystem, The Blaze, Parcels
- Pannonica, BitterSweet, Bluesfestival Baden — 2025 lineupy jako plausible fallback (2026 jeszcze nie ogłoszone)

**Plausible reconstruction (DNA zachowane):** 3/24
- FKŻ Kraków — regularni: Kroke, David Krakauer, Frank London, Daniel Kahn (stałe venues Tempel/Synagoga Kupa)
- Cirencester History — real 2025 speakers: Tracy Borman, Tom Holland, Mary Beard, Dan Snow
- Barley Arts — fikcyjny "Summer Showcase 2026" z ich roster'em: Ligabue, Vasco Rossi, Jovanotti

**Invented placeholder (explicite flagged):** 1/24
- Teodora Murareanu — "Berlin Underground Weekender" z realnymi Berlin DJ'ami (Héctor Oaks, SPFDJ, VTSS, Nene H)

## Open items (Paweł uzupełnia w `config.json`)

```json
{
  "cal_url": "",                   // gdy dodasz, "Book a call" button pojawi się
  "mailto_address": "sales@cocolab.pl",
  "mailto_subject_template": "LineApp demo dla {{festival}} — porozmawiajmy"
}
```

Po zmianie: `npm run build && npm run deploy`.

## Maintenance

**Re-scrape pojedynczego festiwalu** (np. gdy ogłoszą nowy lineup):
```bash
npm run scrape -- --slug=malta-festival
node scripts/merge-scraper.mjs --overwrite  # jeśli chcesz nadpisać nowszymi kolorami/logo
npm run build && npm run deploy
```

**Dodać festiwal:**
1. Dopisać wpis do `festivals.json` (slug, name, dates, location, website, contact)
2. `npm run scrape -- --slug=new-slug` albo ręcznie wypełnić kolory/logo
3. Opcjonalnie dopisać `enrichments/new-slug.json` z lineup
4. `npm run build && npm run deploy`

**Zmienić parentHash (wymusić nowy obfuscated URL):**
- Edit `config.json.parentHash`
- `npm run build && npm run deploy`
- **UWAGA:** stare URLe przestaną działać. Rozesłane maile będą 404.

**Usunąć festiwal z produkcji:**
- Delete wpis z `festivals.json`
- `npm run build` (nie uwzględni go w dist)
- `npm run deploy` (rsync --delete usunie folder ze serwera)

## SSH / Zenbox details

- Host: `s37.zenbox.pl`
- User: `pnut`
- Auth: SSH key (`~/.ssh/id_ed25519.pub` zainstalowany 2026-04-21 via `ssh-copy-id`)
- Credentials password-fallback w vault memory `memory/zenbox-hosting.md` (lokalne, nigdzie indziej nie puszczone)
- Path: `~/domains/demo.getlineapp.com/public_html/e8e1b9ed6c79/`

## Co NIE jest w tym deploy

- Email campaigns / outreach pipelines — osobny workflow (outreach.csv jest wejściem)
- CRM integration
- Analytics / tracking (brak UTM, brak Plausible) — intentional, demo ma być czysty
- A/B testing między wariantami demo
- Wbudowany "live chat" / intercom

## Kontakt / context

- Project lead: Paweł Orzech (pawel@cocolab.pl)
- Linear project: [Festival Demo Landings (24)](https://linear.app/lineapp/project/festival-demo-landings-24-57f98e6024d3)
- Outreach source note: `Cocolab (shared)/Leads - outreach apki festiwalowej.md` w Paweł's Obsidian vault
- Plan: `~/.claude/plans/enumerated-frolicking-acorn.md`
