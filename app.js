// --- 1. INITIALIZATION & STATE ---
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

function triggerHaptic() {
    if (navigator.vibrate) navigator.vibrate(50);
}

let defaultState = { 
    roster: [], tournaments: [], games: [], 
    activeTournamentId: null, activeGameId: null, nextLineType: 'O' 
};

let state = JSON.parse(localStorage.getItem('ultiProState')) || defaultState;
if (!state.nextLineType) state.nextLineType = 'O'; 
if (!state.tournaments) state.tournaments = []; 

let possession = { status: 'setup', hasDisc: null, lastPasser: null, currentPointEvents: [] };
let currentViewedPlayerId = null;

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
    possession.status = 'setup'; state.roster.forEach(p => p.active = false);
    saveData(); switchTab('play-view');
}

function setActiveGame(id) {
    state.activeGameId = id;
    const game = state.games.find(g => g.id === id);
    if(game.tournamentId) state.activeTournamentId = game.tournamentId;
    possession.status = 'setup'; state.roster.forEach(p => p.active = false);
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
                <div class="info-block">📄 ${g.name} <span class="info-sub">${currentTName}</span></div>
                <button class="btn btn-primary" style="width:auto; margin:0; padding:10px 20px;">Add</button></div>`;
        });
    }
    document.getElementById('assign-game-list').innerHTML = html;
    document.getElementById('assign-game-modal').style.display = 'block';
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
    if(confirm("Delete this game and all of its play history?")) {
        state.games = state.games.filter(g => g.id !== id);
        if(state.activeGameId === id) state.activeGameId = null;
        saveData(); renderSeasonView();
    }
}

function deleteTournament(event, id) {
    event.stopPropagation();
    if(confirm("Delete this tournament folder? (Games inside will be moved to 'Unassigned', NOT deleted).")) {
        state.games.forEach(g => { if(g.tournamentId === id) g.tournamentId = null; });
        state.tournaments = state.tournaments.filter(t => t.id !== id);
        if(state.activeTournamentId === id) state.activeTournamentId = null;
        saveData(); renderSeasonView();
    }
}

// --- POINT MANAGEMENT ---
function deletePoint(pointId) {
    if(!confirm("Are you sure you want to permanently delete this point?")) return;
    triggerHaptic();
    const game = state.games.find(g => g.id === state.activeGameId);
    game.history = game.history.filter(p => p.pointId !== pointId);
    saveData(); renderStatsView();
}

function resumePoint(pointId) {
    triggerHaptic();
    if(!confirm("Edit this point? It will be removed from history and loaded into the Play tab so you can continue it or fix errors.")) return;
    
    const game = state.games.find(g => g.id === state.activeGameId);
    const pointIndex = game.history.findIndex(p => p.pointId === pointId);
    const point = game.history[pointIndex];
    game.history.splice(pointIndex, 1);
    
    state.roster.forEach(p => { p.active = point.playerIds.includes(p.id); });
    state.nextLineType = point.lineType; possession.status = 'playing'; possession.currentPointEvents = [...point.events];
    
    if (possession.currentPointEvents.length > 0) {
        const lastEv = possession.currentPointEvents[possession.currentPointEvents.length - 1];
        if (lastEv.type === 'Goal' || lastEv.type === 'Turnover') possession.currentPointEvents.pop(); 
    }
    
    if (possession.currentPointEvents.length === 0) {
        possession.hasDisc = null; possession.lastPasser = null;
    } else {
        const newLast = possession.currentPointEvents[possession.currentPointEvents.length - 1];
        if (newLast.type === 'Pass') { possession.hasDisc = newLast.to; possession.lastPasser = newLast.from; } 
        else if (newLast.type === 'Pickup/Block') { possession.hasDisc = newLast.player; possession.lastPasser = null; }
    }
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
    if(confirm("Remove this player? Past stats remain in old games.")) { state.roster = state.roster.filter(p => p.id !== id); saveData(); renderRosterView(); }
}

// --- 3. THE STATE MACHINE (PLAY VIEW) ---
function toggleLineType() {
    triggerHaptic(); state.nextLineType = state.nextLineType === 'O' ? 'D' : 'O'; saveData(); renderPlayView();
}

function toggleFieldStatus(playerId) {
    const player = state.roster.find(p => p.id === playerId);
    const activeCount = state.roster.filter(p => p.active).length;
    if (!player.active && activeCount >= 7) { alert("Line is full!"); return; }
    player.active = !player.active; saveData(); renderPlayView();
}

function startPoint() {
    triggerHaptic(); const activeCount = state.roster.filter(p => p.active).length;
    if (activeCount !== 7) { if(!confirm(`You only have ${activeCount} players selected. Start anyway?`)) return; }
    possession.status = 'playing'; possession.hasDisc = null; possession.lastPasser = null; possession.currentPointEvents = []; renderPlayView();
}

function undoLastAction() {
    triggerHaptic();
    if (possession.currentPointEvents.length === 0) { possession.status = 'setup'; possession.hasDisc = null; possession.lastPasser = null; renderPlayView(); return; }
    possession.currentPointEvents.pop();
    
    if (possession.currentPointEvents.length === 0) { possession.hasDisc = null; possession.lastPasser = null; } 
    else {
        const prevEvent = possession.currentPointEvents[possession.currentPointEvents.length - 1];
        if (prevEvent.type === 'Pass') { possession.hasDisc = prevEvent.to; possession.lastPasser = prevEvent.from; } 
        else if (prevEvent.type === 'Pickup/Block' || prevEvent.type === 'Turnover') { possession.hasDisc = prevEvent.player; possession.lastPasser = null; }
    }
    renderPlayView();
}

function tapPlayer(playerId) {
    triggerHaptic();
    if (possession.status === 'setup') { toggleFieldStatus(playerId); } 
    else if (possession.status === 'playing') {
        if (!possession.hasDisc) {
            possession.currentPointEvents.push({ type: 'Pickup/Block', player: playerId, time: Date.now() });
            possession.hasDisc = playerId; possession.lastPasser = null;
        } else if (possession.hasDisc !== playerId) {
            possession.currentPointEvents.push({ type: 'Pass', from: possession.hasDisc, to: playerId, time: Date.now() });
            possession.lastPasser = possession.hasDisc; possession.hasDisc = playerId;
        }
        renderPlayView();
    }
}

function handleSwipe(playerId, direction) {
    if (possession.status !== 'playing' || possession.hasDisc !== playerId) return;
    if (direction === 'right') {
        triggerHaptic(); let assist = possession.lastPasser;
        if (possession.currentPointEvents.length > 0) {
            const lastEvent = possession.currentPointEvents[possession.currentPointEvents.length - 1];
            if ((lastEvent.type === 'Pass' && lastEvent.to === playerId) || (lastEvent.type === 'Pickup/Block' && lastEvent.player === playerId)) {
                possession.currentPointEvents.pop();
            }
        }
        possession.currentPointEvents.push({ type: 'Goal', player: playerId, assist: assist, time: Date.now() }); savePoint('Won');
    } 
    else if (direction === 'left') {
        triggerHaptic(); possession.currentPointEvents.push({ type: 'Turnover', player: playerId, time: Date.now() });
        possession.hasDisc = null; possession.lastPasser = null; renderPlayView();
    }
}

function savePoint(result) {
    triggerHaptic(); const game = state.games.find(g => g.id === state.activeGameId); const activeIds = state.roster.filter(p => p.active).map(p => p.id);
    game.history.push({ pointId: generateId(), result: result, lineType: state.nextLineType, events: [...possession.currentPointEvents], playerIds: activeIds });
    state.nextLineType = (result === 'Won') ? 'D' : 'O';
    possession.status = 'setup'; possession.hasDisc = null; possession.lastPasser = null; possession.currentPointEvents = [];
    saveData(); renderPlayView();
}

let touchstartX = 0;
function bindGestures() {
    const rows = document.querySelectorAll('.list-row');
    rows.forEach(row => {
        row.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; }, {passive: true});
        row.addEventListener('touchend', e => {
            const touchendX = e.changedTouches[0].screenX; const playerId = row.getAttribute('data-id');
            if (touchendX < touchstartX - 50) handleSwipe(playerId, 'left');
            else if (touchendX > touchstartX + 50) handleSwipe(playerId, 'right');
            else tapPlayer(playerId);
        }, {passive: true});
    });
}

// --- 4. FILE I/O ---
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const anchor = document.createElement('a'); anchor.setAttribute("href", dataStr); anchor.setAttribute("download", "ulti_data_export.json"); anchor.click();
}

function importData(event) {
    const file = event.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = function(e) { state = JSON.parse(e.target.result); saveData(); alert('Backup Restored Successfully!'); location.reload(); };
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

function clearAllData() { if(prompt("Type 'DELETE' to wipe all app data:") === "DELETE") { localStorage.removeItem('ultiProState'); location.reload(); } }

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
        html += `<div class="${classes}" onclick="toggleBuilderPlayer('${p.id}')">#${p.num} ${p.name.split(' ')[0]}</div>`;
    });
    container.innerHTML = html;
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
    
    let rankings = candidates.map(candidate => {
        let totalPlayed = 0; let totalWeightedWins = 0;
        selectedArray.forEach(selId => {
            const key = [candidate.id, selId].sort().join('|');
            if (pairStats[key]) { totalPlayed += pairStats[key].played; totalWeightedWins += pairStats[key].weightedWins; }
        });
        const compositeScore = (totalWeightedWins + (ALPHA * 0.5)) / (totalPlayed + ALPHA);
        return { player: candidate, score: compositeScore, played: totalPlayed };
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
                    <div style="font-size:12px; color:var(--text-muted);">Synergy Score: ${(r.score * 100).toFixed(1)}</div>
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
                } else if (ev.type === 'Pickup/Block') {
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
            <button class="btn btn-primary" onclick="startPoint()">Start Point (${activeCount}/7 Ready)</button>`;
    } else {
        html += `<div style="display:flex; gap:10px;">
                    <button class="btn btn-warning" style="flex:1;" onclick="undoLastAction()">Undo Action</button>
                    <button class="btn btn-danger" style="flex:1;" onclick="savePoint('Lost')">They Scored</button>
                 </div>
                 <div class="state-banner state-${state.nextLineType.toLowerCase()}">
                    ${possession.hasDisc ? 'Tap to Pass. Swipe Right to Score. Swipe Left for Turnover.' : 'Tap player who picks up / blocks the disc.'}
                 </div>`;
    }

    html += `<h3>On Field</h3><div id="active-players">`;
    state.roster.filter(p => p.active).forEach(p => {
        let extraClass = '';
        if (possession.hasDisc === p.id) extraClass = 'has-disc';
        if (possession.lastPasser === p.id) extraClass = 'last-passer';
        html += `<div class="list-row on-field ${extraClass}" data-id="${p.id}"><div class="info-block">#${p.num} ${p.name}</div></div>`;
    });
    html += `</div>`;
    
    if (possession.status === 'setup') {
        html += `<h3>Bench</h3><div>`;
        state.roster.filter(p => !p.active).forEach(p => {
            html += `<div class="list-row" data-id="${p.id}"><div class="info-block">#${p.num} ${p.name}</div></div>`;
        });
        html += `</div>`;
    }
    container.innerHTML = html;
    bindGestures();
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
    gameStats.forEach(p => { html += `<div class="stat-line clickable" onclick="openPlayerModal('${p.id}')"><span>#${p.num} ${p.name}</span><strong style="color:var(--primary);">${p.pts} pts</strong></div>`; });
    html += `</div>`;

    if (!state.activeGameId) { html += `<div style="text-align:center; color:#aaa;">Select a game in the Season tab to view history logs.</div>`; container.innerHTML = html; return; }

    const game = state.games.find(g => g.id === state.activeGameId);
    const scoreText = getGameScore(game).text;
    html += `<h3>Game History: ${game.name} <span style="color:var(--warning); float:right;">Score: ${scoreText}</span></h3>`;
    
    [...game.history].reverse().forEach((point, index) => {
        const isWon = point.result === 'Won'; const resultColor = isWon ? 'var(--primary)' : 'var(--danger)'; const lineStr = point.lineType === 'O' ? 'O-Line' : 'D-Line';
        const rosterNames = point.playerIds.map(id => state.roster.find(r => r.id === id)?.name || 'Unknown').join(", ");
        
        html += `
            <div class="history-card" style="border-left-color: ${resultColor}; cursor: default;">
                <div style="margin-bottom: 6px; font-size: 16px;">
                    <strong>Point ${game.history.length - index}:</strong> <span style="color:${resultColor}; font-weight:bold;">${point.result}</span> ${lineStr}
                </div>
                <div style="font-size:14px; line-height: 1.5; margin-bottom: 12px; color: var(--text);">${rosterNames}</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button class="btn btn-secondary" style="flex:1; margin:0; padding:12px 6px; font-size:13px;" onclick="openTreeModal('${point.pointId}')">Play Diagram</button>
                    <button class="btn btn-secondary" style="flex:1; margin:0; padding:12px 6px; font-size:13px;" onclick="resumePoint('${point.pointId}')">Edit / Resume</button>
                    <button class="btn btn-secondary" style="flex:1; margin:0; padding:12px 6px; font-size:13px;" onclick="deletePoint('${point.pointId}')">Delete</button>
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

function getPlayerName(id) { const p = state.roster.find(r => r.id === id); return p ? `#${p.num} ${p.name.split(' ')[0]}` : 'Unknown'; }

function openTreeModal(pointId) {
    triggerHaptic();
    const game = state.games.find(g => g.id === state.activeGameId); const point = game.history.find(p => p.pointId === pointId);
    document.getElementById('tree-title').innerText = `${point.lineType}-Line (${point.result})`;
    const container = document.getElementById('tree-content');
    
    if (!point.events || point.events.length === 0) { container.innerHTML = `<div style="color:var(--text-muted); width:100%; text-align:center;">No pass data recorded for this point.</div>`; document.getElementById('tree-modal').style.display = 'block'; return; }

    let html = '';
    point.events.forEach((ev, idx) => {
        if (ev.type === 'Pickup/Block') {
            if (idx > 0) html += `<div class="divider-node">Possession Change / Block</div>`;
            html += `<div class="tree-node" onclick="openPlayerModal('${ev.player}')">${getPlayerName(ev.player)}</div>`;
        } 
        else if (ev.type === 'Pass') html += `<div class="tree-arrow">➔</div><div class="tree-node" onclick="openPlayerModal('${ev.to}')">${getPlayerName(ev.to)}</div>`;
        else if (ev.type === 'Goal') html += `<div class="tree-arrow">➔</div><div class="tree-node goal-node" onclick="openPlayerModal('${ev.player}')">⭐ GOAL: ${getPlayerName(ev.player)}</div>`;
        else if (ev.type === 'Turnover') html += `<div class="tree-arrow">➔</div><div class="tree-node turn-node" onclick="openPlayerModal('${ev.player}')">❌ Turnover: ${getPlayerName(ev.player)}</div>`;
    });
    container.innerHTML = html; document.getElementById('tree-modal').style.display = 'block';
}

function closeTreeModal() { triggerHaptic(); document.getElementById('tree-modal').style.display = 'none'; }

function renderRosterView() {
    const container = document.getElementById('roster-list'); let html = '';
    const sortedRoster = [...state.roster].sort((a,b) => parseInt(a.num) - parseInt(b.num));
    sortedRoster.forEach(p => {
        const gradeTag = p.grade ? `<span style="color:#2196F3; font-size:12px; margin-left:8px;">(Gr: ${p.grade})</span>` : '';
        let ptsPlayed = 0; state.games.forEach(g => g.history.forEach(pt => { if(pt.playerIds.includes(p.id)) ptsPlayed++; }));
        html += `
            <div class="list-row" onclick="openPlayerModal('${p.id}')">
                <div class="info-block"><span>#${p.num} ${p.name} ${gradeTag}</span><span class="info-sub">Points Played: ${ptsPlayed}</span></div>
                <div class="row-actions"><button class="icon-btn edit" onclick="editPlayer(event, '${p.id}')">Edit</button><button class="icon-btn delete" onclick="deletePlayer(event, '${p.id}')">Del</button></div>
            </div>`;
    });
    container.innerHTML = html;
}

function renderSeasonView() {
    const container = document.getElementById('season-content'); let html = '';

    if (state.activeTournamentId) {
        const activeT = state.tournaments.find(t => t.id === state.activeTournamentId);
        html += `
        <div style="background:#333; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid var(--warning);">
            <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase;">Active Tournament</div>
            <div style="font-weight:bold; font-size:18px; color:var(--warning); margin-bottom:10px;">🏆 ${activeT.name}</div>
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
                    <div style="font-weight:bold; font-size:18px;">📁 ${t.name}</div>
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
                    <div style="font-weight:bold; font-size:14px;">📄 ${g.name} <span style="font-weight:normal; color:#aaa; margin-left:8px;">${scoreText}</span></div>
                    <div class="row-actions">
                        <button class="icon-btn" onclick="removeGameFromTournament(event, '${g.id}')">Remove</button>
                        <button class="icon-btn delete" onclick="deleteGame(event, '${g.id}')">Del</button>
                    </div>
                </div>`;
            });
            html += `<button class="btn btn-secondary" style="font-size:14px; padding:8px; margin-top:10px; width:auto;" onclick="openAssignGameModal('${t.id}')">+ Add Game</button></div></div>`;
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
                    <div style="font-weight:bold; font-size:16px; ${isGActive ? 'color:var(--primary);' : ''}">📄 ${g.name} <span style="font-weight:normal; color:#aaa; margin-left:8px;">${scoreText}</span></div>
                    <div class="row-actions"><button class="icon-btn delete" onclick="deleteGame(event, '${g.id}')">Del</button></div>
                </div>
            </div>`;
        });
    }
    container.innerHTML = html || `<div style="text-align:center; color:#aaa; padding:20px;">No data yet. Create a tournament or a game!</div>`;
}

function buildPlayerScopeDropdown() {
    const scopeSelect = document.getElementById('player-scope'); let options = `<option value="all">🌎 Season Totals (All Games)</option>`;
    state.tournaments.forEach(t => {
        options += `<optgroup label="📁 ${t.name}"><option value="t_${t.id}">All Games in ${t.name}</option>`;
        const tGames = state.games.filter(g => g.tournamentId === t.id);
        tGames.forEach(g => { options += `<option value="g_${g.id}">&nbsp;&nbsp;&nbsp;↳ 📄 ${g.name}</option>`; }); options += `</optgroup>`;
    });
    const unassignedGames = state.games.filter(g => !g.tournamentId);
    if (unassignedGames.length > 0) {
        options += `<optgroup label="Standalone Games">`;
        unassignedGames.forEach(g => { options += `<option value="g_${g.id}">📄 ${g.name}</option>`; }); options += `</optgroup>`;
    }
    scopeSelect.innerHTML = options;
}

function openPlayerModal(playerId) {
    triggerHaptic(); currentViewedPlayerId = playerId;
    const player = state.roster.find(p => p.id === playerId);
    document.getElementById('modal-name').innerText = `#${player.num} ${player.name}`;
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
                if (ev.type === 'Pickup/Block' && pt.lineType === 'D' && ev.player === currentViewedPlayerId) stats.blocks++; 
                if (ev.type === 'Turnover' && ev.player === currentViewedPlayerId) stats.drops++;
            });
        });
    });

    document.getElementById('modal-stats-grid').innerHTML = `
        <div class="stat-box"><div class="val">${stats.goals}</div><div class="lbl">Goals</div></div>
        <div class="stat-box"><div class="val">${stats.assists}</div><div class="lbl">Assists</div></div>
        <div class="stat-box"><div class="val">${stats.passes}</div><div class="lbl">Passes</div></div>
        <div class="stat-box"><div class="val">${stats.drops}</div><div class="lbl">Turnovers</div></div>
    `;
    let targetHtml = ''; const sortedTargets = Object.entries(targets).sort((a,b) => b[1] - a[1]).slice(0, 5);
    if(sortedTargets.length === 0) targetHtml = '<div style="color:#aaa;">No passes logged in this scope.</div>';
    sortedTargets.forEach(([tId, count]) => {
        const tName = state.roster.find(p => p.id === tId)?.name || 'Unknown';
        targetHtml += `<div style="padding:12px; border-bottom:1px solid #333; display:flex; justify-content:space-between;"><span>${tName}</span><strong style="color:var(--primary);">${count} passes</strong></div>`;
    });
    document.getElementById('modal-targets').innerHTML = targetHtml;
}

function closePlayerModal() { triggerHaptic(); document.getElementById('player-modal').style.display = 'none'; }

function switchTab(tabId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    const tabs = document.querySelectorAll('.tab'); const viewIds = ['play-view', 'stats-view', 'analytics-view', 'roster-view', 'season-view'];
    const index = viewIds.indexOf(tabId); if (index > -1) tabs[index].classList.add('active');
    
    if (tabId === 'play-view') renderPlayView();
    if (tabId === 'stats-view') renderStatsView();
    if (tabId === 'analytics-view') setAnalyticsMode('assistant'); // Default mode
    if (tabId === 'roster-view') renderRosterView();
    if (tabId === 'season-view') renderSeasonView();
}

// Boot
renderPlayView();