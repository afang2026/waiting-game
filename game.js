/* ===========================================================
   Nova Drift — Milky Way Explorer
   A single-file idle/incremental space exploration game.
   =========================================================== */

const SAVE_KEY = 'novadrift-save-v1';
const IDLE_THRESHOLD_MS = 30 * 1000;      // gaps shorter than this don't count as a "return"
const FATIGUE_GRACE_MIN = 20;             // minutes of continuous play before fatigue starts
const FATIGUE_WINDOW_MIN = 40;            // minutes after grace to reach max fatigue
const FATIGUE_FLOOR = 0.25;               // worst-case multiplier while overstaying

// ---------- Content definitions ----------

const UPGRADES = {
  collector: {
    name: 'Solar Collector', costRes: 'stardust', baseCost: 15,
    desc: '+0.4 Stardust/sec passive collection', statKey: 'collector'
  },
  reactor: {
    name: 'Energy Reactor', costRes: 'stardust', baseCost: 20,
    desc: '+0.15 Energy/sec passive generation', statKey: 'reactor'
  },
  laser: {
    name: 'Mining Laser', costRes: 'stardust', baseCost: 25,
    desc: '+2 power per asteroid click', statKey: 'laser'
  },
  cargo: {
    name: 'Cargo Expansion', costRes: 'energy', baseCost: 10,
    desc: '+0.75h max offline range', statKey: 'cargo'
  }
};

const PLANETS = [
  { id: 'mercury', name: 'Mercury', color: '#a8a29e', cost: { stardust: 50, energy: 0 }, bonus: { stat: 'collectorPct', pct: 0.10 }, desc: '+10% Collector' },
  { id: 'venus', name: 'Venus', color: '#e2b857', cost: { stardust: 200, energy: 20 }, bonus: { stat: 'laserPct', pct: 0.10 }, desc: '+10% Laser' },
  { id: 'mars', name: 'Mars', color: '#c1440e', cost: { stardust: 600, energy: 60 }, bonus: { stat: 'collectorPct', pct: 0.15 }, desc: '+15% Collector' },
  { id: 'jupiter', name: 'Jupiter', color: '#d9a066', cost: { stardust: 2000, energy: 200 }, bonus: { stat: 'reactorPct', pct: 0.20 }, desc: '+20% Reactor' },
  { id: 'saturn', name: 'Saturn', color: '#e8d4a0', cost: { stardust: 6000, energy: 600 }, bonus: { stat: 'collectorPct', pct: 0.20 }, desc: '+20% Collector' },
  { id: 'uranus', name: 'Uranus', color: '#8fd3e8', cost: { stardust: 18000, energy: 1800 }, bonus: { stat: 'cargoPct', pct: 0.25 }, desc: '+25% Cargo Range' },
  { id: 'neptune', name: 'Neptune', color: '#5b7fe8', cost: { stardust: 50000, energy: 5000 }, bonus: { stat: 'laserPct', pct: 0.25 }, desc: '+25% Laser' },
  { id: 'kuiper', name: 'Kuiper Outpost', color: '#7d8fa8', cost: { stardust: 150000, energy: 15000 }, bonus: { stat: 'reactorPct', pct: 0.30 }, desc: '+30% Reactor' },
  { id: 'proxima', name: 'Proxima b', color: '#e85d5d', cost: { stardust: 500000, energy: 50000 }, bonus: { stat: 'collectorPct', pct: 0.35 }, desc: '+35% Collector' },
  { id: 'cygnus', name: 'Cygnus Arm', color: '#b85de8', cost: { stardust: 1500000, energy: 150000 }, bonus: { stat: 'laserPct', pct: 0.40 }, desc: '+40% Laser' }
];

const RANKS = [
  { min: 0, label: 'Rookie Pilot · Sol System' },
  { min: 3, label: 'Scout Captain · Inner Planets' },
  { min: 6, label: 'Fleet Commander · Outer Planets' },
  { min: 9, label: 'Star Voyager · Local Stars' },
  { min: 10, label: 'Galaxy Explorer · Milky Way' }
];

// ---------- State ----------

function defaultState() {
  const now = Date.now();
  return {
    resources: { stardust: 0, energy: 0, crystals: 0 },
    totalEarned: 0,
    upgrades: { collector: 0, reactor: 0, laser: 0, cargo: 0 },
    bonuses: { collectorPct: 0, laserPct: 0, reactorPct: 0, cargoPct: 0 },
    exploredPlanets: [],
    lastActive: now,
    lastTick: now,
    sessionStart: now,
    pomodoro: { active: false, endTime: 0, duration: 0, sessionsCompleted: 0 },
    log: []
  };
}

let state = loadState();
let asteroidTimer = null;
let selectedDuration = 25;

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed, {
      resources: Object.assign({ stardust: 0, energy: 0, crystals: 0 }, parsed.resources),
      upgrades: Object.assign({ collector: 0, reactor: 0, laser: 0, cargo: 0 }, parsed.upgrades),
      bonuses: Object.assign({ collectorPct: 0, laserPct: 0, reactorPct: 0, cargoPct: 0 }, parsed.bonuses),
      pomodoro: Object.assign({ active: false, endTime: 0, duration: 0, sessionsCompleted: 0 }, parsed.pomodoro)
    });
  } catch (e) {
    console.warn('Save corrupted, starting fresh.', e);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  document.getElementById('saveStatus').textContent = 'Saved ' + new Date().toLocaleTimeString();
  syncToFolder();
}

// ---------- Derived stats ----------

function getCollectorRate() {
  const base = 0.5 + state.upgrades.collector * 0.4;
  return base * (1 + state.bonuses.collectorPct);
}
function getReactorRate() {
  const base = 0.1 + state.upgrades.reactor * 0.15;
  return base * (1 + state.bonuses.reactorPct);
}
function getLaserPower() {
  const base = 3 + state.upgrades.laser * 2;
  return base * (1 + state.bonuses.laserPct);
}
function getCargoHours() {
  const base = 2 + state.upgrades.cargo * 0.75;
  return Math.min(24, base * (1 + state.bonuses.cargoPct));
}

function getFatigueMultiplier(activeMs) {
  const minutes = activeMs / 60000;
  if (minutes <= FATIGUE_GRACE_MIN) return 1;
  const over = minutes - FATIGUE_GRACE_MIN;
  return Math.max(FATIGUE_FLOOR, 1 - (over / FATIGUE_WINDOW_MIN) * (1 - FATIGUE_FLOOR));
}

function getIdleMultiplier(awayMinutes) {
  if (awayMinutes < 1) return 1;
  return Math.min(40, 1 + Math.pow(awayMinutes, 0.7) * 0.15);
}

function getUpgradeCost(key) {
  const def = UPGRADES[key];
  const level = state.upgrades[key];
  return Math.ceil(def.baseCost * Math.pow(1.15, level));
}

// ---------- Helpers ----------

function format(n) {
  n = Math.floor(n);
  if (n < 1000) return n.toString();
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let u = -1;
  let v = n;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return v.toFixed(v < 10 ? 2 : 1) + units[u];
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRate(n) {
  if (n < 1000) return n < 10 ? n.toFixed(2) : n.toFixed(1);
  return format(n);
}

function addResources(type, amount) {
  if (amount <= 0) return;
  state.resources[type] += amount;
  if (type !== 'crystals') state.totalEarned += amount;
}

function addLog(msg) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  state.log.unshift(`[${time}] ${msg}`);
  state.log = state.log.slice(0, 30);
  renderLog();
}

function showModal(title, body) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modalOverlay').classList.add('hidden');
});

function spawnFloatText(el, text) {
  const area = document.getElementById('miningArea');
  const rect = el.getBoundingClientRect();
  const areaRect = area.getBoundingClientRect();
  const span = document.createElement('div');
  span.className = 'float-gain';
  span.textContent = text;
  span.style.left = (rect.left - areaRect.left) + 'px';
  span.style.top = (rect.top - areaRect.top) + 'px';
  area.appendChild(span);
  setTimeout(() => span.remove(), 900);
}

// ---------- Rendering ----------

function renderResources() {
  document.getElementById('resStardust').textContent = format(state.resources.stardust);
  document.getElementById('resEnergy').textContent = format(state.resources.energy);
  document.getElementById('resCrystals').textContent = format(state.resources.crystals);
}

function renderStats() {
  const fatigue = state.pomodoro.active ? 1 : getFatigueMultiplier(Date.now() - state.sessionStart);
  document.getElementById('statLaser').textContent = formatRate(getLaserPower() * fatigue);
  document.getElementById('statCollector').textContent = formatRate(getCollectorRate() * fatigue);
  document.getElementById('statReactor').textContent = formatRate(getReactorRate() * fatigue);
  document.getElementById('statCargo').textContent = getCargoHours().toFixed(1);

  const exploredCount = state.exploredPlanets.length;
  let rank = RANKS[0].label;
  for (const r of RANKS) if (exploredCount >= r.min) rank = r.label;
  document.getElementById('rankLabel').textContent = rank;
}

function renderUpgrades() {
  const list = document.getElementById('upgradeList');
  list.innerHTML = '';
  for (const key of Object.keys(UPGRADES)) {
    const def = UPGRADES[key];
    const level = state.upgrades[key];
    const cost = getUpgradeCost(key);
    const canAfford = state.resources[def.costRes] >= cost;
    const div = document.createElement('div');
    div.className = 'upgrade';
    div.innerHTML = `
      <div class="upgrade-top"><span>${def.name} · Lv${level}</span></div>
      <div class="upgrade-desc">${def.desc}</div>
      <button class="btn btn-small ${canAfford ? 'btn-primary' : 'btn-ghost'}" ${canAfford ? '' : 'disabled'}>
        Upgrade — ${format(cost)} ${def.costRes === 'stardust' ? '✨' : '⚡'}
      </button>`;
    div.querySelector('button').addEventListener('click', () => buyUpgrade(key));
    list.appendChild(div);
  }
}

function buyUpgrade(key) {
  const def = UPGRADES[key];
  const cost = getUpgradeCost(key);
  if (state.resources[def.costRes] < cost) return;
  state.resources[def.costRes] -= cost;
  state.upgrades[key]++;
  addLog(`Upgraded ${def.name} to level ${state.upgrades[key]}.`);
  renderUpgrades();
  renderStats();
  renderResources();
  saveState();
}

function renderPlanets() {
  const track = document.getElementById('planetTrack');
  track.innerHTML = '';
  PLANETS.forEach((p, i) => {
    const explored = state.exploredPlanets.includes(p.id);
    const unlocked = i === 0 || state.exploredPlanets.includes(PLANETS[i - 1].id);
    const canAfford = state.resources.stardust >= p.cost.stardust && state.resources.energy >= p.cost.energy;
    const card = document.createElement('div');
    card.className = 'planet-card ' + (explored ? 'explored' : (unlocked ? '' : 'locked'));
    let btnHtml;
    if (explored) {
      btnHtml = `<button class="btn btn-small btn-ghost" disabled>Explored ✓</button>`;
    } else if (!unlocked) {
      btnHtml = `<button class="btn btn-small btn-ghost" disabled>🔒 Locked</button>`;
    } else {
      btnHtml = `<button class="btn btn-small ${canAfford ? 'btn-primary' : 'btn-ghost'}" ${canAfford ? '' : 'disabled'}>
        Explore — ${format(p.cost.stardust)}✨ ${p.cost.energy ? format(p.cost.energy) + '⚡' : ''}
      </button>`;
    }
    card.innerHTML = `
      <div class="planet-sphere" style="--sphere-color:${p.color}"></div>
      <h3>${p.name}</h3>
      <p>${p.desc}</p>
      ${btnHtml}`;
    if (unlocked && !explored) {
      card.querySelector('button').addEventListener('click', () => explorePlanet(p));
    }
    track.appendChild(card);
  });
}

function explorePlanet(p) {
  if (state.resources.stardust < p.cost.stardust || state.resources.energy < p.cost.energy) return;
  state.resources.stardust -= p.cost.stardust;
  state.resources.energy -= p.cost.energy;
  state.exploredPlanets.push(p.id);
  state.bonuses[p.bonus.stat] += p.bonus.pct;
  state.resources.crystals += 3;
  addLog(`Explored ${p.name}! ${p.desc}. +3 Crystals.`);
  renderPlanets();
  renderStats();
  renderResources();
  saveState();
}

function renderLog() {
  const ul = document.getElementById('missionLog');
  ul.innerHTML = state.log.map(l => `<li>${l}</li>`).join('');
}

function renderAll() {
  renderResources();
  renderStats();
  renderUpgrades();
  renderPlanets();
  renderLog();
  document.getElementById('pomodoroCount').textContent = state.pomodoro.sessionsCompleted;
}

// ---------- Fatigue banner ----------

function updateFatigueBanner() {
  const banner = document.getElementById('fatigueBanner');
  if (state.pomodoro.active) { banner.classList.add('hidden'); return; }
  const fatigue = getFatigueMultiplier(Date.now() - state.sessionStart);
  if (fatigue >= 0.85) { banner.classList.add('hidden'); return; }
  const text = fatigue < 0.5
    ? "Your crew is exhausted — ship effectiveness is way down. A study break will recharge them."
    : "Your crew is getting tired from the long shift. Consider a Pomodoro soon.";
  document.getElementById('fatigueText').textContent = text;
  banner.classList.remove('hidden');
}
document.getElementById('fatigueCta').addEventListener('click', () => {
  document.getElementById('pomodoroCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ---------- Idle / return handling ----------

function handleReturn(awayMs) {
  const awayMinutes = awayMs / 60000;
  if (awayMinutes < IDLE_THRESHOLD_MS / 60000) return;
  const cargoHours = getCargoHours();
  const cappedMinutes = Math.min(awayMinutes, cargoHours * 60);
  const multiplier = getIdleMultiplier(cappedMinutes);
  const collectorRate = getCollectorRate();
  const reactorRate = getReactorRate();
  const gainStardust = collectorRate * cappedMinutes * 60 * multiplier;
  const gainEnergy = reactorRate * cappedMinutes * 60 * multiplier * 0.7;
  addResources('stardust', gainStardust);
  addResources('energy', gainEnergy);
  state.sessionStart = Date.now();

  const cappedNote = awayMinutes > cargoHours * 60
    ? `<br><small>Capped by your ${cargoHours.toFixed(1)}h cargo range — upgrade Cargo Expansion to store more while away.</small>`
    : '';
  showModal('Welcome Back, Captain', `
    You were away for <strong>${formatDuration(awayMs)}</strong>.<br>
    Your automated probes gathered <strong>${format(gainStardust)} ✨</strong> and <strong>${format(gainEnergy)} ⚡</strong>
    (×${multiplier.toFixed(1)} idle bonus).${cappedNote}`);
  addLog(`Returned after ${formatDuration(awayMs)} — gathered ${format(gainStardust)} stardust (×${multiplier.toFixed(1)}).`);
}

// ---------- Pomodoro ----------

document.querySelectorAll('#durationSelect .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#durationSelect .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    selectedDuration = parseInt(chip.dataset.min, 10);
  });
});

function startPomodoro(minutes) {
  const now = Date.now();
  state.pomodoro = {
    active: true,
    endTime: now + minutes * 60000,
    duration: minutes,
    sessionsCompleted: state.pomodoro.sessionsCompleted
  };
  addLog(`Started a ${minutes}-minute Pomodoro. Fleet holding position.`);
  saveState();
  enterFocusUI();
}

function cancelPomodoro() {
  state.pomodoro.active = false;
  state.sessionStart = Date.now();
  addLog('Pomodoro abandoned early — no reward this time.');
  exitFocusUI();
  saveState();
}

function completePomodoroInternal() {
  const minutes = state.pomodoro.duration;
  const collectorRate = getCollectorRate();
  const reactorRate = getReactorRate();
  const crystalGain = 5 + Math.floor(minutes / 5) * 2;
  const stardustGain = collectorRate * minutes * 60 * 3;
  const energyGain = reactorRate * minutes * 60 * 2;
  addResources('stardust', stardustGain);
  addResources('energy', energyGain);
  state.resources.crystals += crystalGain;
  state.pomodoro.sessionsCompleted++;
  state.pomodoro.active = false;
  state.sessionStart = Date.now();
  addLog(`Pomodoro complete! +${format(stardustGain)}✨ +${format(energyGain)}⚡ +${crystalGain}💎 — crew fully rested.`);
  return { stardustGain, energyGain, crystalGain, minutes };
}

function completePomodoroAndNotify() {
  const r = completePomodoroInternal();
  exitFocusUI();
  showModal('Pomodoro Complete!', `
    Nice work focusing for <strong>${r.minutes} minutes</strong>.<br>
    Reward: <strong>${format(r.stardustGain)} ✨</strong>, <strong>${format(r.energyGain)} ⚡</strong>,
    <strong>${r.crystalGain} 💎</strong>.<br>Your crew is fully rested — fatigue reset.`);
  renderAll();
  saveState();
}

function enterFocusUI() {
  document.getElementById('pomodoroIdle').classList.add('hidden');
  document.getElementById('pomodoroActive').classList.remove('hidden');
  document.getElementById('focusOverlay').classList.remove('hidden');
  if (asteroidTimer) { clearTimeout(asteroidTimer); asteroidTimer = null; }
  document.querySelectorAll('.asteroid').forEach(a => a.remove());
  updateFatigueBanner();
}

function exitFocusUI() {
  document.getElementById('pomodoroIdle').classList.remove('hidden');
  document.getElementById('pomodoroActive').classList.add('hidden');
  document.getElementById('focusOverlay').classList.add('hidden');
  document.getElementById('pomodoroCount').textContent = state.pomodoro.sessionsCompleted;
  scheduleAsteroid();
}

function updatePomodoroTimerUI() {
  const remaining = Math.max(0, state.pomodoro.endTime - Date.now());
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const text = `${m}:${s.toString().padStart(2, '0')}`;
  document.getElementById('timerDisplay').textContent = text;
  document.getElementById('focusTimerBig').textContent = text;
}

document.getElementById('startPomodoro').addEventListener('click', () => startPomodoro(selectedDuration));
document.getElementById('cancelPomodoro').addEventListener('click', cancelPomodoro);
document.getElementById('cancelPomodoroBig').addEventListener('click', cancelPomodoro);

// ---------- Asteroid mining ----------

function scheduleAsteroid() {
  if (asteroidTimer) clearTimeout(asteroidTimer);
  const delay = 1200 + Math.random() * 2000;
  asteroidTimer = setTimeout(() => {
    spawnAsteroid();
    scheduleAsteroid();
  }, delay);
}

function spawnAsteroid() {
  if (state.pomodoro.active || document.hidden) return;
  const area = document.getElementById('miningArea');
  if (area.querySelectorAll('.asteroid').length >= 3) return;
  const emojis = ['🪨', '☄️', '🌑', '🛰️'];
  const el = document.createElement('div');
  el.className = 'asteroid';
  el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
  const maxX = area.clientWidth - 40;
  const maxY = area.clientHeight - 40;
  el.style.left = Math.max(0, Math.random() * maxX) + 'px';
  el.style.top = Math.max(0, Math.random() * maxY) + 'px';
  el.addEventListener('click', () => mineAsteroid(el));
  area.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 8000);
}

function mineAsteroid(el) {
  const fatigue = getFatigueMultiplier(Date.now() - state.sessionStart);
  const laser = getLaserPower() * fatigue;
  const stardustGain = laser;
  const energyGain = laser * 0.3;
  addResources('stardust', stardustGain);
  addResources('energy', energyGain);
  spawnFloatText(el, `+${format(stardustGain)}✨`);
  el.remove();
  renderResources();
  renderStats();
}

// ---------- Main tick ----------

function tick() {
  const now = Date.now();
  if (state.pomodoro.active) {
    if (now >= state.pomodoro.endTime) {
      completePomodoroAndNotify();
    } else {
      updatePomodoroTimerUI();
    }
    state.lastTick = now;
    state.lastActive = now;
    return;
  }
  const dt = Math.max(0, (now - state.lastTick) / 1000);
  const activeMs = now - state.sessionStart;
  const fatigue = getFatigueMultiplier(activeMs);
  addResources('stardust', getCollectorRate() * fatigue * dt);
  addResources('energy', getReactorRate() * fatigue * dt);
  state.lastTick = now;
  state.lastActive = now;
  renderResources();
  renderStats();
  updateFatigueBanner();
}

setInterval(tick, 1000);
setInterval(saveState, 10000);

// ---------- Visibility / lifecycle ----------

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.hiddenAt = Date.now();
    saveState();
  } else if (state.hiddenAt) {
    const awayMs = Date.now() - state.hiddenAt;
    delete state.hiddenAt;
    if (!state.pomodoro.active) {
      handleReturn(awayMs);
    } else if (Date.now() >= state.pomodoro.endTime) {
      completePomodoroAndNotify();
    }
    state.lastTick = Date.now();
    state.lastActive = Date.now();
    renderAll();
  }
});

window.addEventListener('beforeunload', saveState);

// ---------- Save export / import / reset ----------

document.getElementById('exportSave').addEventListener('click', () => {
  saveState();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `novadrift-save-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importSave').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        state = Object.assign(defaultState(), parsed);
        state.sessionStart = Date.now();
        state.lastTick = Date.now();
        state.lastActive = Date.now();
        saveState();
        renderAll();
        addLog('Save imported.');
      } catch (e) {
        alert('Could not read that save file.');
      }
    };
    reader.readAsText(file);
  });
  input.click();
});

document.getElementById('resetSave').addEventListener('click', () => {
  if (!confirm('Reset all progress? This cannot be undone.')) return;
  state = defaultState();
  saveState();
  renderAll();
  addLog('Game reset — fresh start.');
});

// ---------- Local folder sync (File System Access API) ----------

const FOLDER_DB = 'novadrift-fs';
let folderHandle = null;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FOLDER_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function folderSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

function setFolderStatus(text, linked) {
  document.getElementById('folderStatus').textContent = text;
  document.querySelector('.folder-sync').classList.toggle('linked', !!linked);
}

async function initFolderSync() {
  const linkBtn = document.getElementById('linkFolder');
  if (!folderSupported()) {
    setFolderStatus('Folder sync needs Chrome or Edge — use Export instead.', false);
    linkBtn.disabled = true;
    return;
  }
  try {
    const stored = await idbGet('dir');
    if (stored) {
      const perm = await stored.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        folderHandle = stored;
        setFolderStatus(`Linked to "${stored.name}" — syncing saves there.`, true);
        linkBtn.textContent = '🔗 Linked';
        syncToFolder();
      } else {
        setFolderStatus(`Was linked to "${stored.name}" — click to reconnect.`, false);
        linkBtn.textContent = '🔗 Reconnect Save Folder';
      }
    }
  } catch (e) {
    console.warn('Folder restore failed', e);
  }
}

document.getElementById('linkFolder').addEventListener('click', async () => {
  if (!folderSupported()) return;
  try {
    const handle = await window.showDirectoryPicker();
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { setFolderStatus('Permission denied.', false); return; }
    folderHandle = handle;
    await idbSet('dir', handle);
    document.getElementById('linkFolder').textContent = '🔗 Linked';
    setFolderStatus(`Linked to "${handle.name}" — syncing saves there.`, true);
    syncToFolder();
    addLog(`Linked local save folder: ${handle.name}`);
  } catch (e) {
    // user cancelled picker — ignore
  }
});

async function syncToFolder() {
  if (!folderHandle) return;
  try {
    const perm = await folderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;

    const saveFile = await folderHandle.getFileHandle('novadrift-save.json', { create: true });
    const saveWritable = await saveFile.createWritable();
    await saveWritable.write(JSON.stringify(state, null, 2));
    await saveWritable.close();

    const logFile = await folderHandle.getFileHandle('mission-log.txt', { create: true });
    const logWritable = await logFile.createWritable();
    const summary = [
      'NOVA DRIFT — MISSION LOG',
      `Last updated: ${new Date().toLocaleString()}`,
      `Rank: ${document.getElementById('rankLabel').textContent}`,
      `Stardust: ${format(state.resources.stardust)} | Energy: ${format(state.resources.energy)} | Crystals: ${format(state.resources.crystals)}`,
      `Planets explored: ${state.exploredPlanets.length}/${PLANETS.length}`,
      `Pomodoro sessions completed: ${state.pomodoro.sessionsCompleted}`,
      '',
      '--- Recent Activity ---',
      ...state.log
    ].join('\n');
    await logWritable.write(summary);
    await logWritable.close();
  } catch (e) {
    console.warn('Folder sync failed', e);
  }
}

// ---------- Starfield background ----------

function buildStarfield() {
  const field = document.getElementById('starfield');
  const count = 120;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2 + 0.5;
    star.style.width = size + 'px';
    star.style.height = size + 'px';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDuration = (2 + Math.random() * 4) + 's';
    star.style.animationDelay = (Math.random() * 4) + 's';
    field.appendChild(star);
  }
}

// ---------- Boot ----------

function boot() {
  buildStarfield();
  const now = Date.now();

  if (state.pomodoro.active) {
    if (now >= state.pomodoro.endTime) {
      const extra = now - state.pomodoro.endTime;
      completePomodoroInternal();
      if (extra > IDLE_THRESHOLD_MS) handleReturn(extra);
      else state.sessionStart = now;
    }
  } else {
    const awayMs = now - (state.lastActive || now);
    if (awayMs > IDLE_THRESHOLD_MS) handleReturn(awayMs);
  }
  state.lastTick = now;
  state.lastActive = now;

  renderAll();
  updateFatigueBanner();
  initFolderSync();

  if (state.pomodoro.active) {
    enterFocusUI();
    updatePomodoroTimerUI();
  } else {
    scheduleAsteroid();
  }
  saveState();
}

boot();
