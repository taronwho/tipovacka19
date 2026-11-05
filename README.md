# Tipovačka

Statická PWA aplikace pro tipování sportovních zápasů (data ve Firebase Firestore).

## Nasazení na GitHub Pages

Workflow `.github/workflows/pages.yml` při každém pushi sestaví a nasadí web.
V repozitáři je potřeba jednou nastavit **Settings → Pages → Source: GitHub Actions**.

Aplikace pak poběží na `https://taronwho.github.io/tipovacka19/`.

Složka `tools/` obsahuje pomocné PowerShell skripty pro kontrolu exportu dat (nejsou součástí webu).
