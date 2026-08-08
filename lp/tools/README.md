# Narzędzia robocze landingów LineApp (v7/v8, sierpień 2026)

Zachowane z sesji budowy landingów v7 Cupertino / v8 One Island (oba odrzucone —
kontekst i handoff: repo `operacje`, gałąź `claude/lineapp-apple-design-patterns-utuusb`,
notatka `LineApp - strona www - v9 brief - wierna replika iPhone 14.md`).
Do reuse przy v9 (replika strony Apple iPhone 14).

Uruchamianie: `node <skrypt> <ścieżka-do-html>` (wymaga Playwright + Chromium).

- `pw-film-v8.mjs` — „film-test": jedzie po klatkach postępu scrolla (P=0.02–0.95)
  i asercjami sprawdza stan scen (data-scene/feed/phase, stany Dynamic Island,
  widoczność sekcji po sticky stage'u, countery, FAQ↔JSON-LD, brak overflow-x,
  zero błędów JS). 3 przebiegi: desktop 1440 / mobile 390 / reduced-motion.
  Zrzuca też klatki PNG do katalogu `film/`.
- `pw-scroll-test.mjs` — starszy, ogólny test scrolla (v7); zostawiony jako baza.
- `faq-lint.mjs` — pilnuje 1:1 między widocznym FAQ a JSON-LD FAQPage.
- `artifact-build.mjs` — składa self-contained HTML (inline assetów) i sprawdza
  rozmiar + działanie offline.
