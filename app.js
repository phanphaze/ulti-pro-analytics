// --- 1. INITIALIZATION & STATE ---
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

const DEFAULT_SETTINGS = {
    haptics: true,
    theme: 'dark',
    confirmDestructive: true,
    keepAwake: false,
    defaultAcquireMode: 'block'
};

let wakeLock = null;

function triggerHaptic() {
    if (!state.settings?.haptics) return;
    if (navigator.vibrate) navigator.vibrate(50);
}

function normalizeSettings() {
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
}

function applyAppSettings() {
    document.documentElement.setAttribute('data-theme', state.settings.theme === 'light' ? 'light' : 'dark');
    updateWakeLock();
}

function confirmAction(message) {
    if (!state.settings.confirmDestructive) return true;
    return confirm(message);
}

async function updateWakeLock() {
    const shouldLock = state.settings.keepAwake && possession.status === 'playing';
    if (!shouldLock) {
        if (wakeLock) {
            try { await wakeLock.release(); } catch (e) { /* ignore */ }
            wakeLock = null;
        }
        return;
    }
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* unsupported or denied */ }
}

function openSettingsModal() {
    triggerHaptic();
    document.getElementById('settings-modal').style.display = 'block';
    syncSettingsUI();
    refreshIcons(document.getElementById('settings-modal'));
}

function closeSettingsModal() {
    triggerHaptic();
    document.getElementById('settings-modal').style.display = 'none';
}

function setSetting(key, value) {
    state.settings[key] = value;
    saveData();
    applyAppSettings();
    syncSettingsUI();
    if (key === 'defaultAcquireMode' && possession.opponentHasDisc && !possession.hasDisc) {
        possession.acquireMode = value;
        if (document.getElementById('play-view').classList.contains('active')) renderPlayView();
    }
}

function toggleSetting(key) {
    setSetting(key, !state.settings[key]);
}

function setTheme(theme) {
    setSetting('theme', theme === 'light' ? 'light' : 'dark');
}

function syncSettingsUI() {
    const s = state.settings;
    const hapticEl = document.getElementById('setting-haptics');
    const confirmEl = document.getElementById('setting-confirm');
    const awakeEl = document.getElementById('setting-keep-awake');
    const acquireEl = document.getElementById('setting-acquire-mode');
    if (hapticEl) hapticEl.checked = s.haptics;
    if (confirmEl) confirmEl.checked = s.confirmDestructive;
    if (awakeEl) awakeEl.checked = s.keepAwake;
    if (acquireEl) acquireEl.value = s.defaultAcquireMode;
    document.querySelectorAll('[data-theme-choice]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-theme-choice') === s.theme);
    });
}

function icon(name, size = 18, className = '') {
    return `<i data-lucide="${name}" class="lucide-ic ${className}" style="width:${size}px;height:${size}px"></i>`;
}

function refreshIcons(root) {
    if (typeof lucide === 'undefined') return;
    lucide.createIcons({ attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' });
}

let defaultState = { 
    roster: [], tournaments: [], games: [], 
    activeTournamentId: null, activeGameId: null, nextLineType: 'O' 
};

let state = JSON.parse(localStorage.getItem('ultiProState')) || defaultState;
if (!state.nextLineType) state.nextLineType = 'O'; 
if (!state.tournaments) state.tournaments = [];
normalizeSettings();
applyAppSettings(); 

let possession = {
    status: 'setup', hasDisc: null, lastPasser: null, currentPointEvents: [],
    opponentHasDisc: false, acquireMode: 'block',
    subStep: null, subOutId: null, subTeam: 'us', pointParticipantIds: []
};
let currentViewedPlayerId = null;
let lastPlayTapId = null;
let currentTreePointId = null;
let passTimerTickInterval = null;

let passTimer = {
    active: false,
    paused: false,
    startedAt: 0,
    pausedAt: 0,
    accumulatedPause: 0
};

const PASS_TIMER_MAX_SEC = 10;

function capThrowTime(sec) {
    const n = parseFloat(sec);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(PASS_TIMER_MAX_SEC, Math.round(n * 10) / 10);
}

function formatPassTimer(sec) {
    return `${capThrowTime(sec).toFixed(1)}s`;
}

function startPassTimer() {
    passTimer.active = true;
    passTimer.paused = false;
    passTimer.startedAt = Date.now();
    passTimer.pausedAt = 0;
    passTimer.accumulatedPause = 0;
}

function stopPassTimer() {
    passTimer.active = false;
    passTimer.paused = false;
    passTimer.pausedAt = 0;
    passTimer.accumulatedPause = 0;
}

function pausePassTimer() {
    if (!passTimer.active || passTimer.paused) return;
    passTimer.paused = true;
    passTimer.pausedAt = Date.now();
}

function resumePassTimer() {
    if (!passTimer.active || !passTimer.paused) return;
    passTimer.accumulatedPause += Date.now() - passTimer.pausedAt;
    passTimer.paused = false;
    passTimer.pausedAt = 0;
}

function togglePassTimerPause() {
    triggerHaptic();
    if (passTimer.paused) resumePassTimer();
    else pausePassTimer();
    renderPlayView();
}

function getPassTimerElapsedSec() {
    if (!passTimer.active) return 0;
    let elapsed = Date.now() - passTimer.startedAt - passTimer.accumulatedPause;
    if (passTimer.paused) elapsed -= Date.now() - passTimer.pausedAt;
    return Math.max(0, elapsed / 1000);
}

function syncPassTimerAfterPossession() {
    if (possession.status === 'playing' && possession.hasDisc && !possession.subStep) startPassTimer();
    else stopPassTimer();
}

function clearPassTimerTick() {
    if (passTimerTickInterval) {
        clearInterval(passTimerTickInterval);
        passTimerTickInterval = null;
    }
}

function ensurePassTimerTick() {
    clearPassTimerTick();
    if (possession.status !== 'playing' || !possession.hasDisc || passTimer.paused) return;
    passTimerTickInterval = setInterval(() => {
        const el = document.getElementById('pass-timer-live');
        if (!el || possession.status !== 'playing' || !possession.hasDisc) {
            clearPassTimerTick();
            return;
        }
        el.textContent = formatPassTimer(getPassTimerElapsedSec());
    }, 100);
}

function getPlayerThrowTimes(playerId, games) {
    const times = [];
    games.forEach(g => {
        g.history.forEach(pt => {
            (pt.events || []).forEach(ev => {
                if (ev.type === 'Pass' && ev.from === playerId && ev.throwTime != null) times.push(ev.throwTime);
            });
        });
    });
    return times;
}

function getPlayerAvgThrowTime(playerId, games) {
    const times = getPlayerThrowTimes(playerId, games);
    if (!times.length) return null;
    return Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
}

function getAvgThrowTimeToTarget(fromId, toId, games) {
    const times = [];
    games.forEach(g => {
        g.history.forEach(pt => {
            (pt.events || []).forEach(ev => {
                if (ev.type === 'Pass' && ev.from === fromId && ev.to === toId && ev.throwTime != null) times.push(ev.throwTime);
            });
        });
    });
    if (!times.length) return null;
    return Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10;
}

function getPlayPinId() {
    if (possession.status === 'playing' && possession.hasDisc) return possession.hasDisc;
    return lastPlayTapId;
}

function isPossessionGainEvent(ev) {
    return ev && (ev.type === 'Pickup' || ev.type === 'Block' || ev.type === 'Pickup/Block');
}

function syncPossessionFromEvents() {
    let opponentHasDisc = state.nextLineType === 'D';
    let hasDisc = null;
    let lastPasser = null;
    possession.currentPointEvents.forEach(ev => {
        if (ev.type === 'Pass') { opponentHasDisc = false; hasDisc = ev.to; lastPasser = ev.from; }
        else if (isPossessionGainEvent(ev)) { opponentHasDisc = false; hasDisc = ev.player; lastPasser = null; }
        else if (ev.type === 'Turnover') { hasDisc = null; lastPasser = null; opponentHasDisc = true; }
    });
    possession.opponentHasDisc = opponentHasDisc;
    possession.hasDisc = hasDisc;
    possession.lastPasser = lastPasser;
}

function initPointPossession() {
    possession.hasDisc = null;
    possession.lastPasser = null;
    possession.opponentHasDisc = state.nextLineType === 'D';
    possession.acquireMode = state.settings.defaultAcquireMode || 'block';
    possession.subStep = null;
    possession.subOutId = null;
}

function startSubFlow(team) {
    triggerHaptic();
    if (possession.status !== 'playing') return;
    possession.subTeam = team || 'us';
    if (possession.subTeam === 'opponent') {
        logOpponentInjuryStoppage();
        return;
    }
    const bench = state.roster.filter(p => !p.active);
    if (bench.length === 0) { alert('No bench players available to sub in.'); return; }
    possession.subStep = 'pick-out';
    possession.subOutId = null;
    pausePassTimer();
    renderPlayView();
}

function cancelSubFlow() {
    possession.subStep = null;
    possession.subOutId = null;
    if (possession.hasDisc && passTimer.active) resumePassTimer();
    renderPlayView();
}

function applyMidPointSub(outId, inId) {
    const outP = state.roster.find(p => p.id === outId);
    const inP = state.roster.find(p => p.id === inId);
    if (!outP?.active || inP?.active) return;

    possession.currentPointEvents.push({ type: 'Sub', team: 'us', out: outId, in: inId, reason: 'injury', time: Date.now() });
    outP.active = false;
    inP.active = true;
    if (!possession.pointParticipantIds.includes(outId)) possession.pointParticipantIds.push(outId);
    if (!possession.pointParticipantIds.includes(inId)) possession.pointParticipantIds.push(inId);

    if (possession.hasDisc === outId) {
        possession.hasDisc = inId;
        possession.lastPasser = null;
        startPassTimer();
    } else if (possession.lastPasser === outId) {
        possession.lastPasser = null;
    }

    possession.subStep = null;
    possession.subOutId = null;
    lastPlayTapId = null;
    triggerHaptic();
    saveData();
    renderPlayView();
}

function logOpponentInjuryStoppage() {
    possession.currentPointEvents.push({ type: 'Stoppage', team: 'opponent', reason: 'injury', time: Date.now() });
    possession.subStep = null;
    possession.subOutId = null;
    triggerHaptic();
    saveData();
    renderPlayView();
}

function undoSubEvent(ev) {
    if (ev.team !== 'us') return;
    const outP = state.roster.find(p => p.id === ev.out);
    const inP = state.roster.find(p => p.id === ev.in);
    if (inP) inP.active = false;
    if (outP) outP.active = true;
    if (possession.hasDisc === ev.in) {
        possession.hasDisc = ev.out;
    }
}

// Analytics State
let builderCore = new Set();
let builderSubOut = new Set();

function saveData() { localStorage.setItem('ultiProState', JSON.stringify(state)); }

function getGameScore(game) {
    let us = 0, them = 0;
    game.history.forEach(pt => { if (pt.result === 'Won') us++; else them++; });
    return { us, them, text: `${us} - ${them}` };
}

// --- 2. ROSTER, TOURNAMENT & GAMES MANAGEMENT ---
function startNewTournament() {
    const tourneyName = prompt("Enter Tournament Name (e.g., 'State Championships'):");
    if (!tourneyName) return;
    const newTourney = { id: generateId(), name: tourneyName, date: Date.now() };
    state.tournaments.push(newTourney);
    state.activeTournamentId = newTourney.id;
    saveData(); renderSeasonView();
}

function startNewGame() {
    const gameName = prompt("Enter game name:");
    if (!gameName) return;
    
    let tId = null;
    if (state.activeTournamentId) {
        const activeT = state.tournaments.find(t => t.id === state.activeTournamentId);
        if (confirm(`Assign this game to the active tournament: '${activeT.name}'?`)) tId = state.activeTournamentId;
    }

    const newGame = { id: generateId(), name: gameName, date: Date.now(), tournamentId: tId, history: [] };
    state.games.push(newGame); state.activeGameId = newGame.id; state.nextLineType = 'O';
    possession.status = 'setup'; possession.opponentHasDisc = false; state.roster.forEach(p => p.active = false);
    saveData(); switchTab('play-view');
}

function setActiveGame(id) {
    state.activeGameId = id;
    const game = state.games.find(g => g.id === id);
    if(game.tournamentId) state.activeTournamentId = game.tournamentId;
    possession.status = 'setup'; possession.opponentHasDisc = false; state.roster.forEach(p => p.active = false);
    saveData(); switchTab('play-view');
}

function openAssignGameModal(tournamentId) {
    triggerHaptic();
    const t = state.tournaments.find(t => t.id === tournamentId);
    document.getElementById('assign-modal-title').innerText = `Add to ${t.name}`;

    const unassigned = state.games.filter(g => g.tournamentId !== tournamentId); 
    let html = '';
    if(unassigned.length === 0) {
        html = '<div style="color:#aaa; text-align:center; padding:20px;">No available games to add. Start a new game first!</div>';
    } else {
        unassigned.forEach(g => {
            const currentTName = g.tournamentId ? `Currently in: ${state.tournaments.find(t=>t.id===g.tournamentId)?.name}` : 'Standalone Game';
            html += `<div class="list-row" onclick="confirmAssignGame('${g.id}', '${tournamentId}')">
                <div class="info-block">${icon('file-text', 16)} ${g.name} <span class="info-sub">${currentTName}</span></div>
                <button class="btn btn-primary" style="width:auto; margin:0; padding:10px 20px;">Add</button></div>`;
        });
    }
    document.getElementById('assign-game-list').innerHTML = html;
    document.getElementById('assign-game-modal').style.display = 'block';
    refreshIcons(document.getElementById('assign-game-list'));
}

function confirmAssignGame(gameId, tournamentId) {
    triggerHaptic(); const game = state.games.find(g => g.id === gameId); game.tournamentId = tournamentId;
    saveData(); document.getElementById('assign-game-modal').style.display = 'none'; renderSeasonView();
}

function removeGameFromTournament(event, gameId) {
    event.stopPropagation(); triggerHaptic(); const game = state.games.find(g => g.id === gameId);
    game.tournamentId = null; saveData(); renderSeasonView();
}

function deleteGame(event, id) {
    event.stopPropagation();
    if(!confirmAction("Delete this game and all of its play history?")) {
        state.games = state.games.filter(g => g.id !== id);
        if(state.activeGameId === id) state.activeGameId = null;
        saveData(); renderSeasonView();
    }
}

function deleteTournament(event, id) {
    event.stopPropagation();
    if(!confirmAction("Delete this tournament folder? (Games inside will be moved to 'Unassigned', NOT deleted).")) {
        state.games.forEach(g => { if(g.tournamentId === id) g.tournamentId = null; });
        state.tournaments = state.tournaments.filter(t => t.id !== id);
        if(state.activeTournamentId === id) state.activeTournamentId = null;
        saveData(); renderSeasonView();
    }
}

// --- POINT MANAGEMENT ---
function deletePoint(pointId) {
    if(!confirmAction("Are you sure you want to permanently delete this point?")) return;
    triggerHaptic();
    const game = state.games.find(g => g.id === state.activeGameId);
    game.history = game.history.filter(p => p.pointId !== pointId);
    saveData(); renderHistoryView(); renderStatsView();
}

function resumePoint(pointId) {
    triggerHaptic();
    if(!confirmAction("Edit this point? It will be removed from history and loaded into the Play tab so you can continue it or fix errors.")) return;
    
    const game = state.games.find(g => g.id === state.activeGameId);
    const pointIndex = game.history.findIndex(p => p.pointId === pointId);
    const point = game.history[pointIndex];
    game.history.splice(pointIndex, 1);
    
    state.roster.forEach(p => { p.active = false; });
    possession.pointParticipantIds = [...point.playerIds];
    state.nextLineType = point.lineType; possession.status = 'playing'; possession.currentPointEvents = [...(point.events || [])];
    const restoreIds = point.endPlayerIds?.length ? point.endPlayerIds : point.playerIds.slice(0, 7);
    restoreIds.forEach(id => {
        const p = state.roster.find(r => r.id === id);
        if (p) p.active = true;
    });
    
    if (possession.currentPointEvents.length > 0) {
        const lastEv = possession.currentPointEvents[possession.currentPointEvents.length - 1];
        if (lastEv.type === 'Goal' || lastEv.type === 'Turnover') possession.currentPointEvents.pop(); 
    }
    
    if (possession.currentPointEvents.length === 0) initPointPossession();
    else syncPossessionFromEvents();
    lastPlayTapId = null;
    syncPassTimerAfterPossession();
    saveData(); switchTab('play-view');
}

function addPlayer() {
    const num = prompt("Jersey Number:"); if (!num) return; const name = prompt("Player Name:"); if (!name) return;
    state.roster.push({ id: generateId(), num: num, name: name, active: false }); saveData(); renderRosterView();
}

function editPlayer(event, id) {
    event.stopPropagation(); const player = state.roster.find(p => p.id === id);
    const newNum = prompt("Edit Jersey:", player.num); const newName = prompt("Edit Name:", player.name);
    if (newNum && newName) { player.num = newNum; player.name = newName; saveData(); renderRosterView(); }
}

function deletePlayer(event, id) {
    event.stopPropagation();
    if(confirmAction("Remove this player? Past stats remain in old games.")) { state.roster = state.roster.filter(p => p.id !== id); saveData(); renderRosterView(); }
}

// --- 3. THE STATE MACHINE (PLAY VIEW) ---
function toggleLineType() {
    triggerHaptic(); state.nextLineType = state.nextLineType === 'O' ? 'D' : 'O'; lastPlayTapId = null; saveData(); renderPlayView();
}

function toggleFieldStatus(playerId) {
    const player = state.roster.find(p => p.id === playerId);
    const activeCount = state.roster.filter(p => p.active).length;
    if (!player.active && activeCount >= 7) { alert("Line is full!"); return; }
    player.active = !player.active;
    lastPlayTapId = playerId;
    saveData(); renderPlayView();
}

function startPoint() {
    triggerHaptic(); const activeCount = state.roster.filter(p => p.active).length;
    if (activeCount !== 7) { if(!confirm(`You only have ${activeCount} players selected. Start anyway?`)) return; }
    possession.status = 'playing'; possession.currentPointEvents = [];
    possession.pointParticipantIds = state.roster.filter(p => p.active).map(p => p.id);
    initPointPossession();
    stopPassTimer();
    lastPlayTapId = null;
    updateWakeLock();
    renderPlayView();
}

function setAcquireMode(mode) {
    triggerHaptic();
    possession.acquireMode = mode;
    renderPlayView();
}

function undoLastAction() {
    triggerHaptic();
    if (possession.currentPointEvents.length === 0) {
        possession.status = 'setup'; possession.hasDisc = null; possession.lastPasser = null; possession.opponentHasDisc = false;
        stopPassTimer();
        lastPlayTapId = null;
        renderPlayView(); return;
    }
    const removed = possession.currentPointEvents.pop();
    if (removed?.type === 'Sub') undoSubEvent(removed);
    if (possession.currentPointEvents.length === 0) initPointPossession();
    else syncPossessionFromEvents();
    lastPlayTapId = null;
    syncPassTimerAfterPossession();
    renderPlayView();
}

function tapPlayer(playerId) {
    triggerHaptic();
    if (possession.status === 'setup') { toggleFieldStatus(playerId); return; } 
    else if (possession.status === 'playing' && possession.subStep === 'pick-out') {
        const player = state.roster.find(p => p.id === playerId);
        if (!player?.active) return;
        possession.subOutId = playerId;
        possession.subStep = 'pick-in';
        renderPlayView();
    }
    else if (possession.status === 'playing' && possession.subStep === 'pick-in') {
        const player = state.roster.find(p => p.id === playerId);
        if (player?.active || !possession.subOutId) return;
        applyMidPointSub(possession.subOutId, playerId);
    }
    else if (possession.status === 'playing') {
        if (!possession.hasDisc) {
            let gainType = 'Pickup';
            if (possession.opponentHasDisc) gainType = possession.acquireMode === 'block' ? 'Block' : 'Pickup';
            possession.currentPointEvents.push({ type: gainType, player: playerId, time: Date.now() });
            possession.hasDisc = playerId; possession.lastPasser = null; possession.opponentHasDisc = false;
            startPassTimer();
        } else if (possession.hasDisc !== playerId) {
            const throwTime = capThrowTime(getPassTimerElapsedSec());
            possession.currentPointEvents.push({ type: 'Pass', from: possession.hasDisc, to: playerId, time: Date.now(), throwTime });
            possession.lastPasser = possession.hasDisc; possession.hasDisc = playerId;
            startPassTimer();
        }
        lastPlayTapId = null;
        renderPlayView();
    }
}

function handleSwipe(playerId, direction) {
    if (possession.status !== 'playing' || possession.hasDisc !== playerId) return;
    if (direction === 'right') {
        let assist = possession.lastPasser;
        if (possession.currentPointEvents.length > 0) {
            const lastEvent = possession.currentPointEvents[possession.currentPointEvents.length - 1];
            if ((lastEvent.type === 'Pass' && lastEvent.to === playerId) || (isPossessionGainEvent(lastEvent) && lastEvent.player === playerId)) {
                possession.currentPointEvents.pop();
            }
        }
        possession.currentPointEvents.push({ type: 'Goal', player: playerId, assist: assist, time: Date.now() }); savePoint('Won');
    } 
    else if (direction === 'left') {
        possession.currentPointEvents.push({ type: 'Turnover', player: playerId, time: Date.now() });
        possession.hasDisc = null; possession.lastPasser = null; possession.opponentHasDisc = true;
        stopPassTimer();
        lastPlayTapId = null;
        renderPlayView();
    }
}

function savePoint(result) {
    triggerHaptic(); const game = state.games.find(g => g.id === state.activeGameId);
    const participantIds = [...new Set(possession.pointParticipantIds.length
        ? possession.pointParticipantIds
        : state.roster.filter(p => p.active).map(p => p.id))];
    const endPlayerIds = state.roster.filter(p => p.active).map(p => p.id);
    game.history.push({
        pointId: generateId(), result: result, lineType: state.nextLineType,
        events: [...possession.currentPointEvents], playerIds: participantIds, endPlayerIds
    });
    state.nextLineType = (result === 'Won') ? 'D' : 'O';
    possession.status = 'setup'; possession.hasDisc = null; possession.lastPasser = null; possession.currentPointEvents = [];
    possession.opponentHasDisc = false;
    possession.pointParticipantIds = [];
    possession.subStep = null;
    stopPassTimer();
    lastPlayTapId = null;
    updateWakeLock();
    saveData(); renderPlayView();
    if (document.getElementById('history-view').classList.contains('active')) renderHistoryView();
    if (document.getElementById('stats-view').classList.contains('active')) renderStatsView();
}

const SWIPE_THRESHOLD = 88;
const SWIPE_MAX = 150;
const SWIPE_COMMIT_MS = 520;
const SWIPE_SNAP_MS = 340;
const SWIPE_ACTIVATE_PX = 6;

function lerpRgb(t, from, to) {
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    return `rgb(${r}, ${g}, ${b})`;
}

function canSwipeRow(row) {
    const playerId = row.getAttribute('data-id');
    return possession.status === 'playing' && !possession.subStep && possession.hasDisc === playerId && row.classList.contains('swipe-row');
}

function getSwipeRowEls(row) {
    return {
        center: row.querySelector('.swipe-center'),
        leftSide: row.querySelector('.swipe-side-left'),
        rightSide: row.querySelector('.swipe-side-right'),
        leftArrow: row.querySelector('.swipe-side-left .swipe-arrow'),
        rightArrow: row.querySelector('.swipe-side-right .swipe-arrow'),
    };
}

function resetSwipeVisual(row) {
    if (!row) return;
    row.classList.remove('swiping-left', 'swiping-right', 'swipe-commit-left', 'swipe-commit-right', 'swipe-snap-back');
    row.style.removeProperty('background-color');
    row.style.removeProperty('transform');
    const { center, leftSide, rightSide, leftArrow, rightArrow } = getSwipeRowEls(row);
    if (center) {
        center.style.removeProperty('transform');
        center.style.removeProperty('opacity');
        center.style.removeProperty('transition');
    }
    [leftSide, rightSide].forEach(el => {
        if (!el) return;
        el.classList.remove('launching');
        el.style.removeProperty('opacity');
        el.style.removeProperty('transition');
    });
    [leftArrow, rightArrow].forEach(el => {
        if (!el) return;
        el.style.removeProperty('transform');
        el.style.removeProperty('transition');
    });
}

function rubberBandDelta(deltaX) {
    const abs = Math.abs(deltaX);
    const sign = deltaX < 0 ? -1 : 1;
    if (abs <= SWIPE_MAX) return deltaX;
    const extra = abs - SWIPE_MAX;
    return sign * (SWIPE_MAX + extra * 0.25);
}

function applySwipeNeutral(row) {
    const base = [38, 50, 56];
    const { center, leftSide, rightSide, leftArrow, rightArrow } = getSwipeRowEls(row);

    row.classList.remove('swiping-left', 'swiping-right');
    row.style.transition = 'none';
    row.style.backgroundColor = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
    if (center) {
        center.style.transform = 'translateX(0)';
        center.style.opacity = '1';
    }
    if (leftSide) leftSide.style.opacity = '';
    if (rightSide) rightSide.style.opacity = '';
    if (leftArrow) leftArrow.style.transform = 'scale(1)';
    if (rightArrow) rightArrow.style.transform = 'scale(1)';
}

function updateSwipeVisual(row, deltaX) {
    const bandX = rubberBandDelta(deltaX);
    const abs = Math.abs(bandX);
    const progress = Math.min(1, abs / SWIPE_MAX);
    const { center, leftSide, rightSide, leftArrow, rightArrow } = getSwipeRowEls(row);
    const base = [38, 50, 56];

    row.style.transition = 'none';

    if (abs < 4) {
        applySwipeNeutral(row);
        return;
    }

    const arrowScale = 1 + progress * 1.35;
    const slideX = bandX * 0.55;

    if (bandX < 0) {
        row.classList.add('swiping-left');
        row.classList.remove('swiping-right');
        row.style.backgroundColor = lerpRgb(progress, base, [198, 40, 40]);
        if (center) center.style.transform = `translateX(${slideX}px)`;
        if (leftArrow) leftArrow.style.transform = `scale(${arrowScale})`;
        if (rightArrow) rightArrow.style.transform = 'scale(1)';
        if (leftSide) leftSide.style.opacity = String(0.5 + progress * 0.5);
        if (rightSide) rightSide.style.opacity = String(Math.max(0.25, 0.5 - progress * 0.35));
    } else {
        row.classList.add('swiping-right');
        row.classList.remove('swiping-left');
        row.style.backgroundColor = lerpRgb(progress, base, [46, 125, 50]);
        if (center) center.style.transform = `translateX(${slideX}px)`;
        if (rightArrow) rightArrow.style.transform = `scale(${arrowScale})`;
        if (leftArrow) leftArrow.style.transform = 'scale(1)';
        if (rightSide) rightSide.style.opacity = String(0.5 + progress * 0.5);
        if (leftSide) leftSide.style.opacity = String(Math.max(0.25, 0.5 - progress * 0.35));
    }
}

function snapBackSwipe(row, onDone) {
    row.classList.add('swipe-snap-back');
    row.classList.remove('swiping-left', 'swiping-right');
    const { center, leftSide, rightSide, leftArrow, rightArrow } = getSwipeRowEls(row);
    const snapEase = 'cubic-bezier(0.34, 1.25, 0.64, 1)';

    row.style.transition = `background-color ${SWIPE_SNAP_MS}ms ease`;
    row.style.removeProperty('background-color');
    if (center) {
        center.style.transition = `transform ${SWIPE_SNAP_MS}ms ${snapEase}`;
        center.style.transform = 'translateX(0)';
    }
    [leftSide, rightSide].forEach(el => {
        if (!el) return;
        el.style.transition = `opacity ${SWIPE_SNAP_MS * 0.85}ms ease`;
        el.style.opacity = '';
    });
    [leftArrow, rightArrow].forEach(el => {
        if (!el) return;
        el.style.transition = `transform ${SWIPE_SNAP_MS}ms ${snapEase}`;
        el.style.transform = 'scale(1)';
    });

    setTimeout(() => {
        row.classList.remove('swipe-snap-back');
        resetSwipeVisual(row);
        if (onDone) onDone();
    }, SWIPE_SNAP_MS);
}

function shouldCancelSwipe(deltaX, velocityX) {
    if (Math.abs(deltaX) < SWIPE_THRESHOLD * 0.45) return true;
    if (deltaX < -20 && velocityX > 0.45) return true;
    if (deltaX > 20 && velocityX < -0.45) return true;
    return false;
}

function shouldCommitSwipe(deltaX, velocityX) {
    if (shouldCancelSwipe(deltaX, velocityX)) return null;
    if (deltaX <= -SWIPE_THRESHOLD || (deltaX < -50 && velocityX < -0.6)) return 'left';
    if (deltaX >= SWIPE_THRESHOLD || (deltaX > 50 && velocityX > 0.6)) return 'right';
    return null;
}

function commitSwipeAnimation(row, direction, onDone) {
    const { center, leftSide, rightSide, leftArrow, rightArrow } = getSwipeRowEls(row);
    const launchSide = direction === 'left' ? leftSide : rightSide;
    const idleSide = direction === 'left' ? rightSide : leftSide;

    row.classList.remove('swiping-left', 'swiping-right');
    row.classList.add(direction === 'left' ? 'swipe-commit-left' : 'swipe-commit-right');
    if (center) center.style.opacity = '0';
    if (idleSide) idleSide.style.opacity = '0';
    [leftArrow, rightArrow].forEach(el => {
        if (!el) return;
        el.style.transition = 'none';
        el.style.removeProperty('transform');
    });
    if (launchSide) launchSide.classList.add('launching');
    triggerHaptic();
    setTimeout(() => { resetSwipeVisual(row); onDone(); }, SWIPE_COMMIT_MS);
}

function bindGestures() {
    const rows = document.querySelectorAll('.list-row');
    rows.forEach(row => {
        let startX = 0;
        let tracking = false;
        let swipeActive = false;
        let lastMoveX = 0;
        let lastMoveT = 0;
        let velocityX = 0;
        let snapping = false;

        row.addEventListener('touchstart', e => {
            if (snapping) return;
            startX = e.touches[0].clientX;
            lastMoveX = startX;
            lastMoveT = performance.now();
            velocityX = 0;
            tracking = true;
            swipeActive = false;
        }, { passive: true });

        row.addEventListener('touchmove', e => {
            if (!tracking || snapping) return;
            const clientX = e.touches[0].clientX;
            const now = performance.now();
            const dt = now - lastMoveT;
            if (dt > 0) velocityX = (clientX - lastMoveX) / dt;
            lastMoveX = clientX;
            lastMoveT = now;

            const deltaX = clientX - startX;
            if (canSwipeRow(row)) {
                if (Math.abs(deltaX) > SWIPE_ACTIVATE_PX) {
                    swipeActive = true;
                    e.preventDefault();
                }
                updateSwipeVisual(row, deltaX);
            }
        }, { passive: false });

        const finish = (clientX) => {
            if (!tracking || snapping) return;
            tracking = false;
            const deltaX = clientX - startX;
            const playerId = row.getAttribute('data-id');

            if (canSwipeRow(row) && swipeActive) {
                const commitDir = shouldCommitSwipe(deltaX, velocityX);
                if (commitDir === 'left') {
                    commitSwipeAnimation(row, 'left', () => handleSwipe(playerId, 'left'));
                    return;
                }
                if (commitDir === 'right') {
                    commitSwipeAnimation(row, 'right', () => handleSwipe(playerId, 'right'));
                    return;
                }
                snapping = true;
                snapBackSwipe(row, () => { snapping = false; swipeActive = false; });
                return;
            }

            resetSwipeVisual(row);
            if (Math.abs(deltaX) < 12 && Math.abs(velocityX) < 0.8) tapPlayer(playerId);
        };

        row.addEventListener('touchend', e => finish(e.changedTouches[0].clientX), { passive: true });
        row.addEventListener('touchcancel', () => {
            tracking = false;
            swipeActive = false;
            snapping = false;
            snapBackSwipe(row);
        }, { passive: true });
    });
}

// --- 4. FILE I/O ---
function exportData() {
    triggerHaptic();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const anchor = document.createElement('a'); anchor.setAttribute("href", dataStr); anchor.setAttribute("download", "ulti_data_export.json"); anchor.click();
}

function importData(event) {
    const file = event.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = function(e) {
        state = JSON.parse(e.target.result);
        normalizeSettings();
        saveData();
        alert('Backup restored successfully.');
        location.reload();
    };
    reader.readAsText(file);
}

function parseCSV(text) {
    let lines = []; let row = [""]; let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        let c = text[i]; let next = text[i+1];
        if (c === '"') { if (inQuotes && next === '"') { row[row.length - 1] += '"'; i++; } else { inQuotes = !inQuotes; } } 
        else if (c === ',' && !inQuotes) { row.push(''); } 
        else if ((c === '\r' || c === '\n') && !inQuotes) { if (c === '\r' && next === '\n') { i++; } lines.push(row); row = ['']; } 
        else { row[row.length - 1] += c; }
    }
    if (row.length > 1 || row[0] !== '') lines.push(row); return lines;
}

function importRosterCSV(event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = function(e) {
        const rows = parseCSV(e.target.result); let headerRowIdx = -1;
        for (let i = 0; i < rows.length; i++) { if (rows[i][0] && rows[i][0].trim().toUpperCase() === 'NUMBER') { headerRowIdx = i; break; } }
        if (headerRowIdx === -1) { alert("Could not find the 'NUMBER' column."); return; }

        let added = 0; let updated = 0;
        for (let i = headerRowIdx + 1; i < rows.length; i++) {
            const row = rows[i]; if (row.length < 4 || !row[0].trim() || !row[1].trim()) continue;
            const num = row[0].trim(); const fullName = `${row[1].trim()} ${row[2].trim()}`; const grade = row[3].trim();
            let existingPlayer = state.roster.find(p => p.name.toLowerCase() === fullName.toLowerCase());
            if (existingPlayer) { existingPlayer.num = num; existingPlayer.grade = grade; updated++; } 
            else { state.roster.push({ id: generateId(), num: num, name: fullName, grade: grade, active: false }); added++; }
        }
        saveData(); alert(`Varsity Roster Imported!\nAdded: ${added}\nUpdated: ${updated}`); location.reload(); 
    }; reader.readAsText(file);
}

function importCSVData(event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = function(e) {
        const rows = parseCSV(e.target.result); if (rows.length < 2) { alert("Empty or malformed CSV."); return; }
        let gamesMap = {};
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i]; if (row.length < 6 || !row[0]) continue; const gameName = row[0].trim();
            if (!gamesMap[gameName]) { gamesMap[gameName] = { id: generateId(), name: gameName, date: Date.parse(row[1].trim()) || Date.now(), history: [] }; }
            const playerIds = row[5].trim().split(';').map(n => n.trim()).filter(n => n.length > 0).map(name => {
                let p = state.roster.find(r => r.name.toLowerCase() === name.toLowerCase());
                if (!p) { p = { id: generateId(), num: "??", name: name, active: false }; state.roster.push(p); } return p.id;
            });
            gamesMap[gameName].history.push({ pointId: generateId(), timestamp: Date.now(), lineType: row[3].trim(), result: row[4].trim(), events: [], playerIds: playerIds });
        }
        Object.values(gamesMap).forEach(game => state.games.push(game)); saveData();
        alert('CSV successfully parsed! Games have been added as Unassigned Standalone games.'); location.reload();
    }; reader.readAsText(file);
}

function clearAllData() {
    if (!confirmAction('This permanently deletes all games, rosters, and settings on this device.')) return;
    if (prompt("Type DELETE to confirm:") !== 'DELETE') return;
    localStorage.removeItem('ultiProState');
    location.reload();
}

// --- 5. THE ANALYTICS ENGINE (SYNERGY & LINEUP ASSISTANT) ---
function setAnalyticsMode(mode) {
    triggerHaptic();
    document.getElementById('tab-assistant').classList.remove('active');
    document.getElementById('tab-raw').classList.remove('active');
    document.getElementById(`tab-${mode}`).classList.add('active');
    
    document.getElementById('pane-assistant').style.display = mode === 'assistant' ? 'block' : 'none';
    document.getElementById('pane-raw').style.display = mode === 'raw' ? 'block' : 'none';
    
    if (mode === 'assistant') renderAnalyticsBuilder();
}

function toggleBuilderPlayer(playerId) {
    triggerHaptic();
    const mode = document.getElementById('assistant-mode').value;
    
    if (mode === 'fill') {
        if (builderCore.has(playerId)) builderCore.delete(playerId);
        else {
            if (builderCore.size >= 6) { alert("You can only select up to 6 core players."); return; }
            builderCore.add(playerId);
        }
    } else { // 'replace' mode
        if (builderSubOut.has(playerId)) builderSubOut.delete(playerId);
        else {
            if (!builderCore.has(playerId)) {
                if (builderCore.size >= 7) { alert("Core is full. To sub out, click an already selected player."); return; }
                builderCore.add(playerId);
            } else {
                builderSubOut.add(playerId); // Mark to sub out
            }
        }
    }
    renderAnalyticsBuilder();
}

function renderAnalyticsBuilder() {
    const container = document.getElementById('builder-roster');
    const mode = document.getElementById('assistant-mode').value;
    
    // Clear subOuts if switching back to fill mode
    if (mode === 'fill' && builderSubOut.size > 0) builderSubOut.clear();

    let html = '';
    const sorted = [...state.roster].sort((a,b) => parseInt(a.num) - parseInt(b.num));
    sorted.forEach(p => {
        let classes = 'builder-tag ';
        if (builderCore.has(p.id)) {
            if (mode === 'replace' && builderSubOut.has(p.id)) classes += 'sub-out';
            else classes += 'selected';
        }
        html += `<div class="${classes}" onclick="toggleBuilderPlayer('${p.id}')">#${p.num} ${p.name.split(' ')[0]} ${roleBadgeHtml(p.id, state.games)}</div>`;
    });
    container.innerHTML = html;
    refreshIcons(container);
}

function runLineupSuggestions() {
    triggerHaptic();
    const container = document.getElementById('assistant-results');
    const mode = document.getElementById('assistant-mode').value;
    
    let activeCore = new Set(builderCore);

    if (mode === 'fill') {
        if (activeCore.size === 0) { container.innerHTML = `<div style="color:var(--danger); text-align:center;">Select 2 to 6 players to find completions.</div>`; return; }
    } else { // replace
        if (activeCore.size !== 7) { container.innerHTML = `<div style="color:var(--danger); text-align:center;">Select exactly 7 players first.</div>`; return; }
        if (builderSubOut.size === 0) { container.innerHTML = `<div style="color:var(--danger); text-align:center;">Tap selected players to sub them out.</div>`; return; }
        // Remove sub-outs from active core evaluation
        builderSubOut.forEach(id => activeCore.delete(id));
    }

    // Mathematical Engine: Calculate Pairwise Scores with Margin Discounting
    let pairStats = {};
    const ALPHA = 2; // Bayesian smoothing constant
    state.games.forEach(game => {
        let currentUs = 0; let currentThem = 0;
        game.history.forEach(pt => {
            const diff = Math.max(0, currentUs - currentThem);
            const marginDiscountWeight = pt.result === 'Won' ? Math.exp(-0.15 * diff) : 0; 
            
            for (let i = 0; i < pt.playerIds.length; i++) {
                for (let j = i + 1; j < pt.playerIds.length; j++) {
                    const key = [pt.playerIds[i], pt.playerIds[j]].sort().join('|');
                    if (!pairStats[key]) pairStats[key] = { played: 0, weightedWins: 0 };
                    pairStats[key].played++; pairStats[key].weightedWins += marginDiscountWeight;
                }
            }
            if (pt.result === 'Won') currentUs++; else currentThem++;
        });
    });

    const selectedArray = Array.from(activeCore);
    const excludedSet = mode === 'replace' ? new Set([...activeCore, ...builderSubOut]) : activeCore;
    const candidates = state.roster.filter(p => !excludedSet.has(p.id));

    const blocksByPlayer = {};
    state.games.forEach(game => {
        game.history.forEach(pt => {
            if (!pt.events) return;
            pt.events.forEach(ev => {
                if (ev.type === 'Block') blocksByPlayer[ev.player] = (blocksByPlayer[ev.player] || 0) + 1;
            });
        });
    });
    
    let rankings = candidates.map(candidate => {
        let totalPlayed = 0; let totalWeightedWins = 0;
        selectedArray.forEach(selId => {
            const key = [candidate.id, selId].sort().join('|');
            if (pairStats[key]) { totalPlayed += pairStats[key].played; totalWeightedWins += pairStats[key].weightedWins; }
        });
        const compositeScore = (totalWeightedWins + (ALPHA * 0.5)) / (totalPlayed + ALPHA);
        const blockBonus = (blocksByPlayer[candidate.id] || 0) * 0.03;
        return { player: candidate, score: compositeScore + blockBonus, played: totalPlayed, blocks: blocksByPlayer[candidate.id] || 0 };
    }).filter(r => r.played > 0).sort((a,b) => b.score - a.score);

    if (rankings.length === 0) { container.innerHTML = `<div style="color:var(--text-muted); text-align:center;">Not enough data for this combination.</div>`; return; }

    const numToSuggest = mode === 'fill' ? (7 - activeCore.size) : builderSubOut.size;
    let html = `<h4>Top Suggested Replacements</h4>`;
    
    for (let i = 0; i < rankings.length && i < numToSuggest + 2; i++) {
        const r = rankings[i];
        let tierClass = 'tier-B'; let tierLetter = 'B';
        if (i === 0) { tierClass = 'tier-S'; tierLetter = 'S'; }
        else if (i < numToSuggest) { tierClass = 'tier-A'; tierLetter = 'A'; }

        html += `
            <div class="tier-row">
                <div class="tier-badge ${tierClass}">${tierLetter}</div>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:16px;">#${r.player.num} ${r.player.name}</div>
                    <div style="font-size:12px; color:var(--text-muted);">Synergy: ${(r.score * 100).toFixed(1)}${r.blocks ? ` · ${r.blocks} blocks` : ''}</div>
                </div>
            </div>`;
    }
    container.innerHTML = html;
}

// Data-Miner: "Active Touch" Group Synergy
function getCombinations(arr, size) {
    let result = [];
    function combine(start, currentCombo) {
        if (currentCombo.length === size) { result.push([...currentCombo]); return; }
        for (let i = start; i < arr.length; i++) { currentCombo.push(arr[i]); combine(i + 1, currentCombo); currentCombo.pop(); }
    }
    combine(0, []); return result;
}

function runRawSynergy() {
    triggerHaptic();
    const container = document.getElementById('raw-results');
    const N = parseInt(document.getElementById('raw-size').value);
    
    let groupStats = {}; // key: "id1,id2..." -> {ids, activePoints, won, passes, assists}

    state.games.forEach(game => {
        game.history.forEach(pt => {
            if (!pt.events) return;
            // 1. Map who interacted with whom
            let interactions = new Set();
            let passCountMap = {}; // Pairwise passes
            let assistCountMap = {};
            
            pt.events.forEach(ev => {
                if (ev.type === 'Pass') {
                    interactions.add(ev.from); interactions.add(ev.to);
                    const pairKey = [ev.from, ev.to].sort().join(',');
                    passCountMap[pairKey] = (passCountMap[pairKey] || 0) + 1;
                } else if (ev.type === 'Goal') {
                    interactions.add(ev.player);
                    if (ev.assist) {
                        interactions.add(ev.assist);
                        const pairKey = [ev.player, ev.assist].sort().join(',');
                        assistCountMap[pairKey] = (assistCountMap[pairKey] || 0) + 1;
                    }
                } else if (isPossessionGainEvent(ev)) {
                    interactions.add(ev.player);
                }
            });

            // 2. Evaluate subsets. A subset ONLY gets credit if ALL members had an active touch/interaction on that point.
            if (pt.playerIds.length >= N) {
                const subsets = getCombinations(pt.playerIds.sort(), N);
                subsets.forEach(subset => {
                    // Check if all members had an active touch
                    let allActive = subset.every(id => interactions.has(id));
                    if (!allActive) return; // Skip ghost subsets!

                    const key = subset.join(',');
                    if (!groupStats[key]) groupStats[key] = { ids: subset, points: 0, won: 0, passes: 0, assists: 0 };
                    
                    groupStats[key].points++;
                    if (pt.result === 'Won') groupStats[key].won++;
                    
                    // Sum internal subset passes/assists
                    for(let i=0; i<subset.length; i++) {
                        for(let j=i+1; j<subset.length; j++) {
                            const pairKey = [subset[i], subset[j]].sort().join(',');
                            if(passCountMap[pairKey]) groupStats[key].passes += passCountMap[pairKey];
                            if(assistCountMap[pairKey]) groupStats[key].assists += assistCountMap[pairKey];
                        }
                    }
                });
            }
        });
    });

    const results = Object.values(groupStats)
        .filter(g => g.points >= 2) // Min threshold
        .sort((a,b) => {
            const winA = a.won/a.points; const winB = b.won/b.points;
            if (winB !== winA) return winB - winA;
            return b.passes - a.passes;
        }).slice(0, 15);

    if (results.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); text-align:center;">No ${N}-person combinations found that actively touched the disc together across multiple points.</div>`;
        return;
    }

    let html = '';
    results.forEach(r => {
        const names = r.ids.map(id => state.roster.find(p => p.id === id)?.name.split(' ')[0] || '?').join(', ');
        const winPct = ((r.won / r.points) * 100).toFixed(0);
        let color = 'var(--primary)'; if(winPct < 50) color = 'var(--danger)'; else if (winPct < 60) color = 'var(--warning)';

        html += `
            <div style="background:var(--surface); padding:12px; border-radius:8px; margin-bottom:8px; border-left:4px solid ${color};">
                <div style="font-weight:bold; font-size:15px; margin-bottom:5px;">${names}</div>
                <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted);">
                    <span>${r.won}W / ${r.points}Pts (<span style="color:${color}; font-weight:bold;">${winPct}%</span>)</span>
                    <span>Passes: ${r.passes} | Assists: ${r.assists}</span>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

// --- PLAY VIEW: SMART PLAYER ORDERING ---
function getPlaySortGames() {
    if (!state.activeGameId) return state.games.map(g => ({ game: g, weight: 1 }));
    const active = state.games.find(g => g.id === state.activeGameId);
    const weighted = [];
    if (active) weighted.push({ game: active, weight: 2 });
    state.games.filter(g => g.id !== state.activeGameId).forEach(g => weighted.push({ game: g, weight: 1 }));
    return weighted;
}

function pairKey(a, b) { return [a, b].sort().join('|'); }

function applyEventToPlayCache(cache, ev, w) {
    const touch = (id) => { cache.touchesByPlayer[id] = (cache.touchesByPlayer[id] || 0) + w; };
    if (ev.type === 'Pass') {
        touch(ev.from); touch(ev.to);
        cache.pairPasses[pairKey(ev.from, ev.to)] = (cache.pairPasses[pairKey(ev.from, ev.to)] || 0) + w;
    } else if (ev.type === 'Goal') {
        touch(ev.player);
        if (ev.assist) {
            touch(ev.assist);
            cache.pairPasses[pairKey(ev.player, ev.assist)] = (cache.pairPasses[pairKey(ev.player, ev.assist)] || 0) + w;
        }
    } else if (ev.type === 'Block') {
        touch(ev.player);
        cache.blocksByPlayer[ev.player] = (cache.blocksByPlayer[ev.player] || 0) + w;
    } else if (ev.type === 'Pickup' || ev.type === 'Pickup/Block') {
        touch(ev.player);
    } else if (ev.type === 'Turnover') {
        touch(ev.player);
    }
}

function recordLivePointEvent(cache, ev) {
    applyEventToPlayCache(cache, ev, 1);
}

function buildPlaySortCache(lineType, liveEvents) {
    const cache = { pointsByPlayer: {}, touchesByPlayer: {}, blocksByPlayer: {}, pairPlayed: {}, pairPasses: {} };
    state.roster.forEach(p => {
        cache.pointsByPlayer[p.id] = 0;
        cache.touchesByPlayer[p.id] = 0;
        cache.blocksByPlayer[p.id] = 0;
    });

    getPlaySortGames().forEach(({ game, weight }) => {
        game.history.forEach(pt => {
            if (pt.lineType !== lineType) return;
            pt.playerIds.forEach(id => { cache.pointsByPlayer[id] = (cache.pointsByPlayer[id] || 0) + weight; });
            for (let i = 0; i < pt.playerIds.length; i++) {
                for (let j = i + 1; j < pt.playerIds.length; j++) {
                    const k = pairKey(pt.playerIds[i], pt.playerIds[j]);
                    cache.pairPlayed[k] = (cache.pairPlayed[k] || 0) + weight;
                }
            }
            if (pt.events) pt.events.forEach(ev => applyEventToPlayCache(cache, ev, weight));
        });
    });

    if (liveEvents) liveEvents.forEach(ev => recordLivePointEvent(cache, ev));
    return cache;
}

function getLineupSortScore(playerId, selectedIds, cache, lineType) {
    const points = cache.pointsByPlayer[playerId] || 0;
    const touches = cache.touchesByPlayer[playerId] || 0;
    const blocks = cache.blocksByPlayer[playerId] || 0;
    let synergy = 0;
    if (selectedIds.length > 0) {
        selectedIds.forEach(sid => { synergy += cache.pairPlayed[pairKey(playerId, sid)] || 0; });
        synergy /= selectedIds.length;
    }
    if (lineType === 'D') return points * 3 + synergy * 4 + touches * 1.5 + blocks * 6;
    return points * 3 + synergy * 4 + touches * 2;
}

function getPassSortScore(playerId, passerId, cache) {
    if (!passerId || playerId === passerId) return cache.touchesByPlayer[playerId] || 0;
    const touches = cache.touchesByPlayer[playerId] || 0;
    const connection = cache.pairPasses[pairKey(playerId, passerId)] || 0;
    return touches * 2 + connection * 5;
}

function sortPlayPlayers(players, scoreFn) {
    return [...players].sort((a, b) => {
        const diff = scoreFn(b.id) - scoreFn(a.id);
        if (diff !== 0) return diff;
        return parseInt(a.num) - parseInt(b.num);
    });
}

function getPlayerLineSplit(playerId, games) {
    let oPts = 0, dPts = 0;
    games.forEach(g => {
        g.history.forEach(pt => {
            if (!pt.playerIds.includes(playerId)) return;
            if (pt.lineType === 'O') oPts++; else dPts++;
        });
    });
    return { oPts, dPts, total: oPts + dPts };
}

function getPlayerRole(playerId, games) {
    const { oPts, dPts, total } = getPlayerLineSplit(playerId, games);
    if (total < 3) return null;
    const oShare = oPts / total;
    if (oShare >= 0.65) return { label: 'O', title: `Offense (${oPts}O / ${dPts}D pts)`, className: 'role-o' };
    if (oShare <= 0.35) return { label: 'D', title: `Defense (${oPts}O / ${dPts}D pts)`, className: 'role-d' };
    return { label: 'N', title: `Neutral (${oPts}O / ${dPts}D pts)`, className: 'role-n' };
}

function roleBadgeHtml(playerId, games) {
    const role = getPlayerRole(playerId, games);
    if (!role) return '';
    return `<span class="role-badge ${role.className}" title="${role.title}">${role.label}</span>`;
}

function pinPlayerToTop(sorted, pinId) {
    if (!pinId) return sorted;
    const idx = sorted.findIndex(p => p.id === pinId);
    if (idx <= 0) return sorted;
    return [sorted[idx], ...sorted.slice(0, idx), ...sorted.slice(idx + 1)];
}

function renderSwipePlayerRow(p, extraClass, roleGames) {
    const isDiscHolder = possession.hasDisc === p.id;
    if (!isDiscHolder) {
        return `<div class="list-row on-field ${extraClass}" data-id="${p.id}"><div class="info-block"><span>#${p.num} ${p.name} ${roleBadgeHtml(p.id, roleGames)}</span></div></div>`;
    }
    return `<div class="list-row swipe-row on-field ${extraClass}" data-id="${p.id}">
        <div class="swipe-side swipe-side-left">
            <span class="swipe-arrow">${icon('arrow-left', 26)}</span>
            <span class="swipe-side-label">turnover</span>
        </div>
        <div class="swipe-center">
            <span class="swipe-player-name">#${p.num} ${p.name} ${roleBadgeHtml(p.id, roleGames)}</span>
        </div>
        <div class="swipe-side swipe-side-right">
            <span class="swipe-side-label">goal</span>
            <span class="swipe-arrow">${icon('arrow-right', 26)}</span>
        </div>
    </div>`;
}

function getConsecutiveOnFieldStreak(playerId, game) {
    if (!game || !game.history.length) return 0;
    let streak = 0;
    for (let i = game.history.length - 1; i >= 0; i--) {
        if (game.history[i].playerIds.includes(playerId)) streak++;
        else break;
    }
    return streak;
}

function getStreakColor(streak) {
    if (streak <= 0) return 'var(--text-muted)';
    if (streak <= 2) return 'var(--primary)';
    if (streak === 3) return 'var(--warning)';
    return 'var(--danger)';
}

function getStreakClass(streak) {
    if (streak <= 0) return 'streak-none';
    if (streak <= 2) return 'streak-green';
    if (streak === 3) return 'streak-orange';
    return 'streak-red';
}

function renderOnFieldStreakSection(game) {
    if (!game) return '';
    const rows = state.roster.map(p => ({
        ...p,
        streak: getConsecutiveOnFieldStreak(p.id, game)
    })).filter(p => p.streak > 0).sort((a, b) => b.streak - a.streak);

    let html = `<h3>Consecutive Points On Field <span style="font-weight:normal; font-size:12px; color:var(--text-muted);">(this game)</span></h3>`;
    html += `<div class="streak-panel">`;
    if (rows.length === 0) {
        html += `<div class="stat-line" style="padding:12px; color:#aaa;">No active streaks yet — subs reset when a player sits a point.</div>`;
    } else {
        rows.forEach(p => {
            html += `<div class="stat-line streak-line">
                <span>#${p.num} ${p.name}</span>
                <strong class="streak-count ${getStreakClass(p.streak)}" style="color:${getStreakColor(p.streak)}">${p.streak}</strong>
            </div>`;
        });
    }
    html += `</div>`;
    return html;
}

function getPlayBannerText() {
    if (possession.subStep === 'pick-out') return 'Sub: tap the injured player coming OFF the field.';
    if (possession.subStep === 'pick-in') {
        const outP = state.roster.find(p => p.id === possession.subOutId);
        return `Sub: tap bench player replacing #${outP?.num || '?'}.`;
    }
    if (possession.hasDisc) return 'Pass: tap another player.';
    if (possession.opponentHasDisc) {
        return possession.acquireMode === 'block'
            ? 'They have the disc — tap who got the BLOCK.'
            : 'They have the disc — tap who PICKED IT UP after their turn.';
    }
    return 'Tap player who gains possession (pull / first touch).';
}

function getPlayBannerClass() {
    if (possession.subStep) return 'state-sub';
    if (possession.hasDisc) return 'state-we-disc';
    if (possession.opponentHasDisc) return 'state-they-disc';
    return 'state-neutral';
}

// --- 6. VIEW RENDERING ---
function renderPlayView() {
    const container = document.getElementById('play-content');
    if (!state.activeGameId) { container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">Go to the Season tab to start a new game.</div>'; return; }

    let html = '';
    if (possession.status === 'setup') {
        const activeCount = state.roster.filter(p => p.active).length;
        html += `
            <div class="slider-toggle ${state.nextLineType === 'D' ? 'is-d' : ''}" onclick="toggleLineType()">
                <div class="slider-bg"></div>
                <div class="slider-label">O-Line (Offense)</div>
                <div class="slider-label">D-Line (Defense)</div>
            </div>
            <button class="btn btn-primary btn-start-point" onclick="startPoint()">${icon('play', 18)} Start Point (${activeCount}/7)</button>`;
    } else {
        const toolbarSub = possession.subStep ? ' play-toolbar-sub' : '';
        html += `<div class="play-active-chrome">
                 <div class="play-toolbar${toolbarSub}">
                    <button type="button" class="btn-icon btn-undo" onclick="undoLastAction()" title="Undo" aria-label="Undo">${icon('undo-2', 18)}</button>
                    <button type="button" class="btn btn-sm btn-danger" onclick="savePoint('Lost')">${icon('circle-minus', 16)} They Scored</button>
                    ${possession.subStep ? '' : `<button type="button" class="btn btn-sm btn-info" onclick="startSubFlow('us')">${icon('user-plus', 16)} Our Sub</button>`}
                 </div>
                 ${possession.subStep ? `<button type="button" class="btn btn-sm btn-secondary play-cancel-sub" onclick="cancelSubFlow()">${icon('x', 16)} Cancel Sub</button>` : ''}
                 <div class="state-banner ${getPlayBannerClass()}">
                    <span class="state-banner-text">${getPlayBannerText()}</span>
                    ${possession.hasDisc && !possession.subStep ? `
                    <div class="pass-timer-bar">
                        <span id="pass-timer-live" class="pass-timer-display">${formatPassTimer(getPassTimerElapsedSec())}</span>
                        <button type="button" class="pass-timer-btn ${passTimer.paused ? 'paused' : ''}" onclick="togglePassTimerPause()">
                            ${passTimer.paused ? icon('play', 14) + ' Resume' : icon('pause', 14) + ' Pause'}
                        </button>
                    </div>` : ''}
                 </div>
                 ${!possession.hasDisc && possession.opponentHasDisc ? `
                 <div class="acquire-bar">
                    <button type="button" class="acquire-btn ${possession.acquireMode === 'block' ? 'active' : ''}" onclick="setAcquireMode('block')">${icon('shield', 16)} Block</button>
                    <button type="button" class="acquire-btn ${possession.acquireMode === 'pickup' ? 'active' : ''}" onclick="setAcquireMode('pickup')">${icon('hand', 16)} Pickup</button>
                 </div>` : ''}
                 </div>`;
    }

    const lineType = state.nextLineType;
    const roleGames = getPlaySortGames().map(x => x.game);
    const selectedIds = state.roster.filter(p => p.active).map(p => p.id);
    const sortCache = buildPlaySortCache(lineType, possession.status === 'playing' ? possession.currentPointEvents : null);

    let onFieldPlayers = state.roster.filter(p => p.active);
    let benchPlayers = state.roster.filter(p => !p.active);

    if (possession.status === 'setup') {
        const lineupScore = (id) => getLineupSortScore(id, selectedIds, sortCache, lineType);
        const pinId = getPlayPinId();
        onFieldPlayers = pinPlayerToTop(sortPlayPlayers(onFieldPlayers, lineupScore), pinId);
        benchPlayers = pinPlayerToTop(sortPlayPlayers(benchPlayers, lineupScore), pinId);
    } else {
        const passScore = (id) => possession.hasDisc
            ? getPassSortScore(id, possession.hasDisc, sortCache)
            : getLineupSortScore(id, selectedIds, sortCache, lineType);
        onFieldPlayers = pinPlayerToTop(sortPlayPlayers(onFieldPlayers, passScore), getPlayPinId());
    }

    html += `<h3>On Field</h3><div id="active-players">`;
    onFieldPlayers.forEach(p => {
        let extraClass = '';
        if (possession.hasDisc === p.id) extraClass = 'has-disc';
        if (possession.lastPasser === p.id) extraClass = 'last-passer';
        if (possession.subStep === 'pick-out' && p.id === possession.subOutId) extraClass += ' sub-pick';
        html += possession.status === 'playing'
            ? renderSwipePlayerRow(p, extraClass, roleGames)
            : `<div class="list-row on-field ${extraClass}" data-id="${p.id}"><div class="info-block"><span>#${p.num} ${p.name} ${roleBadgeHtml(p.id, roleGames)}</span></div></div>`;
    });
    html += `</div>`;

    if (possession.status === 'playing' && possession.subStep === 'pick-in') {
        html += `<h3>Bench — Tap Substitute</h3><div id="sub-bench">`;
        benchPlayers = sortPlayPlayers(benchPlayers, (id) => getLineupSortScore(id, selectedIds, sortCache, lineType));
        benchPlayers.forEach(p => {
            html += `<div class="list-row sub-bench-row" data-id="${p.id}"><div class="info-block"><span>#${p.num} ${p.name} ${roleBadgeHtml(p.id, roleGames)}</span></div></div>`;
        });
        html += `</div>`;
    }
    
    if (possession.status === 'setup') {
        html += `<h3>Bench</h3><div>`;
        benchPlayers.forEach(p => {
            html += `<div class="list-row" data-id="${p.id}"><div class="info-block"><span>#${p.num} ${p.name} ${roleBadgeHtml(p.id, roleGames)}</span></div></div>`;
        });
        html += `</div>`;
    }
    container.innerHTML = html;
    bindGestures();
    refreshIcons(container);
    ensurePassTimerTick();
}

function renderStatsView() {
    const container = document.getElementById('stats-content');
    
    const scope = document.getElementById('leaderboard-scope').value;
    let relevantGames = []; let leaderTitle = '';
    
    if (scope === 'game' && state.activeGameId) { relevantGames = state.games.filter(g => g.id === state.activeGameId); leaderTitle = "Current Game Leaders"; } 
    else if (scope === 'tournament' && state.activeTournamentId) { relevantGames = state.games.filter(g => g.tournamentId === state.activeTournamentId); leaderTitle = "Tournament Leaders"; } 
    else { relevantGames = state.games; document.getElementById('leaderboard-scope').value = 'season'; leaderTitle = "Season Leaders"; }

    let html = `<h3>${leaderTitle}</h3><div style="background: var(--surface); border-radius: 8px; padding: 5px; margin-bottom: 20px;">`;
    const gameStats = state.roster.map(p => {
        let pts = 0; relevantGames.forEach(g => { pts += g.history.filter(pt => pt.playerIds.includes(p.id)).length; });
        return {...p, pts};
    }).filter(p => p.pts > 0).sort((a,b) => b.pts - a.pts);
    
    if(gameStats.length === 0) html += `<div class="stat-line" style="padding:12px; color:#aaa;">No points played in this scope yet.</div>`;
    gameStats.forEach(p => {
        const avgThrow = getPlayerAvgThrowTime(p.id, relevantGames);
        const throwSub = avgThrow != null ? ` · ${avgThrow}s avg throw` : '';
        html += `<div class="stat-line clickable" onclick="openPlayerModal('${p.id}')"><span>#${p.num} ${p.name}<span style="font-size:12px; color:var(--text-muted);">${throwSub}</span></span><strong style="color:var(--primary);">${p.pts} pts</strong></div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
    refreshIcons(container);
}

function renderHistoryView() {
    const container = document.getElementById('history-content');
    if (!state.activeGameId) {
        container.innerHTML = `<div style="text-align:center; color:#aaa; padding:20px;">Select a game in the Season tab to view point history and play diagrams.</div>`;
        return;
    }

    const game = state.games.find(g => g.id === state.activeGameId);
    let html = renderOnFieldStreakSection(game);

    const scoreText = getGameScore(game).text;
    html += `<h3>Game History: ${game.name} <span style="color:var(--warning); float:right;">Score: ${scoreText}</span></h3>`;

    if (game.history.length === 0) {
        html += `<div style="text-align:center; color:#aaa; padding:16px;">No points logged yet. Record plays in the Play tab.</div>`;
    }

    [...game.history].reverse().forEach((point, index) => {
        const isWon = point.result === 'Won'; const resultColor = isWon ? 'var(--primary)' : 'var(--danger)'; const lineStr = point.lineType === 'O' ? 'O-Line' : 'D-Line';
        const rosterNames = point.playerIds.map(id => state.roster.find(r => r.id === id)?.name || 'Unknown').join(", ");
        const subCount = (point.events || []).filter(e => e.type === 'Sub').length;
        const stoppageCount = (point.events || []).filter(e => e.type === 'Stoppage').length;
        const subNote = subCount || stoppageCount
            ? `<div style="font-size:12px; color:var(--warning); margin-bottom:6px;">${subCount ? `${subCount} mid-point sub${subCount > 1 ? 's' : ''}` : ''}${subCount && stoppageCount ? ' · ' : ''}${stoppageCount ? 'opponent injury stop' : ''}</div>`
            : '';

        html += `
            <div class="history-card" style="border-left-color: ${resultColor}; cursor: default;">
                <div style="margin-bottom: 6px; font-size: 16px;">
                    <strong>Point ${game.history.length - index}:</strong> <span style="color:${resultColor}; font-weight:bold;">${point.result}</span> ${lineStr}
                </div>
                ${subNote}
                <div style="font-size:14px; line-height: 1.5; margin-bottom: 12px; color: var(--text);">${rosterNames}</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn btn-secondary" style="flex:1; margin:0; padding:12px 6px; font-size:13px;" onclick="openTreeModal('${point.pointId}')">Play Diagram</button>
                    <button class="btn btn-secondary" style="flex:1; margin:0; padding:12px 6px; font-size:13px;" onclick="resumePoint('${point.pointId}')">Edit / Resume</button>
                    <button class="btn btn-secondary" style="flex:1; margin:0; padding:12px 6px; font-size:13px;" onclick="deletePoint('${point.pointId}')">Delete</button>
                </div>
            </div>`;
    });
    container.innerHTML = html;
    refreshIcons(container);
}

function getPlayerName(id) { const p = state.roster.find(r => r.id === id); return p ? `#${p.num} ${p.name.split(' ')[0]}` : 'Unknown'; }

function openTreeModal(pointId) {
    triggerHaptic();
    currentTreePointId = pointId;
    const game = state.games.find(g => g.id === state.activeGameId); const point = game.history.find(p => p.pointId === pointId);
    document.getElementById('tree-title').innerText = `${point.lineType}-Line (${point.result})`;
    const container = document.getElementById('tree-content');

    if (!point.events || point.events.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); width:100%; text-align:center;">No pass data recorded for this point.</div>`;
        document.getElementById('tree-modal').style.display = 'block';
        return;
    }

    let html = '';
    point.events.forEach((ev, idx) => {
        if (ev.type === 'Block') {
            if (idx > 0) html += `<div class="divider-node">Block</div>`;
            html += `<div class="tree-node block-node" onclick="openPlayerModal('${ev.player}')">${icon('shield', 14)} ${getPlayerName(ev.player)}</div>`;
        }
        else if (ev.type === 'Pickup' || ev.type === 'Pickup/Block') {
            if (idx > 0) html += `<div class="divider-node">Possession Change</div>`;
            html += `<div class="tree-node" onclick="openPlayerModal('${ev.player}')">${getPlayerName(ev.player)}</div>`;
        }
        else if (ev.type === 'Pass') {
            const throwVal = ev.throwTime != null ? ev.throwTime : '';
            html += `<div class="tree-pass-row">
                <div class="tree-node" onclick="openPlayerModal('${ev.from}')">${getPlayerName(ev.from)}</div>
                <div class="tree-pass-time" onclick="event.stopPropagation()">
                    <input type="number" step="0.1" min="0" max="10" value="${throwVal}" placeholder="—"
                        onchange="updatePassThrowTime(${idx}, this.value)" title="Time to throw (max 10s)">
                    <span>s</span>
                </div>
                <div class="tree-arrow">${icon('arrow-right', 18)}</div>
                <div class="tree-node" onclick="openPlayerModal('${ev.to}')">${getPlayerName(ev.to)}</div>
            </div>`;
        }
        else if (ev.type === 'Goal') html += `<div class="tree-arrow">${icon('arrow-right', 18)}</div><div class="tree-node goal-node" onclick="openPlayerModal('${ev.player}')">${icon('target', 14)} GOAL: ${getPlayerName(ev.player)}</div>`;
        else if (ev.type === 'Turnover') html += `<div class="tree-arrow">${icon('arrow-right', 18)}</div><div class="tree-node turn-node" onclick="openPlayerModal('${ev.player}')">${icon('circle-x', 14)} Turnover: ${getPlayerName(ev.player)}</div>`;
        else if (ev.type === 'Sub' && ev.team === 'us') {
            html += `<div class="divider-node">Injury Sub</div>`;
            html += `<div class="tree-node sub-node">${getPlayerName(ev.out)} → ${getPlayerName(ev.in)}</div>`;
        }
        else if (ev.type === 'Stoppage') html += `<div class="divider-node">Opponent injury timeout</div>`;
    });
    container.innerHTML = html;
    document.getElementById('tree-modal').style.display = 'block';
    refreshIcons(container);
}

function updatePassThrowTime(eventIndex, rawValue) {
    if (!currentTreePointId || !state.activeGameId) return;
    const game = state.games.find(g => g.id === state.activeGameId);
    const point = game.history.find(p => p.pointId === currentTreePointId);
    const ev = point?.events?.[eventIndex];
    if (!ev || ev.type !== 'Pass') return;
    const parsed = parseFloat(rawValue);
    if (!Number.isFinite(parsed)) return;
    ev.throwTime = capThrowTime(parsed);
    saveData();
    openTreeModal(currentTreePointId);
    if (document.getElementById('stats-view').classList.contains('active')) renderStatsView();
}

function closeTreeModal() { triggerHaptic(); document.getElementById('tree-modal').style.display = 'none'; }

function renderRosterView() {
    const container = document.getElementById('roster-list'); let html = '';
    const sortedRoster = [...state.roster].sort((a,b) => parseInt(a.num) - parseInt(b.num));
    sortedRoster.forEach(p => {
        const gradeTag = p.grade ? `<span style="color:#2196F3; font-size:12px; margin-left:8px;">(Gr: ${p.grade})</span>` : '';
        let ptsPlayed = 0; state.games.forEach(g => g.history.forEach(pt => { if(pt.playerIds.includes(p.id)) ptsPlayed++; }));
        const split = getPlayerLineSplit(p.id, state.games);
        const splitSub = split.total > 0 ? `${split.oPts}O / ${split.dPts}D` : 'No points yet';
        html += `
            <div class="list-row" onclick="openPlayerModal('${p.id}')">
                <div class="info-block"><span>#${p.num} ${p.name} ${gradeTag} ${roleBadgeHtml(p.id, state.games)}</span><span class="info-sub">Pts: ${ptsPlayed} · ${splitSub}</span></div>
                <div class="row-actions"><button class="icon-btn edit" onclick="editPlayer(event, '${p.id}')" aria-label="Edit">${icon('pencil', 16)}</button><button class="icon-btn delete" onclick="deletePlayer(event, '${p.id}')" aria-label="Delete">${icon('trash-2', 16)}</button></div>
            </div>`;
    });
    container.innerHTML = html;
    refreshIcons(container);
}

function renderSeasonView() {
    const container = document.getElementById('season-content'); let html = '';

    if (state.activeTournamentId) {
        const activeT = state.tournaments.find(t => t.id === state.activeTournamentId);
        html += `
        <div style="background:#333; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid var(--warning);">
            <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Active Tournament</div>
            <div style="font-weight:bold; font-size:18px; color:var(--warning); margin-bottom:10px;">${icon('trophy', 18)} ${activeT.name}</div>
            <button class="btn btn-secondary" style="margin:0; padding:10px; font-size:14px;" onclick="state.activeTournamentId = null; saveData(); renderSeasonView();">Unset Active Tournament</button>
        </div>`;
    }

    if (state.tournaments.length > 0) {
        html += `<h3>Tournaments</h3>`;
        [...state.tournaments].reverse().forEach(t => {
            const tGames = state.games.filter(g => g.tournamentId === t.id); const isActive = state.activeTournamentId === t.id;
            html += `
            <div class="folder-card ${isActive ? 'active-folder' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:18px;">${icon('folder', 18)} ${t.name}</div>
                    <div class="row-actions">
                        ${!isActive ? `<button class="icon-btn edit" onclick="state.activeTournamentId='${t.id}'; saveData(); renderSeasonView();">Set Active</button>` : ''}
                        <button class="icon-btn delete" onclick="deleteTournament(event, '${t.id}')">Del</button>
                    </div>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:5px; margin-bottom:10px;">${tGames.length} Games inside</div>
                <div style="padding-left:10px; border-left:1px dashed #555;">`;
            
            if(tGames.length === 0) html += `<div style="color:#aaa; font-size:12px;">No games assigned yet.</div>`;
            
            tGames.forEach(g => {
                const isGActive = g.id === state.activeGameId; const scoreText = getGameScore(g).text;
                html += `
                <div class="game-item ${isGActive ? 'active-game' : ''}" onclick="setActiveGame('${g.id}')">
                    <div style="font-weight:bold; font-size:14px;">${icon('file-text', 16)} ${g.name} <span style="font-weight:normal; color:#aaa; margin-left:8px;">${scoreText}</span></div>
                    <div class="row-actions">
                        <button class="icon-btn" onclick="removeGameFromTournament(event, '${g.id}')">Remove</button>
                        <button class="icon-btn delete" onclick="deleteGame(event, '${g.id}')">Del</button>
                    </div>
                </div>`;
            });
            html += `<button class="btn btn-secondary" style="font-size:14px; padding:8px; margin-top:10px; width:auto; gap:6px;" onclick="openAssignGameModal('${t.id}')">${icon('plus', 16)} Add Game</button></div></div>`;
        });
    }

    const unassigned = state.games.filter(g => !g.tournamentId);
    if (unassigned.length > 0) {
        html += `<h3>Unassigned Standalone Games</h3>`;
        unassigned.forEach(g => {
            const isGActive = g.id === state.activeGameId; const scoreText = getGameScore(g).text;
            html += `
            <div class="folder-card" style="border-left-color: #333;" onclick="setActiveGame('${g.id}')">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:16px; ${isGActive ? 'color:var(--primary);' : ''}">${icon('file-text', 16)} ${g.name} <span style="font-weight:normal; color:#aaa; margin-left:8px;">${scoreText}</span></div>
                    <div class="row-actions"><button class="icon-btn delete" onclick="deleteGame(event, '${g.id}')">Del</button></div>
                </div>
            </div>`;
        });
    }
    container.innerHTML = html || `<div style="text-align:center; color:#aaa; padding:20px;">No data yet. Create a tournament or a game!</div>`;
    refreshIcons(container);
}

function buildPlayerScopeDropdown() {
    const scopeSelect = document.getElementById('player-scope'); let options = `<option value="all">Season Totals (All Games)</option>`;
    state.tournaments.forEach(t => {
        options += `<optgroup label="${t.name}"><option value="t_${t.id}">All Games in ${t.name}</option>`;
        const tGames = state.games.filter(g => g.tournamentId === t.id);
        tGames.forEach(g => { options += `<option value="g_${g.id}">${g.name}</option>`; }); options += `</optgroup>`;
    });
    const unassignedGames = state.games.filter(g => !g.tournamentId);
    if (unassignedGames.length > 0) {
        options += `<optgroup label="Standalone Games">`;
        unassignedGames.forEach(g => { options += `<option value="g_${g.id}">${g.name}</option>`; }); options += `</optgroup>`;
    }
    scopeSelect.innerHTML = options;
}

function openPlayerModal(playerId) {
    triggerHaptic(); currentViewedPlayerId = playerId;
    const player = state.roster.find(p => p.id === playerId);
    const role = getPlayerRole(playerId, state.games);
    document.getElementById('modal-name').innerHTML = `#${player.num} ${player.name}${role ? ` <span class="role-badge ${role.className}" title="${role.title}">${role.label}</span>` : ''}`;
    buildPlayerScopeDropdown(); document.getElementById('player-scope').value = 'all'; 
    updatePlayerModalStats(); document.getElementById('player-modal').style.display = 'block';
}

function updatePlayerModalStats() {
    if (!currentViewedPlayerId) return;
    const scope = document.getElementById('player-scope').value; let relevantGames = [];
    if (scope === 'all') { relevantGames = state.games; } 
    else if (scope.startsWith('t_')) { const tId = scope.replace('t_', ''); relevantGames = state.games.filter(g => g.tournamentId === tId); } 
    else if (scope.startsWith('g_')) { const gId = scope.replace('g_', ''); relevantGames = state.games.filter(g => g.id === gId); }

    let stats = { goals: 0, assists: 0, passes: 0, blocks: 0, drops: 0 }; let targets = {}; 
    relevantGames.forEach(g => {
        g.history.forEach(pt => {
            if (!pt.events) return;
            pt.events.forEach(ev => {
                if (ev.type === 'Goal' && ev.player === currentViewedPlayerId) stats.goals++;
                if (ev.type === 'Goal' && ev.assist === currentViewedPlayerId) stats.assists++;
                if (ev.type === 'Pass' && ev.from === currentViewedPlayerId) { stats.passes++; targets[ev.to] = (targets[ev.to] || 0) + 1; }
                if (ev.type === 'Block' && ev.player === currentViewedPlayerId) stats.blocks++;
                if (ev.type === 'Turnover' && ev.player === currentViewedPlayerId) stats.drops++;
            });
        });
    });

    const split = getPlayerLineSplit(currentViewedPlayerId, relevantGames);
    const role = getPlayerRole(currentViewedPlayerId, relevantGames);
    const avgThrow = getPlayerAvgThrowTime(currentViewedPlayerId, relevantGames);
    const throwCount = getPlayerThrowTimes(currentViewedPlayerId, relevantGames).length;
    const roleEl = document.getElementById('modal-role-line');
    if (role) roleEl.textContent = role.title;
    else if (split.total > 0) roleEl.textContent = `${split.oPts} offense · ${split.dPts} defense pts`;
    else roleEl.textContent = '';
    if (avgThrow != null) {
        roleEl.textContent += roleEl.textContent ? ` · ${avgThrow}s avg throw (${throwCount})` : `${avgThrow}s avg throw (${throwCount} throws)`;
    }

    document.getElementById('modal-stats-grid').innerHTML = `
        <div class="stat-box"><div class="val">${stats.goals}</div><div class="lbl">Goals</div></div>
        <div class="stat-box"><div class="val">${stats.assists}</div><div class="lbl">Assists</div></div>
        <div class="stat-box"><div class="val">${stats.passes}</div><div class="lbl">Passes</div></div>
        <div class="stat-box"><div class="val">${avgThrow != null ? avgThrow + 's' : '—'}</div><div class="lbl">Avg Throw</div></div>
        <div class="stat-box"><div class="val">${stats.blocks}</div><div class="lbl">Blocks</div></div>
        <div class="stat-box"><div class="val">${stats.drops}</div><div class="lbl">Turnovers</div></div>
    `;
    let targetHtml = ''; const sortedTargets = Object.entries(targets).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if(sortedTargets.length === 0) targetHtml = '<div style="color:#aaa;">No passes logged in this scope.</div>';
    sortedTargets.forEach(([tId, count]) => {
        const tName = state.roster.find(p => p.id === tId)?.name || 'Unknown';
        const avgToTarget = getAvgThrowTimeToTarget(currentViewedPlayerId, tId, relevantGames);
        const timeStr = avgToTarget != null ? `${avgToTarget}s avg throw` : 'no timed passes';
        targetHtml += `<div style="padding:12px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <span>${tName}</span>
            <span style="text-align:right;"><strong style="color:var(--primary);">${count} passes</strong><br><span style="font-size:12px; color:var(--text-muted);">${timeStr}</span></span>
        </div>`;
    });
    document.getElementById('modal-targets').innerHTML = targetHtml;
    refreshIcons(document.getElementById('player-modal'));
}

function closePlayerModal() { triggerHaptic(); document.getElementById('player-modal').style.display = 'none'; }

function switchTab(tabId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    const tabs = document.querySelectorAll('.tab'); const viewIds = ['play-view', 'stats-view', 'history-view', 'analytics-view', 'roster-view', 'season-view'];
    const index = viewIds.indexOf(tabId); if (index > -1) tabs[index].classList.add('active');
    
    if (tabId === 'play-view') renderPlayView();
    if (tabId === 'stats-view') renderStatsView();
    if (tabId === 'history-view') renderHistoryView();
    if (tabId === 'analytics-view') setAnalyticsMode('assistant'); // Default mode
    if (tabId === 'roster-view') renderRosterView();
    if (tabId === 'season-view') renderSeasonView();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateWakeLock();
});

// Boot
renderPlayView();
refreshIcons(document.body);
