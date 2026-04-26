/**
 * main.js (Auctioneer)
 * The main controller for the Auctioneer portal.
 */

import { db } from '../shared/firebase.js';
import { state, setRoomState, recalculateBudgets } from '../shared/state.js';
import { esc, showAlert, showPrompt, showConfirm, closeModal } from '../shared/dom.js';
import { playSound } from '../shared/audio.js';
import { renderDeckList, renderUnsoldList, renderSquadList } from '../shared/render.js';
import { persistEvent, pushPlayerToBlock } from './controls.js';

const CRORE = 10_000_000;
const ARC_CIRCUMFERENCE = 289.03;

let _liveStateData = {};
let _renderTimer = null;
let _arcTimerTotal = 0;
let _prevTimerEnd = 0;
let localBidTracker = 0;
let _lastTimerWarnSecond = -1;

// --- Boot Sequence & Room Management ---

window.onload = function() {
    let savedKey = sessionStorage.getItem('roomKey');
    if (savedKey) {
        setRoomState(savedKey, db.ref('rooms/' + savedKey));
        executeAdminBoot();
    } else {
        document.getElementById('adminGatewayScreen').style.display = 'flex';
    }
};

window.showCreateRoom = () => {
    document.getElementById('adminGatewayScreen').style.display = 'none';
    document.getElementById('createRoomScreen').style.display = 'flex';
    
    let sel = document.getElementById('dbSelection');
    sel.innerHTML = '<option value="custom">Upload Custom CSV</option>';
    
    db.ref('preset_databases').once('value', snap => {
        let dbs = snap.val() || {}, keys = Object.keys(dbs);
        if (keys.length) {
            sel.innerHTML = '';
            keys.forEach(k => { 
                let o = document.createElement('option'); 
                o.value = 'preset_' + k; 
                o.text = `Preset: ${k.toUpperCase()} (${dbs[k].length} Players)`; 
                sel.appendChild(o); 
            });
            let co = document.createElement('option'); co.value = 'custom'; co.text = 'Upload Custom CSV'; sel.appendChild(co);
            sel.value = 'preset_' + keys[0];
        } else { 
            sel.value = 'custom'; 
        }
        window.toggleCustomUpload();
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
    document.getElementById('customDbUpload').style.display = document.getElementById('dbSelection').value === 'custom' ? 'block' : 'none';
};

function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let raw = lines[0].split(',');
    let hdrs = raw.map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g,''));
    let result = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        let cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        let obj = { status: 'available' };
        
        for (let j = 0; j < hdrs.length; j++) {
            let v = (cols[j]||'').replace(/['"]+/g,'').trim();
            let h = hdrs[j];
            
            if (h === 'baseprice') {
                let num = Number(v) || 0;
                obj.base_price = (num > 0 && num <= 100) ? num * CRORE : num;
            } else if (['runs','average','avg','sr','strikerate','wickets','economy','econ','bowlingsr'].includes(h)) {
                let key = h;
                if(h === 'avg') key = 'average';
                if(h === 'strikerate' || h === 'sr') key = 'bat_sr';
                if(h === 'econ') key = 'economy';
                if(h === 'bowlingsr') key = 'bowl_sr';
                obj[key] = v || '-';
            } else if (['name','set','role','franchise','nationality'].includes(h)) {
                obj[h] = v;
            }
        }
        result.push(obj);
    }
    return result;
}

window.createNewRoom = () => {
    let name = document.getElementById('newRoomName').value.trim();
    let key = document.getElementById('newRoomKey').value.trim();
    let dbType = document.getElementById('dbSelection').value;
    let purse = parseInt(document.getElementById('newRoomPurse').value) || 100;
    
    if (!name || key.length < 4) { showAlert('Invalid Input','Enter a Room Name and 4-digit key.'); return; }
    
    db.ref('rooms/'+key).once('value', snap => {
        if (snap.exists()) { showAlert('Key Taken','Room key already exists. Pick another or Join it.'); return; }
        
        let init = poolData => {
            db.ref('rooms/'+key).set({
                settings: { room_name: name, starting_purse: purse, overseas_limit_enabled: true },
                player_pool: poolData,
                live_state: { auction_state: 'idle', current_bid: 0, highest_bidder: '-', timer_end: 0, current_player_index: -1, last_sold_index: -1, bid_stack: null }
            }).then(() => {
                sessionStorage.setItem('roomKey', key);
                setRoomState(key, db.ref('rooms/'+key));
                executeAdminBoot();
            });
        };
        
        if (dbType.startsWith('preset_')) {
            let pid = dbType.replace('preset_','');
            db.ref('preset_databases/'+pid).once('value', s => {
                let pool = (s.val() || []).map(p => { p.status = 'available'; return p; });
                if (!pool.length) { showAlert('Empty DB','Selected preset is empty!'); return; }
                init(pool);
            });
        } else {
            let fi = document.getElementById('csvFileInput');
            if (!fi.files.length) { showAlert('Missing File','Select a CSV file.'); return; }
            let reader = new FileReader();
            reader.onload = e => { 
                let pool = parseCSV(e.target.result); 
                if(pool.length && pool[0].name !== undefined) init(pool); 
                else showAlert('CSV Error','Could not parse the file. Ensure you use the exact 12 columns.'); 
            };
            reader.readAsText(fi.files[0]);
        }
    });
};

window.joinAdminRoom = () => {
    let key = document.getElementById('joinAdminKey').value.trim();
    db.ref('rooms/'+key).once('value', snap => {
        if (snap.exists()) { 
            sessionStorage.setItem('roomKey', key); 
            setRoomState(key, db.ref('rooms/'+key)); 
            executeAdminBoot(); 
        } else {
            showAlert('Not Found','Invalid Room Key!');
        }
    });
};

function executeAdminBoot() {
    document.getElementById('adminGatewayScreen').style.display = 'none';
    document.getElementById('createRoomScreen').style.display = 'none';
    document.getElementById('joinAdminRoomScreen').style.display = 'none';
    document.getElementById('adminDashboardWrapper').style.display = 'flex';
    attachFirebaseListeners();
}

// --- Firebase Listeners ---

function attachFirebaseListeners() {
    db.ref('.info/connected').on('value', snap => {
        let connVisible = !snap.val();
        document.getElementById('connBanner').style.display = connVisible ? 'block' : 'none';
        _reposBroadcastBanner(connVisible);
    });

    let isChatLoaded = false;
    state.roomRef.child('chat_events').limitToLast(15).on('child_added', snap => {
        if (!isChatLoaded) return;
        let d = snap.val();
        let color = state.allRegisteredTeams[d.team]?.color || (d.team === 'ADMIN' ? '#ffc107' : '#fff');
        logLocal(`💬 <span style="color:${color}; font-weight:bold;">${esc(d.team)}</span>: ${esc(d.text)}`);
    });
    state.roomRef.child('chat_events').once('value', () => { isChatLoaded = true; });

    let isLogLoaded = false;
    state.roomRef.child('auction_log').limitToLast(100).once('value', snap => {
        let entries = snap.val() || {};
        Object.values(entries).sort((a,b) => a.t - b.t).forEach(e => logLocal(e.msg, new Date(e.t)));
        isLogLoaded = true;
    });
    state.roomRef.child('auction_log').limitToLast(100).on('child_added', snap => {
        if (!isLogLoaded) return;
        let e = snap.val(); logLocal(e.msg, new Date(e.t));
    });

    db.ref('global_player_images').on('value', snap => {
        state.globalImageMap = snap.val() || {};
        if (state.liveState.current_player_index >= 0 && state.playerPool.length > 0) updateLiveUI(_liveStateData); 
    });

    state.roomRef.child('settings').on('value', snap => {
        let d = snap.val() || {};
        state.settings = { ...state.settings, ...d };
        document.getElementById('headerRoomName').textContent = (d.room_name || 'IPL AUCTIONEER').toUpperCase();
    });

    state.roomRef.child('teams_auth').on('value', snap => {
        state.allRegisteredTeams = snap.val() || {};
        populateDropdowns(); recalculateBudgets(); updateBudgetTracker();
    });

    state.roomRef.child('logged_in_teams').on('value', snap => {
        state.activePresence = snap.val() || {}; 
        updateBudgetTracker();
    });

    state.roomRef.child('player_pool').once('value', snap => {
        let raw = snap.val() || [];
        state.playerPool = Array.isArray(raw) ? raw : Object.values(raw);
        populateDropdowns(); recalculateBudgets(); scheduleRender();
    });

    state.roomRef.child('player_pool').on('child_changed', snap => {
        let idx = parseInt(snap.key);
        if (!isNaN(idx)) {
            state.playerPool[idx] = snap.val();
            recalculateBudgets(); scheduleRender(); updateBudgetTracker();
        }
    });

    state.roomRef.child('live_state').on('value', snap => {
        let data = snap.val() || {};
        _liveStateData = data;
        state.liveState = data;
        updateLiveUI(data);
    });

    state.roomRef.child('broadcast').on('value', snap => {
        let d = snap.val();
        let banner = document.getElementById('broadcastBanner');
        let dot = document.getElementById('broadcastActiveDot');
        if (d && d.active && d.message) {
            document.getElementById('broadcastText').textContent = d.message;
            banner.style.display = 'block';
            if (dot) dot.style.display = 'inline-block';
            _reposBroadcastBanner(document.getElementById('connBanner').style.display !== 'none');
        } else {
            banner.style.display = 'none';
            if (dot) dot.style.display = 'none';
        }
    });
    
    state.roomRef.child('admin_presence').set(true);
    state.roomRef.child('admin_presence').onDisconnect().remove();
}

function _reposBroadcastBanner(connBannerVisible) {
    let bb = document.getElementById('broadcastBanner');
    if (bb) bb.style.top = (connBannerVisible && bb.style.display !== 'none') ? '36px' : '0';
}

function scheduleRender() { 
    clearTimeout(_renderTimer); 
    _renderTimer = setTimeout(() => { window.refreshLists(); }, 60); 
}

function logLocal(msg, date) {
    let time = (date || new Date()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    let logDiv = document.getElementById('logContainer');
    let entry = document.createElement('div'); entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
    if (logDiv) {
        logDiv.appendChild(entry);
        logDiv.parentElement.scrollTop = logDiv.parentElement.scrollHeight;
    }
}

// --- Live UI Updates ---

function updateLiveUI(data) {
    let isIdle = data.auction_state === 'idle';
    let isPaused = data.auction_state === 'paused';
    let currentIndex = data.current_player_index !== undefined ? data.current_player_index : -1;
    let currentBid = data.current_bid || 0;
    let currentLeader = data.highest_bidder || '-';

    // Audio trigger for incoming bids
    if (data.auction_state === 'bidding' && currentBid > localBidTracker && currentLeader !== '-' && currentLeader !== 'Base Price') {
        playSound('bid');
    }
    localBidTracker = (data.auction_state === 'cooldown' || isIdle) ? 0 : currentBid;

    // Track arc total duration
    if (data.timer_end && data.timer_end !== _prevTimerEnd && !isPaused) {
        _arcTimerTotal = Math.max(1000, data.timer_end - Date.now());
        _prevTimerEnd = data.timer_end;
    }

    // Update Player Info Panel
    if (currentIndex >= 0 && state.playerPool.length > 0 && !isIdle) {
        let p = state.playerPool[currentIndex];
        if (p) {
            let isOv = !['india','indian','ind'].includes((p.nationality || 'Indian').trim().toLowerCase());
            document.getElementById('adminPlayer').innerHTML = esc(p.name) + (isOv ? `<span class="neon-plane" title="${esc(p.nationality)}">✈️</span>` : '');
            
            let tags = document.getElementById('adminPlayerTags');
            let rl = document.getElementById('adminPlayerRole');
            if (p.franchise) { tags.textContent = p.franchise; tags.style.display = 'inline-block'; } else tags.style.display = 'none';
            if (p.role) { rl.textContent = p.role; rl.style.display = 'inline-block'; } else rl.style.display = 'none';
            
            document.getElementById('statRuns').textContent = p.runs || '-';
            document.getElementById('statAvg').textContent = p.average || '-';
            document.getElementById('statBatSR').textContent = p.bat_sr || '-';
            document.getElementById('statWkts').textContent = p.wickets || '-';
            document.getElementById('statEcon').textContent = p.economy || '-';
            document.getElementById('statBowlSR').textContent = p.bowl_sr || '-';
            
            let safeNameKey = (p.name || '').replace(/[.#$\[\]\/]/g, '_');
            let imgObj = state.globalImageMap[safeNameKey] || state.globalImageMap[p.name]; 
            let imgUrl = imgObj ? (imgObj.url || imgObj) : ''; 
            
            let photoBox = document.getElementById('playerPhoto');
            if (imgUrl) {
                photoBox.innerHTML = `<img src="${esc(imgUrl)}" style="width:100%; height:100%; object-fit:cover;">`;
            } else {
                photoBox.innerHTML = 'PHOTO';
            }
        }
    } else {
        document.getElementById('adminPlayer').textContent = 'Waiting…';
        document.getElementById('adminPlayerTags').style.display = 'none';
        document.getElementById('adminPlayerRole').style.display = 'none';
        document.getElementById('playerPhoto').innerHTML = 'PHOTO';
        ['statRuns','statAvg','statBatSR','statWkts','statEcon','statBowlSR'].forEach(id => { document.getElementById(id).textContent = '-'; });
    }

    document.getElementById('adminBid').textContent = `₹${(currentBid/CRORE).toFixed(2)} Cr`;
    let leaderEl = document.getElementById('adminLeader');
    leaderEl.textContent = currentLeader;
    leaderEl.style.color = state.allRegisteredTeams[currentLeader]?.color || '#007bff';

    // Render Bid History
    let stackArr = data.bid_stack ? Object.values(data.bid_stack) : [];
    let historyHtml = stackArr.slice().reverse().map(b => {
        let tColor = state.allRegisteredTeams[b.bidder]?.color || '#fff';
        return `<div class="bid-history-item"><span style="color:${tColor}; font-weight:bold;">${esc(b.bidder)}</span><span style="color:#28a745; font-weight:bold;">₹${(b.amount/CRORE).toFixed(2)} Cr</span></div>`;
    }).join('');
    document.getElementById('adminBidHistory').innerHTML = historyHtml || '<div style="padding:4px 8px; color:#666; text-align:center;">No bids placed yet.</div>';

    // Timer Arc Management
    if (window.uiTimer) clearInterval(window.uiTimer);
    if (window._cooldownAdvance) clearTimeout(window._cooldownAdvance);

    window.uiTimer = setInterval(() => {
        let timerEl = document.getElementById('adminTimer');
        let arcEl = document.getElementById('timerArc');
        timerEl.classList.remove('timer-green','timer-orange','timer-red','timer-paused');

        if (isIdle) {
            timerEl.textContent = '--';
            if (arcEl) { arcEl.style.stroke = '#333'; arcEl.style.strokeDashoffset = ARC_CIRCUMFERENCE; }
            return;
        }

        if (isPaused) {
            timerEl.textContent = '⏸';
            timerEl.classList.add('timer-paused');
            if (arcEl && _arcTimerTotal > 0) {
                let rem = data.paused_remaining || 0;
                let frac = Math.max(0, Math.min(1, rem / _arcTimerTotal));
                arcEl.style.strokeDashoffset = (ARC_CIRCUMFERENCE * (1 - frac)).toFixed(2);
                arcEl.style.stroke = '#fd7e14';
            }
            return;
        }

        let remainMs = data.timer_end ? Math.max(0, data.timer_end - Date.now()) : 0;
        let t = Math.ceil(remainMs / 1000);
        timerEl.textContent = t + 's';

        let arcColor;
        if (t > 10) { timerEl.classList.add('timer-green'); arcColor = '#28a745'; }
        else if (t > 5) { timerEl.classList.add('timer-orange'); arcColor = '#fd7e14'; }
        else { timerEl.classList.add('timer-red'); arcColor = '#dc3545'; }

        if (arcEl) {
            let frac = _arcTimerTotal > 0 ? Math.max(0, Math.min(1, remainMs / _arcTimerTotal)) : 0;
            arcEl.style.strokeDashoffset = (ARC_CIRCUMFERENCE * (1 - frac)).toFixed(2);
            arcEl.style.stroke = arcColor;
        }

        if (data.auction_state === 'bidding' && t <= 5 && t > 0 && t !== _lastTimerWarnSecond) {
            _lastTimerWarnSecond = t; playSound('timer_warn');
        }
    }, 200);

    // Auto-advance cooldown
    if (data.auction_state === 'cooldown' && data.timer_end) {
        let delay = Math.max(0, data.timer_end - Date.now());
        let biddingSecs = state.settings.bid_timer_secs || 15;
        window._cooldownAdvance = setTimeout(() => {
            state.roomRef.child('live_state').transaction(ld => {
                if (ld && ld.auction_state === 'cooldown') {
                    ld.auction_state = 'bidding';
                    ld.timer_end = Date.now() + (biddingSecs * 1000);
                }
                return ld;
            });
        }, delay + 200);
    }

    // Button States
    let btnSold = document.getElementById('btnSold'), btnUnsold = document.getElementById('btnUnsold');
    let diceBtn = document.getElementById('randomDiceBtn'), clocks = document.querySelectorAll('.master-clock');
    let pauseBtn = document.getElementById('btnPause');
    let hasBids = (currentLeader !== '-' && currentLeader !== 'Base Price');
    let active = (data.auction_state === 'bidding' || data.auction_state === 'cooldown');

    const setBtn = (btn, enabled) => {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.3';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    };

    if (isIdle || data.auction_state === 'sold' || data.auction_state === 'unsold') {
        setBtn(btnSold, false); setBtn(btnUnsold, false); clocks.forEach(b => setBtn(b, false));
        setBtn(pauseBtn, false);
        if (!isIdle) diceBtn.style.opacity = '1';
    } else {
        setBtn(btnSold, true); setBtn(btnUnsold, !hasBids && active);
        clocks.forEach(b => setBtn(b, true));
        setBtn(pauseBtn, active || isPaused);
        diceBtn.style.opacity = '0.3';
    }
    
    if (isPaused) { pauseBtn.innerHTML = '▶'; pauseBtn.classList.add('is-paused'); }
    else { pauseBtn.innerHTML = '⏸'; pauseBtn.classList.remove('is-paused'); }

    updateBudgetTracker();
}

function updateBudgetTracker() {
    let keys = Object.keys(state.allRegisteredTeams);
    let totalSlots = Math.max(10, Math.ceil(keys.length/5)*5);
    let html = '';
    let currentLeader = state.liveState.highest_bidder;
    let isValidLeader = currentLeader !== '-' && currentLeader !== 'Base Price' && currentLeader !== '';

    for (let i = 0; i < totalSlots; i++) {
        if (i < keys.length) {
            let team = keys[i], tData = state.allRegisteredTeams[team] || {};
            let remaining = state.teamBudgets[team] !== undefined ? state.teamBudgets[team] : (state.settings.starting_purse * CRORE);
            let count = state.playerPool.filter(p => p.status === 'sold' && p.team === team).length;
            let isOnline = state.activePresence[team];
            let dot = isOnline ? '<span class="live-dot"></span>' : '<span class="offline-dot"></span>';
            let tColor = tData.color || '#fff';
            let leaderClass = '';
            
            if (team === currentLeader && isValidLeader) {
                if (state.liveState.auction_state === 'sold') leaderClass = ' sold-card-glow';
                else if (state.liveState.auction_state === 'bidding' || state.liveState.auction_state === 'cooldown') leaderClass = ' leader-card-glow-silver';
            }

            html += `<div class="budget-card${leaderClass}">
                <button class="delete-team-btn" onclick="confirmDeleteTeam('${esc(team)}')" title="Delete Team">&times;</button>
                <div>
                    <div style="font-weight:bold; color:${tColor}; font-size:14px; margin-bottom:2px; display:flex; align-items:center; justify-content:center;">${esc(team)} ${dot}</div>
                    <div style="color:${remaining > 0 ? '#28a745' : '#dc3545'}; font-size:15px; font-weight:bold; margin-bottom:2px;">₹${(remaining/CRORE).toFixed(2)} Cr</div>
                    <div style="color:#666; font-size:9px; text-transform:uppercase;">${count} Players</div>
                </div>
                <div style="margin-top:auto; padding-top:4px; border-top:1px solid #222; font-size:9px; color:#888; display:flex; justify-content:space-between; align-items:center;">
                    <span id="rep-name-${esc(team)}" style="text-transform:uppercase; letter-spacing:.5px; max-width: 60px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(tData.repName || 'Unclaimed')}</span>
                    <span id="rep-pin-${esc(team)}" style="display:none; color:#ffc107; font-weight:bold; letter-spacing:1px;">${esc(tData.pin || 'None')}</span>
                    <span class="pin-eye" onclick="togglePin('${esc(team)}')">👁️</span>
                </div>
            </div>`;
        } else {
            html += `<div class="budget-card-empty">WAITING...</div>`;
        }
    }
    document.getElementById('budgetCards').innerHTML = html;
}

// --- List Render Management ---

let _deckRoleFilter = '';

window.setRoleFilter = function(role, el) {
    _deckRoleFilter = role;
    document.querySelectorAll('.role-filter-btn').forEach(b => {
        let active = b.dataset.role === role;
        b.style.background = active ? '#22222d' : '#111';
        b.style.color      = active ? '#ffc107' : '#888';
        b.style.borderColor= active ? '#ffc107' : '#333';
    });
    window.refreshLists();
};

window.refreshLists = function() {
    let set = document.getElementById('setSelector')?.value || '';
    let deckSearch = document.getElementById('auctioneerSearch')?.value.toLowerCase() || '';
    renderDeckList('deckList', set, deckSearch, _deckRoleFilter, null, true); // true = isAuctioneer
    
    renderUnsoldList('unsoldList', deckSearch, true); // true = isAuctioneer
    
    let team = document.getElementById('teamSelector')?.value || '';
    renderSquadList('squadList', team, deckSearch);
};

window.switchTab = function(name, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    if (el) el.classList.add('active');
    window.refreshLists();
};

function populateDropdowns() {
    let sets = new Set(); 
    state.playerPool.forEach(p => { if (p.set) sets.add(p.set); });
    let setSel = document.getElementById('setSelector'), prev = setSel.value;
    setSel.innerHTML = '<option value="" disabled hidden>SELECT SET</option>';
    sets.forEach(s => { let o = document.createElement('option'); o.value = s; o.text = s; setSel.appendChild(o); });
    if (prev && sets.has(prev)) setSel.value = prev; else if (sets.size > 0) setSel.value = Array.from(sets)[0];

    let tSel = document.getElementById('teamSelector'), prevT = tSel.value;
    tSel.innerHTML = '<option value="" disabled hidden>SELECT TEAM</option>';
    let keys = Object.keys(state.allRegisteredTeams);
    keys.forEach(t => { let o = document.createElement('option'); o.value = t; o.text = t; tSel.appendChild(o); });
    if (prevT && keys.includes(prevT)) tSel.value = prevT; else if (keys.length > 0) tSel.value = keys[0];
}

// Hook search bar to refresh lists
document.getElementById('auctioneerSearch')?.addEventListener('input', () => window.refreshLists());

// --- Admin Controls & Chat ---

window.confirmDeleteTeam = (teamCode) => {
    showPrompt('Delete Franchise',
        `Enter the PIN for '${teamCode}' to confirm deletion:`,
        '4-digit PIN',
        val => {
            if (state.allRegisteredTeams[teamCode] && state.allRegisteredTeams[teamCode].pin === val) {
                state.roomRef.child('teams_auth/' + teamCode).remove();
                state.roomRef.child('logged_in_teams/' + teamCode).remove();
                persistEvent(`🗑️ Franchise <strong>${esc(teamCode)}</strong> deleted by auctioneer.`);
            } else { 
                showAlert('Wrong PIN','Incorrect PIN. Deletion cancelled.'); 
            }
        }
    );
};

window.togglePin = (teamCode) => {
    let n = document.getElementById(`rep-name-${teamCode}`), p = document.getElementById(`rep-pin-${teamCode}`);
    if (n && p) { 
        let show = n.style.display !== 'none'; 
        n.style.display = show ? 'none' : 'block'; 
        p.style.display = show ? 'block' : 'none'; 
    }
};

window.sendBroadcast = () => {
    let inp = document.getElementById('broadcastInput');
    let msg = inp.value.trim();
    if (!msg) { inp.focus(); return; }
    if (!state.roomRef) return;
    state.roomRef.child('broadcast').set({ message: msg, active: true, ts: Date.now() });
    inp.value = '';
    persistEvent(`📢 Auctioneer broadcast: <em>${esc(msg)}</em>`);
};

window.clearBroadcast = () => {
    if (!state.roomRef) return;
    state.roomRef.child('broadcast').set({ message: '', active: false, ts: Date.now() });
};

window.sendChatMessage = () => {
    let inp = document.getElementById('chatInput'), msg = inp.value.trim();
    if (msg && state.roomRef) { 
        state.roomRef.child('chat_events').push({ team: 'ADMIN', text: msg, time: Date.now() }); 
        inp.value = ''; 
    }
};

// --- Settings Overlay ---

window.openSettings = () => {
    document.getElementById('settingsOverlay').style.display = 'flex';
    document.getElementById('set-room-key').value = state.roomKey || '';
    
    let s = state.settings;
    document.getElementById('set-room-name').value = s.room_name || 'IPL Auction';
    document.getElementById('set-purse').value = s.starting_purse || 100;
    document.getElementById('set-overseas-rule').value = s.overseas_limit_enabled !== false ? 'true' : 'false';
    document.getElementById('set-inc-base').value = s.inc_base || 20;
    document.getElementById('set-inc-mid').value = s.inc_mid || 50;
    document.getElementById('set-inc-high').value = s.inc_high || 100;
    document.getElementById('set-limit-mid').value = s.limit_mid || 2;
    document.getElementById('set-limit-high').value = s.limit_high || 5;
    document.getElementById('label-mid-start').textContent = s.limit_mid || 2;
    document.getElementById('label-high-start').textContent = s.limit_high || 5;
    document.getElementById('set-max-ov').value = s.max_overseas || 8;
    document.getElementById('set-min-squad').value = s.min_squad || 18;
    document.getElementById('set-max-squad').value = s.max_squad || 25;
    document.getElementById('set-bid-timer').value = s.bid_timer_secs || 15;
    document.getElementById('set-cooldown').value = s.cooldown_secs || 10;
    
    let exp = document.getElementById('exportTeamSelector');
    exp.innerHTML = '<option value="ALL">All Teams</option>';
    Object.keys(state.allRegisteredTeams).forEach(t => { 
        let o = document.createElement('option'); o.value = t; o.text = t; exp.appendChild(o); 
    });
};

window.saveSettings = () => {
    let rName = document.getElementById('set-room-name').value.trim();
    let purse = parseInt(document.getElementById('set-purse').value) || 100;
    let oLimit = document.getElementById('set-overseas-rule').value === 'true';
    
    if (state.roomRef && rName) {
        state.roomRef.child('settings').update({
            room_name: rName, 
            starting_purse: purse, 
            overseas_limit_enabled: oLimit,
            limit_mid: parseFloat(document.getElementById('set-limit-mid').value) || 2,
            limit_high: parseFloat(document.getElementById('set-limit-high').value) || 5,
            inc_base: parseInt(document.getElementById('set-inc-base').value) || 20,
            inc_mid: parseInt(document.getElementById('set-inc-mid').value) || 50,
            inc_high: parseInt(document.getElementById('set-inc-high').value) || 100,
            max_overseas: parseInt(document.getElementById('set-max-ov').value) || 8,
            min_squad: parseInt(document.getElementById('set-min-squad').value) || 18,
            max_squad: parseInt(document.getElementById('set-max-squad').value) || 25,
            bid_timer_secs: parseInt(document.getElementById('set-bid-timer').value) || 15,
            cooldown_secs: parseInt(document.getElementById('set-cooldown').value) || 10
        });
        document.getElementById('settingsOverlay').style.display = 'none';
        persistEvent('⚙️ Auction settings updated.');
    }
};

// --- Exports ---

window.exportSquadCSV = () => {
    let team = document.getElementById('exportTeamSelector').value;
    let sold = state.playerPool.filter(p => p.status === 'sold' && (team === 'ALL' || p.team === team));
    let csv = `"Player","Team","Role","Bought For (Cr)"\n` + sold.map(p => {
        let role = (state.allRegisteredTeams[p.team]?.playerRoles && state.allRegisteredTeams[p.team].playerRoles[p.name]) || '-';
        return `"${p.name}","${p.team}","${role}","${(p.sold_price/CRORE).toFixed(2)}"`;
    }).join('\n');
    
    let blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `IPL_${team}_Export.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

window.exportSquadPDF = () => {
    let team = document.getElementById('exportTeamSelector').value;
    let sold = state.playerPool.filter(p => p.status === 'sold' && (team === 'ALL' || p.team === team));
    if (!sold.length) { showAlert('No Data','No sold players for this selection.'); return; }
    
    let div = document.createElement('div');
    div.style.cssText = 'padding:20px; font-family:sans-serif; color:#000; background:#fff;';
    div.innerHTML = `<h2 style="text-align:center; text-transform:uppercase; margin-bottom:20px;">IPL Auction Result — ${team}</h2>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr style="background:#eee;"><th style="padding:10px; border:1px solid #ccc;">Player</th><th style="padding:10px; border:1px solid #ccc;">Nat</th><th style="padding:10px; border:1px solid #ccc;">Team</th><th style="padding:10px; border:1px solid #ccc;">Role</th><th style="padding:10px; border:1px solid #ccc;">Price (Cr)</th></tr>
        ${sold.map(p => {
            let role = (state.allRegisteredTeams[p.team]?.playerRoles?.[p.name]) || '-';
            return `<tr><td style="padding:10px; border:1px solid #ccc;">${p.name}</td><td style="padding:10px; border:1px solid #ccc;">${p.nationality||'-'}</td><td style="padding:10px; border:1px solid #ccc;">${p.team}</td><td style="padding:10px; border:1px solid #ccc; font-weight:bold;">${role}</td><td style="padding:10px; border:1px solid #ccc; font-weight:bold;">₹${(p.sold_price/CRORE).toFixed(2)}</td></tr>`;
        }).join('')}
    </table>`;
    
    html2pdf().set({ margin:10, filename:`IPL_${team}_Export.pdf`, html2canvas:{scale:2}, jsPDF:{unit:'mm', format:'a4', orientation:'portrait'} }).from(div).save();
};

// --- Keyboard Shortcuts ---

document.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (document.getElementById('adminDashboardWrapper').style.display === 'none') return;
    
    if (e.key.toLowerCase() === 's' && !document.getElementById('btnSold').disabled) window.sellPlayer();
    if (e.key.toLowerCase() === 'x' && !document.getElementById('btnUnsold').disabled) window.passPlayer();
    if (e.key.toLowerCase() === 'p' && !document.getElementById('btnPause').disabled) window.togglePause();
    if (e.code === 'Space') { e.preventDefault(); window.pullRandomFromSet(); }
});