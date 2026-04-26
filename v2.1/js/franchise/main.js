/**
 * main.js (Franchise)
 * The main controller for the Franchise portal.
 */

import { db } from '../shared/firebase.js';
import { state, setRoomState, setMyTeamState, recalculateBudgets } from '../shared/state.js';
import { esc, showAlert, closeModal } from '../shared/dom.js';
import { playSound } from '../shared/audio.js';
import { verifyRoomKey, submitTeamAuth } from '../shared/auth.js';
import { renderDeckList, renderUnsoldList, renderSquadList } from '../shared/render.js';
import { evaluateBidButtonStatus, attachBidListeners } from './bid.js';
import { initDropZones, attachDragEvents, isDragging } from './squad.js';
import { watchlist, initWatchlistListener } from './watchlist.js';

const CRORE = 10_000_000;
let _latestLiveData = null;
let _lastTimerWarnSecond = -1;
let activePopups = {};
let isUserScrollingLog = false;
let pendingCode = '', pendingColor = '', isCustomFlow = false;

// --- Boot Sequence ---

window.onload = function() {
    let savedKey = sessionStorage.getItem('roomKey');
    if (savedKey) {
        setRoomState(savedKey, db.ref('rooms/' + savedKey));
        let savedTeam  = sessionStorage.getItem('myAuctionTeam');
        let savedRep   = sessionStorage.getItem('myRepName');
        let savedColor = sessionStorage.getItem('myTeamColor');
        
        if (savedTeam && savedRep) {
            setMyTeamState(savedTeam, savedRep, savedColor);
            document.getElementById('gatewayScreen').style.display = 'none';
            executeUIBoot();
        } else {
            document.getElementById('gatewayScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display   = 'block';
            loadGlobalFranchises();
        }
    } else {
        document.getElementById('gatewayScreen').style.display = 'flex';
    }

    initDropZones();
    attachBidListeners();

    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        logContainer.addEventListener('scroll', () => {
            isUserScrollingLog = (logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight) >= 15;
        });
    }

    setInterval(updateAllPopups, 500);
};

// --- Login & Gateway Wrappers ---

window.showRoomKeyScreen = () => {
    document.getElementById('gatewayScreen').style.display = 'none';
    document.getElementById('roomKeyScreen').style.display = 'flex';
};

window.backToGateway = () => {
    document.getElementById('roomKeyScreen').style.display = 'none';
    document.getElementById('gatewayScreen').style.display = 'flex';
};

window.handleVerifyRoomKey = () => {
    let key = document.getElementById('joinRoomKey').value.trim();
    verifyRoomKey(key).then(success => {
        if (success) {
            document.getElementById('roomKeyScreen').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'block';
            loadGlobalFranchises();
        }
    });
};

function loadGlobalFranchises() {
    db.ref('global_teams').once('value', snap => {
        let teams = snap.val(), grid = document.getElementById('globalTeamsGrid');
        if (!teams) { 
            grid.innerHTML = '<p style="grid-column:span 2; color:#dc3545; font-size:11px;">No global franchises found. Contact your Admin.</p>'; 
            return; 
        }
        let html = '';
        for (let code in teams) {
            let t = teams[code];
            html += `<button class="team-btn" style="background:${t.color};" onclick="prepareLogin('${esc(code)}','${esc(t.color)}')">${esc(code)}</button>`;
        }
        grid.innerHTML = html;
    });
}

window.prepareLogin = (code, color) => {
    pendingCode = code; pendingColor = color; isCustomFlow = false;
    document.getElementById('presetSelection').style.display = 'none';
    document.getElementById('pinEntryDiv').style.display = 'block';
    document.getElementById('customFields').style.display = 'none';
    document.getElementById('loginTitle').textContent = 'Claim ' + code;
};

window.prepareCustomLogin = () => {
    isCustomFlow = true;
    document.getElementById('presetSelection').style.display = 'none';
    document.getElementById('pinEntryDiv').style.display = 'block';
    document.getElementById('customFields').style.display = 'block';
    document.getElementById('loginTitle').textContent = 'New Franchise';
};

window.backToSelection = () => {
    document.getElementById('presetSelection').style.display = 'block';
    document.getElementById('pinEntryDiv').style.display = 'none';
    document.getElementById('loginTitle').textContent = 'Franchise Access';
    document.getElementById('pinInput').value = '';
};

window.handleSubmitAuth = () => {
    let repName = document.getElementById('repNameInput').value.trim();
    let pin     = document.getElementById('pinInput').value.trim();
    
    let finalCode  = pendingCode;
    let finalColor = pendingColor;
    
    if (isCustomFlow) {
        finalCode  = document.getElementById('customCodeInput').value.trim().toUpperCase();
        finalColor = document.getElementById('customColorInput').value;
        if (!finalCode) { showAlert('Missing Code', 'Enter a Franchise Code.'); return; }
    }

    submitTeamAuth(finalCode, pin, finalColor, repName).then(success => {
        if (success) executeUIBoot();
    });
};

function executeUIBoot() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'flex';
    document.getElementById('myTeamDisplay').textContent = state.myTeamName;
    document.getElementById('myTeamDisplay').style.color = state.myTeamColor;
    document.getElementById('myTeamBox').style.borderColor = state.myTeamColor;
    
    let presenceRef = state.roomRef.child('logged_in_teams/' + state.myTeamName);
    presenceRef.set(true);
    presenceRef.onDisconnect().remove();
    
    logAction(`✅ <strong>${esc(state.myRepName)}</strong> connected as ${esc(state.myTeamName)}.`);
    
    attachFirebaseListeners();
    initWatchlistListener();
}

window.logout = () => {
    if (state.roomRef && state.myTeamName) {
        state.roomRef.child('logged_in_teams/' + state.myTeamName).remove();
    }
    sessionStorage.clear();
    window.location.reload();
};

// --- Firebase Listeners ---

function attachFirebaseListeners() {
    // Connection Monitor
    db.ref('.info/connected').on('value', snap => {
        document.getElementById('connBanner').style.display = snap.val() ? 'none' : 'block';
    });

    // Settings
    state.roomRef.child('settings').on('value', snap => {
        let s = snap.val() || {};
        state.settings = { ...state.settings, ...s };
    });

    // Teams & Presence
    state.roomRef.child('teams_auth').on('value', snap => {
        state.allRegisteredTeams = snap.val() || {};
        updateTeamDropdown();
        recalculateBudgets();
        updateMyTeamUI();
    });

    state.roomRef.child('logged_in_teams').on('value', snap => {
        state.activePresence = snap.val() || {};
        updateMyTeamUI();
    });

    // Player Pool
    state.roomRef.child('player_pool').once('value', snap => {
        let raw = snap.val() || [];
        state.playerPool = Array.isArray(raw) ? raw : Object.values(raw);
        populateSetDropdown();
        recalculateBudgets();
        refreshLists();
        updateMyTeamUI();
    });

    state.roomRef.child('player_pool').on('child_changed', snap => {
        let idx = parseInt(snap.key);
        if (!isNaN(idx)) {
            state.playerPool[idx] = snap.val();
            recalculateBudgets();
            refreshLists();
            updateMyTeamUI();
            
            if (state.liveState.auction_state === 'sold' && _latestLiveData) {
                let soldP = state.playerPool[_latestLiveData.current_player_index];
                let amIWinning = soldP?.team === state.myTeamName;
                updateLiveUI(_latestLiveData, amIWinning);
            }
        }
    });

    // Live State
    state.roomRef.child('live_state').on('value', snap => {
        let data = snap.val(); 
        if (!data) return;
        _latestLiveData = data;
        state.liveState = data;
        
        let amIWinning = (data.highest_bidder === state.myTeamName);
        updateLiveUI(data, amIWinning);
    });

    // Chat & Logs & Broadcast... (Implementation same as before, calling logAction and triggerChatPopup)
    let isChatLoaded = false;
    state.roomRef.child('chat_events').limitToLast(15).on('child_added', snap => {
        if (!isChatLoaded) return;
        let d = snap.val();
        triggerChatPopup(d.team, d.text);
        let col = state.allRegisteredTeams[d.team]?.color || '#fff';
        logAction(`💬 <span style="color:${col}; font-weight:bold;">${esc(d.team)}</span>: ${esc(d.text)}`);
    });
    state.roomRef.child('chat_events').once('value', () => { isChatLoaded = true; });

    let isLogLoaded = false;
    state.roomRef.child('auction_log').limitToLast(100).once('value', snap => {
        let entries = snap.val() || {};
        Object.values(entries).sort((a,b) => a.t - b.t).forEach(e => logAction(e.msg, new Date(e.t)));
        isLogLoaded = true;
    });
    state.roomRef.child('auction_log').limitToLast(100).on('child_added', snap => {
        if (!isLogLoaded) return;
        let e = snap.val(); logAction(e.msg, new Date(e.t));
    });

    // Broadcast
    state.roomRef.child('broadcast').on('value', snap => {
        let d = snap.val();
        let banner = document.getElementById('broadcastBanner');
        if (d && d.active && d.message) {
            document.getElementById('broadcastText').textContent = d.message;
            banner.classList.remove('show');
            void banner.offsetWidth; // trigger reflow
            banner.classList.add('show');
        } else {
            banner.classList.remove('show');
        }
    });
}

// --- Live UI Updates ---

function updateLiveUI(data, amIWinning) {
    document.getElementById('actualBidAmount').textContent = `₹${((data.current_bid || 0) / CRORE).toFixed(2)} Cr`;
    
    // Timer Loop Logic...
    if (window.uiTimer) clearInterval(window.uiTimer);
    window.uiTimer = setInterval(() => {
        let el  = document.getElementById('playerTimer');
        let arc = document.getElementById('timerArcFill');
        const CIRCUM = 188.5; 

        el.classList.remove('timer-green','timer-warn','timer-danger','timer-paused');

        if (data.auction_state === 'idle') {
            el.textContent = '--';
            if (arc) { arc.style.stroke = '#333'; arc.style.strokeDashoffset = '0'; }
            return;
        }
        if (data.auction_state === 'paused') {
            el.textContent = '⏸'; el.classList.add('timer-paused');
            if (arc) arc.style.stroke = '#fd7e14';
            return;
        }

        let t = data.timer_end ? Math.max(0, Math.ceil((data.timer_end - Date.now()) / 1000)) : 0;
        el.textContent = t + 's';

        let totalSecs = state.settings.bid_timer_secs;
        let progress  = totalSecs > 0 ? Math.min(1, t / totalSecs) : 0;
        let offset    = CIRCUM * (1 - progress);

        if (t > 10) {
            el.classList.add('timer-green');
            if (arc) { arc.style.stroke = '#28a745'; arc.style.strokeDashoffset = offset; }
        } else if (t > 5) {
            el.classList.add('timer-warn');
            if (arc) { arc.style.stroke = '#fd7e14'; arc.style.strokeDashoffset = offset; }
        } else {
            el.classList.add('timer-danger');
            if (arc) { arc.style.stroke = '#ff4444'; arc.style.strokeDashoffset = offset; }
        }

        if (data.auction_state === 'bidding' && t <= 5 && t > 0 && t !== _lastTimerWarnSecond) {
            _lastTimerWarnSecond = t; 
            playSound('timer_warn');
        }
    }, 500);

    evaluateBidButtonStatus(amIWinning);
    
    // Update player center console details here... (Runs, Avg, Image, etc based on data.current_player_index)
    // Update leader badge and bid stack history...
}

function updateMyTeamUI() {
    if (!state.myTeamName || !Object.keys(state.allRegisteredTeams).length) return;
    
    let myBudget = state.teamBudgets[state.myTeamName] !== undefined ? state.teamBudgets[state.myTeamName] : (state.settings.starting_purse * CRORE);
    let myPurseCr = myBudget / CRORE;
    let purseEl = document.getElementById('myTeamPurse');
    purseEl.textContent = `₹${myPurseCr.toFixed(2)} Cr`;
    
    // Render My Squad XI and Bench (Drag and drop logic applied here)
    if (!isDragging) {
        // Build the HTML for the XI and Bench using state.playerPool and state.allRegisteredTeams[state.myTeamName]
        // Attach drag events to new elements using attachDragEvents(el) from squad.js
    }
}

// --- List Render Management ---

window.addEventListener('watchlistUpdated', refreshLists);
window.addEventListener('rosterOrderUpdated', updateMyTeamUI);

let _deckRoleFilter = '';
window.setRoleFilter = function(role, el) {
    _deckRoleFilter = role;
    document.querySelectorAll('.role-filter-btn').forEach(b => {
        let active = b.dataset.role === role;
        b.style.background = active ? '#22222d' : 'transparent';
        b.style.color      = active ? '#ffc107' : '#888';
        b.style.borderColor= active ? '#ffc107' : '#333';
    });
    refreshLists();
};

window.refreshLists = function() {
    let set = document.getElementById('setSelector')?.value || '';
    let deckSearch = document.getElementById('deckSearch')?.value.toLowerCase() || '';
    renderDeckList('deckList', set, deckSearch, _deckRoleFilter, watchlist, false);
    
    renderUnsoldList('unsoldList', '', false);
    
    let team = document.getElementById('teamSelector')?.value || '';
    renderSquadList('squadList', team, '');
};

window.switchTab = function(name, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    if (el) el.classList.add('active');
};

function populateSetDropdown() {
    let sets = new Set(); 
    state.playerPool.forEach(p => { if (p.set) sets.add(p.set); });
    let sel = document.getElementById('setSelector'), prev = sel.value;
    sel.innerHTML = '<option value="" disabled hidden>ON DECK</option>';
    sets.forEach(s => { 
        let o = document.createElement('option'); o.value = s; o.text = s; sel.appendChild(o); 
    });
    if (prev && sets.has(prev)) sel.value = prev; 
    else if (sets.size > 0) sel.value = Array.from(sets)[0];
}

function updateTeamDropdown() {
    let keys = Object.keys(state.allRegisteredTeams);
    let sel = document.getElementById('teamSelector'), prev = sel.value;
    sel.innerHTML = '<option value="" disabled hidden>SQUADS</option>';
    keys.forEach(t => {
        let o = document.createElement('option'); o.value = t; o.text = t;
        o.style.color = state.allRegisteredTeams[t]?.color || '#fff';
        sel.appendChild(o);
    });
    if (keys.includes(prev)) sel.value = prev; 
    else sel.value = "";
}

// --- Utilities & Chat ---

window.sendChatMessage = () => {
    let inp = document.getElementById('chatInput'), msg = inp.value.trim();
    if (msg && state.myTeamName && state.roomRef) {
        state.roomRef.child('chat_events').push({ team: state.myTeamName, text: msg, time: Date.now() });
        inp.value = '';
    }
};

function triggerChatPopup(team, text) { 
    activePopups[team] = { text, expiry: Date.now() + 5000 }; 
}

function updateAllPopups() {
    let now = Date.now();
    [state.myTeamName, ...Object.keys(state.allRegisteredTeams)].forEach(t => {
        let pop = t === state.myTeamName ? document.getElementById('msg-popup-myteam') : document.getElementById('msg-popup-'+t);
        if (!pop) return;
        if (activePopups[t] && activePopups[t].expiry > now) {
            pop.textContent = activePopups[t].text; pop.classList.add('show');
        } else { 
            pop.classList.remove('show'); 
        }
    });
}

function logAction(msg) {
    let time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    let entry = document.createElement('div'); 
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        logContainer.appendChild(entry);
        if (!isUserScrollingLog) logContainer.scrollTop = logContainer.scrollHeight;
    }
}

// Hotkey listener
document.addEventListener('keydown', e => {
    if (document.getElementById('mainDashboard').style.display === 'none') return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { 
        e.preventDefault(); 
        if (!document.getElementById('mainActionButton').disabled) window.placeBid(); 
    }
});