// === MS Tipovačka — Multi-tournament App ===
let tournaments = JSON.parse(localStorage.getItem('ms_tournaments') || '[]');
let activeTournamentId = localStorage.getItem('ms_active_tournament') || null;
let currentMatchId = null, selectedTipType = null, parsedAiTips = [], screenshotBase64 = null;
let importedMatches = [], matchesScreenshotBase64 = null, importMethod = 'paste';

// Firebase Globals
let db = null, isCloudActive = false, cloudUnsubscribe = null;
let isAdmin = true;

const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const genId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);

const save = () => {
  localStorage.setItem('ms_tournaments', JSON.stringify(tournaments));
  localStorage.setItem('ms_active_tournament', activeTournamentId || '');
  if (db && isCloudActive) {
    const t = getT();
    if (t && t.id && t.id !== '__all__') {
      db.collection('tournaments').doc(t.id).set(t).catch(err => {
        console.error("Firestore save error:", err);
        showToast("Chyba při ukládání do cloudu", "error");
      });
    }
  }
};

function getCombinedTournamentData() {
  const combined = { id: '__all__', name: 'Všechny tipovačky', icon: '🌐', players: [], matches: [], tips: [] };
  const allPlayers = new Set();
  tournaments.forEach(t => (t.players || []).forEach(p => allPlayers.add(p)));
  combined.players = [...allPlayers];
  tournaments.forEach(t => {
    (t.matches || []).forEach(m => {
      combined.matches.push({ ...m, id: `${t.id}_${m.id}`, tournamentId: t.id, tournamentName: t.name });
    });
    (t.tips || []).forEach(tip => {
      combined.tips.push({ ...tip, id: `${t.id}_${tip.id}`, matchId: `${t.id}_${tip.matchId}`, tournamentId: t.id });
    });
  });
  return combined;
}
const getT = () => {
  if (activeTournamentId === '__all__') return getCombinedTournamentData();
  return tournaments.find(t => t.id === activeTournamentId);
};
const getApiKey = () => localStorage.getItem('geminiApiKey') || '';

function checkAdminPermission() {
  const adminPassword = localStorage.getItem('adminPassword') || '';
  if (!adminPassword) return true;
  
  const userAdminPass = localStorage.getItem('userAdminPass') || '';
  if (adminPassword === userAdminPass) {
    isAdmin = true;
    return true;
  }
  
  // Prompt
  const pass = prompt('Zadejte administrátorské heslo pro odemčení této akce:');
  if (pass === adminPassword) {
    localStorage.setItem('userAdminPass', pass);
    isAdmin = true;
    showToast('Ověřeno! Jste přihlášen/a jako admin.', 'success');
    renderAll();
    return true;
  } else {
    showToast('Chybné heslo!', 'error');
    return false;
  }
}

function setCloudStatus(state) {
  const el = $('#cloudStatus');
  if (!el) return;
  el.className = `cloud-status ${state}`;
  if (state === 'online') {
    el.innerHTML = '☁️ Online';
    el.title = 'Připojeno ke cloudu - real-time synchronizace aktivní';
  } else if (state === 'loading') {
    el.innerHTML = '☁️ Připojování...';
    el.title = 'Připojování ke cloudu...';
  } else {
    el.innerHTML = '☁️ Místní';
    el.title = 'Ukládá se pouze v paměti tohoto prohlížeče';
  }
}

function initFirebase() {
  let configStr = localStorage.getItem('firebaseConfig');
  
  // Default to the provided Firebase configuration
  if (!configStr) {
    const defaultConfig = {
      apiKey: "AIzaSyCK4A7MVEmgVXneiSmy73ymHS_2XLfqJlI",
      authDomain: "tipovacka19.firebaseapp.com",
      projectId: "tipovacka19",
      storageBucket: "tipovacka19.firebasestorage.app",
      messagingSenderId: "602639029659",
      appId: "1:602639029659:web:2e1d6c5b02bc8691fcfd3e",
      measurementId: "G-PJVGFTMKKE"
    };
    configStr = JSON.stringify(defaultConfig, null, 2);
    localStorage.setItem('firebaseConfig', configStr);
  }

  const adminPassword = localStorage.getItem('adminPassword') || '';
  const userAdminPass = localStorage.getItem('userAdminPass') || '';
  
  isAdmin = !adminPassword || (adminPassword === userAdminPass);
  
  if (!configStr) {
    setCloudStatus('offline');
    if (db) {
      db = null; isCloudActive = false;
      if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
      tournaments = JSON.parse(localStorage.getItem('ms_tournaments') || '[]');
      renderAll();
    }
    return;
  }

  try {
    const config = JSON.parse(configStr);
    setCloudStatus('loading');
    
    if (typeof firebase === 'undefined') {
      throw new Error('Firebase SDK se nenačetlo. Zkontrolujte připojení k internetu.');
    }
    
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }
    db = firebase.firestore();
    isCloudActive = true;
    setCloudStatus('online');

    if (cloudUnsubscribe) { cloudUnsubscribe(); }
    cloudUnsubscribe = db.collection('tournaments').onSnapshot(snapshot => {
      let cloudTournaments = [];
      snapshot.forEach(doc => {
        cloudTournaments.push(doc.data());
      });
      
      if (cloudTournaments.length === 0 && tournaments.length > 0) {
        // Migration!
        tournaments.forEach(t => {
          db.collection('tournaments').doc(t.id).set(t).catch(e => console.error(e));
        });
        showToast('Data nahrána do cloudu!', 'success');
      } else if (cloudTournaments.length > 0) {
        tournaments = cloudTournaments;
        if (activeTournamentId && !tournaments.some(t => t.id === activeTournamentId)) {
          activeTournamentId = tournaments[0]?.id || null;
        }
        localStorage.setItem('ms_tournaments', JSON.stringify(tournaments));
        renderAll();
      }
    }, err => {
      console.error("Firestore error:", err);
      setCloudStatus('offline');
      showToast('Chyba: Zkontrolujte Rules ve Firebase konzoli (test mode)', 'error');
    });
  } catch (e) {
    console.error("Firebase init error:", e);
    setCloudStatus('offline');
    showToast('Chyba Firebase: ' + e.message, 'error');
  }
}

function showToast(msg, type='success') {
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function getResultType(h, a) { return h > a ? 1 : h < a ? 2 : 0; }
function formatDate(s) { if (!s) return ''; const d = new Date(s); return `${['Ne','Po','Út','St','Čt','Pá','So'][d.getDay()]} ${d.getDate()}.${d.getMonth()+1}.`; }

// --- Tabs ---
function renderTabs() {
  const scroll = $('#tabsScroll');
  let tabsHtml = tournaments.map(t => {
    const icon = t.icon || '🏆';
    const isImg = icon.startsWith('data:image/');
    const iconHtml = isImg ? `<img src="${icon}" style="width: 18px; height: 18px; border-radius: 4px; object-fit: cover; flex-shrink:0;">` : `<span>${icon}</span>`;
    return `<button class="tab-item ${t.id === activeTournamentId ? 'active' : ''}" data-tid="${t.id}">${iconHtml} <span>${t.name}</span></button>`;
  }).join('');

  if (tournaments.length > 1) {
    tabsHtml += `<button class="tab-item ${activeTournamentId === '__all__' ? 'active' : ''}" data-tid="__all__"><span>🌐</span> <span>Celkový přehled</span></button>`;
  }

  scroll.innerHTML = tabsHtml;
  scroll.querySelectorAll('.tab-item').forEach(btn => btn.addEventListener('click', () => { activeTournamentId = btn.dataset.tid; save(); renderAll(); }));
  const hasTournaments = tournaments.length > 0;
  const ws = $('#welcomeScreen');
  if (hasTournaments) { ws.classList.remove('visible'); } else { ws.classList.add('visible'); }
  $('#mainContent').style.display = hasTournaments && activeTournamentId ? '' : 'none';
  $('#tabsBar').style.display = hasTournaments ? '' : 'none';
}

// --- Scoring ---
function calculateScores() {
  const t = getT(); if (!t) return [];
  const scores = {}; t.players.forEach(p => scores[p] = { points: 0, correct102: 0, correctScore: 0 });
  t.matches.forEach(m => {
    if (m.result === null) return;
    (t.tips || []).filter(tip => tip.matchId === m.id).forEach(tip => {
      if (!scores[tip.playerName]) scores[tip.playerName] = { points: 0, correct102: 0, correctScore: 0 };
      if (tip.tipType === m.resultType) { scores[tip.playerName].points += 1; scores[tip.playerName].correct102 += 1; }
      if (tip.tipScore === m.result) { scores[tip.playerName].points += 3; scores[tip.playerName].correctScore += 1; }
    });
  });
  return Object.entries(scores).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.points - a.points || b.correctScore - a.correctScore);
}

// --- Render ---
function renderLeaderboard() {
  const scores = calculateScores(), c = $('#leaderboardBody');
  if (!scores.length) { c.innerHTML = '<div class="empty-state"><p>Žádní hráči / hráčky</p></div>'; return; }
  c.innerHTML = scores.map((s, i) => {
    const r = i + 1; let rc = 'rank-other', ri = r;
    if (r === 1) {
      rc = 'rank-1';
      ri = `<img src="medal_gold.png" crossorigin="anonymous" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle;">`;
    } else if (r === 2) {
      rc = 'rank-2';
      ri = `<img src="medal_silver.png" crossorigin="anonymous" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle;">`;
    } else if (r === 3) {
      rc = 'rank-3';
      ri = `<img src="medal_bronze.png" crossorigin="anonymous" style="width: 24px; height: 24px; object-fit: contain; vertical-align: middle;">`;
    }
    return `<div class="leaderboard-item" onclick="openPlayerModal('${s.name}')" style="cursor: pointer;"><div class="rank ${rc}">${ri}</div><div class="player-info"><div class="player-name">${s.name}</div><div class="player-stats">${s.correct102}× správný tip · ${s.correctScore}× přesné skóre</div></div><div class="player-points">${s.points} <span>b</span></div></div>`;
  }).join('');
}

function renderMatches() {
  const t = getT(), c = $('#matchesBody'); if (!t) return;
  $('#matchCount').textContent = `${t.matches.length} zápasů`;
  if (!t.matches.length) { c.innerHTML = '<div class="empty-state"><p>Žádné zápasy. Klikněte + pro přidání.</p></div>'; return; }
  
  // Chronologické seřazení zápasů
  const sortedMatches = [...t.matches].sort((a, b) => {
    if (!a.date) return 1; if (!b.date) return -1;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return (a.order || 0) - (b.order || 0);
  });

  c.innerHTML = sortedMatches.map(m => {
    const mTips = (t.tips || []).filter(tip => tip.matchId === m.id), hasRes = m.result !== null;
    const tipsHtml = t.players.map(p => {
      const tip = mTips.find(x => x.playerName === p);
      if (!tip) return `<div class="tip-card"><div class="tip-player">${p}</div><div class="tip-type" style="color:var(--text-muted)">—</div></div>`;
      let cc = '';
      if (hasRes) { const tc = tip.tipType === m.resultType, sc = tip.tipScore === m.result; cc = sc ? 'correct-score correct-type' : tc ? 'correct-type' : 'wrong'; }
      return `<div class="tip-card ${cc}"><div class="tip-player">${p}</div><div class="tip-type">${tip.tipType}</div><div class="tip-score">${tip.tipScore || '—'}</div></div>`;
    }).join('');

    const tLabel = activeTournamentId === '__all__' 
      ? `<span class="tournament-badge" style="background: rgba(99,102,241,0.15); color: var(--accent-hover); font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 6px; font-weight: 700; vertical-align: middle; display: inline-block;">${m.tournamentName}</span>` 
      : '';

    // Rozložení tipů skupiny
    const totalTips = mTips.length;
    let distHtml = '';
    if (totalTips > 0) {
      const ones = mTips.filter(x => x.tipType === 1);
      const zeros = mTips.filter(x => x.tipType === 0);
      const twos = mTips.filter(x => x.tipType === 2);
      
      const p1 = Math.round((ones.length / totalTips) * 100);
      const p0 = Math.round((zeros.length / totalTips) * 100);
      const p2 = 100 - p1 - p0;
      
      const names1 = ones.map(x => x.playerName).join(', ');
      const names0 = zeros.map(x => x.playerName).join(', ');
      const names2 = twos.map(x => x.playerName).join(', ');
      
      distHtml = `
        <div class="tip-dist-wrap" style="margin: 12px 0; background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 10px; border-radius: 8px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">📊 Rozložení tipů skupiny</div>
          <div style="display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: rgba(255,255,255,0.05);">
            ${ones.length ? `<div style="width: ${p1}%; background: #22c55e;" title="Výhra domácích (1): ${p1}% (${names1})"></div>` : ''}
            ${zeros.length ? `<div style="width: ${p0}%; background: #eab308;" title="Remíza (0): ${p0}% (${names0})"></div>` : ''}
            ${twos.length ? `<div style="width: ${p2}%; background: #3b82f6;" title="Výhra hostů (2): ${p2}% (${names2})"></div>` : ''}
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted); margin-top: 4px;">
            <span>1 (Domácí): ${ones.length}× (${p1}%)</span>
            <span>0 (Remíza): ${zeros.length}× (${p0}%)</span>
            <span>2 (Hosté): ${twos.length}× (${p2}%)</span>
          </div>
        </div>
      `;
    }

    // AI Gemini Predikce
    let aiPredictions = JSON.parse(localStorage.getItem('ms_ai_predictions') || '{}');
    const predData = aiPredictions[m.id];
    let aiHtml = '';
    if (!hasRes) {
      if (predData) {
        aiHtml = `
          <div class="ai-pred-box" style="margin: 12px 0; background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.25); padding: 12px; border-radius: var(--radius-sm); text-align: left; font-size: 12px; line-height: 1.5; color: var(--text-primary);">
            <div style="font-weight: 800; color: var(--accent-hover); margin-bottom: 6px; display: flex; align-items: center; gap: 6px;"><span style="font-size: 16px;">🔮</span> AI Analýza a Predikce</div>
            <p style="font-style: italic; color: #cbd5e1; margin-bottom: 8px;">"${predData.analysis}"</p>
            <div style="display: inline-block; background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); padding: 4px 8px; border-radius: 6px; font-weight: 800; color: #fff; font-size: 11px;">
              Tip skóre: ${predData.score}
            </div>
          </div>
        `;
      } else {
        aiHtml = `
          <div class="ai-pred-trigger" id="aiPredWrap_${m.id}" style="margin: 12px 0 6px; text-align: left;">
            <button class="btn btn-sm btn-outline" style="border-color: rgba(99,102,241,0.3); background: rgba(99,102,241,0.04); color: var(--accent-hover); font-weight: 700; font-size: 11px; padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: all var(--transition);" onclick="event.stopPropagation(); getAiPrediction('${m.id}', '${m.homeTeam.replace(/'/g, "\\'")}', '${m.awayTeam.replace(/'/g, "\\'")}')">
              🔮 Získat AI předpověď zápasu
            </button>
          </div>
        `;
      }
    }

    const actionButtons = activeTournamentId !== '__all__' 
      ? `<div class="match-actions"><button class="btn btn-sm" onclick="openResultModal('${m.id}')">📝 Výsledek</button><button class="btn btn-sm" onclick="openManualTipModal('${m.id}')">✍️ Tip</button><button class="btn btn-sm" onclick="deleteMatch('${m.id}')" style="color:var(--danger)">🗑️</button></div>`
      : '';

    return `<div class="match-item" data-id="${m.id}"><div class="match-header" onclick="toggleMatch('${m.id}')"><div><div class="match-teams">${m.homeTeam} – ${m.awayTeam}</div><div class="match-date">${tLabel}${formatDate(m.date)}${m.time ? ' · '+m.time : ''}</div></div>${hasRes ? `<div class="match-result">${m.result}</div>` : '<div class="match-result pending">Čeká se</div>'}<svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div><div class="match-details">${actionButtons}${distHtml}${aiHtml}<div class="tips-grid">${tipsHtml}</div>${!mTips.length ? '<div class="no-tips">Zatím žádné tipy</div>' : ''}</div></div>`;
  }).join('');
}

// --- Dynamic Point Progress Chart (Vanilla SVG) ---
function renderProgressChart() {
  const container = document.getElementById('progressChartContainer');
  if (!container) return;
  
  const t = getT();
  if (!t || !t.matches || !t.matches.length) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:12px;color:var(--text-muted);font-style:italic;">Žádná data pro graf vývoje bodů</div>`;
    return;
  }
  
  // Získání odehraných zápasů seřazených chronologicky
  const finishedMatches = [...t.matches]
    .filter(m => m.result !== null)
    .sort((a, b) => {
      if (!a.date) return 1; if (!b.date) return -1;
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time && b.time) return a.time.localeCompare(b.time);
      return (a.order || 0) - (b.order || 0);
    });
    
  if (finishedMatches.length === 0) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:12px;color:var(--text-muted);font-style:italic;padding:20px;text-align:center;">Odehrajte alespoň 1 zápas pro zobrazení vývoje bodů</div>`;
    return;
  }
  
  // Výpočet postupného sčítání bodů zápas po zápasu
  const players = t.players;
  const history = {}; // jméno -> pole bodů v každém kroku (začíná 0)
  players.forEach(p => history[p] = [0]);
  
  const matchesData = ['Začátek'];
  
  finishedMatches.forEach(m => {
    matchesData.push(`${m.homeTeam} vs ${m.awayTeam}`);
    const mTips = (t.tips || []).filter(tip => tip.matchId === m.id);
    
    players.forEach(p => {
      const prevPoints = history[p][history[p].length - 1];
      let matchPoints = 0;
      const tip = mTips.find(x => x.playerName === p);
      if (tip) {
        if (tip.tipType === m.resultType) matchPoints += 1;
        if (tip.tipScore === m.result) matchPoints += 3;
      }
      history[p].push(prevPoints + matchPoints);
    });
  });
  
  // Vykreslení SVG grafu
  const width = container.clientWidth || 600;
  const height = 340;
  const paddingX = 40;
  const paddingY = 20;
  
  const stepsCount = history[players[0]].length; // zápasy + 1
  
  // Zjištění maxima bodů pro měřítko Y
  let maxPoints = 0;
  players.forEach(p => {
    const finalPoints = history[p][history[p].length - 1];
    if (finalPoints > maxPoints) maxPoints = finalPoints;
  });
  if (maxPoints === 0) maxPoints = 5;
  
  // Barvy pro hráče (HSL pro pestrost a záři)
  const getPlayerColor = (index, total) => {
    const hue = (index * (360 / Math.max(total, 1))) % 360;
    return `hsl(${hue}, 85%, 65%)`;
  };
  
  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="overflow:visible;">
    <defs>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  `;
  
  // Grid Lines Y
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const yVal = Math.round((maxPoints / yTicks) * i);
    const y = height - paddingY - ((yVal / maxPoints) * (height - 2 * paddingY));
    svg += `<line x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />`;
    svg += `<text x="${paddingX - 10}" y="${y + 4}" fill="var(--text-muted)" font-size="10" font-weight="700" text-anchor="end">${yVal}</text>`;
  }
  
  // Grid Lines X
  for (let i = 0; i < stepsCount; i++) {
    const x = paddingX + (i / (stepsCount - 1)) * (width - 2 * paddingX);
    svg += `<line x1="${x}" y1="${paddingY}" x2="${x}" y2="${height - paddingY}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />`;
  }
  
  const pointsList = [];
  
  // Vykreslení čar jednotlivých hráčů
  players.forEach((p, pIdx) => {
    const color = getPlayerColor(pIdx, players.length);
    let pathD = '';
    
    for (let i = 0; i < stepsCount; i++) {
      const x = paddingX + (i / (stepsCount - 1)) * (width - 2 * paddingX);
      const pts = history[p][i];
      const y = height - paddingY - ((pts / maxPoints) * (height - 2 * paddingY));
      
      if (i === 0) {
        pathD += `M ${x} ${y}`;
      } else {
        const prevX = paddingX + ((i - 1) / (stepsCount - 1)) * (width - 2 * paddingX);
        const prevPts = history[p][i - 1];
        const prevY = height - paddingY - ((prevPts / maxPoints) * (height - 2 * paddingY));
        const cpX1 = prevX + (x - prevX) / 2;
        const cpY1 = prevY;
        const cpX2 = prevX + (x - prevX) / 2;
        const cpY2 = y;
        pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${x} ${y}`;
      }
      
      pointsList.push({
        player: p,
        matchIndex: i,
        matchName: matchesData[i],
        points: pts,
        x,
        y,
        color
      });
    }
    
    svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" filter="url(#glow)" style="opacity: 0.85;" />`;
  });
  
  // Vykreslení interaktivních uzlů
  pointsList.forEach(pt => {
    svg += `<circle cx="${pt.x}" cy="${pt.y}" r="3" fill="#fff" stroke="${pt.color}" stroke-width="2" />`;
    svg += `<circle cx="${pt.x}" cy="${pt.y}" r="10" fill="transparent" style="cursor:pointer;" onmouseenter="showChartTooltip(event, '${pt.player}', ${pt.points}, '${pt.matchName}', '${pt.color}')" onmouseleave="hideChartTooltip()" />`;
  });
  
  svg += `</svg>`;
  container.innerHTML = svg;
}

window.showChartTooltip = function(event, player, points, matchName, color) {
  const tooltip = document.getElementById('chartTooltip');
  if (!tooltip) return;
  
  const container = document.getElementById('progressChartContainer');
  const rect = container.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  tooltip.style.display = 'block';
  tooltip.style.left = `${x + 12}px`;
  tooltip.style.top = `${y - 12}px`;
  tooltip.innerHTML = `
    <div style="font-weight:800;color:${color};margin-bottom:2px;font-size:12px;">👑 ${player}</div>
    <div style="font-weight:700;font-size:13px;color:#fff;">${points} bodů</div>
    <div style="color:var(--text-muted);font-size:9px;margin-top:2px;">${matchName}</div>
  `;
};

window.hideChartTooltip = function() {
  const tooltip = document.getElementById('chartTooltip');
  if (tooltip) tooltip.style.display = 'none';
};

// --- AI Gemini Prediktor ---
window.getAiPrediction = async function(matchId, home, away) {
  const wrap = document.getElementById(`aiPredWrap_${matchId}`);
  if (!wrap) return;
  wrap.innerHTML = `<div class="spinner" style="width:20px;height:20px;margin:0;display:inline-block;vertical-align:middle;"></div> <span style="font-size:11px;color:var(--text-muted);vertical-align:middle;margin-left:8px;">AI přemýšlí...</span>`;
  
  try {
    const key = getApiKey();
    if (!key) throw new Error('Nastavte Gemini API klíč v nastavení');
    
    const prompt = {
      contents: [{ role: 'user', parts: [
        { text: `Analyzuj nadcházející hokejový zápas: ${home} vs ${away}.\n\nNapiš stručnou a vtipnou předpověď v češtině (max 2-3 věty). Navrhni přesný výsledek (formát X:Y, např. 3:2 nebo 1:4). Vrať to jako JSON se strukturou: {"analysis": "text analýzy", "score": "X:Y"}` }
      ]}],
      generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { analysis: { type: 'STRING' }, score: { type: 'STRING' } }, required: ["analysis", "score"] } }
    };
    
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prompt)
    });
    if (!r.ok) throw new Error(`API chyba: ${r.status}`);
    const d = await r.json(); const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('AI nevrátila data.');
    const res = JSON.parse(txt);
    
    let aiPredictions = JSON.parse(localStorage.getItem('ms_ai_predictions') || '{}');
    aiPredictions[matchId] = res;
    localStorage.setItem('ms_ai_predictions', JSON.stringify(aiPredictions));
    
    renderMatches();
    showToast('AI analýza stažena!', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
    renderMatches();
  }
};

// --- Hráčské Trofeje & Statistiky (Dynamické extrémy a rozmanité odznaky) ---
function calculateAllPlayerBadges() {
  const t = getT(); if (!t) return { playerStats: {}, badges: {} };
  const players = t.players;
  const matches = t.matches || [];
  const tips = t.tips || [];
  
  // Inicializace statistik pro všechny hráče
  const playerStats = {};
  players.forEach(p => {
    playerStats[p] = {
      exactScores: 0,
      drawTipsCorrect: 0,
      closeCalls: 0,
      totalGoalsTipped: 0,
      tipsCount: 0,
      rebelTips: 0,
      missingTips: 0,
      leaderCount: 0,
      totalTips: 0,
      correctOutcomes: 0,
      totalPoints: 0,
      accuracy: 0,
      avgPoints: '0.00',
      czechWinTips: 0,
      correctShutouts: 0,
      worstRank: null,
      currentRank: 1,
      bestRank: null,
      maxStreak: 0,
      streakTemp: 0
    };
  });

  const finishedMatches = [...matches].filter(m => m.result !== null).sort((a, b) => {
    if (!a.date) return 1; if (!b.date) return -1;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return (a.order || 0) - (b.order || 0);
  });

  // Procházení všech zápasů pro výpočet Rebelů, Patriotů, atd.
  matches.forEach(m => {
    const mTips = tips.filter(x => x.matchId === m.id);
    
    // Rebelové
    if (mTips.length >= 2) {
      const counts = { 1: 0, 0: 0, 2: 0 };
      mTips.forEach(tip => counts[tip.tipType]++);
      
      let minType = null, minVal = Infinity;
      [1, 0, 2].forEach(type => {
        if (counts[type] > 0 && counts[type] < minVal) {
          minVal = counts[type];
          minType = type;
        }
      });
      
      if (minType !== null && counts[minType] < mTips.length / 2) {
        mTips.forEach(tip => {
          if (tip.tipType === minType) {
            if (playerStats[tip.playerName]) playerStats[tip.playerName].rebelTips++;
          }
        });
      }
    }

    const isHomeCzech = (m.homeTeam || '').toLowerCase().includes('čes') || (m.homeTeam || '').toLowerCase().includes('czech');
    const isAwayCzech = (m.awayTeam || '').toLowerCase().includes('čes') || (m.awayTeam || '').toLowerCase().includes('czech');
    const isCzechPlaying = isHomeCzech || isAwayCzech;

    players.forEach(p => {
      const tip = mTips.find(x => x.playerName === p);
      if (!tip) {
        playerStats[p].missingTips++;
      } else {
        playerStats[p].totalTips++;
        
        // Patriot
        if (isCzechPlaying) {
          let tippedCzechToWin = false;
          if (tip.tipScore) {
            const cleanScore = tip.tipScore.replace('p', '');
            const parts = cleanScore.split(':').map(Number);
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              if (isHomeCzech && parts[0] > parts[1]) {
                tippedCzechToWin = true;
              } else if (isAwayCzech && parts[1] > parts[0]) {
                tippedCzechToWin = true;
              }
            }
          }
          // Fallback if score is not parsed properly but tipType is set
          if (!tippedCzechToWin) {
            if (isHomeCzech && tip.tipType === 1) {
              tippedCzechToWin = true;
            } else if (isAwayCzech && tip.tipType === 2) {
              tippedCzechToWin = true;
            }
          }

          if (tippedCzechToWin) {
            playerStats[p].czechWinTips++;
          }
        }

        if (tip.tipScore) {
          const parts = tip.tipScore.replace('p', '').split(':').map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            playerStats[p].totalGoalsTipped += (parts[0] + parts[1]);
            playerStats[p].tipsCount++;
          }
        }
      }
    });
  });

  // Výpočet výsledků a průběžného žebříčku
  const history = {};
  players.forEach(p => history[p] = 0);
  
  const firstDayDate = finishedMatches.length > 0 ? finishedMatches[0].date : null;
  
  finishedMatches.forEach((m, mIdx) => {
    const mTips = tips.filter(x => x.matchId === m.id);
    players.forEach(p => {
      const tip = mTips.find(x => x.matchId === m.id && x.playerName === p);
      
      if (tip) {
        const isOutcomeCorrect = tip.tipType === m.resultType;
        const isScoreCorrect = tip.tipScore === m.result;
        
        if (isOutcomeCorrect) {
          playerStats[p].correctOutcomes++;
          playerStats[p].totalPoints += 1;
          history[p] += 1;
          if (m.resultType === 0) {
            playerStats[p].drawTipsCorrect++;
          }
        }
        if (isScoreCorrect) {
          playerStats[p].exactScores++;
          playerStats[p].totalPoints += 3;
          history[p] += 3;
        }

        // Streak temp
        const points = isOutcomeCorrect ? (isScoreCorrect ? 4 : 1) : 0;
        if (points > 0) {
          playerStats[p].streakTemp = (playerStats[p].streakTemp || 0) + 1;
          if (playerStats[p].streakTemp > playerStats[p].maxStreak) {
            playerStats[p].maxStreak = playerStats[p].streakTemp;
          }
        } else {
          playerStats[p].streakTemp = 0;
        }
        
        // Neprůstřelná zeď (Shutouts) a Smolař
        if (tip.tipScore && m.result) {
          const tScores = tip.tipScore.replace('p', '').split(':').map(Number);
          const rScores = m.result.replace('p', '').split(':').map(Number);
          if (tScores.length === 2 && rScores.length === 2) {
            const tShut = (tScores[0] === 0 || tScores[1] === 0);
            const rShut = (rScores[0] === 0 || rScores[1] === 0);
            if (tShut && rShut && isOutcomeCorrect) {
              playerStats[p].correctShutouts++;
            }
            
            if (!isScoreCorrect) {
              const err = Math.abs(tScores[0] - rScores[0]) + Math.abs(tScores[1] - rScores[1]);
              if (err === 1) {
                playerStats[p].closeCalls++;
              }
            }
          }
        }
      } else {
        playerStats[p].streakTemp = 0;
      }
    });
    
    // Vyhodnocení žebříčku a odznaků POUZE na konci hracího dne (poslední zápas daného data)
    const isLastOfDate = (
      mIdx === finishedMatches.length - 1 || 
      finishedMatches[mIdx + 1].date !== m.date
    );

    if (isLastOfDate) {
      const roundScores = Object.entries(history).map(([name, pts]) => ({ name, points: pts })).sort((a, b) => b.points - a.points);
      let lastPts = -1;
      let lastRank = 1;

      const isFirstDay = firstDayDate !== null && m.date === firstDayDate;
      const isLastOfFirstDay = isFirstDay;
      const isAfterFirstDay = firstDayDate !== null && m.date !== firstDayDate;

      roundScores.forEach((s, idx) => {
        let rank = idx + 1;
        if (s.points === lastPts) {
          rank = lastRank;
        } else {
          lastPts = s.points;
          lastRank = rank;
        }
        
        if (playerStats[s.name]) {
          playerStats[s.name].currentRank = rank;
          
          if (isLastOfFirstDay) {
            playerStats[s.name].bestRank = rank;
            playerStats[s.name].worstRank = rank;
          } else if (isAfterFirstDay) {
            if (playerStats[s.name].bestRank === null || rank < playerStats[s.name].bestRank) {
              playerStats[s.name].bestRank = rank;
            }
            if (playerStats[s.name].worstRank === null || rank > playerStats[s.name].worstRank) {
              playerStats[s.name].worstRank = rank;
            }
          }
        }
      });

      // Lídr count – počítáme pouze lídry na konci každého hracího dne
      let maxPts = -1, leaders = [];
      players.forEach(p => {
        if (history[p] > maxPts) { maxPts = history[p]; leaders = [p]; }
        else if (history[p] === maxPts) { leaders.push(p); }
      });
      if (maxPts > 0) {
        leaders.forEach(l => playerStats[l].leaderCount++);
      }
    }
  });

  // Výpočet průměrů a nových statistik odznaků
  players.forEach(p => {
    const ps = playerStats[p];
    ps.accuracy = ps.totalTips > 0 ? Math.round(((ps.correctOutcomes + ps.exactScores) / (ps.totalTips * 2)) * 100) : 0;
    ps.avgPoints = ps.totalTips > 0 ? (ps.totalPoints / ps.totalTips).toFixed(2) : '0.00';
    ps.avgGoalsTipped = ps.tipsCount > 0 ? (ps.totalGoalsTipped / ps.tipsCount) : null;
    
    // Černý kůň (climb) a Padající hvězda (drop)
    ps.comebackClimb = ps.worstRank !== null ? (ps.worstRank - ps.currentRank) : 0; // Největší posun nahoru ze dna
    ps.fallingDrop = ps.bestRank !== null ? (ps.currentRank - ps.bestRank) : 0; // Největší pád dolů z vrcholu
  });

  // Hledání extrémů (kdo získá odznaky)
  const extremes = {
    maxExact: { val: 0, players: [] },
    maxDraws: { val: 0, players: [] },
    maxClose: { val: 1, players: [] },
    minAvgGoals: { val: Infinity, players: [] },
    maxAvgGoals: { val: 0, players: [] },
    maxRebels: { val: 0, players: [] },
    maxMissing: { val: 0, players: [] },
    maxLeader: { val: 0, players: [] },
    maxCzechTips: { val: 0, players: [] },
    maxShutouts: { val: 0, players: [] },
    maxClimb: { val: 0, players: [] },
    maxDrop: { val: 0, players: [] },
    maxStreak: { val: 2, players: [] }
  };

  players.forEach(p => {
    const ps = playerStats[p];
    
    if (ps.exactScores > extremes.maxExact.val) { extremes.maxExact = { val: ps.exactScores, players: [p] }; }
    else if (ps.exactScores === extremes.maxExact.val && ps.exactScores > 0) { extremes.maxExact.players.push(p); }
    
    if (ps.drawTipsCorrect > extremes.maxDraws.val) { extremes.maxDraws = { val: ps.drawTipsCorrect, players: [p] }; }
    else if (ps.drawTipsCorrect === extremes.maxDraws.val && ps.drawTipsCorrect > 0) { extremes.maxDraws.players.push(p); }
    
    if (ps.closeCalls > extremes.maxClose.val) { extremes.maxClose = { val: ps.closeCalls, players: [p] }; }
    else if (ps.closeCalls === extremes.maxClose.val && ps.closeCalls > 1) { extremes.maxClose.players.push(p); }
    
    if (ps.rebelTips > extremes.maxRebels.val) { extremes.maxRebels = { val: ps.rebelTips, players: [p] }; }
    else if (ps.rebelTips === extremes.maxRebels.val && ps.rebelTips > 0) { extremes.maxRebels.players.push(p); }
    
    if (ps.missingTips > extremes.maxMissing.val) { extremes.maxMissing = { val: ps.missingTips, players: [p] }; }
    else if (ps.missingTips === extremes.maxMissing.val && ps.missingTips > 0) { extremes.maxMissing.players.push(p); }
    
    if (ps.leaderCount > extremes.maxLeader.val) { extremes.maxLeader = { val: ps.leaderCount, players: [p] }; }
    else if (ps.leaderCount === extremes.maxLeader.val && ps.leaderCount > 0) { extremes.maxLeader.players.push(p); }

    if (ps.czechWinTips > extremes.maxCzechTips.val) { extremes.maxCzechTips = { val: ps.czechWinTips, players: [p] }; }
    else if (ps.czechWinTips === extremes.maxCzechTips.val && ps.czechWinTips > 0) { extremes.maxCzechTips.players.push(p); }

    if (ps.correctShutouts > extremes.maxShutouts.val) { extremes.maxShutouts = { val: ps.correctShutouts, players: [p] }; }
    else if (ps.correctShutouts === extremes.maxShutouts.val && extremes.maxShutouts.val > 0) { extremes.maxShutouts.players.push(p); }

    if (ps.avgGoalsTipped !== null && ps.tipsCount >= 3) {
      if (ps.avgGoalsTipped < extremes.minAvgGoals.val) { extremes.minAvgGoals = { val: ps.avgGoalsTipped, players: [p] }; }
      else if (ps.avgGoalsTipped === extremes.minAvgGoals.val) { extremes.minAvgGoals.players.push(p); }
      
      if (ps.avgGoalsTipped > extremes.maxAvgGoals.val) { extremes.maxAvgGoals = { val: ps.avgGoalsTipped, players: [p] }; }
      else if (ps.avgGoalsTipped === extremes.maxAvgGoals.val) { extremes.maxAvgGoals.players.push(p); }
    }

    // Extremes pro Černého koně a Padající hvězdu
    if (ps.comebackClimb > extremes.maxClimb.val) { extremes.maxClimb = { val: ps.comebackClimb, players: [p] }; }
    else if (ps.comebackClimb === extremes.maxClimb.val && ps.comebackClimb > 0) { extremes.maxClimb.players.push(p); }

    if (ps.fallingDrop > extremes.maxDrop.val) { extremes.maxDrop = { val: ps.fallingDrop, players: [p] }; }
    else if (ps.fallingDrop === extremes.maxDrop.val && ps.fallingDrop > 0) { extremes.maxDrop.players.push(p); }

    // Extremes pro bodovou šňůru (Na Vlně)
    if (ps.maxStreak > extremes.maxStreak.val) { extremes.maxStreak = { val: ps.maxStreak, players: [p] }; }
    else if (ps.maxStreak === extremes.maxStreak.val && ps.maxStreak >= 3) { extremes.maxStreak.players.push(p); }
  });

  // Generování odznaků pro jednotlivé hráče
  const badges = {};
  players.forEach(p => badges[p] = []);

  if (extremes.maxExact.val >= 1) extremes.maxExact.players.forEach(p => badges[p].push({ key: 'sniper', emoji: '🎯', title: 'Ostrý sniper / sniperka', desc: `Drží rekord turnaje s ${extremes.maxExact.val}× přesně trefeným skóre!`, color: '#4ade80', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.2)' }));
  if (extremes.maxDraws.val >= 1) extremes.maxDraws.players.forEach(p => badges[p].push({ key: 'peacemaker', emoji: '⚖️', title: 'Diplomatický/á mírotvůrce', desc: `Rozpoznal/a nejvíce remíz a prodloužení v turnaji (${extremes.maxDraws.val}×).`, color: '#facc15', bg: 'rgba(234,179,8,0.06)', border: 'rgba(234,179,8,0.2)' }));
  if (extremes.maxClose.val >= 2) extremes.maxClose.players.forEach(p => badges[p].push({ key: 'unlucky', emoji: '💥', title: 'Smolař / Smolařka turnaje', desc: `Největší smolař/ka! Trefil/a těsně vedle o jediný gól celkem ${extremes.maxClose.val}×.`, color: '#f87171', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.2)' }));
  if (extremes.maxRebels.val >= 1) extremes.maxRebels.players.forEach(p => badges[p].push({ key: 'rebel', emoji: '🔮', title: 'Odvážný rebel / rebelka', desc: `Trefil/a nejvíc odvážných tipů (${extremes.maxRebels.val}×), které šly proti většině skupiny.`, color: '#a855f7', bg: 'rgba(168,85,247,0.06)', border: 'rgba(168,85,247,0.2)' }));
  if (extremes.maxMissing.val >= 1) extremes.maxMissing.players.forEach(p => badges[p].push({ key: 'missing', emoji: '💤', title: 'Zapomnětlivý profesor / profesorka', desc: `Zaspal/a a zapomněl/a natipovat nejvíce zápasů z celé skupiny (${extremes.maxMissing.val}×).`, color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.2)' }));
  if (extremes.maxLeader.val >= 1) extremes.maxLeader.players.forEach(p => badges[p].push({ key: 'leader', emoji: '👑', title: 'Neochvějný lídr / lídryně', desc: `Strávil/a nejvíce zápasů na absolutním 1. místě tabulky v průběhu turnaje (${extremes.maxLeader.val}×).`, color: '#f97316', bg: 'rgba(249,115,22,0.06)', border: 'rgba(249,115,22,0.2)' }));
  if (extremes.minAvgGoals.val !== Infinity) extremes.minAvgGoals.players.forEach(p => badges[p].push({ key: 'defense', emoji: '🛡️', title: 'Defenzivní betonář / betonářka', desc: `Absolutně nejnižší průměrný tip gólů v celé skupině (pouze ${extremes.minAvgGoals.val.toFixed(1)} gólu na zápas).`, color: '#38bdf8', bg: 'rgba(56,189,248,0.06)', border: 'rgba(56,189,248,0.2)' }));
  if (extremes.maxAvgGoals.val > 0) extremes.maxAvgGoals.players.forEach(p => badges[p].push({ key: 'attack', emoji: '🌪️', title: 'Ofenzivní uragán', desc: `Absolutně nejvyšší průměrný tip gólů v celé skupině (rekordních ${extremes.maxAvgGoals.val.toFixed(1)} gólu na zápas).`, color: '#ec4899', bg: 'rgba(236,72,153,0.06)', border: 'rgba(236,72,153,0.2)' }));

  if (extremes.maxCzechTips.val >= 1) extremes.maxCzechTips.players.forEach(p => badges[p].push({ key: 'patriot', emoji: '🇨🇿', title: 'Hrdý patriot / patriotka', desc: `Absolutní a bezbřehá víra v náš tým! Natipoval/a výhru Česka celkem ${extremes.maxCzechTips.val}×.`, color: '#f43f5e', bg: 'rgba(244,63,94,0.06)', border: 'rgba(244,63,94,0.2)' }));
  if (extremes.maxShutouts.val >= 1) extremes.maxShutouts.players.forEach(p => badges[p].push({ key: 'wall', emoji: '🧱', title: 'Neprůstřelná zeď', desc: `Předpověděl/a a trefil/a zápas s nulovým kontem (čisté konto jednoho z týmů) celkem ${extremes.maxShutouts.val}×.`, color: '#e2e8f0', bg: 'rgba(226,232,240,0.06)', border: 'rgba(226,232,240,0.2)' }));
  // Nové odznaky (schválené)
  if (extremes.maxStreak.val >= 3) extremes.maxStreak.players.forEach(p => badges[p].push({ key: 'streak', emoji: '🔥', title: 'Na Vlně', desc: `Chytil/a neuvěřitelnou formu! Drží rekord turnaje s bodovou šňůrou v ${extremes.maxStreak.val} zápasech po sobě.`, color: '#f97316', bg: 'rgba(249,115,22,0.06)', border: 'rgba(249,115,22,0.2)' }));
  
  if (extremes.maxClimb.val >= 1) extremes.maxClimb.players.forEach(p => badges[p].push({ key: 'darkhorse', emoji: '🐎', title: 'Černý kůň', desc: `Předvedl/a největší návrat do hry! Vyšplhal/a se o rekordních ${extremes.maxClimb.val} míst nahoru ze svého nejhoršího umístění v turnaji.`, color: '#8b5cf6', bg: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.2)' }));
  
  if (extremes.maxDrop.val >= 1) extremes.maxDrop.players.forEach(p => badges[p].push({ key: 'fallingstar', emoji: '☄️', title: 'Padající hvězda', desc: `Smutný hrdina / Smutná hrdinka! Zažil/a nejtvrdší pád v žebříčku, propadl/a se o ${extremes.maxDrop.val} míst dolů ze své nejlepší pozice v turnaji.`, color: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.2)' }));

  return { playerStats, badges };
}

window.openPlayerModal = function(playerName) {
  const allData = calculateAllPlayerBadges();
  const stats = allData.playerStats[playerName];
  const playerBadges = allData.badges[playerName] || [];
  
  if (!stats) return;
  
  $('#profilePlayerName').textContent = playerName;
  $('#profileGlobalStats').textContent = `Odehráno ${stats.totalTips} zápasů · celkem ${stats.totalPoints} bodů`;
  
  $('#statExactScores').textContent = stats.exactScores;
  $('#statOutcomes').textContent = stats.correctOutcomes;
  $('#statAccuracy').textContent = `${stats.accuracy} %`;
  $('#statAvgPoints').textContent = stats.avgPoints;
  
  let badgesHtml = playerBadges.map(b => `
    <div style="display: flex; align-items: center; gap: 12px; background: ${b.bg}; border: 1px solid ${b.border}; padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
      <span style="font-size: 26px; filter: drop-shadow(0 0 6px ${b.color}50);">${b.emoji}</span>
      <div>
        <div style="font-weight: 800; color: ${b.color}; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${b.title}</div>
        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${b.desc}</div>
      </div>
    </div>
  `).join('');
  
  if (!badgesHtml) {
    badgesHtml = `<p style="font-size: 12px; color: var(--text-muted); font-style: italic; text-align: center; padding: 16px 0;">Zatím nezískány žádné rekordní odznaky. Bojujte o extrémy turnaje!</p>`;
  }
  
  $('#profileBadgesList').innerHTML = badgesHtml;
  openModal('modalPlayerProfile');
};

function renderAll() {
  renderTabs();
  if (getT()) {
    renderLeaderboard();
    renderMatches();
    renderProgressChart();
  }
}
function toggleMatch(id) { document.querySelector(`.match-item[data-id="${id}"]`)?.classList.toggle('expanded'); }

// --- CRUD ---
function addMatch(home, away, date, time) {
  if (!checkAdminPermission()) return;
  const t = getT(); if (!t) return;
  t.matches.push({ id: genId(), homeTeam: home, awayTeam: away, date, time, result: null, resultType: null, order: t.matches.length + 1 });
  save(); renderAll(); showToast(`${home} - ${away} přidán`);
}
function setResult(matchId, h, a, isOvertime) {
  if (!checkAdminPermission()) return;
  const t = getT(), m = t?.matches.find(x => x.id === matchId); if (!m) return;
  m.result = `${h}:${a}${isOvertime ? 'p' : ''}`;
  m.resultType = isOvertime ? 0 : getResultType(h, a);
  save(); renderAll(); showToast(`Výsledek ${m.result} uložen`);
}
function deleteMatch(matchId) {
  if (!checkAdminPermission()) return;
  const t = getT(); if (!t || !confirm('Smazat zápas?')) return;
  t.matches = t.matches.filter(m => m.id !== matchId); t.tips = (t.tips || []).filter(x => x.matchId !== matchId);
  save(); renderAll(); showToast('Smazáno');
}
function saveTip(matchId, player, tipType, tipScore) {
  const t = getT(); if (!t) return; if (!t.tips) t.tips = [];
  const idx = t.tips.findIndex(x => x.matchId === matchId && x.playerName === player);
  const data = { id: genId(), matchId, playerName: player, tipType: parseInt(tipType), tipScore, timestamp: Date.now() };
  if (idx >= 0) { data.id = t.tips[idx].id; t.tips[idx] = data; } else t.tips.push(data);
  save(); renderAll();
}

// --- Parse pasted text ---
function parseMatchesText(text) {
  return text.split('\n').map(line => {
    line = line.trim(); if (!line) return null;
    // Try: "Team1 - Team2, date, time" or "Team1 - Team2"
    const parts = line.split(/[,\t]+/).map(s => s.trim());
    const teamsPart = parts[0];
    const sep = teamsPart.match(/\s+[-–—vs.]+\s+/);
    if (!sep) return null;
    const teams = teamsPart.split(sep[0]);
    if (teams.length < 2) return null;
    let date = '', time = '';
    if (parts[1]) {
      // Parse Czech date like "15.5." or "15. 5." 
      const dm = parts[1].match(/(\d{1,2})\.\s*(\d{1,2})\./);
      if (dm) { const y = new Date().getFullYear(); date = `${y}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`; }
    }
    if (parts[2]) { const tm = parts[2].match(/(\d{1,2})[:.:](\d{2})/); if (tm) time = `${tm[1].padStart(2,'0')}:${tm[2]}`; }
    return { id: genId(), homeTeam: teams[0].trim(), awayTeam: teams[1].trim(), date, time, result: null, resultType: null };
  }).filter(Boolean);
}

function cleanJsonResponse(txt) {
  if (!txt) return '';
  let clean = txt.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\n?/i, '');
    clean = clean.replace(/\n?```$/i, '');
  }
  return clean.trim();
}

// --- Gemini API ---
async function callGemini(payload) {
  const key = getApiKey(); if (!key) throw new Error('Nastavte Gemini API klíč v nastavení');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(`API chyba: ${r.status}`);
  const d = await r.json(); const txt = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error('AI nevrátila data. Zkontrolujte API klíč.');
  const cleaned = cleanJsonResponse(txt);
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error("Failed to parse JSON from AI response:", txt);
    throw new Error('AI vrátila neplatný formát dat. Zkuste to prosím znovu.');
  }
}

async function analyzeScreenshot(base64, player, dateVal = 'auto') {
  const t = getT(); if (!t) throw new Error('Žádná tipovačka');
  const matchesToMatch = dateVal === 'auto' ? t.matches : t.matches.filter(m => m.date === dateVal);
  const sortedMatches = [...matchesToMatch].sort((a,b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return (a.order || 0) - (b.order || 0);
  });
  const list = sortedMatches.map((m, idx) => `${idx + 1}. ${m.homeTeam} - ${m.awayTeam}`).join('\n');
  
  let promptText = `Hokejové tipy hráče "${player}" na MS.\n`;
  if (dateVal !== 'auto') {
    promptText += `Tipy se vztahují VÝHRADNĚ k zápasům ze dne ${formatDate(dateVal)}.\n`;
  }
  promptText += `Seznam zápasů v pořadí:\n${list}\n\n`;
  promptText += `DŮLEŽITÉ: Pokud uživatel poslal pouze seznam tipů nebo skóre (např. 2:1, 3:0, 5:4 nebo 1, 2, 0) bez názvů týmů, tyto tipy/skóre odpovídají ZÁPASŮM V TOMTO PŘESNÉM POŘADÍ (první tip je pro 1. zápas, druhý pro 2. zápas, atd.).\n\n`;
  promptText += `Pro každý zápas na screenshotu extrahuj: match (přesně název ze seznamu ve tvaru "Domácí - Hosté"), tipType (1=domácí,0=remíza,2=hosté), tipScore (X:Y). Odvoď tipType ze skóre.

DŮLEŽITÉ: Pokud byl tipovaný zápas označen v prodloužení nebo na nájezdy (bývá označeno jako "p", "PP", "prodloužení", "ot", "SO", "pen", "sn", atd.), přidej na konec tipScore písmeno "p" (např. "3:2p" nebo "2:3p") a nastav tipType na 0.`;

  return callGemini({
    contents: [{ role: 'user', parts: [
      { text: promptText },
      { inlineData: { mimeType: 'image/jpeg', data: base64.split(',')[1] } }
    ]}],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { match: { type: 'STRING' }, tipType: { type: 'INTEGER' }, tipScore: { type: 'STRING' } } } } }
  });
}

async function analyzeTextTips(text, player, dateVal = 'auto') {
  const t = getT(); if (!t) throw new Error('Žádná tipovačka');
  const matchesToMatch = dateVal === 'auto' ? t.matches : t.matches.filter(m => m.date === dateVal);
  const sortedMatches = [...matchesToMatch].sort((a,b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time && b.time) return a.time.localeCompare(b.time);
    return (a.order || 0) - (b.order || 0);
  });
  const list = sortedMatches.map((m, idx) => `${idx + 1}. ${m.homeTeam} - ${m.awayTeam}`).join('\n');
  
  let promptText = `Uživatel vložil textové tipy pro hráče "${player}":\n\n${text}\n\n`;
  if (dateVal !== 'auto') {
    promptText += `Tipy se vztahují VÝHRADNĚ k zápasům ze dne ${formatDate(dateVal)}.\n`;
  }
  promptText += `Seznam zápasů v tomto pořadí:\n${list}\n\n`;
  promptText += `DŮLEŽITÉ: Pokud uživatel vložil pouze skóre/tipy (např. "5:2, 3:1, 5:4" nebo jen v řádcích bez názvů týmů), spáruj je POSTUPNĚ JEDNO PO DRUHÉM s naším seznamem zápasů v tomto přesném pořadí (1. tip je pro 1. zápas, 2. tip pro 2. zápas, atd.).\n\n`;
  promptText += `Spáruj textové tipy s naším seznamem zápasů. Pro každý rozpoznaný zápas extrahuj:\n- match (přesně název ze seznamu ve tvaru "Domácí - Hosté")\n- tipType (1=domácí,0=remíza,2=hosté)\n- tipScore (skóre ve formátu X:Y, např. 3:1)\n\nPokud u zápasu není skóre, ale jen 1/0/2, odvoď tipType a tipScore nech prázdné.\n\nDŮLEŽITÉ: Pokud byl tipovaný zápas označen v prodloužení nebo na nájezdy (bývá označeno jako "p", "PP", "prodloužení", "ot", "SO", "pen", "sn", atd.), přidej na konec tipScore písmeno "p" (např. "3:2p" nebo "2:3p") a nastav tipType na 0.`;

  return callGemini({
    contents: [{ role: 'user', parts: [
      { text: promptText }
    ]}],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { match: { type: 'STRING' }, tipType: { type: 'INTEGER' }, tipScore: { type: 'STRING' } } } } }
  });
}

async function analyzeMatchesScreenshot(base64) {
  return callGemini({
    contents: [{ role: 'user', parts: [
      { text: 'Na screenshotu je program hokejových zápasů MS. Extrahuj všechny zápasy. Pro každý vrať: homeTeam, awayTeam, date (formát YYYY-MM-DD), time (HH:MM). Rok je ' + new Date().getFullYear() + '.' },
      { inlineData: { mimeType: 'image/jpeg', data: base64.split(',')[1] } }
    ]}],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { homeTeam: { type: 'STRING' }, awayTeam: { type: 'STRING' }, date: { type: 'STRING' }, time: { type: 'STRING' } } } } }
  });
}

async function analyzeResultsText(text) {
  const t = getT(); if (!t) throw new Error('Žádná tipovačka');
  const list = t.matches.map(m => `${m.homeTeam} - ${m.awayTeam}`).join('\n');
  return callGemini({
    contents: [{ role: 'user', parts: [
      { text: `Uživatel vložil textové výsledky zápasů:\n\n${text}\n\nSeznam našich zápasů:\n${list}\n\nSpáruj text s naším seznamem zápasů. Pro každý nalezený zápas extrahuj:\n- match (přesně ze seznamu zápasů)\n- result (skóre ve formátu X:Y, např. 3:1)\n\nDŮLEŽITÉ: Pokud byl zápas rozhodnut v prodloužení nebo na nájezdy (bývá označeno jako "p", "PP", "prodloužení", "ot", "SO", "pen", "nájezdy", "sn", "decided in OT", atd.), přidej na konec skóre písmeno "p" (např. "3:2p" nebo "2:3p").` }
    ]}],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { match: { type: 'STRING' }, result: { type: 'STRING' } } } } }
  });
}

async function analyzeResultsScreenshot(base64) {
  const t = getT(); if (!t) throw new Error('Žádná tipovačka');
  const list = t.matches.map(m => `${m.homeTeam} - ${m.awayTeam}`).join('\n');
  return callGemini({
    contents: [{ role: 'user', parts: [
      { text: `Na screenshotu jsou výsledky hokejových zápasů. Spáruj je s naším seznamem zápasů:\n${list}\n\nPro každý nalezený zápas extrahuj:\n- match (přesně ze seznamu zápasů)\n- result (skóre ve formátu X:Y, např. 3:1)\n\nDŮLEŽITÉ: Pokud byl zápas rozhodnut v prodloužení nebo na nájezdy (bývá označeno jako "p", "PP", "prodloužení", "ot", "SO", "pen", "nájezdy", "sn", "decided in OT", atd.), přidej na konec skóre písmeno "p" (např. "3:2p" nebo "2:3p").` },
      { inlineData: { mimeType: 'image/jpeg', data: base64.split(',')[1] } }
    ]}],
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { match: { type: 'STRING' }, result: { type: 'STRING' } } } } }
  });
}

async function analyzeExcelTournament(text) {
  const key = getApiKey();
  if (!key) throw new Error('Nastavte Gemini API klíč v nastavení');
  
  const promptText = `
Uživatel zkopíroval celou tabulku ze svého Excelu, kde vedl tipovačku sportovních zápasů z minulých let.
Tvým úkolem je kompletně pochopit tuto tabulku a převést ji do našeho datového formátu (JSON).

Surový text tabulky z Excelu:
"""
${text}
"""

Instrukce pro analýzu:
1. Rozpoznej název turnaje (např. "MS 2024", pokud tam není, vymysli vhodný podle dat zápasů).
2. Rozpoznej seznam všech hráčů (playerName).
3. Extrahuj všechny zápasy. U každého zápasu:
   - homeTeam: název domácího týmu
   - awayTeam: název hostujícího týmu
   - date: datum ve formátu YYYY-MM-DD (pokud chybí rok, odvoď jej)
   - time: čas ve formátu HH:MM (pokud chybí, nech prázdný)
   - result: skóre (např. "3:2" nebo "3:2p" pro prodloužení)
   - resultType: 1 (výhra domácích), 2 (výhra hostů), 0 (remíza - pokud šlo do prodloužení/nájezdů s "p").
4. Extrahuj všechny tipy jednotlivých hráčů. U každého tipu:
   - playerName: přesné jméno hráče
   - matchHomeTeam: název domácího týmu zápasu
   - matchAwayTeam: název hostujícího týmu zápasu
   - tipType: 1, 0, nebo 2 (typ tipu 1-0-2, odvozený z tipScore nebo zapsaný přímo)
   - tipScore: skóre tipu (např. "2:1", pokud chybí skóre a je jen 1-0-2, nech prázdný)

DŮLEŽITÉ: Vrať data PŘESNĚ ve formátu JSON podle schématu.
`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          players: { type: 'ARRAY', items: { type: 'STRING' } },
          matches: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                homeTeam: { type: 'STRING' },
                awayTeam: { type: 'STRING' },
                date: { type: 'STRING' },
                time: { type: 'STRING' },
                result: { type: 'STRING' },
                resultType: { type: 'INTEGER' }
              },
              required: ["homeTeam", "awayTeam"]
            }
          },
          tips: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                playerName: { type: 'STRING' },
                matchHomeTeam: { type: 'STRING' },
                matchAwayTeam: { type: 'STRING' },
                tipType: { type: 'INTEGER' },
                tipScore: { type: 'STRING' }
              },
              required: ["playerName", "matchHomeTeam", "matchAwayTeam", "tipType"]
            }
          }
        },
        required: ["name", "players", "matches", "tips"]
      }
    }
  };
  
  return callGemini(payload);
}

// --- Modal helpers ---
function openResultModal(mid) {
  currentMatchId = mid; const t = getT(), m = t.matches.find(x => x.id === mid);
  $('#resultMatchName').textContent = `${m.homeTeam} – ${m.awayTeam}`;
  if (m.result) {
    const isOt = m.result.includes('p');
    const cleanScore = m.result.replace('p', '');
    $('#inputHomeScore').value = cleanScore.split(':')[0];
    $('#inputAwayScore').value = cleanScore.split(':')[1];
    $('#inputResultOvertime').checked = isOt;
  } else {
    $('#inputHomeScore').value = '';
    $('#inputAwayScore').value = '';
    $('#inputResultOvertime').checked = false;
  }
  openModal('modalSetResult');
}
function loadPlayerTip() {
  const t = getT(), player = $('#selectManualPlayer').value;
  if (!t || !player) return;
  const tip = (t.tips || []).find(x => x.matchId === currentMatchId && x.playerName === player);
  
  // Reset
  selectedTipType = null;
  $$('.tip-btn').forEach(b => b.classList.remove('active'));
  $('#inputTipHome').value = '';
  $('#inputTipAway').value = '';
  const otCheck = $('#inputTipOvertime');
  if (otCheck) otCheck.checked = false;
  
  if (tip) {
    selectedTipType = tip.tipType;
    const btn = Array.from($$('.tip-btn')).find(b => parseInt(b.dataset.val) === selectedTipType);
    if (btn) btn.classList.add('active');
    
    if (tip.tipScore) {
      const isOt = tip.tipScore.includes('p');
      const cleanScore = tip.tipScore.replace('p', '');
      $('#inputTipHome').value = cleanScore.split(':')[0] || '';
      $('#inputTipAway').value = cleanScore.split(':')[1] || '';
      if (otCheck) otCheck.checked = isOt;
    }
  }
}

function openManualTipModal(mid) {
  currentMatchId = mid; const t = getT(), m = t.matches.find(x => x.id === mid);
  $('#manualMatchName').textContent = `${m.homeTeam} – ${m.awayTeam}`;
  const sel = $('#selectManualPlayer'); sel.innerHTML = t.players.map(p => `<option>${p}</option>`).join('');
  loadPlayerTip();
  openModal('modalManualTips');
}
function populatePlayerSelect(sel) { const t = getT(); if (!t) return; $(sel).innerHTML = t.players.map(p => `<option>${p}</option>`).join(''); }

function renderImportPreview() {
  $('#importCount').textContent = importedMatches.length;
  $('#importMatchesList').innerHTML = importedMatches.map((m, i) =>
    `<div class="import-match-row"><span class="num">${i+1}.</span><span class="teams">${m.homeTeam} – ${m.awayTeam}</span><span class="date-info">${m.date ? formatDate(m.date) : ''}${m.time ? ' '+m.time : ''}</span><button class="btn-remove-match" onclick="importedMatches.splice(${i},1);renderImportPreview()">×</button></div>`
  ).join('');
  $('#importPreview').hidden = !importedMatches.length;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  // Automatická obnova ze zálohy ms2026_data.json, pokud jsou data prázdná
  if (tournaments.length === 0) {
    fetch('ms2026_data.json')
      .then(r => r.json())
      .then(data => {
        if (data && data.id) {
          tournaments = [data];
          activeTournamentId = data.id;
          save();
          renderAll();
          showToast('Data automaticky obnovena ze záložního souboru!', 'success');
        }
      })
      .catch(err => {
        console.warn("Záložní soubor ms2026_data.json nenalezen nebo jej nebylo možné načíst:", err);
      });
  }

  if (activeTournamentId && !tournaments.find(t => t.id === activeTournamentId)) activeTournamentId = tournaments[0]?.id || null;
  initFirebase();
  renderAll();

  // Close modals
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); }));

  // New tournament
  let selectedTournamentIcon = '🏒';
  const openNewTournament = () => {
    $('#inputTournamentName').value = `MS ${new Date().getFullYear()}`;
    $('#inputTournamentPlayers').value = 'Kuba, Eliška, Dan, Tade, Maruš, Pavel, Rey';
    $('#inputMatchesPaste').value = ''; importedMatches = []; matchesScreenshotBase64 = null;
    $('#uploadMatchesPreview').hidden = true; $('#uploadMatchesPlaceholder').hidden = false;
    $('#importPreview').hidden = true; $('#importLoading').hidden = true;
    importMethod = 'paste'; setImportMethod('paste');
    
    // Reset icon selection
    selectedTournamentIcon = '🏒';
    $$('.btn-icon-select').forEach(b => b.classList.toggle('active', b.dataset.icon === '🏒'));
    $('#inputCustomIcon').value = '';
    
    openModal('modalNewTournament');
  };
  $('#btnNewTournament').addEventListener('click', openNewTournament);
  $('#btnWelcomeNew').addEventListener('click', openNewTournament);

  // Icon selector listeners
  $$('.btn-icon-select').forEach(b => {
    b.addEventListener('click', () => {
      $$('.btn-icon-select').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selectedTournamentIcon = b.dataset.icon;
      $('#inputCustomIcon').value = '';
    });
  });
  $('#inputCustomIcon').addEventListener('input', e => {
    const val = e.target.value.trim();
    if (val) {
      $$('.btn-icon-select').forEach(x => x.classList.remove('active'));
      selectedTournamentIcon = val;
    }
  });

  // Import method tabs
  function setImportMethod(method) {
    importMethod = method;
    $$('.import-tab').forEach(t => t.classList.toggle('active', t.dataset.method === method));
    $('#panelPaste').hidden = method !== 'paste';
    $('#panelScreenshot').hidden = method !== 'screenshot';
    $('#panelNone').hidden = method !== 'none';
  }
  $$('.import-tab').forEach(tab => tab.addEventListener('click', () => setImportMethod(tab.dataset.method)));

  // Screenshot import for matches
  const uzm = $('#uploadZoneMatches'), fim = $('#inputMatchesScreenshot');
  uzm.addEventListener('click', () => fim.click());
  uzm.addEventListener('dragover', e => { e.preventDefault(); uzm.style.borderColor = 'var(--accent)'; });
  uzm.addEventListener('dragleave', () => uzm.style.borderColor = '');
  uzm.addEventListener('drop', e => { e.preventDefault(); uzm.style.borderColor = ''; if (e.dataTransfer.files.length) handleMatchesFile(e.dataTransfer.files[0]); });
  fim.addEventListener('change', e => { if (e.target.files.length) handleMatchesFile(e.target.files[0]); });

  async function handleMatchesFile(file) {
    const reader = new FileReader();
    reader.onload = async e => {
      matchesScreenshotBase64 = e.target.result;
      $('#uploadMatchesPreview').src = matchesScreenshotBase64;
      $('#uploadMatchesPreview').hidden = false; $('#uploadMatchesPlaceholder').hidden = true;
      uzm.classList.add('has-image');
      // Auto-analyze
      $('#importLoading').hidden = false;
      try {
        const result = await analyzeMatchesScreenshot(matchesScreenshotBase64);
        importedMatches = result.map(m => ({ id: genId(), homeTeam: m.homeTeam, awayTeam: m.awayTeam, date: m.date || '', time: m.time || '', result: null, resultType: null }));
        renderImportPreview();
      } catch (err) { showToast(err.message, 'error'); }
      finally { $('#importLoading').hidden = true; }
    };
    reader.readAsDataURL(file);
  }

  // Create tournament
  $('#btnCreateTournament').addEventListener('click', async () => {
    const name = $('#inputTournamentName').value.trim();
    if (!name) return showToast('Zadejte název', 'error');
    const players = $('#inputTournamentPlayers').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!players.length) return showToast('Zadejte hráče', 'error');

    let matchesToAdd = [];
    if (importMethod === 'paste') {
      const text = $('#inputMatchesPaste').value.trim();
      if (text) matchesToAdd = parseMatchesText(text);
    } else if (importMethod === 'screenshot') {
      matchesToAdd = importedMatches;
    }
    matchesToAdd.forEach((m, i) => m.order = i + 1);

    const t = { id: genId(), name, icon: selectedTournamentIcon, players, matches: matchesToAdd, tips: [] };
    tournaments.push(t);
    activeTournamentId = t.id;
    save(); renderAll(); closeModal('modalNewTournament');
    showToast(`${name} vytvořena s ${matchesToAdd.length} zápasy`);
  });

  // Add single match
  $('#btnAddMatch').addEventListener('click', () => {
    if (activeTournamentId === '__all__') return showToast('Pro přidávání zápasů vyberte konkrétní tipovačku.', 'warning');
    if (!getT()) return showToast('Nejdřív vytvořte tipovačku','error');
    $('#inputHomeTeam').value=''; $('#inputAwayTeam').value=''; $('#inputMatchDate').value=''; $('#inputMatchTime').value='';
    openModal('modalAddMatch');
  });
  $('#btnSaveMatch').addEventListener('click', () => {
    const h = $('#inputHomeTeam').value.trim(), a = $('#inputAwayTeam').value.trim();
    if (!h || !a) return showToast('Vyplňte týmy', 'error');
    addMatch(h, a, $('#inputMatchDate').value, $('#inputMatchTime').value);
    closeModal('modalAddMatch');
  });

  // Set result
  $('#btnSaveResult').addEventListener('click', () => {
    const h = parseInt($('#inputHomeScore').value), a = parseInt($('#inputAwayScore').value);
    if (isNaN(h) || isNaN(a)) return showToast('Vyplňte skóre', 'error');
    const isOt = $('#inputResultOvertime').checked;
    setResult(currentMatchId, h, a, isOt); closeModal('modalSetResult');
  });

  // Manual tip
  $('#selectManualPlayer').addEventListener('change', loadPlayerTip);

  $('#inputTipOvertime')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      selectedTipType = 0;
      $$('.tip-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val) === 0));
    }
  });

  $$('.tip-btn').forEach(b => b.addEventListener('click', () => { 
    $$('.tip-btn').forEach(x => x.classList.remove('active')); 
    b.classList.add('active'); 
    selectedTipType = parseInt(b.dataset.val); 
    if (selectedTipType === 1 || selectedTipType === 2) {
      const otCheck = $('#inputTipOvertime');
      if (otCheck) otCheck.checked = false;
    }
  }));

  $('#btnSaveManualTip').addEventListener('click', () => {
    const player = $('#selectManualPlayer').value, th = $('#inputTipHome').value, ta = $('#inputTipAway').value;
    const isOt = $('#inputTipOvertime')?.checked || false;
    
    let tipScore = '', tipType = selectedTipType;
    if (th !== '' && ta !== '') { 
      tipScore = `${th}:${ta}${isOt ? 'p' : ''}`; 
      if (tipType === null) {
        tipType = isOt ? 0 : getResultType(parseInt(th), parseInt(ta)); 
      }
    }
    
    if (isOt) {
      tipType = 0; // Prodloužení je vždy remíza (0) v tendenci
    }
    
    if (tipType === null) return showToast('Vyberte tip', 'error');
    saveTip(currentMatchId, player, tipType, tipScore); 
    showToast(`Tip uložen`); 
    closeModal('modalManualTips');
  });

  // Upload tips
  let tipsImportMethod = 'screenshot';
  $('#btnUploadTips').addEventListener('click', () => {
    if (activeTournamentId === '__all__') return showToast('Pro nahrávání tipů vyberte konkrétní tipovačku.', 'warning');
    if (!getT()) return showToast('Nejdřív vytvořte tipovačku','error');
    populatePlayerSelect('#selectTipPlayer');
    
    // Populate dates select
    const dates = getUniqueDates();
    const todayStr = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    })();
    let dateOptsHtml = '<option value="auto">🤖 Automatické rozpoznání dne</option>';
    dates.forEach(d => {
      const isToday = (d === todayStr);
      const count = (getT().matches || []).filter(m => m.date === d).length;
      dateOptsHtml += `<option value="${d}">${formatDate(d)} (${count} zápasů)${isToday ? ' [Dnes]' : ''}</option>`;
    });
    $('#selectTipDate').innerHTML = dateOptsHtml;
    $('#selectTipDate').value = 'auto';

    $('#uploadPreview').hidden = true; $('#uploadPlaceholder').hidden = false;
    $('#aiResult').hidden = true; $('#aiLoading').hidden = true; 
    $('#inputTipsPaste').value = '';
    
    // Default to screenshot tab
    tipsImportMethod = 'screenshot';
    $$('#modalUploadTips .import-tab').forEach(x => x.classList.remove('active'));
    $('#tabTipsScreenshot').classList.add('active');
    $('#panelTipsScreenshot').hidden = false;
    $('#panelTipsText').hidden = true;
    
    $('#btnAnalyze').disabled = true;
    screenshotBase64 = null; 
    openModal('modalUploadTips');
  });

  // Tab switching for Tips Upload
  $('#tabTipsScreenshot').addEventListener('click', () => {
    tipsImportMethod = 'screenshot';
    $('#tabTipsScreenshot').classList.add('active');
    $('#tabTipsText').classList.remove('active');
    $('#panelTipsScreenshot').hidden = false;
    $('#panelTipsText').hidden = true;
    $('#btnAnalyze').disabled = !screenshotBase64;
  });
  $('#tabTipsText').addEventListener('click', () => {
    tipsImportMethod = 'text';
    $('#tabTipsText').classList.add('active');
    $('#tabTipsScreenshot').classList.remove('active');
    $('#panelTipsScreenshot').hidden = true;
    $('#panelTipsText').hidden = false;
    $('#btnAnalyze').disabled = false;
  });

  const uz = $('#uploadZone'), fi = $('#inputScreenshot');
  uz.addEventListener('click', () => fi.click());
  uz.addEventListener('dragover', e => { e.preventDefault(); uz.style.borderColor = 'var(--accent)'; });
  uz.addEventListener('dragleave', () => uz.style.borderColor = '');
  uz.addEventListener('drop', e => { e.preventDefault(); uz.style.borderColor = ''; if (e.dataTransfer.files.length) handleTipFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', e => { if (e.target.files.length) handleTipFile(e.target.files[0]); });
  function handleTipFile(file) {
    const r = new FileReader(); r.onload = e => {
      screenshotBase64 = e.target.result; $('#uploadPreview').src = screenshotBase64;
      $('#uploadPreview').hidden = false; $('#uploadPlaceholder').hidden = true; uz.classList.add('has-image'); $('#btnAnalyze').disabled = false;
    }; r.readAsDataURL(file);
  }

  $('#btnAnalyze').addEventListener('click', async () => {
    $('#aiLoading').hidden = false; $('#aiResult').hidden = true; $('#btnAnalyze').disabled = true;
    try {
      const t = getT(), player = $('#selectTipPlayer').value;
      const dateVal = $('#selectTipDate').value;
      let result;
      if (tipsImportMethod === 'screenshot') {
        if (!screenshotBase64) return;
        result = await analyzeScreenshot(screenshotBase64, player, dateVal);
      } else {
        const text = $('#inputTipsPaste').value.trim();
        if (!text) return showToast('Vložte textové tipy', 'error');
        result = await analyzeTextTips(text, player, dateVal);
      }
      
      const matchesToMatch = dateVal === 'auto' ? t.matches : t.matches.filter(m => m.date === dateVal);
      
      parsedAiTips = result.map(r => {
        const m = matchesToMatch.find(m => { const n1 = `${m.homeTeam} - ${m.awayTeam}`.toLowerCase(), n2 = (r.match||'').toLowerCase(); return n1===n2||n1.includes(n2)||n2.includes(n1)||n1.replace(/\s/g,'')=== n2.replace(/\s/g,''); });
        return { ...r, matchId: m?.id||null, matchName: m ? `${m.homeTeam} - ${m.awayTeam}` : r.match };
      }).filter(r => r.matchId);
      
      $('#aiTipsPreview').innerHTML = parsedAiTips.map((t,i) => `<div class="ai-tip-row"><span class="match-name">${t.matchName}</span><select data-idx="${i}" class="ai-tip-type"><option value="1" ${t.tipType==1?'selected':''}>1</option><option value="0" ${t.tipType==0?'selected':''}>0</option><option value="2" ${t.tipType==2?'selected':''}>2</option></select><input type="text" data-idx="${i}" class="ai-tip-score" value="${t.tipScore||''}" placeholder="X:Y"></div>`).join('');
      $$('.ai-tip-type').forEach(s => s.addEventListener('change', e => { parsedAiTips[e.target.dataset.idx].tipType = parseInt(e.target.value); }));
      $$('.ai-tip-score').forEach(s => s.addEventListener('input', e => { parsedAiTips[e.target.dataset.idx].tipScore = e.target.value; }));
      $('#aiResult').hidden = false;
    } catch (err) { showToast(err.message, 'error'); }
    finally { $('#aiLoading').hidden = true; $('#btnAnalyze').disabled = false; }
  });
  $('#btnSaveTips').addEventListener('click', () => {
    const player = $('#selectTipPlayer').value;
    parsedAiTips.forEach(t => { if (t.matchId && (t.tipType !== null || t.tipScore)) saveTip(t.matchId, player, t.tipType, t.tipScore); });
    showToast(`Tipy pro ${player} uloženy (${parsedAiTips.length})`); closeModal('modalUploadTips');
  });

  // Custom tournament image upload inside modalNewTournament
  let customUploadedIconBase64 = null;
  $('#btnUploadCustomIcon').addEventListener('click', () => $('#inputTournamentCustomImage').click());
  $('#inputTournamentCustomImage').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        customUploadedIconBase64 = ev.target.result;
        selectedTournamentIcon = customUploadedIconBase64;
        $$('#modalNewTournament .btn-icon-select').forEach(x => x.classList.remove('active'));
        $('#btnUploadCustomIcon').classList.add('active');
        $('#customImageFileName').textContent = `Vybráno: ${file.name}`;
        $('#inputCustomIcon').value = '';
      };
      reader.readAsDataURL(file);
    }
  });

  // Edit active tournament settings and custom image upload inside modalSettings
  let selectedEditTournamentIcon = '🏒';
  let customUploadedEditIconBase64 = null;
  
  $('#btnUploadEditCustomIcon').addEventListener('click', () => $('#inputEditTournamentCustomImage').click());
  $('#inputEditTournamentCustomImage').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        customUploadedEditIconBase64 = ev.target.result;
        selectedEditTournamentIcon = customUploadedEditIconBase64;
        $$('#editIconSelector .btn-icon-select').forEach(x => x.classList.remove('active'));
        $('#btnUploadEditCustomIcon').classList.add('active');
        $('#editCustomImageFileName').textContent = `Vybráno: ${file.name}`;
        $('#inputEditCustomIcon').value = '';
      };
      reader.readAsDataURL(file);
    }
  });

  $$('#editIconSelector .btn-icon-select-edit').forEach(b => {
    b.addEventListener('click', () => {
      $$('#editIconSelector .btn-icon-select').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selectedEditTournamentIcon = b.dataset.icon;
      $('#inputEditCustomIcon').value = '';
      $('#editCustomImageFileName').textContent = '';
      customUploadedEditIconBase64 = null;
    });
  });

  $('#inputEditCustomIcon').addEventListener('input', e => {
    const val = e.target.value.trim();
    if (val) {
      $$('#editIconSelector .btn-icon-select').forEach(x => x.classList.remove('active'));
      selectedEditTournamentIcon = val;
      $('#editCustomImageFileName').textContent = '';
      customUploadedEditIconBase64 = null;
    }
  });

  // Settings Modal Open
  $('#btnSettings').addEventListener('click', () => {
    $('#inputApiKey').value = getApiKey();
    const t = getT();
    
    if (t) {
      $('#inputActiveTournamentName').value = t.name || '';
      $('#inputPlayersEdit').value = (t.players || []).join(', ');
      
      // Load and pre-select active icon
      selectedEditTournamentIcon = t.icon || '🏆';
      customUploadedEditIconBase64 = null;
      $('#editCustomImageFileName').textContent = '';
      $('#inputEditCustomIcon').value = '';
      
      $$('#editIconSelector .btn-icon-select').forEach(x => x.classList.remove('active'));
      const predefinedBtn = Array.from($$('#editIconSelector .btn-icon-select-edit')).find(b => b.dataset.icon === selectedEditTournamentIcon);
      if (predefinedBtn) {
        predefinedBtn.classList.add('active');
      } else if (selectedEditTournamentIcon.startsWith('data:image/')) {
        $('#btnUploadEditCustomIcon').classList.add('active');
        $('#editCustomImageFileName').textContent = 'Zvolen vlastní obrázek';
      } else {
        $('#inputEditCustomIcon').value = selectedEditTournamentIcon;
      }
    } else {
      $('#inputActiveTournamentName').value = '';
      $('#inputPlayersEdit').value = '';
    }
    
    // Load Firebase Config & Admin Password
    $('#inputFirebaseConfig').value = localStorage.getItem('firebaseConfig') || '';
    const adminPassword = localStorage.getItem('adminPassword') || '';
    $('#inputAdminPassword').value = adminPassword;
    
    if (adminPassword && !isAdmin) {
      $('#adminLoginWrap').hidden = false;
      $('#inputAdminLogin').value = '';
    } else {
      $('#adminLoginWrap').hidden = true;
    }
    
    openModal('modalSettings');
  });
  
  // Save Settings
  $('#btnSaveSettings').addEventListener('click', () => {
    const k = $('#inputApiKey').value.trim();
    if (k) localStorage.setItem('geminiApiKey', k);
    
    // Check Admin Login if it is shown
    const adminPassword = localStorage.getItem('adminPassword') || '';
    if (adminPassword && !isAdmin) {
      const loginPass = $('#inputAdminLogin').value.trim();
      if (loginPass) {
        if (loginPass === adminPassword) {
          localStorage.setItem('userAdminPass', loginPass);
          isAdmin = true;
          showToast('Úspěšně přihlášen/a jako admin', 'success');
        } else {
          showToast('Chybné přihlašovací heslo!', 'error');
          return;
        }
      }
    }

    // Save Firebase settings
    const fc = $('#inputFirebaseConfig').value.trim();
    localStorage.setItem('firebaseConfig', fc);
    
    const ap = $('#inputAdminPassword').value.trim();
    localStorage.setItem('adminPassword', ap);

    // Save Active Tournament Updates
    const t = getT();
    if (t) {
      if (!checkAdminPermission()) return;
      
      const newName = $('#inputActiveTournamentName').value.trim();
      if (newName) t.name = newName;

      const pl = $('#inputPlayersEdit').value.split(',').map(s => s.trim()).filter(Boolean);
      if (pl.length) t.players = pl;
      
      t.icon = selectedEditTournamentIcon;
    }
    
    save();
    initFirebase();
    showToast('Uloženo');
    closeModal('modalSettings');
    renderAll();
  });

  // Vynucení aktualizace a promazání mezipaměti PWA
  async function forceAppUpdate() {
    showToast('Promazávám vyrovnávací paměť souborů...', 'success');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (let r of regs) {
          await r.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (let k of keys) {
          await caches.delete(k);
        }
      }
      showToast('Restartuji aplikaci s novou verzí...', 'success');
      setTimeout(() => {
        window.location.reload(true);
      }, 800);
    } catch (e) {
      console.error(e);
      window.location.reload(true);
    }
  }

  $('#btnForceUpdate')?.addEventListener('click', async () => {
    if (confirm('Vynutit aktualizaci? Aplikace vymaže vyrovnávací paměť souborů a restartuje se. Vaše data (zápasy, tipy) zůstanou v naprostém bezpečí.')) {
      await forceAppUpdate();
    }
  });

  // Import staré tipovačky z Excelu přes AI
  $('#btnImportExcel')?.addEventListener('click', async () => {
    const text = $('#inputExcelPaste').value.trim();
    if (!text) return showToast('Vložte zkopírovaný obsah z Excelu', 'error');
    
    $('#aiExcelLoading').hidden = false;
    $('#btnImportExcel').disabled = true;
    
    try {
      const res = await analyzeExcelTournament(text);
      if (!res) throw new Error('AI vrátila prázdná data.');
      
      const tid = genId();
      
      // Bezpečná standardizace zápasů (předcházení chybám z chybějících polí)
      const standardizedMatches = (res.matches || []).map((m, idx) => {
        if (!m) return null;
        const home = (m.homeTeam || m.home || '').toString().trim();
        const away = (m.awayTeam || m.away || '').toString().trim();
        if (!home || !away) return null; // Přeskočit nekompletní zápas
        
        return {
          id: genId(),
          homeTeam: home,
          awayTeam: away,
          date: m.date || '',
          time: m.time || '',
          result: m.result || null,
          resultType: m.resultType !== undefined ? m.resultType : null,
          order: idx + 1
        };
      }).filter(Boolean);
      
      if (!standardizedMatches.length) {
        throw new Error('Nepodařilo se rozpoznat žádné platné zápasy. Zkontrolujte kopírovaný text.');
      }
      
      // Bezpečná standardizace tipů a spárování se zápasy
      const standardizedTips = (res.tips || []).map(tip => {
        if (!tip) return null;
        const player = (tip.playerName || tip.player || '').toString().trim();
        const tHome = (tip.matchHomeTeam || tip.homeTeam || tip.home || '').toString().trim();
        const tAway = (tip.matchAwayTeam || tip.awayTeam || tip.away || '').toString().trim();
        if (!player || !tHome || !tAway) return null;
        
        const m = standardizedMatches.find(sm => {
          const n1 = `${sm.homeTeam} - ${sm.awayTeam}`.toLowerCase();
          const n2 = `${tHome} - ${tAway}`.toLowerCase();
          return n1 === n2 || n1.includes(n2) || n2.includes(n1) || n1.replace(/\s/g,'') === n2.replace(/\s/g,'');
        });
        
        if (!m) return null;
        
        // Bezpečné odvození tipType
        let tType = tip.tipType;
        if (tType === undefined && tip.tipScore) {
          const scores = tip.tipScore.split(':').map(Number);
          if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
            tType = scores[0] > scores[1] ? 1 : scores[0] < scores[1] ? 2 : 0;
          }
        }
        if (tType === undefined) tType = 1; // Výchozí
        
        return {
          id: genId(),
          matchId: m.id,
          playerName: player,
          tipType: parseInt(tType),
          tipScore: tip.tipScore || '',
          timestamp: Date.now()
        };
      }).filter(Boolean);
      
      // Bezpečná rekonstrukce seznamu hráčů
      let playersList = (res.players || []).map(p => (p || '').toString().trim()).filter(Boolean);
      if (!playersList.length) {
        const uniquePlayers = new Set();
        standardizedTips.forEach(tip => uniquePlayers.add(tip.playerName));
        playersList = [...uniquePlayers];
      }
      
      if (!playersList.length) {
        throw new Error('V zadané tabulce nebyli nalezeni žádní hráči ani tipy.');
      }
      
      const newTournament = {
        id: tid,
        name: res.name || `Archiv MS`,
        icon: '🏒',
        players: playersList,
        matches: standardizedMatches,
        tips: standardizedTips
      };
      
      tournaments.push(newTournament);
      activeTournamentId = newTournament.id;
      save();
      renderAll();
      closeModal('modalSettings');
      $('#inputExcelPaste').value = '';
      showToast(`Importováno: ${newTournament.name} s ${newTournament.matches.length} zápasy a tipy!`, 'success');
    } catch (err) {
      console.error(err);
      showToast(`Chyba importu: ${err.message}`, 'error');
    } finally {
      $('#aiExcelLoading').hidden = true;
      $('#btnImportExcel').disabled = false;
    }
  });

  // Delete tournament
  $('#btnDeleteTournament').addEventListener('click', () => {
    if (!checkAdminPermission()) return;
    const t = getT(); if (!t || !confirm(`Smazat "${t.name}"?`)) return;
    const deletedId = t.id;
    
    if (db && isCloudActive) {
      db.collection('tournaments').doc(deletedId).delete().catch(err => {
        console.error("Firestore delete error:", err);
      });
    }
    
    tournaments = tournaments.filter(x => x.id !== deletedId);
    activeTournamentId = tournaments[0]?.id || null;
    save(); renderAll(); closeModal('modalSettings'); showToast('Tipovačka smazána');
  });

  // Export/Import
  $('#btnExport').addEventListener('click', () => {
    const t = getT(); if (!t) return;
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${t.name.replace(/\s/g,'_')}_export.json`; a.click(); showToast('Exportováno');
  });
  $('#btnImport').addEventListener('click', () => $('#inputImport').click());
  $('#inputImport').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader(); r.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.matches) throw new Error('Neplatný formát');
        if (!confirm(`Import "${data.name}" (${data.matches.length} zápasů)?`)) return;
        data.id = genId(); tournaments.push(data); activeTournamentId = data.id;
        save(); renderAll(); showToast('Importováno'); closeModal('modalSettings');
      } catch (err) { showToast('Chyba: ' + err.message, 'error'); }
    }; r.readAsText(file); e.target.value = '';
  });

  // === SHARE DAILY TIPS ===
  function getUniqueDates() {
    const t = getT(); if (!t) return [];
    return [...new Set(t.matches.map(m => m.date).filter(Boolean))].sort();
  }

  function buildTipsTable(matchesForDay) {
    const t = getT(); if (!t) return '';
    const players = t.players, tips = t.tips || [];
    
    let html = `<style>
      .render-table {
        border-collapse: separate;
        border-spacing: 0;
        font-family: 'Inter', system-ui, sans-serif;
        background: #0b0f19;
        border: 1.5px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        overflow: hidden;
        color: #f1f5f9;
        width: 100%;
        box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      }
      .render-table th, .render-table td {
        padding: 12px 10px;
        border-bottom: 1.5px solid rgba(255,255,255,0.06);
        vertical-align: middle;
        text-align: center;
      }
      .render-table .title-row td {
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
        font-weight: 800;
        font-size: 16px;
        letter-spacing: 0.5px;
        color: #ffffff;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        padding: 16px;
        text-transform: uppercase;
        border-bottom: 2px solid rgba(255,255,255,0.15);
      }
      .render-table .section-header {
        background: rgba(255,255,255,0.04);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.2px;
        color: #a5b4fc;
        text-transform: uppercase;
        border-left: 1.5px solid rgba(255,255,255,0.06);
      }
      .render-table .col-match {
        width: 240px;
        min-width: 240px;
        max-width: 240px;
        text-align: left !important;
        padding-left: 12px !important;
        padding-right: 8px !important;
        font-weight: 700;
        color: #ffffff;
        border-right: 1.5px solid rgba(255,255,255,0.08);
        overflow: hidden;
      }
      .render-table .col-player {
        width: 60px;
        min-width: 60px;
        max-width: 60px;
        font-size: 11px;
        font-weight: 700;
        color: #cbd5e1;
        border-left: 1.5px solid rgba(255,255,255,0.04);
      }
      .render-table .leaderboard-row td {
        background: rgba(255,255,255,0.01);
        padding: 12px 16px;
      }
      .render-table .leaderboard-row:nth-child(even) td {
        background: rgba(255,255,255,0.03);
      }
      .tip-badge-1 { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; display: inline-block; width: 24px; text-align: center; }
      .tip-badge-0 { background: rgba(234,179,8,0.15); color: #facc15; border: 1px solid rgba(234,179,8,0.3); padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; display: inline-block; width: 24px; text-align: center; }
      .tip-badge-2 { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; display: inline-block; width: 24px; text-align: center; }
      .tip-badge-score { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); padding: 4px 8px; border-radius: 6px; font-weight: 700; color: #f1f5f9; font-size: 12px; display: inline-block; }
      .tip-badge-correct { background: rgba(34,197,94,0.18) !important; color: #4ade80 !important; border: 1px solid rgba(34,197,94,0.4) !important; padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; display: inline-block; width: 24px; text-align: center; box-shadow: 0 0 8px rgba(34,197,94,0.1); }
      .tip-badge-wrong { background: rgba(239,68,68,0.18) !important; color: #f87171 !important; border: 1px solid rgba(239,68,68,0.4) !important; padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; display: inline-block; width: 24px; text-align: center; }
      .score-badge-exact { background: rgba(34,197,94,0.22) !important; color: #4ade80 !important; border: 1px solid rgba(34,197,94,0.7) !important; padding: 4px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; display: inline-block; box-shadow: 0 0 10px rgba(34,197,94,0.2); }
      .score-badge-outcome { background: rgba(34,197,94,0.08) !important; color: #a3e635 !important; border: 1px solid rgba(163,230,53,0.3) !important; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block; }
      .score-badge-wrong { background: rgba(239,68,68,0.12) !important; color: #f87171 !important; border: 1px solid rgba(239,68,68,0.3) !important; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block; }
    </style>`;
    
    const isImg = (t.icon || '🏆').startsWith('data:image/');
    const iconHtml = isImg ? `<img src="${t.icon}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; vertical-align: middle; margin-right: 12px; display: inline-block; box-shadow: 0 0 10px rgba(99,102,241,0.3); border: 1px solid rgba(255,255,255,0.1);">` : `<span style="margin-right: 12px; font-size: 28px; vertical-align: middle; filter: drop-shadow(0 0 6px rgba(99,102,241,0.3));">${t.icon || '🏆'}</span>`;

    html += `<table class="render-table">`;
    html += `<tr class="title-row"><td colspan="${1 + players.length * 2}" style="text-align: center;">${iconHtml}${t.name}</td></tr>`;
    html += `<tr><th></th><th class="section-header" colspan="${players.length}">TIPY 1-0-2</th><th class="section-header" colspan="${players.length}">TIPY SKÓRE</th></tr>`;
    
    html += `<tr><th class="col-match">ZÁPAS</th>`;
    players.forEach(p => { html += `<th class="col-player">${p}</th>`; });
    players.forEach(p => { html += `<th class="col-player">${p}</th>`; });
    html += `</tr>`;
    
    matchesForDay.forEach(m => {
      const hasRes = m.result !== null;
      html += `<tr><td class="col-match">`;
      html += `<div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px;">`;
      html += `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1; min-width: 0;">${m.homeTeam} - ${m.awayTeam}</span>`;
      if (hasRes) {
        html += `<span style="color: #38bdf8; font-weight: 800; background: rgba(56, 189, 248, 0.12); padding: 2px 6px; border-radius: 4px; font-size: 11px; flex-shrink: 0;">${m.result}</span>`;
      }
      html += `</div>`;
      html += `</td>`;
      players.forEach(p => {
        const tip = tips.find(x => x.matchId === m.id && x.playerName === p);
        if (tip) {
          let badgeClass = '';
          if (hasRes) {
            badgeClass = tip.tipType === m.resultType ? 'tip-badge-correct' : 'tip-badge-wrong';
          } else {
            badgeClass = tip.tipType === 1 ? 'tip-badge-1' : tip.tipType === 2 ? 'tip-badge-2' : 'tip-badge-0';
          }
          html += `<td><span class="${badgeClass}">${tip.tipType}</span></td>`;
        } else {
          html += `<td style="color:#475569">—</td>`;
        }
      });
      players.forEach(p => {
        const tip = tips.find(x => x.matchId === m.id && x.playerName === p);
        if (tip?.tipScore) {
          let badgeClass = '';
          if (hasRes) {
            const sc = tip.tipScore === m.result;
            badgeClass = sc ? 'score-badge-exact' : 'score-badge-wrong';
          } else {
            badgeClass = 'tip-badge-score';
          }
          html += `<td><span class="${badgeClass}">${tip.tipScore}</span></td>`;
        } else {
          html += `<td style="color:#475569">—</td>`;
        }
      });
      html += `</tr>`;
    });
    
    const scores = calculateScores();
    html += `<tr class="title-row"><td colspan="${1 + players.length * 2}" style="text-align: center; background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%); font-size: 14px; padding: 12px;"><img src="rankings_badge.png" crossorigin="anonymous" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle; margin-right: 8px;">ŽEBŘÍČEK HRAČŮ</td></tr>`;
    
    scores.forEach((s, i) => {
      let medalHtml = `${i+1}.`;
      if (i === 0) medalHtml = `<img src="medal_gold.png" crossorigin="anonymous" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle;">`;
      else if (i === 1) medalHtml = `<img src="medal_silver.png" crossorigin="anonymous" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle;">`;
      else if (i === 2) medalHtml = `<img src="medal_bronze.png" crossorigin="anonymous" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle;">`;
      
      html += `<tr class="leaderboard-row">`;
      html += `<td style="text-align: left; padding-left: 20px; font-weight: 700; color: #ffffff;"><span style="display:inline-block; width: 22px; text-align: center; margin-right: 8px; vertical-align: middle;">${medalHtml}</span>${s.name}</td>`;
      html += `<td colspan="${players.length}" style="text-align: center; color: #94a3b8; font-size: 11px; font-weight: 500;">${s.correct102}× správný tip · ${s.correctScore}× přesné skóre</td>`;
      html += `<td colspan="${players.length}" style="text-align: center; font-weight: 800; color: #38bdf8; font-size: 13px;">${s.points} bodů</td>`;
      html += `</tr>`;
    });
    
    html += `</table>`;
    return html;
  }

  function buildTipsText(matchesForDay) {
    const t = getT(); if (!t) return '';
    const players = t.players, tips = t.tips || [];
    let text = '🏆 ' + t.name + '\n\n';
    matchesForDay.forEach(m => {
      const hasRes = m.result !== null;
      const resStr = hasRes ? ` (${m.result})` : '';
      text += '⚔️ ' + m.homeTeam + ' - ' + m.awayTeam + resStr + '\n';
      players.forEach(p => {
        const tip = tips.find(x => x.matchId === m.id && x.playerName === p);
        if (tip) {
          let evalStr = '';
          if (hasRes) {
            const sc = tip.tipScore === m.result;
            const tc = tip.tipType === m.resultType;
            evalStr = sc ? ' 🥇 (3b)' : tc ? ' ✅ (1b)' : ' ❌ (0b)';
          }
          text += '  ' + p + ': ' + tip.tipType + ' (' + (tip.tipScore || '—') + ')' + evalStr + '\n';
        }
      });
      text += '\n';
    });
    const scores = calculateScores();
    text += '📊 Žebříček:\n';
    scores.forEach((s, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
      text += medal + ' ' + s.name + ': ' + s.points + 'b\n';
    });
    return text;
  }

  let currentShareType = 'tips'; // 'tips' | 'matches'
  let currentShareDate = null;

  function buildMatchesTable(matchesForDay) {
    const t = getT(); if (!t) return '';
    const dateVal = currentShareDate;
    
    let html = `<style>
      .render-table {
        border-collapse: separate;
        border-spacing: 0;
        font-family: 'Inter', system-ui, sans-serif;
        background: #0b0f19;
        border: 1.5px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        overflow: hidden;
        color: #f1f5f9;
        width: 100%;
        box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      }
      .render-table th, .render-table td {
        padding: 14px 16px;
        border-bottom: 1.5px solid rgba(255,255,255,0.06);
        vertical-align: middle;
      }
      .render-table .title-row td {
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
        font-weight: 800;
        font-size: 16px;
        letter-spacing: 0.5px;
        color: #ffffff;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        padding: 16px;
        text-transform: uppercase;
        border-bottom: 2px solid rgba(255,255,255,0.15);
        text-align: center;
      }
      .render-table .date-row td {
        background: rgba(255,255,255,0.02);
        font-size: 13px;
        font-weight: 700;
        color: #a5b4fc;
        text-transform: uppercase;
        text-align: center;
        letter-spacing: 1px;
        border-bottom: 1.5px solid rgba(255,255,255,0.08);
      }
      .render-table .match-row td {
        background: rgba(255,255,255,0.01);
      }
      .render-table .match-row:nth-child(even) td {
        background: rgba(255,255,255,0.03);
      }
      .render-table .col-time {
        width: 80px;
        text-align: center;
        font-weight: 800;
        color: #38bdf8;
        font-size: 14px;
        border-right: 1.5px solid rgba(255,255,255,0.08);
      }
      .render-table .col-teams-display {
        font-weight: 700;
        font-size: 15px;
        color: #ffffff;
        padding-left: 20px !important;
      }
      .render-table .vs-badge {
        font-size: 11px;
        background: rgba(255,255,255,0.1);
        padding: 2px 6px;
        border-radius: 4px;
        color: #94a3b8;
        margin: 0 8px;
        font-weight: 500;
      }
    </style>`;
    
    const isImg = (t.icon || '🏆').startsWith('data:image/');
    const iconHtml = isImg ? `<img src="${t.icon}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; vertical-align: middle; margin-right: 12px; display: inline-block; box-shadow: 0 0 10px rgba(99,102,241,0.3); border: 1px solid rgba(255,255,255,0.1);">` : `<span style="margin-right: 12px; font-size: 28px; vertical-align: middle; filter: drop-shadow(0 0 6px rgba(99,102,241,0.3));">${t.icon || '🏆'}</span>`;

    html += `<table class="render-table">`;
    html += `<tr class="title-row"><td>${iconHtml}${t.name}</td></tr>`;
    html += `<tr class="date-row"><td>📅 ${dateVal === '__all__' ? 'Všechny zápasy' : formatDate(dateVal)}</td></tr>`;
    
    matchesForDay.forEach(m => {
      const hasRes = m.result !== null;
      html += `<tr class="match-row">`;
      html += `<td style="padding: 0; display: flex; width: 100%; align-items: center;">`;
      html += `<div class="col-time" style="padding: 14px 16px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; height: 100%;">${m.time || '—'}</div>`;
      html += `<div class="col-teams-display" style="padding: 14px 16px; flex-grow: 1; text-align: left;">${m.homeTeam}<span class="vs-badge">VS</span>${m.awayTeam}</div>`;
      if (hasRes) {
        html += `<div style="font-weight: 900; color: #38bdf8; font-size: 16px; padding: 4px 12px; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 6px; margin-right: 12px;">${m.result}</div>`;
      }
      html += `</td>`;
      html += `</tr>`;
    });
    
    html += `</table>`;
    return html;
  }

  function buildMatchesText(matchesForDay) {
    const t = getT(); if (!t) return '';
    const dateVal = currentShareDate;
    let text = `🏒 ${t.name}\n`;
    text += `📅 Program zápasů: ${dateVal === '__all__' ? 'Všechny zápasy' : formatDate(dateVal)}\n\n`;
    matchesForDay.forEach(m => {
      const resStr = m.result ? ` (${m.result})` : '';
      text += `⏰ ${m.time || '—'}  ${m.homeTeam} vs ${m.awayTeam}${resStr}\n`;
    });
    text += `\nNatipujte včas! 🏆`;
    return text;
  }

  function buildMatchesRankingsTable(matchesForDay) {
    const t = getT(); if (!t) return '';
    const dateVal = currentShareDate;
    
    let html = `<style>
      .render-table {
        border-collapse: separate;
        border-spacing: 0;
        font-family: 'Inter', system-ui, sans-serif;
        background: #0b0f19;
        border: 1.5px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        overflow: hidden;
        color: #f1f5f9;
        width: 100%;
        box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      }
      .render-table th, .render-table td {
        padding: 14px 16px;
        border-bottom: 1.5px solid rgba(255,255,255,0.06);
        vertical-align: middle;
      }
      .render-table .title-row td {
        background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
        font-weight: 800;
        font-size: 16px;
        letter-spacing: 0.5px;
        color: #ffffff;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        padding: 16px;
        text-transform: uppercase;
        border-bottom: 2px solid rgba(255,255,255,0.15);
        text-align: center;
      }
      .render-table .date-row td {
        background: rgba(255,255,255,0.02);
        font-size: 13px;
        font-weight: 700;
        color: #a5b4fc;
        text-transform: uppercase;
        text-align: center;
        letter-spacing: 1px;
        border-bottom: 1.5px solid rgba(255,255,255,0.08);
      }
      .render-table .match-row td {
        background: rgba(255,255,255,0.01);
      }
      .render-table .match-row:nth-child(even) td {
        background: rgba(255,255,255,0.03);
      }
      .render-table .col-time {
        width: 80px;
        text-align: center;
        font-weight: 800;
        color: #38bdf8;
        font-size: 14px;
        border-right: 1.5px solid rgba(255,255,255,0.08);
      }
      .render-table .col-teams-display {
        font-weight: 700;
        font-size: 15px;
        color: #ffffff;
        padding-left: 20px !important;
      }
      .render-table .vs-badge {
        font-size: 11px;
        background: rgba(255,255,255,0.1);
        padding: 2px 6px;
        border-radius: 4px;
        color: #94a3b8;
        margin: 0 8px;
        font-weight: 500;
      }
      .render-table .col-result-display {
        font-weight: 900;
        color: #38bdf8;
        font-size: 16px;
        padding: 4px 12px;
        background: rgba(56, 189, 248, 0.12);
        border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 6px;
        margin-right: 12px;
      }
      .render-table .leaderboard-row td {
        background: rgba(255,255,255,0.01);
        border-bottom: 1.5px solid rgba(255,255,255,0.04);
      }
      .render-table .leaderboard-row:nth-child(even) td {
        background: rgba(255,255,255,0.03);
      }
      .render-table .leaderboard-flex {
        display: flex;
        align-items: center;
        width: 100%;
        gap: 12px;
      }
      .render-table .leaderboard-flex .col-rank {
        width: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        font-weight: 800;
      }
      .render-table .leaderboard-flex .col-player-info {
        flex-grow: 1;
        text-align: left;
      }
      .render-table .leaderboard-flex .col-player-name {
        font-weight: 700;
        font-size: 14px;
        color: #ffffff;
      }
      .render-table .leaderboard-flex .col-player-stats {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .render-table .leaderboard-flex .col-player-points {
        font-size: 18px;
        font-weight: 800;
        color: #38bdf8;
        text-align: right;
      }
      .render-table .leaderboard-flex .col-player-points span {
        font-size: 11px;
        font-weight: 500;
        color: #64748b;
      }
    </style>`;
    
    const isImg = (t.icon || '🏆').startsWith('data:image/');
    const iconHtml = isImg ? `<img src="${t.icon}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; vertical-align: middle; margin-right: 12px; display: inline-block; box-shadow: 0 0 10px rgba(99,102,241,0.3); border: 1px solid rgba(255,255,255,0.1);">` : `<span style="margin-right: 12px; font-size: 28px; vertical-align: middle; filter: drop-shadow(0 0 6px rgba(99,102,241,0.3));">${t.icon || '🏆'}</span>`;

    html += `<table class="render-table">`;
    html += `<tr class="title-row"><td>${iconHtml}${t.name}</td></tr>`;
    html += `<tr class="date-row"><td>📅 ${dateVal === '__all__' ? 'Všechny zápasy' : formatDate(dateVal)}</td></tr>`;
    
    matchesForDay.forEach(m => {
      const hasRes = m.result !== null;
      html += `<tr class="match-row">`;
      html += `<td style="padding: 0; display: flex; width: 100%; align-items: center;">`;
      html += `<div class="col-time" style="padding: 14px 16px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; height: 100%;">${m.time || '—'}</div>`;
      html += `<div class="col-teams-display" style="padding: 14px 16px; flex-grow: 1; text-align: left;">${m.homeTeam}<span class="vs-badge">VS</span>${m.awayTeam}</div>`;
      if (hasRes) {
        html += `<div class="col-result-display">${m.result}</div>`;
      }
      html += `</td>`;
      html += `</tr>`;
    });
    
    // Append Standings Header
    html += `<tr class="title-row"><td style="text-align: center; background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%); font-size: 14px; padding: 12px;"><img src="rankings_badge.png" crossorigin="anonymous" style="width: 18px; height: 18px; object-fit: contain; vertical-align: middle; margin-right: 8px;">ŽEBŘÍČEK HRÁČŮ / HRÁČEK</td></tr>`;
    
    const scores = calculateScores();
    scores.forEach((s, i) => {
      let medalHtml = `${i+1}.`;
      if (i === 0) medalHtml = `<img src="medal_gold.png" crossorigin="anonymous" style="width: 20px; height: 20px; object-fit: contain; vertical-align: middle;">`;
      else if (i === 1) medalHtml = `<img src="medal_silver.png" crossorigin="anonymous" style="width: 20px; height: 20px; object-fit: contain; vertical-align: middle;">`;
      else if (i === 2) medalHtml = `<img src="medal_bronze.png" crossorigin="anonymous" style="width: 20px; height: 20px; object-fit: contain; vertical-align: middle;">`;
      
      html += `<tr class="leaderboard-row">`;
      html += `<td style="padding: 12px 16px;">`;
      html += `<div class="leaderboard-flex">`;
      html += `<div class="col-rank">${medalHtml}</div>`;
      html += `<div class="col-player-info">`;
      html += `<div class="col-player-name">${s.name}</div>`;
      html += `<div class="col-player-stats">${s.correct102}× správný tip · ${s.correctScore}× přesné skóre</div>`;
      html += `</div>`;
      html += `<div class="col-player-points">${s.points} <span>b</span></div>`;
      html += `</div>`;
      html += `</td>`;
      html += `</tr>`;
    });
    
    html += `</table>`;
    return html;
  }

  function buildMatchesRankingsText(matchesForDay) {
    const t = getT(); if (!t) return '';
    const dateVal = currentShareDate;
    let text = `🏒 ${t.name}\n`;
    text += `📅 Program zápasů: ${dateVal === '__all__' ? 'Všechny zápasy' : formatDate(dateVal)}\n\n`;
    matchesForDay.forEach(m => {
      const resStr = m.result ? ` (${m.result})` : '';
      text += `⏰ ${m.time || '—'}  ${m.homeTeam} vs ${m.awayTeam}${resStr}\n`;
    });
    
    const scores = calculateScores();
    text += `\n📊 Aktuální žebříček:\n`;
    scores.forEach((s, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
      text += `${medal} ${s.name}: ${s.points}b (${s.correct102}× 102 · ${s.correctScore}× přesné skóre)\n`;
    });
    
    text += `\nNatipujte včas! 🏆`;
    return text;
  }

  function updateSharePreview() {
    const t = getT(); if (!t) return;
    const matchesForDay = currentShareDate === '__all__' ? t.matches : t.matches.filter(m => m.date === currentShareDate);
    if (!matchesForDay.length) {
      $('#shareTipsPreview').innerHTML = '<p style="text-align:center;padding:20px;color:#6b7280">\u017d\u00e1dn\u00e9 z\u00e1pasy</p>';
      return;
    }
    
    let tableHtml = '';
    if (currentShareType === 'tips') {
      tableHtml = buildTipsTable(matchesForDay);
    } else if (currentShareType === 'matches') {
      tableHtml = buildMatchesTable(matchesForDay);
    } else if (currentShareType === 'matches_rankings') {
      tableHtml = buildMatchesRankingsTable(matchesForDay);
    }
    
    $('#shareTipsPreview').innerHTML = tableHtml;
    $('#renderContainer').innerHTML = '<div style="display:inline-block;padding:16px;background:#0f1729">' + tableHtml + '</div>';
  }

  $('#btnShare').addEventListener('click', () => {
    const t = getT(); if (!t) return showToast('\u017d\u00e1dn\u00e1 tipova\u010dka', 'error');
    const dates = getUniqueDates();
    const sel = $('#selectShareDate');
    const today = new Date().toISOString().split('T')[0];
    let opts = dates.map(d => {
      const count = t.matches.filter(m => m.date === d).length;
      return '<option value="' + d + '"' + (d === today ? ' selected' : '') + '>' + formatDate(d) + ' (' + count + ' z\u00e1pas\u016f)</option>';
    });
    opts.push('<option value="__all__">V\u0161echny z\u00e1pasy (' + t.matches.length + ')</option>');
    sel.innerHTML = opts.join('');
    currentShareDate = sel.value || dates[0] || '__all__';
    
    // Default to tips tab
    currentShareType = 'tips';
    $$('#modalShareTips .import-tab').forEach(x => x.classList.remove('active'));
    $('#tabShareTips').classList.add('active');
    
    updateSharePreview();
    openModal('modalShareTips');
  });

  // Tab switching for Share Modal
  $('#tabShareTips').addEventListener('click', () => {
    currentShareType = 'tips';
    $$('#modalShareTips .import-tab').forEach(x => x.classList.remove('active'));
    $('#tabShareTips').classList.add('active');
    updateSharePreview();
  });
  $('#tabShareMatches').addEventListener('click', () => {
    currentShareType = 'matches';
    $$('#modalShareTips .import-tab').forEach(x => x.classList.remove('active'));
    $('#tabShareMatches').classList.add('active');
    updateSharePreview();
  });
  $('#tabShareMatchesRankings').addEventListener('click', () => {
    currentShareType = 'matches_rankings';
    $$('#modalShareTips .import-tab').forEach(x => x.classList.remove('active'));
    $('#tabShareMatchesRankings').classList.add('active');
    updateSharePreview();
  });

  $('#selectShareDate').addEventListener('change', e => {
    currentShareDate = e.target.value;
    updateSharePreview();
  });

  $('#btnShareImageOnly').addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    const renderEl = $('#renderContainer').firstChild;
    if (!renderEl) return;
    if (!navigator.share) {
      showToast('Přímé sdílení není podporováno. Použijte tlačítko Stáhnout obrázek.', 'error');
      return;
    }
    try {
      const canvas = await html2canvas(renderEl, { backgroundColor: '#0f1729', scale: 2, useCORS: true, allowTaint: true });
      canvas.toBlob(async blob => {
        if (!blob) {
          console.error("Canvas toBlob returned null");
          showToast('Chyba: Nepodařilo se vytvořit soubor', 'error');
          return;
        }
        const fn = t.name.replace(/\s/g, '_') + '_' + (currentShareType === 'tips' ? 'tipy' : currentShareType === 'matches' ? 'program' : 'program_zebricek') + '_' + (currentShareDate || 'all') + '.png';
        const file = new File([blob], fn, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          const matchesForDay = currentShareDate === '__all__' ? t.matches : t.matches.filter(m => m.date === currentShareDate);
          const shareText = currentShareType === 'tips' ? buildTipsText(matchesForDay) : currentShareType === 'matches' ? buildMatchesText(matchesForDay) : buildMatchesRankingsText(matchesForDay);
          await navigator.share({ files: [file], text: shareText });
        } else {
          showToast('Tento soubor nelze sdílet přímou cestou.', 'error');
        }
      }, 'image/png');
    } catch (e) {
      console.error("html2canvas share error:", e);
      if (e.name !== 'AbortError') showToast('Chyba při sdílení: ' + (e.message || 'Nepodporovaný formát'), 'error');
    }
  });

  $('#btnDownloadImageOnly').addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    const renderEl = $('#renderContainer').firstChild;
    if (!renderEl) return;
    try {
      const canvas = await html2canvas(renderEl, { backgroundColor: '#0f1729', scale: 2, useCORS: true, allowTaint: true });
      canvas.toBlob(async blob => {
        if (!blob) {
          showToast('Chyba: Nepodařilo se stáhnout soubor', 'error');
          return;
        }
        const fn = t.name.replace(/\s/g, '_') + '_' + (currentShareType === 'tips' ? 'tipy' : currentShareType === 'matches' ? 'program' : 'program_zebricek') + '_' + (currentShareDate || 'all') + '.png';
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = fn; a.click();
        showToast('Obrázek stažen');
      }, 'image/png');
    } catch (e) {
      console.error("html2canvas download error:", e);
      if (e.name !== 'AbortError') showToast('Chyba při stahování: ' + (e.message || 'Nepodporovaný formát'), 'error');
    }
  });

  $('#btnCopyText').addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    const matchesForDay = currentShareDate === '__all__' ? t.matches : t.matches.filter(m => m.date === currentShareDate);
    const textToCopy = currentShareType === 'tips' ? buildTipsText(matchesForDay) : currentShareType === 'matches' ? buildMatchesText(matchesForDay) : buildMatchesRankingsText(matchesForDay);
    try {
      await navigator.clipboard.writeText(textToCopy);
      showToast('Zkopírováno do schránky');
    } catch { showToast('Nelze zkopírovat', 'error'); }
  });

  // --- PLAYER PROFILE IMAGE SHARE & DOWNLOAD ---
  $('#btnShareProfileImage')?.addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    const modalEl = $('#modalPlayerProfile .modal');
    if (!modalEl) return;
    if (!navigator.share) {
      showToast('Přímé sdílení není podporováno. Použijte tlačítko Stáhnout profil.', 'error');
      return;
    }
    
    const closeBtn = $('#modalPlayerProfile .btn-close');
    const actions = $('#modalPlayerProfile .share-actions');
    
    // Dočasně skryjeme ovládací prvky pro čistý render
    if (closeBtn) closeBtn.style.visibility = 'hidden';
    if (actions) actions.style.display = 'none';
    
    try {
      const canvas = await html2canvas(modalEl, { 
        backgroundColor: '#0f1729', 
        scale: 2, 
        useCORS: true, 
        allowTaint: true,
        scrollX: 0,
        scrollY: 0
      });
      
      canvas.toBlob(async blob => {
        // Obnovíme viditelnost tlačítek
        if (closeBtn) closeBtn.style.visibility = 'visible';
        if (actions) actions.style.display = 'flex';
        
        if (!blob) {
          showToast('Chyba: Nepodařilo se vytvořit obrázek', 'error');
          return;
        }
        
        const playerName = $('#profilePlayerName').textContent || 'hrac';
        const fn = `profil_${playerName.replace(/\s/g, '_')}.png`;
        const file = new File([blob], fn, { type: 'image/png' });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          const statsText = $('#profileGlobalStats').textContent || '';
          await navigator.share({ 
            files: [file], 
            text: `🥇 Profil hráče / hráčky ${playerName} v tipovačce ${t.name}! ${statsText}` 
          });
        } else {
          showToast('Tento soubor nelze sdílet přímou cestou.', 'error');
        }
      }, 'image/png');
    } catch (e) {
      if (closeBtn) closeBtn.style.visibility = 'visible';
      if (actions) actions.style.display = 'flex';
      console.error("Profile share error:", e);
      showToast('Chyba při sdílení: ' + (e.message || 'Nepodporovaný formát'), 'error');
    }
  });

  $('#btnDownloadProfileImage')?.addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    const modalEl = $('#modalPlayerProfile .modal');
    if (!modalEl) return;
    
    const closeBtn = $('#modalPlayerProfile .btn-close');
    const actions = $('#modalPlayerProfile .share-actions');
    
    // Dočasně skryjeme ovládací prvky pro čistý render
    if (closeBtn) closeBtn.style.visibility = 'hidden';
    if (actions) actions.style.display = 'none';
    
    try {
      const canvas = await html2canvas(modalEl, { 
        backgroundColor: '#0f1729', 
        scale: 2, 
        useCORS: true, 
        allowTaint: true,
        scrollX: 0,
        scrollY: 0
      });
      
      canvas.toBlob(blob => {
        // Obnovíme viditelnost tlačítek
        if (closeBtn) closeBtn.style.visibility = 'visible';
        if (actions) actions.style.display = 'flex';
        
        if (!blob) {
          showToast('Chyba při stahování', 'error');
          return;
        }
        
        const playerName = $('#profilePlayerName').textContent || 'hrac';
        const fn = `profil_${playerName.replace(/\s/g, '_')}.png`;
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fn;
        a.click();
        showToast('Profil stažen jako obrázek');
      }, 'image/png');
    } catch (e) {
      if (closeBtn) closeBtn.style.visibility = 'visible';
      if (actions) actions.style.display = 'flex';
      console.error("Profile download error:", e);
      showToast('Chyba při stahování: ' + (e.message || 'Nepodporovaný formát'), 'error');
    }
  });

  // === BULK IMPORT MATCHES ===
  let bulkImportedMatches = [], bulkMatchesScreenshotBase64 = null, bulkImportMethod = 'paste';

  $('#btnTriggerBulkImport').addEventListener('click', () => {
    closeModal('modalAddMatch');
    bulkImportedMatches = [];
    bulkMatchesScreenshotBase64 = null;
    bulkImportMethod = 'paste';
    $('#inputBulkMatchesPaste').value = '';
    $('#uploadBulkPreview').hidden = true;
    $('#uploadBulkPlaceholder').hidden = false;
    $('#bulkImportPreview').hidden = true;
    $('#bulkImportLoading').hidden = true;
    $$('[data-bulk-method]').forEach(b => b.classList.toggle('active', b.dataset.bulkMethod === 'paste'));
    $('#panelBulkPaste').hidden = false;
    $('#panelBulkScreenshot').hidden = true;
    openModal('modalBulkImport');
  });

  // Switch tabs
  $$('[data-bulk-method]').forEach(tab => {
    tab.addEventListener('click', () => {
      bulkImportMethod = tab.dataset.bulkMethod;
      $$('[data-bulk-method]').forEach(t => t.classList.toggle('active', t.dataset.bulkMethod === bulkImportMethod));
      $('#panelBulkPaste').hidden = bulkImportMethod !== 'paste';
      $('#panelBulkScreenshot').hidden = bulkImportMethod !== 'screenshot';
    });
  });

  // Screenshot Upload logic
  const uzbm = $('#uploadZoneBulkMatches'), fibm = $('#inputBulkMatchesScreenshot');
  if (uzbm && fibm) {
    uzbm.addEventListener('click', () => fibm.click());
    uzbm.addEventListener('dragover', e => { e.preventDefault(); uzbm.style.borderColor = 'var(--accent)'; });
    uzbm.addEventListener('dragleave', () => uzbm.style.borderColor = '');
    uzbm.addEventListener('drop', e => {
      e.preventDefault(); uzbm.style.borderColor = '';
      if (e.dataTransfer.files.length) handleBulkMatchesFile(e.dataTransfer.files[0]);
    });
    fibm.addEventListener('change', e => {
      if (e.target.files.length) handleBulkMatchesFile(e.target.files[0]);
    });
  }

  async function handleBulkMatchesFile(file) {
    const reader = new FileReader();
    reader.onload = async e => {
      bulkMatchesScreenshotBase64 = e.target.result;
      $('#uploadBulkPreview').src = bulkMatchesScreenshotBase64;
      $('#uploadBulkPreview').hidden = false;
      $('#uploadBulkPlaceholder').hidden = true;
      $('#bulkImportLoading').hidden = false;
      try {
        const result = await analyzeMatchesScreenshot(bulkMatchesScreenshotBase64);
        bulkImportedMatches = result.map(m => ({
          id: genId(),
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          date: m.date || '',
          time: m.time || '',
          result: null,
          resultType: null
        }));
        renderBulkImportPreview();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        $('#bulkImportLoading').hidden = true;
      }
    };
    reader.readAsDataURL(file);
  }

  window.removeBulkImportMatch = function(idx) {
    bulkImportedMatches.splice(idx, 1);
    renderBulkImportPreview();
  };

  function renderBulkImportPreview() {
    $('#bulkImportCount').textContent = bulkImportedMatches.length;
    $('#bulkImportMatchesList').innerHTML = bulkImportedMatches.map((m, i) =>
      `<div class="import-match-row">
        <span class="num">${i+1}.</span>
        <span class="teams">${m.homeTeam} – ${m.awayTeam}</span>
        <span class="date-info">${m.date ? formatDate(m.date) : ''}${m.time ? ' ' + m.time : ''}</span>
        <button class="btn-remove-match" onclick="window.removeBulkImportMatch(${i})">×</button>
      </div>`
    ).join('');
    $('#bulkImportPreview').hidden = !bulkImportedMatches.length;
  }

  // Import button logic
  $('#btnImportBulkMatches').addEventListener('click', () => {
    if (!checkAdminPermission()) return;
    const t = getT(); if (!t) return;
    let matchesToAdd = [];

    if (bulkImportMethod === 'paste') {
      const text = $('#inputBulkMatchesPaste').value.trim();
      if (!text) return showToast('Vložte nějaký text zápasů', 'error');
      matchesToAdd = parseMatchesText(text);
    } else {
      matchesToAdd = bulkImportedMatches;
    }

    if (!matchesToAdd.length) {
      return showToast('Žádné zápasy k importu', 'error');
    }

    // Append to tournament matches
    const startOrder = t.matches.length + 1;
    matchesToAdd.forEach((m, idx) => {
      m.order = startOrder + idx;
      t.matches.push(m);
    });

    save();
    renderAll();
    closeModal('modalBulkImport');
    showToast(`Hromadně naimportováno ${matchesToAdd.length} zápasů`);
  });

  // === BULK RESULTS IMPORT ===
  let resultsImportMethod = 'text';
  let resultsScreenshotBase64 = null;

  $('#btnBulkResultsOpen').addEventListener('click', () => {
    if (activeTournamentId === '__all__') return showToast('Pro zadávání výsledků vyberte konkrétní tipovačku.', 'warning');
    if (!getT()) return showToast('Nejdřív vytvořte tipovačku', 'error');
    $('#inputResultsPaste').value = '';
    $('#uploadPreviewResults').hidden = true;
    $('#uploadPlaceholderResults').hidden = false;
    $('#aiResultsLoading').hidden = true;
    resultsScreenshotBase64 = null;
    
    // Set default tab
    resultsImportMethod = 'text';
    $('#tabResultsText').classList.add('active');
    $('#tabResultsScreenshot').classList.remove('active');
    $('#panelResultsText').hidden = false;
    $('#panelResultsScreenshot').hidden = true;
    
    openModal('modalBulkResults');
  });

  $('#tabResultsText').addEventListener('click', () => {
    resultsImportMethod = 'text';
    $('#tabResultsText').classList.add('active');
    $('#tabResultsScreenshot').classList.remove('active');
    $('#panelResultsText').hidden = false;
    $('#panelResultsScreenshot').hidden = true;
  });

  $('#tabResultsScreenshot').addEventListener('click', () => {
    resultsImportMethod = 'screenshot';
    $('#tabResultsScreenshot').classList.add('active');
    $('#tabResultsText').classList.remove('active');
    $('#panelResultsText').hidden = true;
    $('#panelResultsScreenshot').hidden = false;
  });

  const uzr = $('#uploadZoneResults'), fir = $('#inputResultsScreenshot');
  if (uzr && fir) {
    uzr.addEventListener('click', () => fir.click());
    uzr.addEventListener('dragover', e => { e.preventDefault(); uzr.style.borderColor = 'var(--accent)'; });
    uzr.addEventListener('dragleave', () => uzr.style.borderColor = '');
    uzr.addEventListener('drop', e => {
      e.preventDefault(); uzr.style.borderColor = '';
      if (e.dataTransfer.files.length) handleResultsFile(e.dataTransfer.files[0]);
    });
    fir.addEventListener('change', e => {
      if (e.target.files.length) handleResultsFile(e.target.files[0]);
    });
  }

  function handleResultsFile(file) {
    const r = new FileReader();
    r.onload = e => {
      resultsScreenshotBase64 = e.target.result;
      $('#uploadPreviewResults').src = resultsScreenshotBase64;
      $('#uploadPreviewResults').hidden = false;
      $('#uploadPlaceholderResults').hidden = true;
    };
    r.readAsDataURL(file);
  }

  $('#btnAnalyzeResults').addEventListener('click', async () => {
    const t = getT(); if (!t) return;
    $('#aiResultsLoading').hidden = false;
    $('#btnAnalyzeResults').disabled = true;

    try {
      let parsedResults = [];
      if (resultsImportMethod === 'text') {
        const text = $('#inputResultsPaste').value.trim();
        if (!text) return showToast('Vložte text s výsledky', 'error');
        parsedResults = await analyzeResultsText(text);
      } else {
        if (!resultsScreenshotBase64) return showToast('Nahrajte screenshot s výsledky', 'error');
        parsedResults = await analyzeResultsScreenshot(resultsScreenshotBase64);
      }

      let count = 0;
      parsedResults.forEach(r => {
        if (!r.result) return;
        const m = t.matches.find(m => {
          const n1 = `${m.homeTeam} - ${m.awayTeam}`.toLowerCase();
          const n2 = (r.match || '').toLowerCase();
          return n1 === n2 || n1.includes(n2) || n2.includes(n1) || n1.replace(/\s/g,'') === n2.replace(/\s/g,'');
        });
        
        if (m) {
          const isOvertime = r.result.toLowerCase().includes('p');
          const cleanResult = r.result.replace(/[a-zA-Z]/g, '');
          const scores = cleanResult.split(/[:\-x]/).map(s => parseInt(s.trim()));
          if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
            m.result = `${scores[0]}:${scores[1]}${isOvertime ? 'p' : ''}`;
            m.resultType = isOvertime ? 0 : getResultType(scores[0], scores[1]);
            count++;
          }
        }
      });

      save();
      renderAll();
      closeModal('modalBulkResults');
      showToast(`Úspěšně uloženo ${count} výsledků!`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      $('#aiResultsLoading').hidden = true;
      $('#btnAnalyzeResults').disabled = false;
    }
  });

  // Service Worker s automatickou detekcí a načtením nové verze
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        // Kontrola aktualizací při každém načtení
        reg.update();
        
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('Aktualizuji aplikaci na nejnovější verzi...', 'success');
              }
            });
          }
        });
      })
      .catch(() => {});

    // Automatický reload při převzetí kontroly novým Service Workerem
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
});