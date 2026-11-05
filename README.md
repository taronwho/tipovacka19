# Tipovačka

Statická PWA aplikace pro tipování sportovních zápasů (data ve Firebase Firestore).

## Nasazení na GitHub Pages

Web se publikuje z větve `gh-pages` (Settings → Pages → Deploy from a branch).
Alternativně lze použít workflow `.github/workflows/pages.yml` (Settings → Pages → Source: GitHub Actions).

Aplikace pak poběží na `https://taronwho.github.io/tipovacka19/`.

Složka `tools/` obsahuje pomocné PowerShell skripty a starší export dat (nejsou součástí webu).

## Struktura

- `index.html` – kostra stránky a modální okna
- `app.js` – logika (data/cloud, skóre a odznaky, vykreslení, AI import, sdílení)
- `style.css` – vzhled
- `sw.js` – offline cache (jen vlastní soubory aplikace)
- `ms2026_data.json` – záloha, zobrazí se jen když není dostupný cloud (nikdy se do cloudu nenahrává)
