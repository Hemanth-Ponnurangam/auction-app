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
            executeUIBoot();
        } else {
            document.getElementById('loginScreen').style.display = 'block';
            loadGlobalFranchises();
        }
    } else {
        document.getElementById('roomKeyScreen').style.display = 'flex';
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
    document.getElementById('roomKeyScreen').style.display = 'flex';
};

window.backToGateway = () => {
    window.location.href = 'index.html';
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

    // PATCH: Initialize War Room using custom session data instead of Firebase Auth
    let myUid = state.myRepName.replace(/\s+/g, '_') + '_' + Math.random().toString(36).substr(2, 5);
    initializeWarRoom(state.myTeamName, myUid, state.myRepName);
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
        
        let aucStatus = document.getElementById('auctioneerStatus');
        if (aucStatus) {
            let isAucOnline = state.activePresence['ADMIN'] || false;
            aucStatus.className = isAucOnline ? 'live-dot' : 'offline-dot';
            aucStatus.title = isAucOnline ? 'Auctioneer Online' : 'Auctioneer Offline';
        }
    });

    // Player Pool
    state.roomRef.child('player_pool').once('value', snap => {
        let raw = snap.val() || [];
        state.playerPool = Array.isArray(raw) ? raw : Object.values(raw);
        populateSetDropdown();
        recalculateBudgets();
        window.refreshLists();
        updateMyTeamUI();
    });

    state.roomRef.child('player_pool').on('child_changed', snap => {
        let idx = parseInt(snap.key);
        if (!isNaN(idx)) {
            state.playerPool[idx] = snap.val();
            recalculateBudgets();
            window.refreshLists();
            updateMyTeamUI();
            
            if (state.liveState.auction_state === 'sold' && _latestLiveData) {
                let soldP = state.playerPool[_latestLiveData.current_player_index];
                let amIWinning = soldP?.team === state.myTeamName;
                updateLiveUI(_latestLiveData, amIWinning);
            }
        }
    });
    
    // Global Images
    db.ref('global_player_images').on('value', snap => {
        state.globalImageMap = snap.val() || {};
        if (state.liveState.current_player_index >= 0 && state.playerPool.length > 0) {
            updateLiveUI(state.liveState, state.liveState.highest_bidder === state.myTeamName); 
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
        updateMyTeamUI(); // Trigger glow updates on team cards
    });

    // Chat & Logs
    let isChatLoaded = false;
    state.roomRef.child('chat_events').limitToLast(15).on('child_added', snap => {
        if (!isChatLoaded) return;
        let d = snap.val();
        triggerChatPopup(d.team, d.text);
        let col = state.allRegisteredTeams[d.team]?.color || (d.team === 'SYSTEM' ? '#ffc107' : '#fff');
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
            let connVisible = document.getElementById('connBanner').style.display !== 'none';
            banner.style.top = connVisible ? '36px' : '0';
        } else {
            banner.classList.remove('show');
        }
    });
}

// --- Live UI Updates ---

function updateLiveUI(data, amIWinning) {
    document.getElementById('actualBidAmount').textContent = `₹${((data.current_bid || 0) / CRORE).toFixed(2)} Cr`;
    
    // Timer Loop
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

        let totalSecs = data.auction_state === 'cooldown' ? (state.settings.cooldown_secs || 10) : (state.settings.bid_timer_secs || 15);
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
    }, 200);

    evaluateBidButtonStatus(amIWinning);
    
    // Update Central Player Stats & Images
    let pIdx = data.current_player_index !== undefined ? data.current_player_index : -1;
    if (pIdx >= 0 && state.playerPool.length > 0 && data.auction_state !== 'idle') {
        let p = state.playerPool[pIdx];
        if (p) {
            let isOv = !['india','indian','ind'].includes((p.nationality || 'Indian').trim().toLowerCase());
            document.getElementById('playerName').innerHTML = esc(p.name) + (isOv ? `<span class="neon-plane" title="${esc(p.nationality)}">✈️</span>` : '');
            
            let tags = document.getElementById('playerFranchise');
            let rl = document.getElementById('playerRole');
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
                photoBox.classList.add('has-photo');
                photoBox.innerHTML = `<img src="${esc(imgUrl)}" alt="Player">`;
            } else {
                photoBox.classList.remove('has-photo');
                photoBox.innerHTML = 'PHOTO';
            }
        }
    } else {
        document.getElementById('playerName').textContent = 'Waiting…';
        document.getElementById('playerFranchise').style.display = 'none';
        document.getElementById('playerRole').style.display = 'none';
        document.getElementById('playerPhoto').innerHTML = 'PHOTO';
        document.getElementById('playerPhoto').classList.remove('has-photo');
        ['statRuns','statAvg','statBatSR','statWkts','statEcon','statBowlSR'].forEach(id => { document.getElementById(id).textContent = '-'; });
    }

    // Bid History rendering
    let leaderEl = document.getElementById('leaderBadge');
    if (data.highest_bidder !== '-' && data.highest_bidder !== 'Base Price' && data.highest_bidder !== '') {
        leaderEl.textContent = data.highest_bidder;
        leaderEl.style.display = 'inline-block';
        leaderEl.style.color = state.allRegisteredTeams[data.highest_bidder]?.color || '#007bff';
    } else {
        leaderEl.style.display = 'none';
    }

    let stackArr = data.bid_stack ? Object.values(data.bid_stack) : [];
    let historyHtml = stackArr.slice().reverse().map(b => {
        let tColor = state.allRegisteredTeams[b.bidder]?.color || '#fff';
        return `<div class="hist-row"><span style="color:${tColor}; font-weight:bold;">${esc(b.bidder)}</span><span style="color:#28a745; font-weight:bold;">₹${(b.amount/CRORE).toFixed(2)} Cr</span></div>`;
    }).join('');
    document.getElementById('franchiseBidHistory').innerHTML = historyHtml;
}

// --- Squad Rendering ---

function updateMyTeamUI() {
    try {
        if (!state.myTeamName || !Object.keys(state.allRegisteredTeams).length) return;

        let myColor = state.allRegisteredTeams[state.myTeamName]?.color || state.myTeamColor || '#fff';
        document.getElementById('myTeamBox').style.borderColor = myColor;
        document.getElementById('myTeamDisplay').style.color   = myColor;

        let startingPurseCr = state.settings.starting_purse || 100;
        let myBudget = state.teamBudgets[state.myTeamName] !== undefined ? state.teamBudgets[state.myTeamName] : (startingPurseCr * CRORE);
        let myPurseCr = myBudget / CRORE;
        let purseEl = document.getElementById('myTeamPurse');
        if (purseEl) {
            purseEl.textContent = `₹${myPurseCr.toFixed(2)} Cr`;
            purseEl.style.color = myPurseCr > 0 ? '#28a745' : '#dc3545';
        }

        let myRoster = state.playerPool.filter(p => p && p.status === 'sold' && p.team === state.myTeamName);
        
        // SAFE ARRAY CONVERSION
        let rawXI = state.allRegisteredTeams[state.myTeamName]?.playingXI || [];
        let myXIOrder = Array.isArray(rawXI) ? rawXI : Object.values(rawXI);
        
        let rawBench = state.allRegisteredTeams[state.myTeamName]?.bench || [];
        let myBenchOrder = Array.isArray(rawBench) ? rawBench : Object.values(rawBench);
        
        let myRoles = state.allRegisteredTeams[state.myTeamName]?.playerRoles || {};

        let xiPlayers    = myXIOrder.map(n => myRoster.find(p => p && p.name === n)).filter(Boolean);
        let benchPlayers = myBenchOrder.map(n => myRoster.find(p => p && p.name === n)).filter(Boolean);
        
        myRoster.forEach(p => { 
            if (p && !myXIOrder.includes(p.name) && !myBenchOrder.includes(p.name)) benchPlayers.push(p); 
        });

        let myPriceRanks = [...new Set(myRoster.map(p => p.sold_price))].filter(v => v > 0).sort((a,b) => b - a);
        let [gold,silver,bronze] = [myPriceRanks[0]||-1, myPriceRanks[1]||-1, myPriceRanks[2]||-1];

        function planeIcon(p) {
            return !['india','indian','ind'].includes((p.nationality || 'Indian').trim().toLowerCase()) 
                ? `<span class="neon-plane" title="${esc(p.nationality)}">✈️</span>` : '';
        }

        let buildRow = p => {
            if (!p) return '';
            let rawR   = myRoles[p.name] || '';
            let roleHtml = rawR ? rawR.split(',').map(r => `<span style="font-size:9px; color:${r==='WK'?'#0dcaf0':'#ffc107'}; font-weight:bold;">${r}</span>`).join(' ') : '·';
            let pc = p.sold_price===gold?'#eab308': p.sold_price===silver?'#c0c0c0': p.sold_price===bronze?'#cd7f32':'#aaa';
            return `<div class="roster-item roster-item-drag" draggable="true" data-player="${esc(p.name)}">
                <div style="display:flex; align-items:center;">
                    <span>${esc(p.name)} ${planeIcon(p)}</span>
                    <button class="role-badge" onclick="openRolePopup(event,'${esc(p.name)}')">${roleHtml}</button>
                </div>
                <span style="color:${pc}; font-weight:bold;">₹${((p.sold_price||0)/CRORE).toFixed(2)}Cr</span>
            </div>`;
        };

        let xiHtml = xiPlayers.map(buildRow).join('');
        let xiCount = xiPlayers.length;
        for (let i = xiCount + 1; i <= 11; i++) {
            xiHtml += `<div class="roster-item" style="border:1px dashed #333; color:#444; justify-content:center; font-style:italic;">Slot ${i}</div>`;
        }

        if (!isDragging) {
            let xiList = document.getElementById('playingXIList');
            let bList = document.getElementById('benchList');
            if (xiList) xiList.innerHTML = xiHtml;
            if (bList) bList.innerHTML = benchPlayers.map(buildRow).join('');
            
            document.querySelectorAll('.roster-item-drag').forEach(attachDragEvents);
        }
        
        let countEl = document.getElementById('xiCount');
        if (countEl) countEl.textContent = `(${xiCount}/11)`;

        let othersHtml = '';
        Object.keys(state.allRegisteredTeams).forEach(t => {
            if (t === state.myTeamName) return;
            let tData  = state.allRegisteredTeams[t] || {};
            let tColor = tData.color || '#fff';
            let tRep   = tData.repName || 'Unknown';
            let rCr    = (state.teamBudgets[t] !== undefined ? state.teamBudgets[t] : (startingPurseCr * CRORE)) / CRORE;
            let count  = state.playerPool.filter(p => p && p.status === 'sold' && p.team === t).length;
            let isOnline = state.activePresence[t];
            let dot = isOnline ? '<span class="live-dot"></span>' : '<span class="offline-dot"></span>';
            
            let curWin = state.liveState.highest_bidder;
            let isValidLeader = curWin !== '-' && curWin !== 'Base Price' && curWin !== '';
            let currentAuctionState = state.liveState.auction_state;
            
            let lgClass = (t === curWin && isValidLeader && (currentAuctionState==='bidding'||currentAuctionState==='cooldown')) ? ' leader-card-glow-silver' :
                          (t === curWin && isValidLeader && currentAuctionState==='sold') ? ' sold-card-glow' : '';
                          
            othersHtml += `
            <div class="other-team-card-hz${lgClass}" data-team="${esc(t)}" style="border-top-color:${tColor};">
                <div class="team-msg-popup" id="msg-popup-${esc(t)}"></div>
                <div style="font-weight:bold; font-size:13px; margin-bottom:2px;">${esc(t)} ${dot}</div>
                <div class="other-team-rep-name">${esc(tRep)}</div>
                <div class="purse-val" style="color:${rCr > 0 ? '#28a745' : '#dc3545'};">₹${rCr.toFixed(2)} Cr</div>
                <div style="font-size:9px; color:#666; text-transform:uppercase; margin-top:2px;">${count} Players</div>
            </div>`;
        });

        let otherList = document.getElementById('otherTeamsList');
        if (otherList) {
            otherList.innerHTML = othersHtml || "<div style='color:#666; font-size:12px; width:100%; text-align:center; padding:20px 0;'>No other franchises connected.</div>";
        }
        
        updateAllPopups();

    } catch(e) {
        console.error("The UI rendering crashed! Error:", e);
    }
}

// --- List Render Management ---

window.addEventListener('watchlistUpdated', () => window.refreshLists());
window.addEventListener('rosterOrderUpdated', updateMyTeamUI);

let _deckRoleFilter = '';
window.setRoleFilter = function(role, el) {
    _deckRoleFilter = role;
    document.querySelectorAll('.role-filter-btn').forEach(b => {
        let active = b.dataset.role === role;
        b.classList.toggle('active', active);
    });
    window.refreshLists();
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

// Settings Overlay Handlers
window.openFranchiseSettings = () => {
    document.getElementById('franchiseSettingsOverlay').style.display = 'flex';
};

window.exportMySquadCSV = () => {
    // Basic CSV export for franchise
    let sold = state.playerPool.filter(p => p.status === 'sold' && p.team === state.myTeamName);
    let csv = `"Player","Role","Bought For (Cr)"\n` + sold.map(p => {
        let role = (state.allRegisteredTeams[state.myTeamName]?.playerRoles && state.allRegisteredTeams[state.myTeamName].playerRoles[p.name]) || '-';
        return `"${p.name}","${role}","${(p.sold_price/CRORE).toFixed(2)}"`;
    }).join('\n');
    let blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    let a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${state.myTeamName}_Squad.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// Hotkey listener
document.addEventListener('keydown', e => {
    if (document.getElementById('mainDashboard').style.display === 'none') return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { 
        e.preventDefault(); 
        if (!document.getElementById('mainActionButton').disabled && typeof window.placeBid === 'function') {
            window.placeBid(); 
        }
    }
});


// --- V2.2 MULTIPLAYER WAR ROOM LOGIC ---

let isPaddleHolder = false;

function initializeWarRoom(teamId, myUid, myName) {
    // PATCH: Uses db.ref instead of database.ref, and scopes it properly to the current room
    const connectedRef = db.ref('.info/connected');
    const userStatusRef = db.ref(`rooms/${state.roomKey}/franchises/${teamId}/onlineUsers/${myUid}`);

    // 1. Live Roster Dot
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            userStatusRef.set(true);
            userStatusRef.onDisconnect().remove();
        }
    });

    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/onlineUsers`).on('value', (snap) => {
        const count = snap.numChildren() || 1;
        const countElement = document.getElementById('onlineRepsCount');
        if(countElement) countElement.innerText = count;

        // PATCH: Auto-assign paddle if you are the only one online and no one holds it
        if (count === 1) {
            db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).once('value', pSnap => {
                if (!pSnap.exists()) {
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).set({ uid: myUid, name: myName });
                }
            });
        }
    });

    // 2. Paddle Delegation
    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).on('value', (snap) => {
        const paddleData = snap.val();
        
        // FIXED: Now properly targets the renamed mainActionButton
        const bidBtn = document.getElementById('mainActionButton'); 
        
        const reqBtn = document.getElementById('requestPaddleBtn');
        const sugBtn = document.getElementById('suggestBidBtn');
        const nameTag = document.getElementById('paddleHolderName');

        if (paddleData && paddleData.uid === myUid) {
            isPaddleHolder = true;
            if(bidBtn) bidBtn.style.display = 'block';
            if(reqBtn) reqBtn.style.display = 'none';
            if(sugBtn) sugBtn.style.display = 'none';
        } else {
            isPaddleHolder = false;
            if(bidBtn) bidBtn.style.display = 'none';
            if(reqBtn) reqBtn.style.display = 'block';
            if(sugBtn) sugBtn.style.display = 'block';
        }
        
        if(nameTag) nameTag.innerText = paddleData ? paddleData.name : "Available";
    });

    // 3. Visual Pings
    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/suggestedBid`).on('value', (snap) => {
        if (isPaddleHolder && snap.exists()) {
            
            // FIXED: Now properly targets the renamed mainActionButton
            const bidBtn = document.getElementById('mainActionButton');
            
            if(bidBtn) {
                bidBtn.classList.add('pulse-green');
                setTimeout(() => bidBtn.classList.remove('pulse-green'), 2000);
            }
        }
    });

    // 4. Button Click Listeners (Using cloning to prevent duplicate listeners if re-initialized)
    const sugBtn = document.getElementById('suggestBidBtn');
    if(sugBtn) {
        sugBtn.replaceWith(sugBtn.cloneNode(true));
        document.getElementById('suggestBidBtn').addEventListener('click', () => {
            db.ref(`rooms/${state.roomKey}/franchises/${teamId}/suggestedBid`).set(Date.now());
        });
    }

    const reqBtn = document.getElementById('requestPaddleBtn');
    if(reqBtn) {
        reqBtn.replaceWith(reqBtn.cloneNode(true));
        document.getElementById('requestPaddleBtn').addEventListener('click', () => {
            db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).set({ uid: myUid, name: myName });
        });
    }
}


// --- V2.2 GLOBAL SCOPE BRIDGE (FRANCHISE PORTAL) ---
// This exposes module functions to the HTML inline onclick attributes

// Gateway & Login Controls
window.backToGateway = typeof backToGateway !== 'undefined' ? backToGateway : null;
window.handleVerifyRoomKey = typeof handleVerifyRoomKey !== 'undefined' ? handleVerifyRoomKey : null;
window.prepareCustomLogin = typeof prepareCustomLogin !== 'undefined' ? prepareCustomLogin : null;
window.handleSubmitAuth = typeof handleSubmitAuth !== 'undefined' ? handleSubmitAuth : null;
window.backToSelection = typeof backToSelection !== 'undefined' ? backToSelection : null;

// Dashboard & Settings Controls
window.logout = typeof logout !== 'undefined' ? logout : null;
window.openFranchiseSettings = typeof openFranchiseSettings !== 'undefined' ? openFranchiseSettings : null;
window.exportMySquadCSV = typeof exportMySquadCSV !== 'undefined' ? exportMySquadCSV : null;
window.exportMySquadPDF = typeof exportMySquadPDF !== 'undefined' ? exportMySquadPDF : null;
window.exportAllSquadsCSV = typeof exportAllSquadsCSV !== 'undefined' ? exportAllSquadsCSV : null;
window.exportAllSquadsPDF = typeof exportAllSquadsPDF !== 'undefined' ? exportAllSquadsPDF : null;

// Tab & UI Controls
window.switchTab = typeof switchTab !== 'undefined' ? switchTab : null;
window.refreshLists = typeof refreshLists !== 'undefined' ? refreshLists : null;
window.setRoleFilter = typeof setRoleFilter !== 'undefined' ? setRoleFilter : null;
window.sendChatMessage = typeof sendChatMessage !== 'undefined' ? sendChatMessage : null;
window.dismissBroadcast = typeof dismissBroadcast !== 'undefined' ? dismissBroadcast : null;
