/**
 * Simulation Lobby — lobby.js
 * Handles room listing, creation, joining.
 */

const db = firebase.database();
const SIM_REF = db.ref('simulation');

let allRooms = {};
let leagueFilter = 'all';
let pendingRoomId = null;

// ─── INIT ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadLeagues();
    listenRooms();

    document.getElementById('btnOpenCreate').addEventListener('click', openCreateModal);
    document.getElementById('btnCancelCreate').addEventListener('click', () => document.getElementById('createModal').style.display = 'none');
    document.getElementById('btnConfirmCreate').addEventListener('click', createRoom);
    document.getElementById('btnCancelJoin').addEventListener('click', () => document.getElementById('joinModal').style.display = 'none');
    document.getElementById('btnConfirmJoin').addEventListener('click', confirmJoin);
    document.getElementById('btnRefresh').addEventListener('click', () => renderRooms());
    document.getElementById('btnJoinByCode').addEventListener('click', () => {
        const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
        if (!code) return;
        const roomId = Object.keys(allRooms).find(id => id.toUpperCase() === code || allRooms[id].code === code);
        if (roomId) openJoinModal(roomId);
        else alert('Room not found. Check the code and try again.');
    });
});

// ─── LEAGUES ─────────────────────────────────────────────────────
async function loadLeagues() {
    const snap = await db.ref('simulation_data/leagues').once('value');
    const leagues = snap.val() || {};
    const filterBar = document.getElementById('leagueFilter');
    const createSel = document.getElementById('createLeague');
    createSel.innerHTML = '';

    if (!Object.keys(leagues).length) {
        createSel.innerHTML = '<option value="">No leagues uploaded yet — use Admin to add</option>';
    }

    for (const [key, lg] of Object.entries(leagues)) {
        // filter pill
        const pill = document.createElement('div');
        pill.className = 'league-pill';
        pill.dataset.league = key;
        pill.textContent = lg.shortName || lg.name;
        pill.addEventListener('click', () => {
            document.querySelectorAll('.league-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            leagueFilter = key;
            renderRooms();
        });
        filterBar.appendChild(pill);

        // create select
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${lg.name} (${lg.season || ''})`;
        createSel.appendChild(opt);
    }

    // Load global teams for franchise select
    loadFranchisesIntoSelect('createFranchise');
    loadFranchisesIntoSelect('joinFranchise');
}

async function loadFranchisesIntoSelect(selectId) {
    const sel = document.getElementById(selectId);
    sel.innerHTML = '<option value="">— No franchise —</option>';
    const snap = await db.ref('global_teams').once('value');
    const teams = snap.val() || {};
    for (const [code, t] of Object.entries(teams)) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${t.name || code} (${code})`;
        sel.appendChild(opt);
    }
}

// ─── ROOMS LISTENER ──────────────────────────────────────────────
function listenRooms() {
    SIM_REF.child('rooms').on('value', snap => {
        allRooms = snap.val() || {};
        renderRooms();
    });
}

function renderRooms() {
    const grid = document.getElementById('roomsGrid');
    const countEl = document.getElementById('roomCount');

    let rooms = Object.entries(allRooms);
    if (leagueFilter !== 'all') {
        rooms = rooms.filter(([, r]) => r.league === leagueFilter);
    }
    // Sort: waiting/setup first, done last
    const ORDER = { waiting: 0, setup: 1, live: 2, done: 3 };
    rooms.sort((a, b) => (ORDER[a[1].status] || 0) - (ORDER[b[1].status] || 0));

    countEl.textContent = rooms.length;

    if (!rooms.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
            <div class="empty-icon">🏟️</div>
            <p>No rooms yet — create one to start simulating</p>
        </div>`;
        return;
    }

    grid.innerHTML = rooms.map(([id, r]) => {
        const status  = r.status || 'waiting';
        const p1 = r.players?.team1;
        const p2 = r.players?.team2;

        return `<div class="room-card status-${status}" onclick="handleRoomClick('${id}')">
            <div class="room-card-top">
                <div class="room-name">${esc(r.name)}</div>
                <div class="room-status-badge">${status.toUpperCase()}</div>
            </div>
            <div class="room-league">${esc(r.leagueName || r.league || '—')}</div>
            <div class="room-players">
                <div class="room-player-slot ${p1 ? 'filled' : ''}">
                    ${p1 ? `<span>🏏 ${esc(p1.playerName)}</span>` : 'Slot 1 — Open'}
                </div>
                <div class="room-player-slot ${p2 ? 'filled' : ''}">
                    ${p2 ? `<span>🏏 ${esc(p2.playerName)}</span>` : 'Slot 2 — Open'}
                </div>
            </div>
            <button class="room-join-btn" ${status === 'done' ? 'disabled' : ''}>
                ${status === 'done' ? 'Match Completed' : 
                  status === 'live' ? '📺 Watch Live' :
                  (p1 && p2) ? '🔒 Room Full' : '+ Join Room'}
            </button>
        </div>`;
    }).join('');
}

function handleRoomClick(roomId) {
    const room = allRooms[roomId];
    if (!room) return;

    const p1Filled = !!room.players?.team1;
    const p2Filled = !!room.players?.team2;

    if (room.status === 'done') return;
    if (room.status === 'live' || (p1Filled && p2Filled)) {
        // Navigate directly (spectate or rejoin)
        window.location.href = `room.html?roomId=${roomId}`;
        return;
    }
    openJoinModal(roomId);
}

// ─── CREATE ROOM ─────────────────────────────────────────────────
function openCreateModal() {
    document.getElementById('createRoomName').value = '';
    document.getElementById('createPlayerName').value = '';
    document.getElementById('createModal').style.display = 'flex';
}

async function createRoom() {
    const name = document.getElementById('createRoomName').value.trim();
    const leagueKey  = document.getElementById('createLeague').value;
    const playerName = document.getElementById('createPlayerName').value.trim();
    const franchise  = document.getElementById('createFranchise').value;

    if (!name) return alert('Room name is required.');
    if (!leagueKey) return alert('Please select a league dataset first.');
    if (!playerName) return alert('Enter your player name.');

    const leagueSnap = await db.ref(`simulation_data/leagues/${leagueKey}`).once('value');
    const leagueData = leagueSnap.val() || {};

    // Generate short room ID
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();

    const uid = getUID();
    const roomData = {
        name,
        code,
        league: leagueKey,
        leagueName: leagueData.name || leagueKey,
        status: 'waiting',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        players: {
            team1: {
                uid,
                playerName,
                franchise: franchise || null,
                ready: false,
                squad: null,
            }
        }
    };

    try {
        const ref = SIM_REF.child('rooms').push();
        await ref.set(roomData);
        document.getElementById('createModal').style.display = 'none';
        saveUID(uid, ref.key, 'team1');
        window.location.href = `room.html?roomId=${ref.key}`;
    } catch (err) {
        console.error('Create room failed:', err);
        alert('Failed to create room. Check your connection and try again.');
    }
}

// ─── JOIN ROOM ────────────────────────────────────────────────────
function openJoinModal(roomId) {
    pendingRoomId = roomId;
    const room = allRooms[roomId];
    document.getElementById('joinModalTitle').textContent = `Join: ${room.name}`;
    document.getElementById('joinModalSub').textContent = `League: ${room.leagueName || room.league}`;
    document.getElementById('joinPlayerName').value = '';
    document.getElementById('joinModal').style.display = 'flex';
}

async function confirmJoin() {
    const playerName = document.getElementById('joinPlayerName').value.trim();
    const franchise  = document.getElementById('joinFranchise').value;
    if (!playerName) return alert('Enter your name.');

    const room = allRooms[pendingRoomId];
    if (!room) return;

    // Determine slot
    const slot = room.players?.team1 ? 'team2' : 'team1';

    const uid = getUID();
    try {
        await SIM_REF.child(`rooms/${pendingRoomId}/players/${slot}`).set({
            uid,
            playerName,
            franchise: franchise || null,
            ready: false,
            squad: null,
        });

        // Update status to setup if both slots filled
        if (slot === 'team2') {
            await SIM_REF.child(`rooms/${pendingRoomId}/status`).set('setup');
        }

        document.getElementById('joinModal').style.display = 'none';
        saveUID(uid, pendingRoomId, slot);
        window.location.href = `room.html?roomId=${pendingRoomId}`;
    } catch (err) {
        console.error('Join room failed:', err);
        alert('Failed to join room. Check your connection and try again.');
    }
}

// ─── HELPERS ─────────────────────────────────────────────────────
function getUID() {
    let uid = sessionStorage.getItem('sim_uid');
    if (!uid) {
        uid = 'u_' + Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem('sim_uid', uid);
    }
    return uid;
}

function saveUID(uid, roomId, slot) {
    sessionStorage.setItem('sim_uid', uid);
    sessionStorage.setItem('sim_room', roomId);
    sessionStorage.setItem('sim_slot', slot);
}

function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
