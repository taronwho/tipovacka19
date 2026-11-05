'use strict';
// === Tipovačka — multi-tournament app ===

// ---------- Konstanty ----------
const ALL = '__all__';
const LS = { tournaments: 'ms_tournaments', active: 'ms_active_tournament', apiKey: 'geminiApiKey', firebase: 'firebaseConfig',
  adminPass: 'adminPassword', userPass: 'userAdminPass', ai: 'ms_ai_predictions' };
const DEFAULT_FIREBASE = {
  apiKey: 'AIzaSyCK4A7MVEmgVXneiSmy73ymHS_2XLfqJlI',
  authDomain: 'tipovacka19.firebaseapp.com',
  projectId: 'tipovacka19',
  storageBucket: 'tipovacka19.firebasestorage.app',
  messagingSenderId: '602639029659',
  appId: '1:602639029659:web:2e1d6c5b02bc8691fcfd3e',
  measurementId: 'G-PJVGFTMKKE'
};
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const DAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const MEDALS = { 1: 'medal_gold.jpg', 2: 'medal_silver.jpg', 3: 'medal_bronze.jpg' };
const OT_HINT = 'Pokud šlo o prodloužení nebo nájezdy (značky "p", "PP", "prodl.", "OT", "SO", "sn", "pen", "nájezdy"), přidej na konec skóre písmeno "p" (např. "3:2p").';

// ---------- Stav ----------
const ls = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { console.warn('localStorage', e); } },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
};
let tournaments = ls.json(LS.tournaments, []);
let activeTournamentId = ls.get(LS.active) || null;
let db = null, cloudUnsubscribe = null, cloudReady = false;
let isAdmin = true;
const expandedMatches = new Set();

// ---------- Utility ----------
const $ = s => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const getApiKey = () => ls.get(LS.apiKey);
const resultType = (h, a) => (h > a ? 1 : h < a ? 2 : 0);
const tipKey = (matchId, player) => `${matchId}|${player}`;
const isImgIcon = icon => String(icon || '').startsWith('data:image/');
const iconHtml = (icon, cls = 'ico') => isImgIcon(icon) ? `<img src="${esc(icon)}" class="${cls}" alt="">` : `<span class="${cls}">${esc(icon || '🏆')}</span>`;
const medalHtml = (rank, cls = 'medal') => MEDALS[rank] ? `<img src="${MEDALS[rank]}" class="${cls}" alt="${rank}.">` : `${rank}.`;
const medalEmoji = rank => ['🥇', '🥈', '🥉'][rank - 1] || `${rank}.`;

function formatDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return isNaN(date) ? s : `${DAYS[date.getDay()]} ${d}.${m}.`;
}

/** "3:2", "3-2 pp", "3:2p" → { h, a, ot } */
function parseScore(s) {
  const m = String(s ?? '').match(/(\d+)\s*[:\-x]\s*(\d+)\s*(.*)/i);
  if (!m) return null;
  return { h: +m[1], a: +m[2], ot: /p|ot|so|sn|n[aá]j/i.test(m[3]) };
}
const scoreStr = ({ h, a, ot }) => `${h}:${a}${ot ? 'p' : ''}`;

const byKickoff = (a, b) => (!a.date - !b.date) || (a.date || '').localeCompare(b.date || '')
  || (a.time && b.time ? a.time.localeCompare(b.time) : 0) || (a.order || 0) - (b.order || 0);
const sortedMatches = t => [...(t.matches || [])].sort(byKickoff);
const finishedMatches = t => sortedMatches(t).filter(m => m.result != null);

function tipIndex(t) {
  const map = new Map();
  (t.tips || []).forEach(tip => map.set(tipKey(tip.matchId, tip.playerName), tip));
  return map;
}

/** Body za tip: 1 b za správnou tendenci 1-0-2, 3 b za přesné skóre. */
function tipPoints(tip, m) {
  if (!tip || m.result == null) return 0;
  return (tip.tipType === m.resultType ? 1 : 0) + (tip.tipScore && tip.tipScore === m.result ? 3 : 0);
}

/** Najde zápas podle textu z AI ("Domácí - Hosté"). Prázdný text nic nenajde. */
function findMatch(matches, label) {
  const n = norm(label);
  if (n.length < 3) return null;
  const key = m => norm(m.homeTeam + m.awayTeam);
  return matches.find(m => key(m) === n) || matches.find(m => key(m).includes(n) || n.includes(key(m))) || null;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}
const openModal = id => document.getElementById(id).classList.add('active');
const closeModal = id => document.getElementById(id).classList.remove('active');
const setLoading = (id, on, btn) => { $(id).hidden = !on; if (btn) $(btn).disabled = on; };

/** Načte obrázek a zmenší ho (šetří místo ve Firestore i data pro AI). */
function readImage(file, maxSize = 2048, quality = 0.88) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Vyberte obrázek'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Obrázek nelze načíst')); };
    img.src = url;
  });
}

// ---------- Data / cloud ----------
function getCombinedTournamentData() {
  const players = new Set(), matches = [], tips = [];
  tournaments.forEach(t => {
    (t.players || []).forEach(p => players.add(p));
    (t.matches || []).forEach(m => matches.push({ ...m, id: `${t.id}_${m.id}`, tournamentName: t.name }));
    (t.tips || []).forEach(tip => tips.push({ ...tip, id: `${t.id}_${tip.id}`, matchId: `${t.id}_${tip.matchId}` }));
  });
  return { id: ALL, name: 'Všechny tipovačky', icon: '🌐', players: [...players], matches, tips };
}
const getT = () => activeTournamentId === ALL ? getCombinedTournamentData() : tournaments.find(t => t.id === activeTournamentId);
const isAllView = () => activeTournamentId === ALL;

function persistLocal() {
  ls.set(LS.tournaments, JSON.stringify(tournaments));
  ls.set(LS.active, activeTournamentId || '');
}

/** Uloží lokálně a (pokud je cloud) zapíše danou tipovačku do Firestore. */
function save(t = getT()) {
  persistLocal();
  if (!db || !t || t.id === ALL) return;
  db.collection('tournaments').doc(t.id).set(JSON.parse(JSON.stringify(t))).catch(err => {
    console.error('Firestore save error:', err);
    showToast('Chyba při ukládání do cloudu', 'error');
  });
}

function ensureActive() {
  if (activeTournamentId === ALL && tournaments.length > 1) return;
  if (!tournaments.some(t => t.id === activeTournamentId)) activeTournamentId = tournaments[0]?.id || null;
}

function setCloudStatus(state) {
  const el = $('#cloudStatus');
  const map = { online: ['☁️ Online', 'Připojeno ke cloudu – synchronizace v reálném čase'],
    loading: ['☁️ Připojování…', 'Připojování ke cloudu…'], offline: ['☁️ Místní', 'Data jsou jen v tomto prohlížeči'] };
  el.className = `cloud-status ${state}`;
  [el.textContent, el.title] = map[state];
}

function getFirebaseConfig() {
  const raw = ls.get(LS.firebase);
  if (!raw) return DEFAULT_FIREBASE;
  try { return JSON.parse(raw); } catch { showToast('Neplatná Firebase konfigurace', 'error'); return null; }
}

function refreshAdmin() {
  const pass = ls.get(LS.adminPass);
  isAdmin = !pass || pass === ls.get(LS.userPass);
}

function checkAdminPermission() {
  refreshAdmin();
  if (isAdmin) return true;
  const pass = prompt('Zadejte administrátorské heslo:');
  if (pass !== null && pass === ls.get(LS.adminPass)) {
    ls.set(LS.userPass, pass); isAdmin = true;
    showToast('Ověřeno – jste přihlášen/a jako admin');
    return true;
  }
  if (pass !== null) showToast('Chybné heslo!', 'error');
  return false;
}

/** Záložní soubor se použije jen lokálně a jen když není cloud – nikdy se automaticky nenahrává. */
async function loadBackupLocally() {
  if (tournaments.length) return;
  try {
    const data = await (await fetch('ms2026_data.json')).json();
    if (!data?.id || tournaments.length) return;
    tournaments = [data]; activeTournamentId = data.id;
    renderAll();
    showToast('Cloud není dostupný – zobrazena záložní data', 'warning');
  } catch (e) { console.warn('Záloha nenalezena', e); }
}

function initFirebase() {
  const config = getFirebaseConfig();
  if (!config || typeof firebase === 'undefined') {
    setCloudStatus('offline');
    if (config) showToast('Firebase se nenačetlo – pracuji offline', 'error');
    loadBackupLocally();
    return;
  }
  try {
    setCloudStatus('loading');
    if (!firebase.apps.length) firebase.initializeApp(config);
    db = firebase.firestore();
    cloudUnsubscribe?.();
    cloudUnsubscribe = db.collection('tournaments').onSnapshot(snapshot => {
      const cloud = snapshot.docs.map(d => d.data());
      setCloudStatus('online');
      if (!cloud.length && !cloudReady && tournaments.length) {
        // Prázdný cloud + data v prohlížeči → jednorázová migrace do cloudu
        tournaments.forEach(t => db.collection('tournaments').doc(t.id).set(t).catch(console.error));
        showToast('Data nahrána do cloudu');
      } else {
        tournaments = cloud;
        ensureActive();
        persistLocal();
        renderAll();
      }
      cloudReady = true;
    }, err => {
      console.error('Firestore error:', err);
      setCloudStatus('offline');
      cloudReady = true;
      renderAll();
      loadBackupLocally();
      showToast('Cloud nedostupný – zkontrolujte pravidla Firestore', 'error');
    });
  } catch (e) {
    console.error('Firebase init error:', e);
    setCloudStatus('offline');
    showToast('Chyba Firebase: ' + e.message, 'error');
  }
}

// ---------- Skóre a statistiky ----------
function calculateScores(t = getT()) {
  if (!t) return [];
  const idx = tipIndex(t), fin = finishedMatches(t);
  const rows = t.players.map(name => {
    const s = { name, points: 0, correct102: 0, correctScore: 0 };
    fin.forEach(m => {
      const tip = idx.get(tipKey(m.id, name));
      if (!tip) return;
      if (tip.tipType === m.resultType) { s.points += 1; s.correct102++; }
      if (tip.tipScore && tip.tipScore === m.result) { s.points += 3; s.correctScore++; }
    });
    return s;
  }).sort((a, b) => b.points - a.points || b.correctScore - a.correctScore);
  // Sdílené pořadí při shodě bodů i přesných skóre
  rows.forEach((s, i) => {
    const p = rows[i - 1];
    s.rank = p && p.points === s.points && p.correctScore === s.correctScore ? p.rank : i + 1;
  });
  return rows;
}

/** Průběžné body po každém odehraném zápase (pro graf). */
function pointsTimeline(t) {
  const idx = tipIndex(t), fin = finishedMatches(t);
  const history = Object.fromEntries(t.players.map(p => [p, [0]]));
  fin.forEach(m => t.players.forEach(p => {
    const h = history[p];
    h.push(h[h.length - 1] + tipPoints(idx.get(tipKey(m.id, p)), m));
  }));
  return { fin, history };
}

const isCzech = name => /čes|czech|cesk/i.test(name || '');

function calculatePlayerStats(t = getT()) {
  if (!t) return { playerStats: {}, badges: {} };
  const players = t.players, idx = tipIndex(t), fin = finishedMatches(t);
  const ps = Object.fromEntries(players.map(p => [p, {
    exactScores: 0, correctOutcomes: 0, totalPoints: 0, playedTips: 0, missingTips: 0, drawTipsCorrect: 0,
    closeCalls: 0, rebelTips: 0, czechWinTips: 0, correctShutouts: 0, goalsTipped: 0, scoreTips: 0,
    leaderCount: 0, streak: 0, maxStreak: 0, bestRank: null, worstRank: null, currentRank: 1
  }]));

  // Patriot a průměr tipovaných gólů – ze všech tipů
  (t.matches || []).forEach(m => {
    const home = isCzech(m.homeTeam), away = isCzech(m.awayTeam);
    players.forEach(p => {
      const tip = idx.get(tipKey(m.id, p)); if (!tip) return;
      const sc = parseScore(tip.tipScore);
      if (sc) { ps[p].goalsTipped += sc.h + sc.a; ps[p].scoreTips++; }
      if (home || away) {
        const czWin = (sc && (home ? sc.h > sc.a : sc.a > sc.h)) || (home ? tip.tipType === 1 : tip.tipType === 2);
        if (czWin) ps[p].czechWinTips++;
      }
    });
  });

  const totals = Object.fromEntries(players.map(p => [p, 0]));
  fin.forEach((m, i) => {
    const mTips = players.map(p => idx.get(tipKey(m.id, p))).filter(Boolean);
    // Rebel = správný tip, který si vybrala menšina skupiny
    const counts = { 0: 0, 1: 0, 2: 0 };
    mTips.forEach(tip => counts[tip.tipType]++);
    const res = parseScore(m.result);

    players.forEach(p => {
      const s = ps[p], tip = idx.get(tipKey(m.id, p));
      if (!tip) { s.missingTips++; s.streak = 0; return; }
      s.playedTips++;
      const outcome = tip.tipType === m.resultType, exact = !!tip.tipScore && tip.tipScore === m.result;
      if (outcome) { s.correctOutcomes++; if (m.resultType === 0) s.drawTipsCorrect++; }
      if (exact) s.exactScores++;
      const pts = tipPoints(tip, m);
      s.totalPoints += pts; totals[p] += pts;
      s.streak = pts > 0 ? s.streak + 1 : 0;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
      if (outcome && mTips.length >= 2 && counts[tip.tipType] < mTips.length / 2) s.rebelTips++;
      const ts = parseScore(tip.tipScore);
      if (ts && res) {
        if (outcome && (ts.h === 0 || ts.a === 0) && (res.h === 0 || res.a === 0)) s.correctShutouts++;
        if (!exact && Math.abs(ts.h - res.h) + Math.abs(ts.a - res.a) === 1) s.closeCalls++;
      }
    });

    // Pořadí a lídr se vyhodnocují na konci hracího dne
    if (i === fin.length - 1 || fin[i + 1].date !== m.date) {
      const ranked = players.map(p => ({ p, pts: totals[p] })).sort((a, b) => b.pts - a.pts);
      ranked.forEach((r, k) => {
        r.rank = k && ranked[k - 1].pts === r.pts ? ranked[k - 1].rank : k + 1;
        const s = ps[r.p];
        s.currentRank = r.rank;
        s.bestRank = s.bestRank === null ? r.rank : Math.min(s.bestRank, r.rank);
        s.worstRank = s.worstRank === null ? r.rank : Math.max(s.worstRank, r.rank);
        if (r.rank === 1 && r.pts > 0) s.leaderCount++;
      });
    }
  });

  players.forEach(p => {
    const s = ps[p];
    s.accuracy = s.playedTips ? Math.round((s.correctOutcomes + s.exactScores) / (s.playedTips * 2) * 100) : 0;
    s.avgPoints = s.playedTips ? (s.totalPoints / s.playedTips).toFixed(2) : '0.00';
    s.avgGoals = s.scoreTips >= 3 ? s.goalsTipped / s.scoreTips : null;
    s.climb = s.worstRank !== null ? s.worstRank - s.currentRank : 0;
    s.drop = s.bestRank !== null ? s.currentRank - s.bestRank : 0;
  });

  // Odznak získá ten, kdo má v dané statistice extrém (při shodě všichni)
  const extreme = (key, min, lowest = false) => {
    const vals = players.map(p => ps[p][key]).filter(v => v !== null && v !== undefined);
    if (!vals.length) return { val: null, players: [] };
    const val = lowest ? Math.min(...vals) : Math.max(...vals);
    if (!lowest && val < min) return { val: null, players: [] };
    return { val, players: players.filter(p => ps[p][key] === val) };
  };
  const f1 = v => v.toFixed(1);
  const BADGES = [
    ['exactScores', 1, '🎯', 'Ostrý sniper / sniperka', '#4ade80', v => `Drží rekord turnaje s ${v}× přesně trefeným skóre!`],
    ['drawTipsCorrect', 1, '⚖️', 'Diplomatický/á mírotvůrce', '#facc15', v => `Rozpoznal/a nejvíce remíz a prodloužení v turnaji (${v}×).`],
    ['closeCalls', 2, '💥', 'Smolař / smolařka turnaje', '#f87171', v => `Trefil/a těsně vedle o jediný gól celkem ${v}×.`],
    ['rebelTips', 1, '🔮', 'Odvážný rebel / rebelka', '#a855f7', v => `Trefil/a nejvíc odvážných tipů (${v}×), které šly proti většině skupiny.`],
    ['missingTips', 1, '💤', 'Zapomnětlivý profesor / profesorka', '#94a3b8', v => `Zapomněl/a natipovat nejvíce odehraných zápasů (${v}×).`],
    ['leaderCount', 1, '👑', 'Neochvějný lídr / lídryně', '#f97316', v => `Byl/a na 1. místě po nejvíce hracích dnech (${v}×).`],
    ['avgGoals', 0, '🛡️', 'Defenzivní betonář / betonářka', '#38bdf8', v => `Nejnižší průměrný tip gólů ve skupině (${f1(v)} gólu na zápas).`, true],
    ['avgGoals', 0, '🌪️', 'Ofenzivní uragán', '#ec4899', v => `Nejvyšší průměrný tip gólů ve skupině (${f1(v)} gólu na zápas).`],
    ['czechWinTips', 1, '🇨🇿', 'Hrdý patriot / patriotka', '#f43f5e', v => `Natipoval/a výhru Česka celkem ${v}×.`],
    ['correctShutouts', 1, '🧱', 'Neprůstřelná zeď', '#e2e8f0', v => `Trefil/a zápas s čistým kontem jednoho z týmů ${v}×.`],
    ['maxStreak', 3, '🔥', 'Na vlně', '#f97316', v => `Rekordní bodová šňůra – body v ${v} zápasech po sobě.`],
    ['climb', 1, '🐎', 'Černý kůň', '#8b5cf6', v => `Vyšplhal/a se o ${v} míst nahoru ze svého nejhoršího umístění.`],
    ['drop', 1, '☄️', 'Padající hvězda', '#ef4444', v => `Propadl/a se o ${v} míst dolů ze své nejlepší pozice.`]
  ];
  const goals = players.map(p => ps[p].avgGoals).filter(v => v !== null);
  const goalsDiffer = goals.length >= 2 && Math.min(...goals) !== Math.max(...goals);

  const badges = Object.fromEntries(players.map(p => [p, []]));
  BADGES.forEach(([key, min, emoji, title, color, desc, lowest]) => {
    if (key === 'avgGoals' && !goalsDiffer) return;
    const e = extreme(key, min, lowest);
    if (e.val === null) return;
    e.players.forEach(p => badges[p].push({ emoji, title, color, desc: desc(e.val) }));
  });
  return { playerStats: ps, badges };
}

// ---------- Render ----------
function renderTabs() {
  const tabs = tournaments.map(t => [t.id, t.icon || '🏆', t.name]);
  if (tournaments.length > 1) tabs.push([ALL, '🌐', 'Celkový přehled']);
  $('#tabsScroll').innerHTML = tabs.map(([id, icon, name]) =>
    `<button class="tab-item${id === activeTournamentId ? ' active' : ''}" data-tid="${esc(id)}">${iconHtml(icon, 'tab-ico')}<span>${esc(name)}</span></button>`).join('');
  const has = tournaments.length > 0, loading = !!db && !cloudReady;
  $('#welcomeText').textContent = loading ? 'Načítám data z cloudu…' : 'Vytvořte svou první tipovačku kliknutím na tlačítko níže.';
  $('#btnWelcomeNew').hidden = loading;
  $('#welcomeScreen').classList.toggle('visible', !has);
  $('#mainContent').hidden = !(has && getT());
  $('#tabsBar').hidden = !has;
}

function renderLeaderboard(t) {
  const scores = calculateScores(t);
  $('#leaderboardBody').innerHTML = scores.length ? scores.map(s => `
    <button class="leaderboard-item" data-player="${esc(s.name)}">
      <span class="rank${s.rank > 3 ? ' rank-other' : ''}">${medalHtml(s.rank)}</span>
      <span class="player-info"><span class="player-name">${esc(s.name)}</span>
        <span class="player-stats">${s.correct102}× správný tip · ${s.correctScore}× přesné skóre</span></span>
      <span class="player-points">${s.points} <small>b</small></span>
    </button>`).join('') : '<div class="empty-state">Žádní hráči / hráčky</div>';
}

function tipDistributionHtml(mTips) {
  if (!mTips.length) return '';
  const parts = [[1, 'Domácí', 'd1'], [0, 'Remíza', 'd0'], [2, 'Hosté', 'd2']].map(([type, label, cls]) => {
    const list = mTips.filter(x => x.tipType === type);
    return { type, label, cls, n: list.length, pct: Math.round(list.length / mTips.length * 100), names: list.map(x => x.playerName).join(', ') };
  });
  return `<div class="dist">
    <div class="dist-title">📊 Rozložení tipů skupiny</div>
    <div class="dist-bar">${parts.filter(p => p.n).map(p => `<i class="${p.cls}" style="width:${p.pct}%" title="${p.label}: ${esc(p.names)}"></i>`).join('')}</div>
    <div class="dist-legend">${parts.map(p => `<span>${p.type} (${p.label}): ${p.n}× (${p.pct} %)</span>`).join('')}</div>
  </div>`;
}

function aiPredictionHtml(m, preds) {
  if (m.result != null) return '';
  const p = preds[m.id];
  if (p) return `<div class="ai-pred"><div class="ai-pred-title">🔮 AI analýza a predikce</div><p>„${esc(p.analysis)}“</p><span class="ai-pred-score">Tip skóre: ${esc(p.score)}</span></div>`;
  return `<div class="ai-pred-trigger"><button class="btn btn-sm btn-soft" data-action="ai">🔮 Získat AI předpověď zápasu</button></div>`;
}

function matchHtml(m, t, idx, preds) {
  const hasRes = m.result != null;
  const mTips = t.players.map(p => idx.get(tipKey(m.id, p))).filter(Boolean);
  const tips = t.players.map(p => {
    const tip = idx.get(tipKey(m.id, p));
    if (!tip) return `<div class="tip-card"><div class="tip-player">${esc(p)}</div><div class="tip-type muted">—</div></div>`;
    let cls = '';
    if (hasRes) { const pts = tipPoints(tip, m); cls = pts >= 3 ? 'correct-score' : pts === 1 ? 'correct-type' : 'wrong'; if (pts === 4) cls += ' correct-type'; }
    return `<div class="tip-card ${cls}"><div class="tip-player">${esc(p)}</div><div class="tip-type">${tip.tipType}</div><div class="tip-score">${esc(tip.tipScore || '—')}</div></div>`;
  }).join('');
  const actions = isAllView() ? '' : `<div class="match-actions">
      <button class="btn btn-sm" data-action="result">📝 Výsledek</button>
      <button class="btn btn-sm" data-action="tip">✍️ Tip</button>
      <button class="btn btn-sm danger-text" data-action="delete" aria-label="Smazat zápas">🗑️</button></div>`;
  return `<div class="match-item${expandedMatches.has(m.id) ? ' expanded' : ''}" data-id="${esc(m.id)}">
    <div class="match-header" data-action="toggle">
      <div><div class="match-teams">${esc(m.homeTeam)} – ${esc(m.awayTeam)}</div>
        <div class="match-date">${m.tournamentName ? `<span class="t-badge">${esc(m.tournamentName)}</span>` : ''}${m.time ? esc(m.time) + ' · ' : ''}${mTips.length}/${t.players.length} tipů</div></div>
      <div class="match-result${hasRes ? '' : ' pending'}">${hasRes ? esc(m.result) : 'Čeká se'}</div>
      <svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="match-details">${actions}${tipDistributionHtml(mTips)}${aiPredictionHtml(m, preds)}
      <div class="tips-grid">${tips}</div>${mTips.length ? '' : '<div class="no-tips">Zatím žádné tipy</div>'}</div>
  </div>`;
}

function renderMatches(t) {
  const list = sortedMatches(t);
  $('#matchCount').textContent = `${list.length} zápasů`;
  if (!list.length) { $('#matchesBody').innerHTML = '<div class="empty-state">Žádné zápasy. Klikněte na + pro přidání.</div>'; return; }
  const idx = tipIndex(t), preds = ls.json(LS.ai, {});
  let html = '', lastDate;
  list.forEach(m => {
    if (m.date !== lastDate) { lastDate = m.date; html += `<div class="day-head">${m.date ? formatDate(m.date) : 'Bez data'}</div>`; }
    html += matchHtml(m, t, idx, preds);
  });
  $('#matchesBody').innerHTML = html;
}

let chartPoints = [];
function renderProgressChart(t) {
  const box = $('#progressChart'), legend = $('#chartLegend');
  $('#chartTooltip').hidden = true;
  const { fin, history } = pointsTimeline(t);
  if (!fin.length || !t.players.length) {
    box.innerHTML = `<div class="chart-empty">${t.matches.length ? 'Odehrajte alespoň 1 zápas pro zobrazení vývoje bodů' : 'Žádná data pro graf'}</div>`;
    legend.innerHTML = ''; chartPoints = []; return;
  }
  const W = box.clientWidth || 600, H = box.clientHeight || 300, px = 32, py = 16;
  const steps = fin.length + 1, labels = ['Začátek', ...fin.map(m => `${m.homeTeam} – ${m.awayTeam}`)];
  const maxPts = Math.max(5, ...t.players.map(p => history[p][steps - 1]));
  const X = i => px + i / Math.max(steps - 1, 1) * (W - px - 12);
  const Y = v => H - py - v / maxPts * (H - 2 * py);
  const color = i => `hsl(${Math.round(i * 360 / t.players.length)}, 85%, 65%)`;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">`;
  for (let i = 0; i <= 4; i++) {
    const v = Math.round(maxPts / 4 * i), y = Y(v);
    svg += `<line x1="${px}" y1="${y}" x2="${W - 12}" y2="${y}" class="grid"/><text x="${px - 8}" y="${y + 4}" class="axis">${v}</text>`;
  }
  chartPoints = [];
  t.players.forEach((p, pi) => {
    const c = color(pi), h = history[p];
    let d = `M ${X(0)} ${Y(0)}`;
    for (let i = 1; i < steps; i++) {
      const x0 = X(i - 1), x1 = X(i), mx = (x0 + x1) / 2;
      d += ` C ${mx} ${Y(h[i - 1])}, ${mx} ${Y(h[i])}, ${x1} ${Y(h[i])}`;
    }
    svg += `<path d="${d}" stroke="${c}" class="line"/>`;
    h.forEach((v, i) => chartPoints.push({ p, v, label: labels[i], c, x: X(i), y: Y(v) }));
  });
  const dots = steps <= 20, r = Math.max(4, Math.min(10, (W - px) / steps / 2));
  chartPoints.forEach((pt, i) => {
    if (dots) svg += `<circle cx="${pt.x}" cy="${pt.y}" r="3" fill="#fff" stroke="${pt.c}" stroke-width="2"/>`;
    svg += `<circle cx="${pt.x}" cy="${pt.y}" r="${r}" class="hit" data-pt="${i}"/>`;
  });
  box.innerHTML = svg + '</svg>';
  legend.innerHTML = t.players.map((p, i) => `<span><i style="background:${color(i)}"></i>${esc(p)} <b>${history[p][steps - 1]}</b></span>`).join('');
}

function showChartTooltip(e) {
  const hit = e.target.closest?.('[data-pt]'), tip = $('#chartTooltip');
  if (!hit) { tip.hidden = true; return; }
  const pt = chartPoints[hit.dataset.pt], rect = $('.chart-body').getBoundingClientRect();
  tip.innerHTML = `<b style="color:${pt.c}">${esc(pt.p)}</b><div>${pt.v} bodů</div><small>${esc(pt.label)}</small>`;
  tip.hidden = false;
  const x = e.clientX - rect.left, w = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(x + 12, 0), rect.width - w)}px`;
  tip.style.top = `${e.clientY - rect.top + 12}px`;
}

function renderAll() {
  ensureActive();
  renderTabs();
  const t = getT();
  if (!t) return;
  renderLeaderboard(t);
  renderMatches(t);
  renderProgressChart(t);
}

function openPlayerModal(name) {
  const { playerStats, badges } = calculatePlayerStats();
  const s = playerStats[name]; if (!s) return;
  $('#profilePlayerName').textContent = name;
  $('#profileGlobalStats').textContent = `Odehráno ${s.playedTips} zápasů · celkem ${s.totalPoints} bodů`;
  $('#statExactScores').textContent = s.exactScores;
  $('#statOutcomes').textContent = s.correctOutcomes;
  $('#statAccuracy').textContent = `${s.accuracy} %`;
  $('#statAvgPoints').textContent = s.avgPoints;
  const hexA = (hex, a) => `rgba(${hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(',')},${a})`;
  $('#profileBadgesList').innerHTML = badges[name].map(b => `
    <div class="badge" style="background:${hexA(b.color, 0.07)};border-color:${hexA(b.color, 0.25)}">
      <span class="badge-emoji">${b.emoji}</span>
      <div><div class="badge-title" style="color:${b.color}">${esc(b.title)}</div><div class="badge-desc">${esc(b.desc)}</div></div>
    </div>`).join('') || '<p class="empty-note">Zatím žádné rekordní odznaky. Bojujte o extrémy turnaje!</p>';
  openModal('modalPlayerProfile');
  loadHtml2Canvas().catch(() => {});
}

// ---------- CRUD ----------
function setResult(matchId, score) {
  if (!checkAdminPermission()) return false;
  const t = getT(), m = t?.matches.find(x => x.id === matchId); if (!m) return false;
  if (score) { m.result = scoreStr(score); m.resultType = score.ot ? 0 : resultType(score.h, score.a); }
  else { m.result = null; m.resultType = null; }
  save(t); renderAll();
  showToast(score ? `Výsledek ${m.result} uložen` : 'Výsledek smazán');
  return true;
}

function deleteMatch(matchId) {
  if (!checkAdminPermission()) return;
  const t = getT(); if (!t || !confirm('Smazat zápas i se všemi tipy?')) return;
  t.matches = t.matches.filter(m => m.id !== matchId);
  t.tips = (t.tips || []).filter(x => x.matchId !== matchId);
  save(t); renderAll(); showToast('Zápas smazán');
}

/** Uloží více tipů najednou (jeden zápis do cloudu). */
function saveTips(entries) {
  const t = getT(); if (!t) return;
  t.tips = t.tips || [];
  entries.forEach(({ matchId, player, tipType, tipScore }) => {
    const data = { id: genId(), matchId, playerName: player, tipType: parseInt(tipType), tipScore: tipScore || '', timestamp: Date.now() };
    const i = t.tips.findIndex(x => x.matchId === matchId && x.playerName === player);
    if (i >= 0) { data.id = t.tips[i].id; t.tips[i] = data; } else t.tips.push(data);
  });
  save(t); renderAll();
}

function newMatch({ homeTeam, awayTeam, date = '', time = '' }) {
  return { id: genId(), homeTeam: String(homeTeam || '').trim(), awayTeam: String(awayTeam || '').trim(), date: date || '', time: time || '', result: null, resultType: null };
}

function addMatches(t, list) {
  const start = t.matches.length;
  list.filter(m => m.homeTeam && m.awayTeam).forEach((m, i) => t.matches.push({ ...m, order: start + i + 1 }));
}

/** "Domácí - Hosté, 15.5., 16:20" po řádcích */
function parseMatchesText(text) {
  return text.split('\n').map(line => {
    const parts = line.trim().split(/[,\t]+/).map(s => s.trim());
    const teams = parts[0]?.split(/\s+(?:-|–|—|vs\.?)\s+/i);
    if (!teams || teams.length < 2) return null;
    let date = '', time = '';
    const rest = parts.slice(1);
    const dm = rest.map(x => x.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})?$/)).find(Boolean);
    if (dm) date = `${dm[3] || new Date().getFullYear()}-${pad(dm[2])}-${pad(dm[1])}`;
    const tm = rest.map(x => x.match(/^(\d{1,2})[:.](\d{2})$/)).find(Boolean);
    if (tm) time = `${pad(tm[1])}:${tm[2]}`;
    return newMatch({ homeTeam: teams[0], awayTeam: teams[1], date, time });
  }).filter(Boolean);
}

// ---------- Gemini AI ----------
const STR = { type: 'STRING' }, INT = { type: 'INTEGER' };
const arrOf = properties => ({ type: 'ARRAY', items: { type: 'OBJECT', properties } });
const imgPart = dataUrl => ({ inlineData: { mimeType: dataUrl.slice(5, dataUrl.indexOf(';')), data: dataUrl.split(',')[1] } });

async function callGemini(parts, schema) {
  const key = getApiKey();
  if (!key) throw new Error('Nastavte Gemini API klíč v nastavení');
  const r = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } })
  });
  if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'AI odmítla požadavek – zkontrolujte API klíč' : `Chyba AI (${r.status})`);
  const txt = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error('AI nevrátila žádná data');
  try { return JSON.parse(txt.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')); }
  catch { throw new Error('AI vrátila neplatný formát. Zkuste to znovu.'); }
}

const matchList = ms => ms.map((m, i) => `${i + 1}. ${m.homeTeam} - ${m.awayTeam}`).join('\n');
const TIP_SCHEMA = arrOf({ match: STR, tipType: INT, tipScore: STR });
const RESULT_SCHEMA = arrOf({ match: STR, result: STR });
const MATCH_SCHEMA = arrOf({ homeTeam: STR, awayTeam: STR, date: STR, time: STR });

function analyzeTips({ image, text, player, matches, dateVal }) {
  const prompt = [
    image ? `Na screenshotu jsou tipy hráče "${player}".` : `Uživatel vložil textové tipy hráče "${player}":\n\n${text}`,
    dateVal !== 'auto' ? `Tipy se týkají VÝHRADNĚ zápasů ze dne ${formatDate(dateVal)}.` : '',
    `Seznam zápasů v pořadí:\n${matchList(matches)}`,
    'Pokud jsou uvedena jen skóre nebo tipy 1/0/2 bez názvů týmů, přiřaď je POSTUPNĚ k zápasům v tomto pořadí.',
    'Pro každý zápas vrať: match (přesně "Domácí - Hosté" ze seznamu), tipType (1 = domácí, 0 = remíza, 2 = hosté), tipScore ("X:Y"; pokud je jen 1/0/2, nech prázdné). tipType odvoď ze skóre.',
    OT_HINT + ' U takového tipu nastav tipType na 0.'
  ].filter(Boolean).join('\n\n');
  return callGemini(image ? [{ text: prompt }, imgPart(image)] : [{ text: prompt }], TIP_SCHEMA);
}

function analyzeResults({ image, text, matches }) {
  const prompt = `${image ? 'Na screenshotu jsou výsledky zápasů.' : `Uživatel vložil výsledky zápasů:\n\n${text}`}\n\nSpáruj je s naším seznamem:\n${matchList(matches)}\n\nPro každý nalezený zápas vrať match (přesně ze seznamu, "Domácí - Hosté") a result ("X:Y").\n${OT_HINT}`;
  return callGemini(image ? [{ text: prompt }, imgPart(image)] : [{ text: prompt }], RESULT_SCHEMA);
}

async function analyzeMatchesScreenshot(image) {
  const res = await callGemini([{ text: `Na screenshotu je program sportovních zápasů. Extrahuj všechny zápasy: homeTeam, awayTeam, date (YYYY-MM-DD, rok ${new Date().getFullYear()}, pokud není uveden), time (HH:MM).` }, imgPart(image)], MATCH_SCHEMA);
  return (res || []).map(newMatch).filter(m => m.homeTeam && m.awayTeam);
}

function analyzeExcelTournament(text) {
  const prompt = `Uživatel zkopíroval tabulku z Excelu, kde vedl tipovačku sportovních zápasů. Převeď ji do JSON.

Tabulka:
"""
${text}
"""

1. name: název turnaje (např. "MS 2024"; pokud chybí, odvoď ho z dat).
2. players: seznam všech hráčů.
3. matches: homeTeam, awayTeam, date (YYYY-MM-DD), time (HH:MM nebo prázdné), result ("3:2", "3:2p" pro prodloužení, prázdné pokud se nehrálo).
4. tips: playerName, matchHomeTeam, matchAwayTeam, tipType (1/0/2), tipScore ("2:1" nebo prázdné).`;
  return callGemini([{ text: prompt }], {
    type: 'OBJECT', required: ['name', 'players', 'matches', 'tips'],
    properties: {
      name: STR, players: { type: 'ARRAY', items: STR },
      matches: { type: 'ARRAY', items: { type: 'OBJECT', required: ['homeTeam', 'awayTeam'], properties: { homeTeam: STR, awayTeam: STR, date: STR, time: STR, result: STR } } },
      tips: { type: 'ARRAY', items: { type: 'OBJECT', required: ['playerName', 'matchHomeTeam', 'matchAwayTeam'], properties: { playerName: STR, matchHomeTeam: STR, matchAwayTeam: STR, tipType: INT, tipScore: STR } } }
    }
  });
}

async function getAiPrediction(m, wrap) {
  wrap.innerHTML = '<div class="spinner spinner-sm"></div> <span class="muted small">AI přemýšlí…</span>';
  try {
    const res = await callGemini([{ text: `Analyzuj nadcházející zápas: ${m.homeTeam} vs ${m.awayTeam}. Napiš stručnou a vtipnou předpověď v češtině (max 2–3 věty) a navrhni přesný výsledek ve formátu X:Y.` }],
      { type: 'OBJECT', properties: { analysis: STR, score: STR }, required: ['analysis', 'score'] });
    const preds = ls.json(LS.ai, {});
    preds[m.id] = { analysis: String(res.analysis || ''), score: String(res.score || '') };
    ls.set(LS.ai, JSON.stringify(preds));
    showToast('AI analýza hotová');
  } catch (err) { showToast(err.message, 'error'); }
  renderAll();
}

// ---------- Sdílení / export obrázků ----------
let html2canvasPromise = null;
function loadHtml2Canvas() {
  return html2canvasPromise ||= new Promise((resolve, reject) => {
    if (window.html2canvas) return resolve(window.html2canvas);
    const s = document.createElement('script');
    s.src = HTML2CANVAS_URL;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => { html2canvasPromise = null; reject(new Error('Nepodařilo se načíst knihovnu pro obrázky')); };
    document.head.appendChild(s);
  });
}

async function elementToFile(el, filename) {
  const h2c = await loadHtml2Canvas();
  const canvas = await h2c(el, { backgroundColor: '#0f1729', scale: 2, useCORS: true, scrollX: 0, scrollY: 0,
    ignoreElements: node => node.classList?.contains('no-capture') });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Nepodařilo se vytvořit obrázek');
  return new File([blob], filename, { type: 'image/png' });
}

function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportImage(el, filename, mode, text) {
  try {
    const file = await elementToFile(el, filename.replace(/[^\p{L}\p{N}_.-]+/gu, '_'));
    if (mode === 'share') {
      if (!navigator.canShare?.({ files: [file] })) { downloadFile(file); return showToast('Sdílení není podporováno – obrázek stažen', 'warning'); }
      await navigator.share({ files: [file], text });
    } else { downloadFile(file); showToast('Obrázek stažen'); }
  } catch (e) {
    if (e.name !== 'AbortError') { console.error(e); showToast('Chyba: ' + e.message, 'error'); }
  }
}

const share = { type: 'tips', date: null };
const shareMatches = t => sortedMatches(t).filter(m => share.date === ALL || m.date === share.date);
const shareDateLabel = () => share.date === ALL ? 'Všechny zápasy' : formatDate(share.date);

function shareLeaderboardHtml(t) {
  return `<div class="sh-section"><img src="rankings_badge.png" alt="">Žebříček</div>
    <table class="sh-table sh-board">${calculateScores(t).map(s => `<tr>
      <td class="sh-rank">${medalHtml(s.rank, 'sh-medal')}</td>
      <td class="sh-left"><b>${esc(s.name)}</b><small>${s.correct102}× správný tip · ${s.correctScore}× přesné skóre</small></td>
      <td class="sh-pts">${s.points} <small>b</small></td></tr>`).join('')}</table>`;
}

function shareTipsHtml(t, matches) {
  const idx = tipIndex(t), P = t.players;
  const head = `<tr><th></th><th colspan="${P.length}" class="sh-group">Tipy 1-0-2</th><th colspan="${P.length}" class="sh-group">Tipy skóre</th></tr>
    <tr><th class="sh-left">Zápas</th>${[...P, ...P].map(p => `<th class="sh-player">${esc(p)}</th>`).join('')}</tr>`;
  const rows = matches.map(m => {
    const hasRes = m.result != null;
    const cells = (fn) => P.map(p => { const tip = idx.get(tipKey(m.id, p)); const c = tip && fn(tip); return `<td>${c || '<span class="muted">—</span>'}</td>`; }).join('');
    const types = cells(tip => `<span class="pill ${hasRes ? (tip.tipType === m.resultType ? 'ok' : 'bad') : 't' + tip.tipType}">${tip.tipType}</span>`);
    const scores = cells(tip => tip.tipScore && `<span class="pill ${hasRes ? (tip.tipScore === m.result ? 'ok' : 'bad') : 'neutral'}">${esc(tip.tipScore)}</span>`);
    return `<tr><td class="sh-left sh-match"><span>${esc(m.homeTeam)} - ${esc(m.awayTeam)}</span>${hasRes ? `<span class="sh-res">${esc(m.result)}</span>` : ''}</td>${types}${scores}</tr>`;
  }).join('');
  return `<table class="sh-table">${head}${rows}</table>`;
}

function shareProgramHtml(matches) {
  return `<table class="sh-table sh-program">${matches.map(m => `<tr>
    <td class="sh-time">${esc(m.time || '—')}</td>
    <td class="sh-left"><b>${esc(m.homeTeam)}</b><span class="sh-vs">VS</span><b>${esc(m.awayTeam)}</b></td>
    <td>${m.result != null ? `<span class="sh-res big">${esc(m.result)}</span>` : ''}</td></tr>`).join('')}</table>`;
}

function buildShareHtml(t, matches) {
  const body = share.type === 'tips' ? shareTipsHtml(t, matches) : shareProgramHtml(matches);
  return `<div class="share-card">
    <div class="sh-title">${iconHtml(t.icon, 'sh-icon')}${esc(t.name)}</div>
    <div class="sh-sub">📅 ${esc(shareDateLabel())}</div>
    ${body}${share.type !== 'matches' ? shareLeaderboardHtml(t) : ''}</div>`;
}

function buildShareText(t, matches) {
  const lines = [`${isImgIcon(t.icon) ? '🏆' : t.icon || '🏆'} ${t.name}`];
  const scores = calculateScores(t);
  if (share.type === 'tips') {
    const idx = tipIndex(t);
    lines.push(`📅 ${shareDateLabel()}`, '');
    matches.forEach(m => {
      lines.push(`⚔️ ${m.homeTeam} - ${m.awayTeam}${m.result != null ? ` (${m.result})` : ''}`);
      t.players.forEach(p => {
        const tip = idx.get(tipKey(m.id, p)); if (!tip) return;
        const pts = tipPoints(tip, m);
        const ev = m.result == null ? '' : pts >= 3 ? ` 🎯 (${pts}b)` : pts ? ' ✅ (1b)' : ' ❌ (0b)';
        lines.push(`  ${p}: ${tip.tipType} (${tip.tipScore || '—'})${ev}`);
      });
      lines.push('');
    });
    lines.push('📊 Žebříček:');
  } else {
    lines.push(`📅 Program zápasů: ${shareDateLabel()}`, '');
    matches.forEach(m => lines.push(`⏰ ${m.time || '—'}  ${m.homeTeam} vs ${m.awayTeam}${m.result != null ? ` (${m.result})` : ''}`));
    if (share.type === 'matches_rankings') lines.push('', '📊 Aktuální žebříček:');
  }
  if (share.type !== 'matches') scores.forEach(s => lines.push(`${medalEmoji(s.rank)} ${s.name}: ${s.points}b${share.type === 'matches_rankings' ? ` (${s.correct102}× 102 · ${s.correctScore}× přesné skóre)` : ''}`));
  if (share.type !== 'tips') lines.push('', 'Natipujte včas! 🏆');
  return lines.join('\n');
}

function updateSharePreview() {
  const t = getT(); if (!t) return;
  const matches = shareMatches(t);
  const html = matches.length ? buildShareHtml(t, matches) : '<p class="empty-state">Žádné zápasy</p>';
  $('#shareTipsPreview').innerHTML = html;
  $('#renderContainer').innerHTML = matches.length ? html : '';
}

const shareFileName = t => `${t.name}_${{ tips: 'tipy', matches: 'program', matches_rankings: 'program_zebricek' }[share.type]}_${share.date === ALL ? 'vse' : share.date}.png`;

// ---------- UI helpery ----------
function initTabs(groupId, onChange) {
  const group = document.getElementById(groupId);
  const set = name => {
    $$('[data-tab]', group).forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('[data-pane]', group).forEach(p => { p.hidden = p.dataset.pane !== name; });
    group.dataset.active = name;
    onChange?.(name);
  };
  $$('[data-tab]', group).forEach(b => b.addEventListener('click', () => set(b.dataset.tab)));
  return { set, get: () => group.dataset.active };
}

function initUploadZone(zoneId, onImage) {
  const zone = document.getElementById(zoneId);
  zone.append($('#tplUploadZone').content.cloneNode(true));
  const input = zone.querySelector('input'), img = zone.querySelector('img'), ph = zone.querySelector('.upload-placeholder');
  let data = null;
  const handle = async file => {
    try {
      data = await readImage(file);
      img.src = data; img.hidden = false; ph.hidden = true; zone.classList.add('has-image');
      onImage?.(data);
    } catch (e) { showToast(e.message, 'error'); }
  };
  zone.addEventListener('click', e => { if (e.target !== input) input.click(); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handle(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { handle(input.files[0]); input.value = ''; });
  zone.handleFile = handle;
  return {
    get: () => data,
    reset() { data = null; img.hidden = true; img.removeAttribute('src'); ph.hidden = false; zone.classList.remove('has-image'); }
  };
}

function initIconPicker(rootId) {
  const root = document.getElementById(rootId);
  root.append($('#tplIconPicker').content.cloneNode(true));
  const btns = $$('[data-icon]', root), upload = root.querySelector('.icon-upload'), file = root.querySelector('input[type=file]');
  const custom = root.querySelector('.icon-custom'), note = root.querySelector('.icon-note');
  let value = '🏒';
  const mark = el => $$('.btn-icon-select', root).forEach(b => b.classList.toggle('active', b === el));
  btns.forEach(b => b.addEventListener('click', () => { value = b.dataset.icon; mark(b); custom.value = ''; note.textContent = ''; }));
  custom.addEventListener('input', () => { const v = custom.value.trim(); if (v) { value = v; mark(null); note.textContent = ''; } });
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    try { value = await readImage(f, 128, 0.85); mark(upload); custom.value = ''; note.textContent = `Vybráno: ${f.name}`; }
    catch (e) { showToast(e.message, 'error'); }
  });
  return {
    get: () => value,
    set(v) {
      value = v || '🏆'; custom.value = ''; note.textContent = '';
      const b = btns.find(x => x.dataset.icon === value);
      if (b) mark(b);
      else if (isImgIcon(value)) { mark(upload); note.textContent = 'Zvolen vlastní obrázek'; }
      else { mark(null); custom.value = value; }
    }
  };
}

function renderImportList(listId, countId, wrapId, matches, onRemove) {
  $(countId).textContent = matches.length;
  $(listId).innerHTML = matches.map((m, i) => `<div class="import-match-row"><span class="num">${i + 1}.</span>
    <span class="teams">${esc(m.homeTeam)} – ${esc(m.awayTeam)}</span><span class="date-info">${formatDate(m.date)} ${esc(m.time)}</span>
    <button class="btn-remove-match" data-i="${i}" aria-label="Odebrat">×</button></div>`).join('');
  $(wrapId).hidden = !matches.length;
  $$('.btn-remove-match', $(listId)).forEach(b => b.onclick = () => onRemove(+b.dataset.i));
}

function playerOptions(players, selected) {
  return players.map(p => `<option${p === selected ? ' selected' : ''}>${esc(p)}</option>`).join('');
}

function requireTournament(action) {
  if (isAllView()) { showToast(`Pro ${action} vyberte konkrétní tipovačku`, 'warning'); return null; }
  const t = getT();
  if (!t) showToast('Nejdřív vytvořte tipovačku', 'error');
  return t;
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
  refreshAdmin();
  initFirebase();
  renderAll();

  // Zavírání modálů
  $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal-overlay').classList.remove('active')));
  $$('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('active'); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal-overlay.active').forEach(o => o.classList.remove('active')); });

  // Vložení screenshotu ze schránky do otevřeného modálu
  document.addEventListener('paste', e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    const zone = $$('.modal-overlay.active .upload-zone').find(z => z.offsetParent);
    if (file && zone) { e.preventDefault(); zone.handleFile(file); }
  });

  // Záložky tipovaček
  $('#tabsScroll').addEventListener('click', e => {
    const b = e.target.closest('[data-tid]'); if (!b) return;
    activeTournamentId = b.dataset.tid; expandedMatches.clear();
    persistLocal(); renderAll();
  });

  // Žebříček → profil
  $('#leaderboardBody').addEventListener('click', e => {
    const b = e.target.closest('[data-player]'); if (b) openPlayerModal(b.dataset.player);
  });

  // Graf – tooltip (myš i dotyk)
  const chart = $('#progressChart');
  chart.addEventListener('pointermove', showChartTooltip);
  chart.addEventListener('pointerdown', showChartTooltip);
  chart.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') $('#chartTooltip').hidden = true; });
  let resizeTimer, lastWidth = chart.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (chart.clientWidth !== lastWidth) { lastWidth = chart.clientWidth; const t = getT(); if (t) renderProgressChart(t); } }, 150);
  });

  // Zápasy – akce (delegace)
  $('#matchesBody').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]'), item = e.target.closest('.match-item');
    if (!btn || !item) return;
    const id = item.dataset.id, t = getT(), m = t?.matches.find(x => x.id === id);
    if (!m) return;
    switch (btn.dataset.action) {
      case 'toggle':
        item.classList.toggle('expanded');
        item.classList.contains('expanded') ? expandedMatches.add(id) : expandedMatches.delete(id);
        break;
      case 'result': openResultModal(m); break;
      case 'tip': openManualTipModal(t, m); break;
      case 'delete': deleteMatch(id); break;
      case 'ai': getAiPrediction(m, btn.parentElement); break;
    }
  });

  // --- Nová tipovačka ---
  const newIcon = initIconPicker('newIconPicker');
  let importedMatches = [];
  const renderNewImport = () => renderImportList('#importMatchesList', '#importCount', '#importPreview', importedMatches, i => { importedMatches.splice(i, 1); renderNewImport(); });
  const newTabs = initTabs('newTournamentTabs');
  const newZone = initUploadZone('uploadZoneMatches', async img => {
    setLoading('#importLoading', true);
    try { importedMatches = await analyzeMatchesScreenshot(img); renderNewImport(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setLoading('#importLoading', false); }
  });
  const openNewTournament = () => {
    $('#inputTournamentName').value = `MS ${new Date().getFullYear()}`;
    $('#inputTournamentPlayers').value = (getT()?.players || tournaments[0]?.players || []).join(', ');
    $('#inputMatchesPaste').value = '';
    importedMatches = []; renderNewImport(); newZone.reset(); newTabs.set('paste'); newIcon.set('🏒');
    openModal('modalNewTournament');
  };
  $('#btnNewTournament').addEventListener('click', openNewTournament);
  $('#btnWelcomeNew').addEventListener('click', openNewTournament);
  $('#btnCreateTournament').addEventListener('click', () => {
    const name = $('#inputTournamentName').value.trim();
    const players = [...new Set($('#inputTournamentPlayers').value.split(',').map(s => s.trim()).filter(Boolean))];
    if (!name) return showToast('Zadejte název', 'error');
    if (!players.length) return showToast('Zadejte hráče', 'error');
    const method = newTabs.get();
    const t = { id: genId(), name, icon: newIcon.get(), players, matches: [], tips: [] };
    addMatches(t, method === 'paste' ? parseMatchesText($('#inputMatchesPaste').value) : method === 'screenshot' ? importedMatches : []);
    tournaments.push(t); activeTournamentId = t.id;
    save(t); renderAll(); closeModal('modalNewTournament');
    showToast(`${name} vytvořena (${t.matches.length} zápasů)`);
  });

  // --- Přidat zápas ---
  $('#btnAddMatch').addEventListener('click', () => {
    if (!requireTournament('přidávání zápasů')) return;
    ['#inputHomeTeam', '#inputAwayTeam', '#inputMatchDate', '#inputMatchTime'].forEach(s => { $(s).value = ''; });
    openModal('modalAddMatch');
  });
  $('#btnSaveMatch').addEventListener('click', () => {
    const m = newMatch({ homeTeam: $('#inputHomeTeam').value, awayTeam: $('#inputAwayTeam').value, date: $('#inputMatchDate').value, time: $('#inputMatchTime').value });
    if (!m.homeTeam || !m.awayTeam) return showToast('Vyplňte týmy', 'error');
    if (!checkAdminPermission()) return;
    const t = getT(); addMatches(t, [m]); save(t); renderAll();
    closeModal('modalAddMatch'); showToast(`${m.homeTeam} – ${m.awayTeam} přidán`);
  });

  // --- Hromadný import zápasů ---
  let bulkMatches = [];
  const renderBulk = () => renderImportList('#bulkImportMatchesList', '#bulkImportCount', '#bulkImportPreview', bulkMatches, i => { bulkMatches.splice(i, 1); renderBulk(); });
  const bulkTabs = initTabs('bulkTabs');
  const bulkZone = initUploadZone('uploadZoneBulkMatches', async img => {
    setLoading('#bulkImportLoading', true);
    try { bulkMatches = await analyzeMatchesScreenshot(img); renderBulk(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setLoading('#bulkImportLoading', false); }
  });
  $('#btnTriggerBulkImport').addEventListener('click', () => {
    closeModal('modalAddMatch');
    bulkMatches = []; renderBulk(); bulkZone.reset(); bulkTabs.set('paste');
    $('#inputBulkMatchesPaste').value = '';
    openModal('modalBulkImport');
  });
  $('#btnImportBulkMatches').addEventListener('click', () => {
    const list = bulkTabs.get() === 'paste' ? parseMatchesText($('#inputBulkMatchesPaste').value) : bulkMatches;
    if (!list.length) return showToast('Žádné zápasy k importu', 'error');
    if (!checkAdminPermission()) return;
    const t = getT(); addMatches(t, list); save(t); renderAll();
    closeModal('modalBulkImport'); showToast(`Naimportováno ${list.length} zápasů`);
  });

  // --- Výsledek ---
  let currentMatchId = null;
  function openResultModal(m) {
    currentMatchId = m.id;
    const sc = parseScore(m.result);
    $('#resultMatchName').textContent = `${m.homeTeam} – ${m.awayTeam}`;
    $('#inputHomeScore').value = sc ? sc.h : '';
    $('#inputAwayScore').value = sc ? sc.a : '';
    $('#inputResultOvertime').checked = !!sc?.ot;
    $('#btnClearResult').hidden = !sc;
    openModal('modalSetResult');
  }
  $('#btnSaveResult').addEventListener('click', () => {
    const h = parseInt($('#inputHomeScore').value), a = parseInt($('#inputAwayScore').value);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return showToast('Vyplňte skóre', 'error');
    if (setResult(currentMatchId, { h, a, ot: $('#inputResultOvertime').checked })) closeModal('modalSetResult');
  });
  $('#btnClearResult').addEventListener('click', () => {
    if (confirm('Smazat výsledek zápasu?') && setResult(currentMatchId, null)) closeModal('modalSetResult');
  });

  // --- Ruční tip ---
  let selectedTipType = null;
  const markTipType = v => { selectedTipType = v; $$('.tip-btn').forEach(b => b.classList.toggle('active', +b.dataset.val === v)); };
  function loadPlayerTip() {
    const tip = (getT()?.tips || []).find(x => x.matchId === currentMatchId && x.playerName === $('#selectManualPlayer').value);
    const sc = parseScore(tip?.tipScore);
    markTipType(tip ? tip.tipType : null);
    $('#inputTipHome').value = sc ? sc.h : '';
    $('#inputTipAway').value = sc ? sc.a : '';
    $('#inputTipOvertime').checked = !!sc?.ot;
  }
  function openManualTipModal(t, m) {
    currentMatchId = m.id;
    $('#manualMatchName').textContent = `${m.homeTeam} – ${m.awayTeam}`;
    $('#selectManualPlayer').innerHTML = playerOptions(t.players);
    loadPlayerTip();
    openModal('modalManualTips');
  }
  $('#selectManualPlayer').addEventListener('change', loadPlayerTip);
  $('#inputTipOvertime').addEventListener('change', e => { if (e.target.checked) markTipType(0); });
  $$('.tip-btn').forEach(b => b.addEventListener('click', () => {
    markTipType(+b.dataset.val);
    if (selectedTipType !== 0) $('#inputTipOvertime').checked = false;
  }));
  $('#btnSaveManualTip').addEventListener('click', () => {
    const th = $('#inputTipHome').value, ta = $('#inputTipAway').value, ot = $('#inputTipOvertime').checked;
    let tipType = selectedTipType, tipScore = '';
    if (th !== '' && ta !== '') {
      tipScore = `${parseInt(th)}:${parseInt(ta)}${ot ? 'p' : ''}`;
      if (tipType === null) tipType = ot ? 0 : resultType(+th, +ta);
    }
    if (ot) tipType = 0; // prodloužení = remíza v tendenci
    if (tipType === null) return showToast('Vyberte tip', 'error');
    saveTips([{ matchId: currentMatchId, player: $('#selectManualPlayer').value, tipType, tipScore }]);
    showToast('Tip uložen'); closeModal('modalManualTips');
  });

  // --- Nahrát tipy přes AI ---
  let parsedAiTips = [];
  const tipsZone = initUploadZone('uploadZoneTips', () => { $('#btnAnalyze').disabled = false; });
  const tipsTabs = initTabs('tipsTabs', name => { $('#btnAnalyze').disabled = name === 'screenshot' && !tipsZone.get(); });
  $('#btnUploadTips').addEventListener('click', () => {
    const t = requireTournament('nahrávání tipů'); if (!t) return;
    const today = isoDate(), dates = [...new Set(t.matches.map(m => m.date).filter(Boolean))].sort();
    $('#selectTipPlayer').innerHTML = playerOptions(t.players);
    $('#selectTipDate').innerHTML = '<option value="auto">🤖 Automaticky</option>' + dates.map(d =>
      `<option value="${d}"${d === today ? ' selected' : ''}>${formatDate(d)} (${t.matches.filter(m => m.date === d).length} zápasů)${d === today ? ' – dnes' : ''}</option>`).join('');
    $('#inputTipsPaste').value = '';
    $('#aiResult').hidden = true; parsedAiTips = [];
    tipsZone.reset(); tipsTabs.set('screenshot');
    openModal('modalUploadTips');
  });
  $('#btnAnalyze').addEventListener('click', async () => {
    const t = getT(), player = $('#selectTipPlayer').value, dateVal = $('#selectTipDate').value;
    const image = tipsTabs.get() === 'screenshot' ? tipsZone.get() : null, text = $('#inputTipsPaste').value.trim();
    if (!image && !text) return showToast(tipsTabs.get() === 'screenshot' ? 'Nahrajte screenshot' : 'Vložte textové tipy', 'error');
    const matches = sortedMatches(t).filter(m => dateVal === 'auto' || m.date === dateVal);
    setLoading('#aiLoading', true, '#btnAnalyze'); $('#aiResult').hidden = true;
    try {
      const result = await analyzeTips({ image, text, player, matches, dateVal });
      const seen = new Set();
      parsedAiTips = (result || []).map(r => ({ ...r, m: findMatch(matches, r.match) }))
        .filter(r => r.m && !seen.has(r.m.id) && seen.add(r.m.id))
        .map(r => ({ matchId: r.m.id, label: `${r.m.homeTeam} - ${r.m.awayTeam}`, tipType: [0, 1, 2].includes(r.tipType) ? r.tipType : 1, tipScore: r.tipScore || '' }));
      $('#aiTipsPreview').innerHTML = parsedAiTips.length ? parsedAiTips.map((r, i) => `<div class="ai-tip-row">
        <span class="match-name">${esc(r.label)}</span>
        <select data-i="${i}" class="ai-tip-type">${[1, 0, 2].map(v => `<option value="${v}"${r.tipType === v ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <input type="text" data-i="${i}" class="ai-tip-score" value="${esc(r.tipScore)}" placeholder="X:Y"></div>`).join('')
        : '<p class="empty-note">AI nenašla žádné tipy k zápasům v seznamu.</p>';
      $$('.ai-tip-type').forEach(s => s.addEventListener('change', () => { parsedAiTips[s.dataset.i].tipType = +s.value; }));
      $$('.ai-tip-score').forEach(s => s.addEventListener('input', () => { parsedAiTips[s.dataset.i].tipScore = s.value.trim(); }));
      $('#aiResult').hidden = false;
      $('#btnSaveTips').hidden = !parsedAiTips.length;
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading('#aiLoading', false, '#btnAnalyze'); }
  });
  $('#btnSaveTips').addEventListener('click', () => {
    const player = $('#selectTipPlayer').value;
    saveTips(parsedAiTips.map(r => ({ ...r, player })));
    showToast(`Tipy pro ${player} uloženy (${parsedAiTips.length})`); closeModal('modalUploadTips');
  });

  // --- Hromadné výsledky ---
  const resultsTabs = initTabs('resultsTabs');
  const resultsZone = initUploadZone('uploadZoneResults');
  $('#btnBulkResultsOpen').addEventListener('click', () => {
    if (!requireTournament('zadávání výsledků')) return;
    $('#inputResultsPaste').value = ''; resultsZone.reset(); resultsTabs.set('text');
    openModal('modalBulkResults');
  });
  $('#btnAnalyzeResults').addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    const isText = resultsTabs.get() === 'text', text = $('#inputResultsPaste').value.trim(), image = resultsZone.get();
    if (isText ? !text : !image) return showToast(isText ? 'Vložte text s výsledky' : 'Nahrajte screenshot s výsledky', 'error');
    if (!checkAdminPermission()) return;
    setLoading('#aiResultsLoading', true, '#btnAnalyzeResults');
    try {
      const parsed = await analyzeResults(isText ? { text, matches: t.matches } : { image, matches: t.matches });
      let count = 0;
      (parsed || []).forEach(r => {
        const m = findMatch(t.matches, r.match), sc = parseScore(r.result);
        if (!m || !sc) return;
        m.result = scoreStr(sc); m.resultType = sc.ot ? 0 : resultType(sc.h, sc.a); count++;
      });
      if (!count) return showToast('Nenašel jsem žádné výsledky k našim zápasům', 'warning');
      save(t); renderAll(); closeModal('modalBulkResults');
      showToast(`Uloženo ${count} výsledků`);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading('#aiResultsLoading', false, '#btnAnalyzeResults'); }
  });

  // --- Nastavení ---
  const editIcon = initIconPicker('editIconPicker');
  $('#btnSettings').addEventListener('click', () => {
    refreshAdmin();
    const t = isAllView() ? null : getT();
    $('#tournamentSettings').hidden = !t;
    if (t) {
      $('#inputActiveTournamentName').value = t.name || '';
      $('#inputPlayersEdit').value = (t.players || []).join(', ');
      editIcon.set(t.icon);
    }
    $('#inputApiKey').value = getApiKey();
    $('#inputFirebaseConfig').value = ls.get(LS.firebase) || JSON.stringify(DEFAULT_FIREBASE, null, 2);
    $('#inputAdminPassword').value = isAdmin ? ls.get(LS.adminPass) : '';
    $('#inputAdminPassword').closest('.form-group').hidden = !isAdmin;
    $('#adminLoginWrap').hidden = isAdmin;
    $('#inputAdminLogin').value = '';
    $('#btnDeleteTournament').hidden = !t;
    openModal('modalSettings');
  });

  $('#btnSaveSettings').addEventListener('click', () => {
    if (!isAdmin) {
      const login = $('#inputAdminLogin').value.trim();
      if (login) {
        if (login !== ls.get(LS.adminPass)) return showToast('Chybné heslo!', 'error');
        ls.set(LS.userPass, login); refreshAdmin(); showToast('Přihlášen/a jako admin');
      }
    }
    ls.set(LS.apiKey, $('#inputApiKey').value.trim());

    const normFc = raw => { try { return !raw || JSON.stringify(JSON.parse(raw)) === JSON.stringify(DEFAULT_FIREBASE) ? '' : raw; } catch { return null; } };
    const fc = normFc($('#inputFirebaseConfig').value.trim());
    if (fc === null) return showToast('Firebase config není platný JSON', 'error');
    const fcChanged = fc !== normFc(ls.get(LS.firebase));

    const t = isAllView() ? null : getT();
    if (t && isAdmin) {
      const ap = $('#inputAdminPassword').value.trim();
      ls.set(LS.adminPass, ap); if (ap) ls.set(LS.userPass, ap);
      t.name = $('#inputActiveTournamentName').value.trim() || t.name;
      const old = t.players, pl = [...new Set($('#inputPlayersEdit').value.split(',').map(s => s.trim()).filter(Boolean))];
      if (pl.length) {
        // Přejmenování na stejné pozici → přenést tipy
        if (pl.length === old.length) old.forEach((o, i) => { if (o !== pl[i] && !old.includes(pl[i])) (t.tips || []).forEach(tip => { if (tip.playerName === o) tip.playerName = pl[i]; }); });
        t.players = pl;
      }
      t.icon = editIcon.get();
      save(t);
    } else if (isAdmin) {
      ls.set(LS.adminPass, $('#inputAdminPassword').value.trim());
    } else if (t) {
      showToast('Změny tipovačky vyžadují admin heslo', 'warning');
    }
    if (fcChanged) {
      ls.set(LS.firebase, fc);
      showToast('Cloud změněn – načítám znovu…');
      return setTimeout(() => location.reload(), 800);
    }
    closeModal('modalSettings'); renderAll(); showToast('Uloženo');
  });

  $('#btnForceUpdate').addEventListener('click', async () => {
    if (!confirm('Vynutit aktualizaci? Vymaže se mezipaměť aplikace, data zůstanou.')) return;
    try {
      await Promise.all((await navigator.serviceWorker?.getRegistrations() || []).map(r => r.unregister()));
      if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    } catch (e) { console.error(e); }
    location.reload();
  });

  $('#btnImportExcel').addEventListener('click', async () => {
    const text = $('#inputExcelPaste').value.trim();
    if (!text) return showToast('Vložte obsah zkopírovaný z Excelu', 'error');
    setLoading('#aiExcelLoading', true, '#btnImportExcel');
    try {
      const res = await analyzeExcelTournament(text);
      const matches = (res?.matches || []).map(m => {
        const nm = newMatch(m), sc = parseScore(m.result);
        if (sc) { nm.result = scoreStr(sc); nm.resultType = sc.ot ? 0 : resultType(sc.h, sc.a); }
        return nm;
      }).filter(m => m.homeTeam && m.awayTeam).map((m, i) => ({ ...m, order: i + 1 }));
      if (!matches.length) throw new Error('Nepodařilo se rozpoznat žádné zápasy');
      const tips = (res.tips || []).map(tip => {
        const player = String(tip.playerName || '').trim(), m = findMatch(matches, `${tip.matchHomeTeam} - ${tip.matchAwayTeam}`);
        if (!player || !m) return null;
        const sc = parseScore(tip.tipScore);
        const tipType = [0, 1, 2].includes(tip.tipType) ? tip.tipType : sc ? (sc.ot ? 0 : resultType(sc.h, sc.a)) : null;
        return tipType === null ? null : { id: genId(), matchId: m.id, playerName: player, tipType, tipScore: sc ? scoreStr(sc) : '', timestamp: Date.now() };
      }).filter(Boolean);
      const players = [...new Set([...(res.players || []).map(p => String(p).trim()).filter(Boolean), ...tips.map(x => x.playerName)])];
      if (!players.length) throw new Error('V tabulce nebyli nalezeni žádní hráči');
      const t = { id: genId(), name: res.name || 'Archiv', icon: '🏒', players, matches, tips };
      tournaments.push(t); activeTournamentId = t.id;
      save(t); renderAll(); closeModal('modalSettings');
      $('#inputExcelPaste').value = '';
      showToast(`Importováno: ${t.name} (${matches.length} zápasů, ${tips.length} tipů)`);
    } catch (err) { console.error(err); showToast('Chyba importu: ' + err.message, 'error'); }
    finally { setLoading('#aiExcelLoading', false, '#btnImportExcel'); }
  });

  $('#btnDeleteTournament').addEventListener('click', () => {
    const t = isAllView() ? null : getT();
    if (!t || !checkAdminPermission() || !confirm(`Opravdu smazat "${t.name}" včetně všech tipů?`)) return;
    db?.collection('tournaments').doc(t.id).delete().catch(err => console.error('Firestore delete error:', err));
    tournaments = tournaments.filter(x => x.id !== t.id);
    activeTournamentId = null; persistLocal();
    renderAll(); closeModal('modalSettings'); showToast('Tipovačka smazána');
  });

  $('#btnExport').addEventListener('click', () => {
    const t = getT(); if (!t) return;
    downloadFile(new File([JSON.stringify(t, null, 2)], `${t.name.replace(/\s+/g, '_')}_export.json`, { type: 'application/json' }));
    showToast('Exportováno');
  });
  $('#btnImport').addEventListener('click', () => $('#inputImport').click());
  $('#inputImport').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.matches) || !Array.isArray(data.players)) throw new Error('Neplatný formát');
      if (!confirm(`Importovat "${data.name}" (${data.matches.length} zápasů)?`)) return;
      const t = { ...data, id: genId(), tips: data.tips || [] };
      tournaments.push(t); activeTournamentId = t.id;
      save(t); renderAll(); closeModal('modalSettings'); showToast('Importováno');
    } catch (err) { showToast('Chyba: ' + err.message, 'error'); }
  });

  // --- Sdílení ---
  const shareTabs = initTabs('shareTabs', type => { share.type = type; updateSharePreview(); });
  $('#btnShare').addEventListener('click', () => {
    const t = getT(); if (!t) return showToast('Žádná tipovačka', 'error');
    const today = isoDate(), dates = [...new Set(t.matches.map(m => m.date).filter(Boolean))].sort();
    // Výchozí den: dnešek, jinak nejbližší další hrací den, jinak poslední
    share.date = dates.includes(today) ? today : dates.find(d => d > today) || dates[dates.length - 1] || ALL;
    $('#selectShareDate').innerHTML = dates.map(d => `<option value="${d}">${formatDate(d)} (${t.matches.filter(m => m.date === d).length} zápasů)</option>`).join('')
      + `<option value="${ALL}">Všechny zápasy (${t.matches.length})</option>`;
    $('#selectShareDate').value = share.date;
    shareTabs.set('tips');
    openModal('modalShareTips');
    loadHtml2Canvas().catch(() => {});
  });
  $('#selectShareDate').addEventListener('change', e => { share.date = e.target.value; updateSharePreview(); });
  const shareTarget = () => $('#renderContainer').firstElementChild;
  $('#btnShareImageOnly').addEventListener('click', () => {
    const t = getT(), el = shareTarget(); if (!t || !el) return;
    exportImage(el, shareFileName(t), 'share', buildShareText(t, shareMatches(t)));
  });
  $('#btnDownloadImageOnly').addEventListener('click', () => {
    const t = getT(), el = shareTarget(); if (!t || !el) return;
    exportImage(el, shareFileName(t), 'download');
  });
  $('#btnCopyText').addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    try { await navigator.clipboard.writeText(buildShareText(t, shareMatches(t))); showToast('Zkopírováno do schránky'); }
    catch { showToast('Nelze zkopírovat', 'error'); }
  });

  // --- Profil jako obrázek ---
  const profileExport = mode => {
    const t = getT(), name = $('#profilePlayerName').textContent || 'hrac';
    exportImage($('#profileCard'), `profil_${name}.png`, mode, `🥇 Profil ${name} v tipovačce ${t?.name || ''}! ${$('#profileGlobalStats').textContent}`);
  };
  $('#btnShareProfileImage').addEventListener('click', () => profileExport('share'));
  $('#btnDownloadProfileImage').addEventListener('click', () => profileExport('download'));

  // --- Service worker ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing) { refreshing = true; location.reload(); } });
  }
});
