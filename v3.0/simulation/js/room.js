/**
 * Simulation Room — room.js
 * FIXED VERSION - Prevents freezing after toss
 */

const db = firebase.database();
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get('roomId');

if (!ROOM_ID) { 
    location.href = 'index.html'; 
    throw new Error('No roomId'); 
}

const SIM_ROOM = db.ref(`simulation/rooms/${ROOM_ID}`);
const MY_UID = getUID();
let MY_SLOT = getSlot();

let roomData = null;
let leagueStats = null;
let leaguePlayers = [];
let mySquad = [];
let bowlingAlloc = {};
let matchState = null;
let simInterval = null;
let simSpeed = 800;
let simPaused = false;
let viewingInning = 1;
let matchStarted = false;

// ─── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (!ROOM_ID) return;
    bindSetupUI();
    listenRoom();
});

function listenRoom() {
    SIM_ROOM.on('value', snap => {
        roomData = snap.val();
        if (!roomData) { 
            location.href = 'index.html'; 
            return; 
        }
        const detectedSlot = detectMySlot();
        if (detectedSlot) MY_SLOT = detectedSlot;
        syncPhase();
    });
}

function detectMySlot() {
    if (!roomData?.players) return null;
    if (roomData.players.team1?.uid === MY_UID) return 'team1';
    if (roomData.players.team2?.uid === MY_UID) return 'team2';
    return null;
}

// ─── CLEANUP ────────────────────────────────────────────────────────
function cleanupSimulation() {
    if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
    }
    matchStarted = false;
    matchState = null;
}

function syncPhase() {
    if (!roomData) return;

    const status = roomData.status || 'waiting';
    const ind = document.getElementById('phaseIndicator');
    ind.className = `phase-indicator ${status}`;
    ind.textContent = `● ${status.toUpperCase()}`;

    document.getElementById('topRoomName').textContent = roomData.name || 'Room';
    document.getElementById('topRoomCode').textContent = roomData.code || ROOM_ID;
    document.getElementById('topLeague').textContent = roomData.leagueName || roomData.league || '';

    if (status !== 'live') {
        cleanupSimulation();
    }

    if (status === 'waiting') showWaiting();
    else if (status === 'setup') showSetup();
    else if (status === 'toss') {
        showMatch();
        if (MY_SLOT !== 'team1') initTossForTeam2();
    }
    else if (status === 'live') {
        showMatch();
        if (!matchStarted) startSimulationFromFirebase();
    }
    else if (status === 'done') showResult();
}

// ─── SIMULATION START (Fixed) ───────────────────────────────────────
async function startSimulationFromFirebase() {
    if (matchStarted || matchState || simInterval) return;

    matchStarted = true;
    cleanupSimulation(); // extra safety

    const matchSnap = await SIM_ROOM.child('match').once('value');
    const match = matchSnap.val();
    if (!match?.team1Slot) return;

    const tossSnap = await SIM_ROOM.child('toss').once('value');
    const toss = tossSnap.val();
    if (!toss?.decision) return;

    if (!leagueStats && roomData.league) {
        await loadLeagueData(roomData.league);
    }

    const t1data = roomData.players[match.team1Slot];
    const t2data = roomData.players[match.team2Slot];

    const t1 = { name: t1data.playerName, squad: t1data.squad || [], bowlingAlloc: t2data.bowlingAlloc || {} };
    const t2 = { name: t2data.playerName, squad: t2data.squad || [], bowlingAlloc: t1data.bowlingAlloc || {} };

    const state1 = createMatchState(t1, t2, true);
    runInnings(state1, 1, t1, t2);
}

async function beginMatch(tossWinner, decision) {
    if (matchStarted) return;
    matchStarted = true;
    cleanupSimulation();

    // ... (rest of your beginMatch logic remains the same)
    const batFirstSlot = decision === 'bat' ? tossWinner : (tossWinner === 'team1' ? 'team2' : 'team1');
    const team1Slot = batFirstSlot;
    const team2Slot = team1Slot === 'team1' ? 'team2' : 'team1';

    const t1data = roomData.players[team1Slot];
    const t2data = roomData.players[team2Slot];

    const t1 = { name: t1data.playerName, squad: t1data.squad || [], bowlingAlloc: t2data.bowlingAlloc || {} };
    const t2 = { name: t2data.playerName, squad: t2data.squad || [], bowlingAlloc: t1data.bowlingAlloc || {} };

    const state1 = createMatchState(t1, t2, true);

    await SIM_ROOM.child('status').set('live');
    await SIM_ROOM.child('match').set({ batFirstSlot, team1Slot, team2Slot, inning: 1 });

    showMatch();
    runInnings(state1, 1, t1, t2);
}

// ─── MAIN SIMULATION LOOP (Fixed) ───────────────────────────────────
function runInnings(state, inningNum, battingTeam, fieldingTeam) {
    cleanupSimulation(); // ensure no old interval

    matchState = state;
    simPaused = false;

    if (!state.currentBowler) {
        state.currentBowler = chooseBowlerFromState(state);
    }

    updateMatchUI(state, inningNum);

    simInterval = setInterval(() => {
        if (simPaused || state.complete) {
            clearInterval(simInterval);
            simInterval = null;
            if (state.complete) {
                if (inningNum === 1) endFirstInnings(state, battingTeam, fieldingTeam);
                else endMatch(state, battingTeam, fieldingTeam);
            }
            return;
        }

        const ev = simulateDelivery(state, leagueStats || { batters:{}, bowlers:{}, matchup:{}, leagueAvg:null });
        applyDelivery(state, ev);
        updateMatchUI(state, inningNum);
        pushFeedEntry(ev);

        // Non-blocking sync
        if (state.ball === 1 && !ev.isExtra) {
            SIM_ROOM.child(`match/inning${inningNum}`).set({
                runs: state.runs, 
                wickets: state.wickets, 
                overs: state.over
            }).catch(() => {});
        }
    }, simSpeed);
}

// Add this at the bottom
window.addEventListener('beforeunload', cleanupSimulation);
