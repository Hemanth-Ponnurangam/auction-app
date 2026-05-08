/**
 * main.js (Auctioneer)
 * The main controller for the Auctioneer portal.
 */

import { db, getCurrentServerTime } from '../shared/firebase.js';
import { state, setRoomState, recalculateBudgets } from '../shared/state.js';
import { esc, showAlert, showPrompt, showConfirm, closeModal } from '../shared/dom.js';
import { playSound } from '../shared/audio.js';
import { renderDeckList, renderUnsoldList, renderSquadList } from '../shared/render.js';
import { 
    persistEvent, pushPlayerToBlock, pullRandomFromSet, 
    sellPlayer, passPlayer, undoLastSale, undoLastBid, confirmResetAuction 
} from './controls.js';

const CRORE = 10_000_000;
const ARC_CIRCUMFERENCE = 289.03;

let _liveStateData = {};
let _renderTimer = null;
let _arcTimerTotal = 0;
let _prevTimerEnd = 0;
let localBidTracker = 0;
let _lastTimerWarnSecond = -1;

// ─ EXPLICIT GLOBAL BINDINGS FOR HTML ONCLICK EVENTS ─────────────────
window.pushPlayerToBlock = pushPlayerToBlock;
window.pullRandomFromSet = pullRandomFromSet;
window.sellPlayer = sellPlayer;
window.passPlayer = passPlayer;
window.undoLastSale = undoLastSale;
window.undoLastBid = undoLastBid;
window.confirmResetAuction = confirmResetAuction;

window.onload = function() {
    setupEventListeners();
    
    let savedKey = sessionStorage.getItem('roomKey');
    if (savedKey) {
        setRoomState(savedKey, db.ref('rooms/' + savedKey));
        executeAdminBoot();
    } else {
        document.getElementById('adminGatewayScreen').style.display = 'flex';
    }

    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        logContainer.addEventListener('scroll', () => {
            isUserScrollingLog = (logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight) >= 15;
        });
    }
};

function setupEventListeners() {
    document.getElementById('dbSelection')?.addEventListener('change', toggleCustomUpload);
    document.getElementById('set-limit-mid')?.addEventListener('input', e => document.getElementById('label-mid-start').textContent = e.target.value);
    document.getElementById('set-limit-high')?.addEventListener('input', e => document.getElementById('label-high-start').textContent = e.target.value);
}

window.showCreateRoom = () => {
    document.getElementById('adminGatewayScreen').style.display = 'none';
    document.getElementById('createRoomScreen').style.display = 'flex';
    db.ref('presets').once('value', snap => {
        let p = snap.val() || {};
        let sel = document.getElementById('dbSelection');
        sel.innerHTML = '<option value="">Select Database...</option>';
        Object.keys(p).forEach(k => {
            sel.innerHTML += `<option value="${esc(k)}">${esc(k)} (${p[k].length} players)</option>`;
        });
        sel.innerHTML += '<option value="custom">Upload Custom CSV...</option>';
    });
};

window.showJoinAdminRoom = () => {
    document.getElementById('adminGatewayScreen').style.display = 'none';
    document.getElementById('joinAdminRoomScreen').style.display = 'flex';
};

window.backToAdminGateway = () => {
    document.getElementById('createRoomScreen').style.display = 'none';
    document.getElementById('joinAdminRoomScreen').style.display = 'none';
    document.getElementById('adminGatewayScreen').style.display = 'flex';
};

window.toggleCustomUpload = () => {
    let val = document.getElementById('dbSelection').value;
    document.getElementById('customDbUpload').style.display = val === 'custom' ? 'block' : 'none';
};

window.createNewRoom = () => {
    let name = document.getElementById('newRoomName').value.trim();
    let key = document.getElementById('newRoomKey').value.trim();
    let purseCr = parseFloat(document.getElementById('newRoomPurse').value);
    let dbSel = document.getElementById('dbSelection').value;

    if (!name || !key || isNaN(purseCr) || !dbSel) return showAlert('Missing Info', 'Please fill all fields.');

    db.ref('rooms/' + key).once('value', snap => {
        if (snap.exists()) return showAlert('Error', 'Room Key already in use.');
        if (dbSel === 'custom') {
            let file = document.getElementById('csvFileInput').files[0];
            if (!file) return showAlert('Error', 'Please select a CSV file.');
            let reader = new FileReader();
            reader.onload = e => {
                let rows = parseCSV(e.target.result);
                if (rows.length < 2) return showAlert('Error', 'Invalid CSV format.');
                let headers = rows[0].map(h => h.toLowerCase().trim());
                let pool = rows.slice(1).map(row => {
                    let p = { status: 'available' };
                    headers.forEach((h, i) => {
                        let val = row[i] ? row[i].trim() : '';
                        if (h === 'player' || h === 'name') p.name = val;
                        else if (h === 'base_price' || h === 'price') p.base_price = parseInt(val) || 0;
                        else p[h] = val;
                    });
                    return p;
                }).filter(p => p.name);
                finalizeRoomCreation(key, name, purseCr, pool);
            };
            reader.readAsText(file);
        } else {
            db.ref('presets/' + dbSel).once('value', pSnap => {
                let pool = pSnap.val();
                if (!pool) return showAlert('Error', 'Selected database not found.');
                finalizeRoomCreation(key, name, purseCr, pool);
            });
        }
    });
};

function finalizeRoomCreation(key, name, purseCr, pool) {
    let rRef = db.ref('rooms/' + key);
    rRef.set({
        settings: { room_name: name, starting_purse: purseCr, bid_timer_secs: 15, cooldown_secs: 10, inc_base: 20, inc_mid: 50, inc_high: 100, limit_mid: 2, limit_high: 5 },
        player_pool: pool,
        live_state: { auction_state: 'idle', current_bid: 0, highest_bidder: '-', timer_end: 0, current_player_index: -1, last_sold_index: -1, bid_stack: null },
        logged_in_teams: { 'ADMIN': true }
    }).then(() => {
        sessionStorage.setItem('roomKey', key);
        setRoomState(key, rRef);
        executeAdminBoot();
    });
}

window.joinAdminRoom = () => {
    let key = document.getElementById('joinAdminKey').value.trim();
    db.ref('rooms/' + key).once('value', snap => {
        if (snap.exists()) {
            sessionStorage.setItem('roomKey', key);
            setRoomState(key, db.ref('rooms/' + key));
            executeAdminBoot();
        } else {
            showAlert('Not Found', 'Invalid Room Key.');
        }
    });
};

function executeAdminBoot() {
    document.getElementById('adminGatewayScreen').style.display = 'none';
    document.getElementById('createRoomScreen').style.display = 'none';
    document.getElementById('joinAdminRoomScreen').style.display = 'none';
    document.getElementById('adminDashboardWrapper').style.display = 'flex';

    state.roomRef.child('logged_in_teams/ADMIN').set(true);
    state.roomRef.child('logged_in_teams/ADMIN').onDisconnect().remove();

    attachFirebaseListeners();
    persistEvent('🔨 <strong>Auctioneer System Online.</strong>');
}

function attachFirebaseListeners() {
    db.ref('.info/connected').on('value', snap => document.getElementById('connBanner').style.display = snap.val() ? 'none' : 'block');

    state.roomRef.child('settings').on('value', snap => {
        let s = snap.val() || {};
        state.settings = { ...state.settings, ...s };
        document.getElementById('headerRoomName').textContent = (s.room_name || 'IPL').toUpperCase();
    });

    state.roomRef.child('teams_auth').on('value', snap => {
        state.allRegisteredTeams = snap.val() || {};
        updateTeamDropdown(); recalculateBudgets(); updateBudgetsUI();
    });

    state.roomRef.child('logged_in_teams').on('value', snap => {
        state.activePresence = snap.val() || {};
        updateBudgetsUI();
    });

    state.roomRef.child('player_pool').once('value', snap => {
        let raw = snap.val() || [];
        state.playerPool = Array.isArray(raw) ? raw : Object.values(raw);
        populateSetDropdown(); recalculateBudgets(); window.refreshLists(); updateBudgetsUI();
    });

    state.roomRef.child('player_pool').on('child_changed', snap => {
        let idx = parseInt(snap.key);
        if (!isNaN(idx)) {
            state.playerPool[idx] = snap.val();
            recalculateBudgets(); window.refreshLists(); updateBudgetsUI();
            if (state.liveState.auction_state === 'sold' && _liveStateData) updateLiveUI(_liveStateData);
        }
    });

    db.ref('global_player_images').on('value', snap => {
        state.globalImageMap = snap.val() || {};
        if (state.liveState && state.liveState.current_player_index >= 0) updateLiveUI(state.liveState);
    });

    state.roomRef.child('live_state').on('value', snap => {
        let data = snap.val();
        if (!data) return;
        state.liveState = data;
        _liveStateData = data;
        updateLiveUI(data);
        updateBudgetsUI();
    });

    let isChatLoaded = false;
    state.roomRef.child('chat_events').limitToLast(15).on('child_added', snap => {
        if (!isChatLoaded) return;
        let d = snap.val();
        let col = state.allRegisteredTeams[d.team]?.color || (d.team === 'SYSTEM' ? '#ffc107' : '#fff');
        logAction(`💬 <span style="color:${col}; font-weight:bold;">${esc(d.team)}</span>: ${esc(d.text)}`);
    });
    state.roomRef.child('chat_events').once('value', () => isChatLoaded = true);

    let isLogLoaded = false;
    state.roomRef.child('auction_log').limitToLast(100).once('value', snap => {
        let entries = snap.val() || {};
        Object.values(entries).sort((a,b) => a.t - b.t).forEach(e => logAction(e.msg));
        isLogLoaded = true;
    });
    state.roomRef.child('auction_log').limitToLast(100).on('child_added', snap => {
        if (!isLogLoaded) return;
        logAction(snap.val().msg);
    });

    state.roomRef.child('broadcast').on('value', snap => {
        let d = snap.val();
        let activeDot = document.getElementById('broadcastActiveDot');
        if (d && d.active) {
            document.getElementById('broadcastInput').value = d.message;
            activeDot.style.display = 'block';
            
            // 5 Second Auto-Dismissal
            setTimeout(() => {
                if (typeof window.clearBroadcast === 'function') window.clearBroadcast();
            }, 5000);
        } else {
            document.getElementById('broadcastInput').value = '';
            activeDot.style.display = 'none';
        }
    });
}

function updateLiveUI(data) {
    let pIdx = data.current_player_index !== undefined ? data.current_player_index : -1;
    let p = pIdx >= 0 ? state.playerPool[pIdx] : null;

    let cr = (data.current_bid || 0) / CRORE;
    document.getElementById('adminBid').textContent = `₹${cr.toFixed(2)} Cr`;
    
    let lEl = document.getElementById('adminLeader');
    let l = data.highest_bidder;
    lEl.textContent = l;
    lEl.style.color = (l !== '-' && l !== 'Base Price' && l !== '') ? (state.allRegisteredTeams[l]?.color || '#007bff') : '#888';

    let stackArr = data.bid_stack ? Object.values(data.bid_stack) : [];
    if (stackArr.length > localBidTracker) playSound('bid');
    localBidTracker = stackArr.length;

    let historyHtml = stackArr.slice().reverse().map(b => {
        let tColor = state.allRegisteredTeams[b.bidder]?.color || '#fff';
        return `<div class="bid-history-item"><span style="color:${tColor}; font-weight:bold;">${esc(b.bidder)}</span><span style="color:#28a745; font-weight:bold;">₹${(b.amount/CRORE).toFixed(2)}</span></div>`;
    }).join('');
    document.getElementById('adminBidHistory').innerHTML = historyHtml || '<div style="color:#444; padding:20px; text-align:center;">No bids yet</div>';

    if (p) {
        document.getElementById('adminPlayer').textContent = p.name;
        document.getElementById('statRuns').textContent = p.runs || '-';
        document.getElementById('statAvg').textContent = p.bat_avg || '-';
        document.getElementById('statBatSR').textContent = p.bat_sr || '-';
        document.getElementById('statWkts').textContent = p.wkts || '-';
        document.getElementById('statEcon').textContent = p.econ || '-';
        document.getElementById('statBowlSR').textContent = p.bowl_sr || '-';
        
        let tags = document.getElementById('adminPlayerTags');
        let rl = document.getElementById('adminPlayerRole');
        if (p.franchise) { tags.textContent = p.franchise; tags.style.display = 'inline-block'; } else tags.style.display = 'none';
        if (p.role) { rl.textContent = p.role; rl.style.display = 'inline-block'; } else rl.style.display = 'none';

        let safeNameKey = (p.name || '').replace(/[.#$\[\]\/]/g, '_');
        let imgObj = state.globalImageMap[safeNameKey] || state.globalImageMap[p.name]; 
        let imgUrl = imgObj ? (imgObj.url || imgObj) : ''; 

        let photoBox = document.getElementById('playerPhoto');
        if (imgUrl) {
            photoBox.innerHTML = `<img src="${esc(imgUrl)}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;" alt="Photo">`;
        } else {
            photoBox.innerHTML = 'PHOTO';
        }
    } else {
        document.getElementById('adminPlayer').textContent = 'Waiting...';
        document.getElementById('adminPlayerTags').style.display = 'none';
        document.getElementById('adminPlayerRole').style.display = 'none';
        document.getElementById('playerPhoto').innerHTML = 'PHOTO';
        ['statRuns','statAvg','statBatSR','statWkts','statEcon','statBowlSR'].forEach(id => document.getElementById(id).textContent = '-');
    }

    manageDynamicButtons(data, p);
    manageTimerArc(data);
}

function manageDynamicButtons(data, player) {
    let btn = document.getElementById('dynamicSellBtn');
    let btnPause = document.getElementById('btnPause');
    let s = data.auction_state;

    if (s === 'idle') {
        btn.className = 'btn-unsold'; btn.textContent = 'WAITING FOR PLAYER'; btn.disabled = true;
        btnPause.className = 'action-btn btn-pause'; btnPause.disabled = true;
    } else if (s === 'cooldown') {
        btn.className = 'btn-green'; btn.textContent = 'AUCTION STARTING...'; btn.disabled = true;
        btnPause.className = 'action-btn btn-pause'; btnPause.disabled = true;
    } else if (s === 'paused') {
        btn.className = 'btn-unsold'; btn.textContent = 'PAUSED'; btn.disabled = true;
        btnPause.className = 'action-btn btn-pause is-paused'; btnPause.disabled = false;
    } else if (s === 'sold') {
        btn.className = 'btn-green'; btn.textContent = 'SOLD TO ' + esc(data.highest_bidder); btn.disabled = true;
        btnPause.className = 'action-btn btn-pause'; btnPause.disabled = true;
    } else if (s === 'unsold') {
        btn.className = 'btn-unsold'; btn.textContent = 'UNSOLD'; btn.disabled = true;
        btnPause.className = 'action-btn btn-pause'; btnPause.disabled = true;
    } else if (s === 'bidding') {
        btnPause.disabled = false;
        btnPause.className = 'action-btn btn-pause';
        let isFirst = data.highest_bidder === '-' || data.highest_bidder === 'Base Price';
        if (isFirst) {
            btn.className = 'btn-red';
            btn.textContent = 'PASS (UNSOLD)';
            btn.disabled = false;
            btn.onclick = passPlayer;
        } else {
            btn.className = 'btn-green';
            btn.textContent = 'SELL (₹' + (data.current_bid/CRORE).toFixed(2) + ' Cr)';
            btn.disabled = false;
            btn.onclick = sellPlayer;
        }
    }
}

function manageTimerArc(data) {
    if (_renderTimer) clearInterval(_renderTimer);
    
    let el = document.getElementById('adminTimer');
    let arc = document.getElementById('timerArc');
    
    _renderTimer = setInterval(() => {
        el.classList.remove('timer-green','timer-orange','timer-red','timer-paused');
        
        if (data.auction_state === 'idle') {
            el.textContent = '--';
            if(arc) { arc.style.stroke = '#333'; arc.style.strokeDashoffset = '0'; }
            return;
        }
        if (data.auction_state === 'paused') {
            el.textContent = '⏸'; el.classList.add('timer-paused');
            if(arc) arc.style.stroke = '#fd7e14';
            return;
        }

        let totalMs = data.auction_state === 'cooldown' ? (state.settings.cooldown_secs||10)*1000 : (state.settings.bid_timer_secs||15)*1000;
        
        if (data.timer_end !== _prevTimerEnd) {
            _prevTimerEnd = data.timer_end;
            _arcTimerTotal = totalMs;
        }

        let now = getCurrentServerTime();
        let remaining = Math.max(0, data.timer_end - now);
        let sec = Math.ceil(remaining / 1000);
        
        el.textContent = sec + 's';

        let progress = _arcTimerTotal > 0 ? Math.min(1, remaining / _arcTimerTotal) : 0;
        let offset = ARC_CIRCUMFERENCE * (1 - progress);

        if (sec > 10) {
            el.classList.add('timer-green');
            if(arc) { arc.style.stroke = '#28a745'; arc.style.strokeDashoffset = offset; }
        } else if (sec > 5) {
            el.classList.add('timer-orange');
            if(arc) { arc.style.stroke = '#fd7e14'; arc.style.strokeDashoffset = offset; }
        } else {
            el.classList.add('timer-red');
            if(arc) { arc.style.stroke = '#dc3545'; arc.style.strokeDashoffset = offset; }
        }

        if (data.auction_state === 'bidding' && sec <= 5 && sec > 0 && sec !== _lastTimerWarnSecond) {
            _lastTimerWarnSecond = sec; 
            playSound('timer_warn');
        }

    }, 100);
}

function updateBudgetsUI() {
    let grid = document.getElementById('budgetCards');
    if (!grid) return;
    
    let html = '';
    let startingPurseCr = state.settings.starting_purse || 100;
    
    let curWin = state.liveState.highest_bidder;
    let isValidLeader = curWin !== '-' && curWin !== 'Base Price' && curWin !== '';
    let currentAuctionState = state.liveState.auction_state;

    Object.keys(state.allRegisteredTeams).forEach(t => {
        let tData = state.allRegisteredTeams[t] || {};
        let tColor = tData.color || '#fff';
        let isOnline = state.activePresence[t];
        let rCr = (state.teamBudgets[t] !== undefined ? state.teamBudgets[t] : (startingPurseCr * CRORE)) / CRORE;
        
        let squadCount = state.playerPool.filter(p => p && p.status === 'sold' && p.team === t).length;
        let ovCount = state.playerPool.filter(p => p && p.status === 'sold' && p.team === t && !['india','indian','ind'].includes((p.nationality||'Indian').trim().toLowerCase())).length;
        
        let lgClass = (t === curWin && isValidLeader && (currentAuctionState === 'bidding' || currentAuctionState === 'cooldown')) ? ' leader-card-glow' : 
                      (t === curWin && isValidLeader && currentAuctionState === 'sold') ? ' sold-card-glow' : '';

        html += `
        <div class="budget-card${lgClass}" style="border-top:3px solid ${tColor};">
            <button class="delete-team-btn" onclick="removeFranchise('${esc(t)}')">✕</button>
            <div style="font-size:14px; font-weight:900; color:${tColor}; margin-bottom:4px; display:flex; justify-content:center; align-items:center; gap:5px;">
                ${esc(t)} ${isOnline ? '<span class="live-dot"></span>' : '<span class="offline-dot"></span>'}
            </div>
            <div style="font-size:18px; font-weight:bold; color:${rCr>0?'#28a745':'#dc3545'};">₹${rCr.toFixed(2)}</div>
            <div style="font-size:9px; color:#888; text-transform:uppercase; margin-top:5px; border-top:1px solid #222; padding-top:4px;">
                Squad: <strong style="color:#ccc;">${squadCount}</strong> | OS: <strong style="color:#ccc;">${ovCount}</strong>
            </div>
            <div style="font-size:8px; color:#555; text-transform:uppercase; margin-top:2px;">
                PIN: <span class="pin-eye" onmousedown="this.textContent='${esc(tData.pin)}'" onmouseup="this.textContent='****'" onmouseleave="this.textContent='****'">****</span>
            </div>
        </div>`;
    });

    for(let i=Object.keys(state.allRegisteredTeams).length; i<10; i++) {
        html += `<div class="budget-card-empty">AVAILABLE SLOT</div>`;
    }
    grid.innerHTML = html;
}

window.removeFranchise = (code) => {
    showConfirm('Remove Franchise', `Are you sure you want to permanently delete ${code} from this room?`, () => {
        state.roomRef.child('teams_auth/' + code).remove();
        state.roomRef.child('logged_in_teams/' + code).remove();
    });
};

function populateSetDropdown() {
    let sets = new Set();
    state.playerPool.forEach(p => { if (p.set) sets.add(p.set); });
    let sel = document.getElementById('setSelector'), prev = sel.value;
    sel.innerHTML = '<option value="" disabled hidden>ON DECK</option>';
    sets.forEach(s => { let o = document.createElement('option'); o.value = s; o.text = s; sel.appendChild(o); });
    if (prev && sets.has(prev)) sel.value = prev; else if (sets.size > 0) sel.value = Array.from(sets)[0];
}

function updateTeamDropdown() {
    let keys = Object.keys(state.allRegisteredTeams);
    let sel = document.getElementById('teamSelector'), prev = sel.value;
    sel.innerHTML = '<option value="" disabled hidden>SQUADS</option>';
    keys.forEach(t => { let o = document.createElement('option'); o.value = t; o.text = t; o.style.color = state.allRegisteredTeams[t]?.color || '#fff'; sel.appendChild(o); });
    if (keys.includes(prev)) sel.value = prev; else sel.value = "";
}

window.sendChatMessage = () => {
    let inp = document.getElementById('chatInput'), msg = inp.value.trim();
    if (msg && state.roomRef) {
        state.roomRef.child('chat_events').push({ team: 'SYSTEM', text: msg, time: Date.now() });
        inp.value = '';
    }
};

window.sendBroadcast = () => {
    let msg = document.getElementById('broadcastInput').value.trim();
    if (!msg) return showAlert('Empty Broadcast', 'Please enter a message.');
    state.roomRef.child('broadcast').set({ message: msg, active: true, time: Date.now() });
};

window.clearBroadcast = () => {
    if (state.roomRef) state.roomRef.child('broadcast').remove();
};

let _deckRoleFilter = '';
window.setRoleFilter = (role, el) => {
    _deckRoleFilter = role;
    document.querySelectorAll('.role-filter-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = '#111'; b.style.color = '#888'; b.style.borderColor = '#333';
    });
    el.classList.add('active');
    el.style.background = '#22222d'; el.style.color = '#ffc107'; el.style.borderColor = '#ffc107';
    window.refreshLists();
};

window.refreshLists = () => {
    let set = document.getElementById('setSelector')?.value || '';
    let deckSearch = document.getElementById('auctioneerSearch')?.value.toLowerCase() || '';
    renderDeckList('deckList', set, deckSearch, _deckRoleFilter, null, true);
    renderUnsoldList('unsoldList', deckSearch, true);
    let team = document.getElementById('teamSelector')?.value || '';
    renderSquadList('squadList', team, deckSearch);
};

document.getElementById('auctioneerSearch')?.addEventListener('input', window.refreshLists);

window.switchTab = (name, el) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    if(el) el.classList.add('active');
};

let isUserScrollingLog = false;
function logAction(msg) {
    let entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = msg;
    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        logContainer.appendChild(entry);
        if (!isUserScrollingLog) logContainer.scrollTop = logContainer.scrollHeight;
    }
}

// ─ HOTKEYS ──────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (document.getElementById('adminDashboardWrapper').style.display === 'none') return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    switch(e.code) {
        case 'Space': e.preventDefault(); pullRandomFromSet(); break;
        case 'KeyS': e.preventDefault(); if(state.liveState.auction_state === 'bidding' && state.liveState.highest_bidder !== '-' && state.liveState.highest_bidder !== 'Base Price') sellPlayer(); break;
        case 'KeyX': e.preventDefault(); if(state.liveState.auction_state === 'bidding') passPlayer(); break;
        case 'KeyP': e.preventDefault(); togglePause(); break;
    }
});

// ─ TIMER OVERRIDES & SETTINGS ───────────────────────────────────────
window.startTimer = (secs, newState) => {
    if (!state.roomRef || state.liveState.auction_state === 'idle') return;
    state.roomRef.child('live_state').update({
        timer_end: getCurrentServerTime() + (secs * 1000),
        auction_state: newState || state.liveState.auction_state,
        paused_remaining: null
    });
};

window.openSettings = () => {
    document.getElementById('set-room-key').value = state.roomKey || '';
    document.getElementById('set-room-name').value = state.settings.room_name || '';
    document.getElementById('set-purse').value = state.settings.starting_purse || 100;
    document.getElementById('set-bid-timer').value = state.settings.bid_timer_secs || 15;
    document.getElementById('set-cooldown').value = state.settings.cooldown_secs || 10;
    
    document.getElementById('set-inc-base').value = state.settings.inc_base || 20;
    document.getElementById('set-inc-mid').value = state.settings.inc_mid || 50;
    document.getElementById('set-inc-high').value = state.settings.inc_high || 100;
    
    document.getElementById('set-limit-mid').value = state.settings.limit_mid || 2;
    document.getElementById('set-limit-high').value = state.settings.limit_high || 5;
    
    document.getElementById('set-overseas-rule').value = state.settings.overseas_limit_enabled ? "true" : "false";
    document.getElementById('set-max-ov').value = state.settings.max_overseas || 8;
    document.getElementById('set-min-squad').value = state.settings.min_squad || 18;
    document.getElementById('set-max-squad').value = state.settings.max_squad || 25;

    document.getElementById('label-mid-start').textContent = document.getElementById('set-limit-mid').value;
    document.getElementById('label-high-start').textContent = document.getElementById('set-limit-high').value;

    document.getElementById('settingsOverlay').style.display = 'flex';
};

window.saveSettings = () => {
    if (state.roomRef) {
        state.roomRef.child('settings').update({
            room_name: document.getElementById('set-room-name').value,
            starting_purse: parseInt(document.getElementById('set-purse').value) || 100,
            bid_timer_secs: parseInt(document.getElementById('set-bid-timer').value) || 15,
            cooldown_secs: parseInt(document.getElementById('set-cooldown').value) || 10,
            
            inc_base: parseInt(document.getElementById('set-inc-base').value) || 20,
            inc_mid: parseInt(document.getElementById('set-inc-mid').value) || 50,
            inc_high: parseInt(document.getElementById('set-inc-high').value) || 100,
            
            limit_mid: parseFloat(document.getElementById('set-limit-mid').value) || 2,
            limit_high: parseFloat(document.getElementById('set-limit-high').value) || 5,
            
            overseas_limit_enabled: document.getElementById('set-overseas-rule').value === "true",
            max_overseas: parseInt(document.getElementById('set-max-ov').value) || 8,
            min_squad: parseInt(document.getElementById('set-min-squad').value) || 18,
            max_squad: parseInt(document.getElementById('set-max-squad').value) || 25
        });
        document.getElementById('settingsOverlay').style.display = 'none';
        persistEvent('⚙️ Auction settings updated.');
    }
};

window.togglePause = () => {
    if (!state.roomRef) return;
    let currentState = state.liveState.auction_state;
    if (currentState === 'paused') {
        let remaining = state.liveState.paused_remaining || (state.settings.bid_timer_secs || 15) * 1000;
        if (remaining <= 0) remaining = (state.settings.bid_timer_secs || 15) * 1000;
        
        state.roomRef.child('live_state').update({ auction_state: 'bidding', timer_end: getCurrentServerTime() + remaining, paused_remaining: null });
    } else if (currentState === 'bidding') {
        let remaining = state.liveState.timer_end ? Math.max(0, state.liveState.timer_end - getCurrentServerTime()) : 0;
        state.roomRef.child('live_state').update({ auction_state: 'paused', timer_end: 0, paused_remaining: remaining });
    }
};

window.bypassCooldown = () => {
    if (!state.roomRef || state.liveState.auction_state !== 'cooldown') return;
    state.roomRef.child('live_state').update({ auction_state: 'bidding', timer_end: getCurrentServerTime() + ((state.settings.bid_timer_secs||15)*1000) });
};
