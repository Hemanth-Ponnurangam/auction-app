/**
 * Simulation Room — room.js
 * Manages the full room lifecycle: waiting → setup → toss → live → result
 */


// ─── STATE ─────────────────────────────────────────────────────────
const db = firebase.database();
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get('roomId');

if (!ROOM_ID) { location.href = 'index.html'; throw new Error('No roomId'); }

const SIM_ROOM = db.ref(`simulation/rooms/${ROOM_ID}`);
const MY_UID   = getUID();
let MY_SLOT    = getSlot();     // 'team1' | 'team2' | null — re-detected after room loads

let roomData     = null;
let leagueStats  = null;      // { batters, bowlers, matchup, leagueAvg }
let leaguePlayers = [];       // array of { name, role, ... }
let mySquad      = [];        // selected XI
let bowlingAlloc = {};        // name → overs
let matchState   = null;
let simInterval  = null;
let simSpeed     = 800;       // ms per delivery
let simPaused    = false;
let viewingInning = 1;
let tossStarted  = false;     // guard: prevent startToss() being called twice
let matchStarted = false;     // guard: prevent runInnings() being started twice

// ─── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (!ROOM_ID) return;
    bindSetupUI();
    listenRoom();
});

function listenRoom() {
    SIM_ROOM.on('value', snap => {
        roomData = snap.val();
        if (!roomData) { location.href = 'index.html'; return; }
        // Auto-detect slot in case user re-entered without sessionStorage
        const detectedSlot = detectMySlot();
        if (detectedSlot) MY_SLOT = detectedSlot;
        syncPhase();
    });
}

function detectMySlot() {
    if (!roomData || !roomData.players) return null;
    if (roomData.players.team1?.uid === MY_UID) return 'team1';
    if (roomData.players.team2?.uid === MY_UID) return 'team2';
    return null; // spectator or unknown
}

// ─── PHASE DISPATCH ─────────────────────────────────────────────────
function syncPhase() {
    const status = roomData.status || 'waiting';
    const ind = document.getElementById('phaseIndicator');
    ind.className = `phase-indicator ${status}`;
    ind.textContent = `● ${status.toUpperCase()}`;

    document.getElementById('topRoomName').textContent = roomData.name || 'Room';
    document.getElementById('topRoomCode').textContent = roomData.code || ROOM_ID;
    document.getElementById('topLeague').textContent = roomData.leagueName || roomData.league || '';

    if (status === 'waiting') showWaiting();
    else if (status === 'setup') showSetup();
    else if (status === 'toss') {
        showMatch();
        // Show the rescue bar for team1 (host); it auto-hides once toss runs cleanly
        if (MY_SLOT === 'team1') {
            const bar = document.getElementById('tossRescueBar');
            if (bar) bar.style.display = 'flex';
            initTossForTeam1().then(() => {
                // Hide rescue bar once initTossForTeam1 succeeds in showing the overlay
                const overlay = document.getElementById('tossOverlay');
                if (overlay && overlay.style.display === 'flex') {
                    if (bar) bar.style.display = 'none';
                }
            });
        } else {
            initTossForTeam2();
        }
    }
    else if (status === 'live') {
        showMatch();
        if (!matchStarted) startSimulationFromFirebase();
    }
    else if (status === 'done') showResult();
}

// ─── WAITING PHASE ──────────────────────────────────────────────────
function showWaiting() {
    document.getElementById('waitingPhase').style.display = 'flex';
    document.getElementById('setupPhase').style.display = 'none';
    document.getElementById('matchPhase').style.display = 'none';

    document.getElementById('waitRoomCode').textContent = roomData.code || ROOM_ID;

    const p1 = roomData.players?.team1;
    const p2 = roomData.players?.team2;
    document.getElementById('playerSlots').textContent =
        `${p1 ? '✓ ' + p1.playerName : '○ Slot 1 open'} · ${p2 ? '✓ ' + p2.playerName : '○ Slot 2 open'}`;

    // If second player just joined → switch to setup
    if (p1 && p2 && MY_SLOT === 'team2') {
        SIM_ROOM.child('status').set('setup');
    }
}

// ─── SETUP PHASE ────────────────────────────────────────────────────
async function showSetup() {
    document.getElementById('waitingPhase').style.display = 'none';
    document.getElementById('setupPhase').style.display = 'block';
    document.getElementById('matchPhase').style.display = 'none';

    if (!leagueStats && roomData.league) {
        await loadLeagueData(roomData.league);
    }

    const myTeam  = roomData.players?.[MY_SLOT];
    const oppSlot = MY_SLOT === 'team1' ? 'team2' : 'team1';
    const oppTeam = roomData.players?.[oppSlot];

    if (myTeam) {
        document.getElementById('myTeamName').textContent = myTeam.playerName || MY_SLOT;
        const ftag = document.getElementById('myFranchiseTag');
        ftag.textContent = myTeam.franchise || '—';
    }
    if (oppTeam) {
        document.getElementById('oppTeamName').textContent = oppTeam.playerName || oppSlot;
        const ftag = document.getElementById('oppFranchiseTag');
        ftag.textContent = oppTeam.franchise || '—';
    }

    // Opponent squad display
    if (oppTeam?.squad?.length) {
        document.getElementById('oppNotReady').style.display = 'none';
        document.getElementById('oppSquadDisplay').style.display = 'block';
        renderOppSquad(oppTeam.squad);
    }

    // My squad (if reconnecting)
    if (myTeam?.squad?.length && !mySquad.length) {
        mySquad = myTeam.squad;
        renderMySquad();
        renderBowlingAlloc();
    }

    // Ready status
    const myReady  = myTeam?.ready || false;
    const oppReady = oppTeam?.ready || false;
    document.getElementById('setupOpponentStatus').textContent =
        oppReady ? '✓ Opponent is ready' : '⏳ Opponent setting up…';
    document.getElementById('readyStatus').innerHTML =
        `You: ${myReady ? '<span style="color:var(--green)">✓ Ready</span>' : '<span style="color:var(--dim)">Not Ready</span>'} &nbsp;|&nbsp; `+
        `Opponent: ${oppReady ? '<span style="color:var(--green)">✓ Ready</span>' : '<span style="color:var(--dim)">Not Ready</span>'}`;

    const readyBtn = document.getElementById('btnReady');
    if (myReady) { readyBtn.classList.add('ready'); readyBtn.textContent = '✓ READY — Waiting for Opponent'; }

    // Both ready → trigger toss (only team1 does it, once)
    if (myReady && oppReady && MY_SLOT === 'team1' && !tossStarted) {
        tossStarted = true;
        startToss();
    }
}

async function loadLeagueData(leagueKey) {
    // Load processed player stats from Firebase
    const snap = await db.ref(`simulation_data/leagues/${leagueKey}/playerStats`).once('value');
    const stored = snap.val();

    if (stored) {
        leagueStats = stored;
        // Restore proper format
        leaguePlayers = Object.entries(stored.playerList || {}).map(([name, d]) => ({ name, ...d }));
    } else {
        // Try raw CSV rows (if admin stored them)
        const rawSnap = await db.ref(`simulation_data/leagues/${leagueKey}/rows`).once('value');
        const rows = rawSnap.val();
        if (rows) {
            const arr = Array.isArray(rows) ? rows : Object.values(rows);
            leagueStats = buildPlayerStats(arr);
            leaguePlayers = getPlayerList(arr);
        } else {
            // No data — use empty stats
            leagueStats = { batters: {}, bowlers: {}, matchup: {}, leagueAvg: null };
            leaguePlayers = [];
        }
    }
}

// ─── PLAYER SEARCH ──────────────────────────────────────────────────
function bindSetupUI() {
    const searchEl = document.getElementById('playerSearch');
    if (searchEl) {
        searchEl.addEventListener('input', debounce(() => {
            const q = searchEl.value.trim().toLowerCase();
            renderPlayerResults(q);
        }, 200));
    }

    document.getElementById('xiCsvInput')?.addEventListener('change', handleXiUpload);
    document.getElementById('btnClearSquad')?.addEventListener('click', () => {
        mySquad = [];
        renderMySquad();
        renderBowlingAlloc();
    });

    document.getElementById('btnReady')?.addEventListener('click', markReady);
}

function renderPlayerResults(q) {
    const container = document.getElementById('playerResults');
    if (!q) { container.style.display = 'none'; return; }

    const matches = leaguePlayers
        .filter(p => p.name.toLowerCase().includes(q))
        .slice(0, 10);

    if (!matches.length) { container.style.display = 'none'; return; }

    container.style.display = 'block';
    container.innerHTML = matches.map(p => {
        const role = guessRole(p);
        const sr   = p.batBalls > 0 ? ((p.batRuns / p.batBalls) * 100).toFixed(0) : '—';
        return `<div class="player-result-row" onclick="addPlayer(${JSON.stringify({ name: p.name, role }).replace(/"/g,'&quot;')})">
            <div>
                <div class="player-result-name">${esc(p.name)}</div>
                <div class="player-result-meta">
                    <span>${p.batBalls || 0} balls faced</span>
                    <span>SR ${sr}</span>
                    <span>${p.wkts || 0} wkts</span>
                </div>
            </div>
            <span class="role-tag ${role}">${role}</span>
        </div>`;
    }).join('');
}

window.addPlayer = function(player) {
    if (mySquad.length >= 11) { alert('XI is complete — remove a player first.'); return; }
    if (mySquad.find(p => p.name === player.name)) { alert('Player already in squad.'); return; }
    mySquad.push({ name: player.name, role: player.role || 'ALL' });
    document.getElementById('playerSearch').value = '';
    document.getElementById('playerResults').style.display = 'none';
    renderMySquad();
    renderBowlingAlloc();
};

function handleXiUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const lines = ev.target.result.split('\n').filter(l => l.trim());
        const parsed = [];
        for (const line of lines) {
            const [name, role] = line.split(',').map(s => s.trim());
            if (name && name.toLowerCase() !== 'name') {
                parsed.push({ name, role: normalizeRole(role) });
            }
        }
        if (parsed.length > 11) { alert('CSV has more than 11 players. Using first 11.'); }
        mySquad = parsed.slice(0, 11);
        renderMySquad();
        renderBowlingAlloc();
    };
    reader.readAsText(file);
}

function renderMySquad() {
    const ul = document.getElementById('mySquadList');
    const countEl = document.getElementById('mySquadCount');
    if (!mySquad.length) {
        ul.innerHTML = `<li style="text-align:center;padding:20px;font-family:var(--mono);font-size:10px;color:var(--dim);">No players selected</li>`;
        countEl.textContent = '0 / 11';
        countEl.style.color = 'var(--dim)';
        return;
    }
    ul.innerHTML = mySquad.map((p, i) => `
        <li class="squad-item${i === 0 ? ' captain' : ''}">
            <span class="squad-pos">${i + 1}</span>
            <span class="player-name">${esc(p.name)}</span>
            <span class="role-tag ${p.role}">${p.role}</span>
            <button class="squad-remove" onclick="removePlayer(${i})">✕</button>
        </li>`).join('');
    countEl.textContent = `${mySquad.length} / 11`;
    countEl.style.color = mySquad.length === 11 ? 'var(--green)' : 'var(--yellow)';
}

window.removePlayer = function(idx) {
    mySquad.splice(idx, 1);
    renderMySquad();
    renderBowlingAlloc();
};

function renderOppSquad(squad) {
    const ul = document.getElementById('oppSquadList');
    ul.innerHTML = squad.map((p, i) => `
        <li class="squad-item${i === 0 ? ' captain' : ''}">
            <span class="squad-pos">${i + 1}</span>
            <span class="player-name">${esc(p.name)}</span>
            <span class="role-tag ${p.role || 'ALL'}">${p.role || 'ALL'}</span>
        </li>`).join('');
}

// ─── BOWLING ALLOCATION ─────────────────────────────────────────────
function renderBowlingAlloc() {
    const container = document.getElementById('bowlingAllocation');
    const totalEl   = document.getElementById('bowlersTotalLabel');
    const bowlers   = mySquad.filter(p => p.role === 'BOWL' || p.role === 'ALL');

    if (!bowlers.length) {
        container.innerHTML = `<p style="font-family:var(--mono);font-size:10px;color:var(--dim);text-align:center;padding:12px;">Add bowlers/all-rounders to allocate overs</p>`;
        return;
    }

    // Default allocation: spread 20 overs
    if (!Object.keys(bowlingAlloc).length) {
        const perBowler = Math.floor(20 / bowlers.length);
        bowlers.forEach((p, i) => {
            bowlingAlloc[p.name] = i < 20 % bowlers.length ? perBowler + 1 : perBowler;
        });
    }

    container.innerHTML = bowlers.map(p => `
        <div class="bowling-row">
            <span class="bowling-row-name">${esc(p.name)}</span>
            <input type="number" class="bowling-overs-input" 
                min="0" max="4" value="${bowlingAlloc[p.name] || 0}"
                onchange="updateBowlingAlloc('${p.name.replace(/'/g,"\\'")}',(+this.value))">
            <span style="font-family:var(--mono);font-size:10px;color:var(--dim);">ov</span>
        </div>`).join('');

    updateBowlTotal();
}

window.updateBowlingAlloc = function(name, val) {
    bowlingAlloc[name] = val;
    updateBowlTotal();
};

function updateBowlTotal() {
    const total = Object.values(bowlingAlloc).reduce((s, v) => s + (+v || 0), 0);
    const el = document.getElementById('bowlersTotalLabel');
    el.textContent = `Total: ${total} / 20 overs`;
    el.className = `bowlers-total ${total === 20 ? 'valid' : 'invalid'}`;
}

// ─── READY ──────────────────────────────────────────────────────────
async function markReady() {
    if (mySquad.length !== 11) { alert('Select exactly 11 players before confirming.'); return; }
    const total = Object.values(bowlingAlloc).reduce((s, v) => s + (+v || 0), 0);
    if (total !== 20) { alert(`Bowling allocation must total exactly 20 overs (currently ${total}).`); return; }

    await SIM_ROOM.child(`players/${MY_SLOT}`).update({
        squad: mySquad,
        bowlingAlloc,
        ready: true,
    });
}

// ─── TOSS ────────────────────────────────────────────────────────────
async function startToss() {
    try {
        await SIM_ROOM.child('status').set('toss');

        const overlay = document.getElementById('tossOverlay');
        overlay.style.display = 'flex';
        document.getElementById('tossStuck').style.display = 'none'; // hide escape hatch

        // Safe player name reads with fallbacks
        const p1 = roomData?.players?.team1?.playerName || 'Team 1';
        const p2 = roomData?.players?.team2?.playerName || 'Team 2';
        const winner = Math.random() < 0.5 ? 'team1' : 'team2';
        const winnerName = winner === 'team1' ? p1 : p2;

        await new Promise(r => setTimeout(r, 1200));

        document.getElementById('tossWinner').textContent = winnerName;
        document.getElementById('tossWinSub').textContent = 'won the toss';
        await SIM_ROOM.child('toss').set({ winner });

        if (MY_SLOT === winner) {
            document.getElementById('tossChoiceRow').style.display = 'flex';
        } else {
            document.getElementById('tossWinSub').textContent = 'won the toss — making their choice…';
            SIM_ROOM.child('toss/decision').on('value', async snap => {
                if (!snap.val()) return;
                const decision = snap.val();
                document.getElementById('tossDecisionDisplay').style.display = 'block';
                document.getElementById('tossDecisionDisplay').textContent = `Elected to ${decision} first`;
                document.getElementById('tossChoiceRow').style.display = 'none';
                await new Promise(r => setTimeout(r, 2000));
                overlay.style.display = 'none';
                beginMatch(winner, decision);
            });
        }
    } catch (err) {
        console.error('startToss failed:', err);
        tossStarted = false;
        tossOverlayShownTeam1 = false;
    }
}

window.chooseToss = async function(choice) {
    document.getElementById('tossChoiceRow').style.display = 'none';
    const display = document.getElementById('tossDecisionDisplay');
    display.style.display = 'block';
    display.textContent = `You elected to ${choice} first`;
    await SIM_ROOM.child('toss/decision').set(choice);
    await new Promise(r => setTimeout(r, 1800));
    document.getElementById('tossOverlay').style.display = 'none';
    const tossSnap = await SIM_ROOM.child('toss').once('value');
    beginMatch(tossSnap.val().winner, choice);
};

window.retryToss = async function() {
    // Called by the escape-hatch button. Clears stale Firebase toss data
    // and re-runs the toss from scratch (team1 / host only).
    if (MY_SLOT !== 'team1') return;
    document.getElementById('tossStuck').style.display = 'none';
    document.getElementById('tossWinSub').textContent = 'Flipping coin…';
    await SIM_ROOM.child('toss').remove();
    tossStarted = false;
    tossOverlayShownTeam1 = false;
    matchStarted = false;
    tossStarted = true;
    startToss();
};

// ─── TOSS (TEAM1 SIDE — RECONNECT) ──────────────────────────────────────────
// Called on team1's client whenever syncPhase sees status === 'toss'.
// If startToss() already ran this session (tossStarted === true) the overlay
// is already visible and we do nothing.  On a fresh page-load / reconnect
// tossStarted is false, so we read the current toss state from Firebase and
// restore the right UI: show the bat/bowl choice if team1 won and no decision
// has been made yet, wait for team2's decision otherwise, or fast-forward
// straight into beginMatch() if a decision already exists.
let tossOverlayShownTeam1 = false;
async function initTossForTeam1() {
    // If startToss() is still live this session, its overlay is already up.
    if (tossStarted) return;
    if (tossOverlayShownTeam1) return;
    tossOverlayShownTeam1 = true;

    // Poll until team1 has written toss.winner (written by startToss on the
    // originating session; may not be there yet on a fast reconnect).
    let toss = null;
    for (let i = 0; i < 10; i++) {
        const snap = await SIM_ROOM.child('toss').once('value');
        toss = snap.val();
        if (toss?.winner) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!toss?.winner) {
        // Toss data was never written (startToss crashed mid-way).
        // Show overlay with the escape-hatch retry button so the user can act.
        const overlay = document.getElementById('tossOverlay');
        overlay.style.display = 'flex';
        document.getElementById('tossWinner').textContent = '';
        document.getElementById('tossWinSub').textContent = 'Toss interrupted — please retry';
        if (MY_SLOT === 'team1') {
            document.getElementById('tossStuck').style.display = 'block';
        }
        return;
    }

    const overlay = document.getElementById('tossOverlay');
    overlay.style.display = 'flex';

    const winnerName = roomData.players[toss.winner]?.playerName || toss.winner;
    document.getElementById('tossWinner').textContent = winnerName;

    if (toss.decision) {
        // Decision was already made before we reconnected — skip straight to match.
        document.getElementById('tossWinSub').textContent = 'won the toss';
        document.getElementById('tossDecisionDisplay').style.display = 'block';
        document.getElementById('tossDecisionDisplay').textContent = `Elected to ${toss.decision} first`;
        document.getElementById('tossChoiceRow').style.display = 'none';
        await new Promise(r => setTimeout(r, 1500));
        overlay.style.display = 'none';
        if (!matchStarted) beginMatch(toss.winner, toss.decision);
    } else if (MY_SLOT === toss.winner) {
        // Team1 won the toss and still needs to choose.
        document.getElementById('tossWinSub').textContent = 'You won the toss!';
        document.getElementById('tossChoiceRow').style.display = 'flex';
        // chooseToss() will handle the rest when the user clicks Bat / Bowl.
    } else {
        // Team2 won — wait for their decision.
        document.getElementById('tossWinSub').textContent =
            `${winnerName} won the toss — making their choice…`;
        SIM_ROOM.child('toss/decision').on('value', async snap => {
            if (!snap.val()) return;
            SIM_ROOM.child('toss/decision').off('value');
            const decision = snap.val();
            document.getElementById('tossDecisionDisplay').style.display = 'block';
            document.getElementById('tossDecisionDisplay').textContent =
                `Elected to ${decision} first`;
            document.getElementById('tossChoiceRow').style.display = 'none';
            await new Promise(r => setTimeout(r, 2000));
            overlay.style.display = 'none';
            if (!matchStarted) beginMatch(toss.winner, decision);
        });
    }
}

// ─── TOSS (TEAM2 SIDE) ──────────────────────────────────────────────────────
// Called on team2's client when Firebase status switches to 'toss'.
// Shows the toss overlay, gives team2 the bat/bowl choice if they won, or
// waits for team1's decision otherwise.
let tossOverlayShown = false;
async function initTossForTeam2() {
    if (tossOverlayShown) return;
    tossOverlayShown = true;

    // Poll until team1 has written toss.winner (may arrive slightly after status flip)
    let toss = null;
    for (let i = 0; i < 10; i++) {
        const snap = await SIM_ROOM.child('toss').once('value');
        toss = snap.val();
        if (toss?.winner) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!toss?.winner) return;

    const overlay = document.getElementById('tossOverlay');
    overlay.style.display = 'flex';

    const winnerName = roomData.players[toss.winner]?.playerName || toss.winner;
    document.getElementById('tossWinner').textContent = winnerName;

    if (MY_SLOT === toss.winner) {
        // Team2 won the toss — let them choose
        document.getElementById('tossWinSub').textContent = 'You won the toss!';
        document.getElementById('tossChoiceRow').style.display = 'flex';
    } else {
        // Team1 won — wait for their decision
        document.getElementById('tossWinSub').textContent = 'won the toss — making their choice…';
        SIM_ROOM.child('toss/decision').on('value', async snap => {
            if (!snap.val()) return;
            SIM_ROOM.child('toss/decision').off('value');
            const decision = snap.val();
            document.getElementById('tossDecisionDisplay').style.display = 'block';
            document.getElementById('tossDecisionDisplay').textContent = `Elected to ${decision} first`;
            document.getElementById('tossChoiceRow').style.display = 'none';
            await new Promise(r => setTimeout(r, 2000));
            overlay.style.display = 'none';
            // Match simulation will start via syncPhase → startSimulationFromFirebase
            // when Firebase status flips to 'live'
        });
    }
}

// ─── SIMULATION INIT FROM FIREBASE ──────────────────────────────────────────
// Called when status becomes 'live' and this client hasn't started the simulation
// yet (i.e. team2, or any late-joining spectator).  Reads the match/toss data
// that team1 already wrote and starts a local simulation run.
async function startSimulationFromFirebase() {
    if (matchStarted || matchState) return;
    matchStarted = true;

    const matchSnap = await SIM_ROOM.child('match').once('value');
    const match = matchSnap.val();
    if (!match?.team1Slot) { matchStarted = false; return; }

    const tossSnap = await SIM_ROOM.child('toss').once('value');
    const toss = tossSnap.val();
    if (!toss?.decision) { matchStarted = false; return; }

    if (!leagueStats && roomData.league) {
        await loadLeagueData(roomData.league);
    }

    // Reconstruct the same team assignments team1 used
    const { team1Slot, team2Slot } = match;
    const t1data = roomData.players[team1Slot];
    const t2data = roomData.players[team2Slot];

    const t1 = { name: t1data.playerName, squad: t1data.squad || [], franchise: t1data.franchise, bowlingAlloc: t2data.bowlingAlloc || {} };
    const t2 = { name: t2data.playerName, squad: t2data.squad || [], franchise: t2data.franchise, bowlingAlloc: t1data.bowlingAlloc || {} };

    const state1 = createMatchState(
        { name: t1.name, squad: t1.squad, bowlingAlloc: t2.bowlingAlloc },
        { name: t2.name, squad: t2.squad, bowlingAlloc: t1.bowlingAlloc },
        true
    );

    showMatch();
    runInnings(state1, 1, t1, t2);
}


async function beginMatch(tossWinner, decision) {
    if (matchStarted) return;   // guard against double-call on reconnect
    matchStarted = true;   // prevent startSimulationFromFirebase() from double-running on team1
    const batFirstSlot = decision === 'bat' ? tossWinner : (tossWinner === 'team1' ? 'team2' : 'team1');
    const team1Slot = batFirstSlot;
    const team2Slot = team1Slot === 'team1' ? 'team2' : 'team1';

    const t1data = roomData.players[team1Slot];
    const t2data = roomData.players[team2Slot];

    const t1 = { name: t1data.playerName, squad: t1data.squad || [], franchise: t1data.franchise, bowlingAlloc: t2data.bowlingAlloc || {} };
    const t2 = { name: t2data.playerName, squad: t2data.squad || [], franchise: t2data.franchise, bowlingAlloc: t1data.bowlingAlloc || {} };

    // Note: t1 bats, t2 bowls in inning 1; t2 bats, t1 bowls in inning 2
    // We actually want team batting first's squad to be battingSquad
    // and the other team's bowlingAlloc to be used
    const state1 = createMatchState(
        { name: t1.name, squad: t1.squad, bowlingAlloc: t2.bowlingAlloc },
        { name: t2.name, squad: t2.squad, bowlingAlloc: t1.bowlingAlloc },
        true
    );

    await SIM_ROOM.child('status').set('live');
    await SIM_ROOM.child('match').set({ batFirstSlot, team1Slot, team2Slot, inning: 1 });

    showMatch();
    runInnings(state1, 1, t1, t2);
}

function showMatch() {
    document.getElementById('waitingPhase').style.display = 'none';
    document.getElementById('setupPhase').style.display = 'none';
    document.getElementById('matchPhase').style.display = 'block';
}

async function runInnings(state, inningNum, battingTeam, fieldingTeam) {
    matchState = state;
    simPaused = false;

    // Ensure bowler is set
    if (!state.currentBowler) {
        state.currentBowler = chooseBowlerFromState(state);
    }

    updateMatchUI(state, inningNum);

    simInterval = setInterval(async () => {
        if (simPaused || state.complete) {
            clearInterval(simInterval);
            if (state.complete) {
                if (inningNum === 1) {
                    await endFirstInnings(state, battingTeam, fieldingTeam);
                } else {
                    endMatch(state, battingTeam, fieldingTeam);
                }
            }
            return;
        }

        const ev = simulateDelivery(state, leagueStats || { batters:{}, bowlers:{}, matchup:{}, leagueAvg:null });
        applyDelivery(state, ev);
        updateMatchUI(state, inningNum);
        pushFeedEntry(ev);

        // Sync to Firebase every over
        if (state.ball === 1 && !ev.isExtra) {
            await SIM_ROOM.child(`match/inning${inningNum}`).set({
                runs: state.runs, wickets: state.wickets, overs: state.over,
            });
        }
    }, simSpeed);
}

function chooseBowlerFromState(state) {
    const bowlers = state.bowlingSquad.filter(p => p.role === 'BOWL' || p.role === 'ALL');
    return bowlers.length ? bowlers[0].name : state.bowlingSquad[state.bowlingSquad.length - 1]?.name;
}

async function endFirstInnings(state1, t1, t2) {
    const target = state1.runs + 1;
    document.getElementById('inningsBreakOverlay').style.display = 'flex';
    document.getElementById('inningsBreakScore').textContent = `${state1.runs}/${state1.wickets}`;
    document.getElementById('inningsBreakTarget').textContent = `Target: ${target}`;

    await SIM_ROOM.child('match/inning1Final').set({ runs: state1.runs, wickets: state1.wickets });

    // Countdown
    let n = 5;
    const cd = document.getElementById('breakCountdown');
    const iv = setInterval(() => {
        n--;
        cd.textContent = n;
        if (n <= 0) {
            clearInterval(iv);
            document.getElementById('inningsBreakOverlay').style.display = 'none';
            // Start 2nd innings
            const state2 = createMatchState(
                { name: t2.name, squad: t2.squad, bowlingAlloc: t1.bowlingAlloc },
                { name: t1.name, squad: t1.squad, bowlingAlloc: t2.bowlingAlloc },
                true
            );
            state2.target = target;

            document.getElementById('targetBanner').style.display = 'flex';
            document.getElementById('targetVal').textContent = target;

            document.getElementById('inningTab2').classList.add('active');
            runInnings(state2, 2, t2, t1);
        }
    }, 1000);
}

function endMatch(state2, battingTeam, fieldingTeam) {
    let winner, margin, marginType;
    if (state2.chaseWin) {
        winner = battingTeam.name;
        const wicketsLeft = 10 - state2.wickets;
        margin = wicketsLeft;
        marginType = `wicket${wicketsLeft !== 1 ? 's' : ''}`;
    } else {
        // Bowling team won
        winner = fieldingTeam.name;
        const i1Snap = matchState?.innings?.[0];
        const target = state2.target || 0;
        margin = target - 1 - state2.runs;
        marginType = `run${margin !== 1 ? 's' : ''}`;
    }

    // Show result overlay
    document.getElementById('resultOverlay').style.display = 'flex';
    document.getElementById('resultTitle').textContent = winner;
    document.getElementById('resultSubtitle').textContent = `Won by ${margin} ${marginType}`;
    document.getElementById('resultTrophy').textContent = '🏆';

    const statsGrid = document.getElementById('resultStats');
    const crr = getCRR(state2);
    statsGrid.innerHTML = `
        <div class="result-stat-box"><div class="result-stat-val">${state2.runs}/${state2.wickets}</div><div class="result-stat-lbl">2nd Innings</div></div>
        <div class="result-stat-box"><div class="result-stat-val">${crr}</div><div class="result-stat-lbl">Final CRR</div></div>
        <div class="result-stat-box"><div class="result-stat-val">${margin}</div><div class="result-stat-lbl">${marginType}</div></div>
    `;

    SIM_ROOM.child('status').set('done');
    SIM_ROOM.child('match/result').set({ winner, margin, marginType });
}

// ─── UI UPDATES ──────────────────────────────────────────────────────
function updateMatchUI(state, inningNum) {
    document.getElementById('battingTeamName').textContent = state.battingTeam || '—';
    document.getElementById('liveScore').textContent       = `${state.runs}/${state.wickets}`;
    document.getElementById('liveOvers').textContent       = `${state.over}.${Math.max(0, state.ball - 1)} ov`;
    document.getElementById('vsLabel').textContent         = `vs ${state.fieldingTeam || '—'}`;
    document.getElementById('crrVal').textContent          = getCRR(state);
    document.getElementById('last5Val').textContent        = getLast5(state);
    document.getElementById('extrasVal').textContent       =
        Object.values(state.extras).reduce((s, v) => s + v, 0);

    // Batters
    const str = state.batters.striker;
    const ns  = state.batters.nonStriker;
    document.getElementById('strikerName').textContent = str?.name || '—';
    document.getElementById('strikerRuns').textContent = str?.runs || 0;
    document.getElementById('strikerBalls').textContent = str?.balls || 0;
    document.getElementById('strikerSR').textContent = str?.balls ? ((str.runs / str.balls) * 100).toFixed(1) : '—';
    document.getElementById('nonStrikerName').textContent = ns?.name || '—';
    document.getElementById('nsRuns').textContent = ns?.runs || 0;
    document.getElementById('nsBalls').textContent = ns?.balls || 0;

    // Bowler
    const bw = state.currentBowler;
    const bwState = state.bowlerStates[bw] || {};
    document.getElementById('bowlerName').textContent  = bw || '—';
    document.getElementById('bowlerWkts').textContent  = bwState.wkts || 0;
    document.getElementById('bowlerRuns').textContent  = bwState.runs || 0;
    document.getElementById('bowlerOvs').textContent   = bwState.overs || 0;

    // Over balls
    renderOverBalls(state.overBalls);

    // Scorecards
    renderBattingScorecard(state);
    renderBowlingScorecard(state);
    renderFOW(state);

    // Target banner (2nd innings)
    if (state.target) {
        const ballsLeft = (20 * 6) - state.legalBalls;
        const need = state.target - state.runs;
        const rrr = ballsLeft > 0 ? ((need / ballsLeft) * 6).toFixed(2) : '—';
        document.getElementById('needVal').textContent      = Math.max(0, need);
        document.getElementById('ballsLeftVal').textContent = Math.max(0, ballsLeft);
        document.getElementById('rrrVal').textContent       = rrr;
    }
}

function renderOverBalls(balls) {
    const container = document.getElementById('overBalls');
    const CLASS_MAP = {
        dot: 'dot', one: 'run1', two: 'run1', three: 'run1',
        four: 'run4', six: 'run6', wkt: 'wkt', wide: 'wide', noball: 'noball',
    };
    const LABEL = {
        dot: '·', one: '1', two: '2', three: '3',
        four: '4', six: '6', wkt: 'W', wide: 'Wd', noball: 'Nb',
    };
    container.innerHTML = (balls || []).map(b => {
        const cls = CLASS_MAP[b.type] || 'dot';
        const lbl = b.isWkt ? 'W' : LABEL[b.type] || b.runs;
        return `<div class="ball-icon ${cls}">${lbl}</div>`;
    }).join('');
}

function renderBattingScorecard(state) {
    const tbody = document.getElementById('battingScorecard');
    const inPlay = [state.batters.striker?.name, state.batters.nonStriker?.name];
    const allBatted = {};

    // Collect from feed
    for (const e of state.feed) {
        if (!allBatted[e.batter]) allBatted[e.batter] = { name: e.batter, runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
        const b = allBatted[e.batter];
        if (!e.isExtra || e.extraType === 'noball') {
            b.runs  += e.runs;
            b.balls++;
        }
        if (e.outcome === 'four') b.fours++;
        if (e.outcome === 'six')  b.sixes++;
    }

    // Mark wickets
    for (const fow of state.fallOfWickets) allBatted[fow.batter] && (allBatted[fow.batter].out = true);

    tbody.innerHTML = Object.values(allBatted).map(b => {
        const isCrease = inPlay.includes(b.name);
        const sr = b.balls ? ((b.runs / b.balls) * 100).toFixed(1) : '—';
        return `<tr class="${isCrease ? 'batting' : ''}">
            <td class="${isCrease ? 'highlight' : ''}">${esc(b.name)}${isCrease ? ' *' : ''}</td>
            <td class="highlight">${b.runs}</td><td>${b.balls}</td>
            <td>${b.fours}</td><td>${b.sixes}</td><td>${sr}</td>
        </tr>`;
    }).join('');
}

function renderBowlingScorecard(state) {
    const tbody = document.getElementById('bowlingScorecard');
    tbody.innerHTML = Object.entries(state.bowlerStates).map(([name, bs]) => {
        const eco = bs.balls ? ((bs.runs / bs.balls) * 6).toFixed(2) : '—';
        return `<tr>
            <td class="${name === state.currentBowler ? 'highlight' : ''}">${esc(name)}</td>
            <td>${bs.overs}</td><td>${bs.runs}</td><td class="highlight">${bs.wkts}</td><td>${eco}</td>
        </tr>`;
    }).join('');
}

function renderFOW(state) {
    const tbody = document.getElementById('fowScorecard');
    tbody.innerHTML = state.fallOfWickets.map(f => `
        <tr>
            <td>${f.wicket}</td>
            <td>${esc(f.batter)}</td>
            <td class="highlight">${f.score}</td>
            <td>${f.over}</td>
        </tr>`).join('');
}

// ─── FEED ────────────────────────────────────────────────────────────
function pushFeedEntry(ev) {
    const feed = document.getElementById('ballFeed');
    const el = document.createElement('div');
    el.className = 'feed-entry';

    const outcomeClass = ev.isWkt ? 'wicket' : ev.outcome === 'six' ? 'six' : ev.outcome === 'four' ? 'four' : ev.outcome === 'dot' ? 'dot' : '';
    const badge = ev.isWkt ? `<span class="feed-outcome wicket">W</span>` :
        ev.outcome === 'six' ? `<span class="feed-outcome six">6</span>` :
        ev.outcome === 'four' ? `<span class="feed-outcome four">4</span>` :
        ev.runs > 0 ? `<span class="feed-outcome" style="background:rgba(0,229,255,.1);color:var(--accent);">${ev.runs}</span>` :
        `<span class="feed-outcome dot">•</span>`;

    el.innerHTML = `<div class="feed-ball-id">${ev.overBall} · ${esc(ev.batter)} vs ${esc(ev.bowler)}</div>
        <div class="feed-text">${ev.commentary}${badge}</div>`;
    feed.prepend(el);

    // Limit feed length in DOM
    while (feed.children.length > 80) feed.removeChild(feed.lastChild);
}

// ─── SPEED / PAUSE ───────────────────────────────────────────────────
window.setSpeed = function(btn) {
    simSpeed = +btn.dataset.speed;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    clearInterval(simInterval);
    if (matchState && !matchState.complete) {
        const inningNum = viewingInning;
        // Re-run interval
        simInterval = setInterval(() => {
            if (simPaused || matchState.complete) { clearInterval(simInterval); return; }
            const ev = simulateDelivery(matchState, leagueStats || { batters:{}, bowlers:{}, matchup:{}, leagueAvg:null });
            applyDelivery(matchState, ev);
            updateMatchUI(matchState, inningNum);
            pushFeedEntry(ev);
        }, simSpeed);
    }
};

window.togglePause = function() {
    simPaused = !simPaused;
    const btn = document.getElementById('btnPause');
    if (simPaused) { btn.textContent = '▶ RESUME'; btn.classList.add('paused'); }
    else { btn.textContent = '⏸ PAUSE'; btn.classList.remove('paused'); }
};

window.__switchInnings = function(n) {
    viewingInning = n;
    // TODO: load innings 1 state from Firebase for replay
};

// ─── RESULT ──────────────────────────────────────────────────────────
function showResult() {
    document.getElementById('matchPhase').style.display = 'block';
    db.ref(`simulation/rooms/${ROOM_ID}/match/result`).once('value').then(snap => {
        const r = snap.val();
        if (!r) return;
        document.getElementById('resultOverlay').style.display = 'flex';
        document.getElementById('resultTitle').textContent    = r.winner;
        document.getElementById('resultSubtitle').textContent = `Won by ${r.margin} ${r.marginType}`;
    });
}

window.showFinalScorecard = function() {
    document.getElementById('resultOverlay').style.display = 'none';
};

// ─── HELPERS ─────────────────────────────────────────────────────────
function getUID() {
    let uid = sessionStorage.getItem('sim_uid');
    if (!uid) {
        uid = 'u_' + Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem('sim_uid', uid);
    }
    return uid;
}

function getSlot() {
    return sessionStorage.getItem('sim_slot') || 'team1';
}

function guessRole(p) {
    const w = p.wkts || 0;
    const bb = p.bowlBalls || 0;
    const rb = p.batBalls || 0;
    if (bb > 60 && rb > 60) return 'ALL';
    if (bb > 60) return 'BOWL';
    if (rb > 0)  return 'BAT';
    return 'ALL';
}

function normalizeRole(r) {
    if (!r) return 'ALL';
    r = r.toUpperCase().trim();
    if (r === 'BAT' || r === 'BATSMAN' || r === 'BATTER') return 'BAT';
    if (r === 'BOWL' || r === 'BWL' || r === 'BOWLER') return 'BOWL';
    if (r === 'WK' || r === 'WKT' || r === 'KEEPER') return 'WK';
    return 'ALL';
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
