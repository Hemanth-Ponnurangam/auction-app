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

// ─── National flag emoji lookup ──────────────────────────────────────────────
const NAT_FLAGS = {
    'indian':'🇮🇳','india':'🇮🇳','ind':'🇮🇳',
    'australian':'🇦🇺','australia':'🇦🇺','aus':'🇦🇺',
    'english':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','england':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','eng':'🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'south african':'🇿🇦','south africa':'🇿🇦','sa':'🇿🇦','rsa':'🇿🇦',
    'west indian':'🏝️','west indies':'🏝️','windies':'🏝️','wi':'🏝️',
    'new zealander':'🇳🇿','new zealand':'🇳🇿','nz':'🇳🇿',
    'pakistani':'🇵🇰','pakistan':'🇵🇰','pak':'🇵🇰',
    'sri lankan':'🇱🇰','sri lanka':'🇱🇰','sl':'🇱🇰','slk':'🇱🇰',
    'bangladeshi':'🇧🇩','bangladesh':'🇧🇩','ban':'🇧🇩',
    'afghan':'🇦🇫','afghanistan':'🇦🇫','afg':'🇦🇫',
    'zimbabwean':'🇿🇼','zimbabwe':'🇿🇼','zim':'🇿🇼',
    'irish':'🇮🇪','ireland':'🇮🇪','ire':'🇮🇪',
    'scottish':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','scotland':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','sco':'🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'dutch':'🇳🇱','netherlands':'🇳🇱','ned':'🇳🇱',
    'namibian':'🇳🇦','namibia':'🇳🇦','nam':'🇳🇦',
    'nepali':'🇳🇵','nepal':'🇳🇵','nep':'🇳🇵',
    'canadian':'🇨🇦','canada':'🇨🇦','can':'🇨🇦',
    'american':'🇺🇸','usa':'🇺🇸','united states':'🇺🇸',
};
function getNatFlag(nat) {
    if (!nat) return '';
    return NAT_FLAGS[nat.trim().toLowerCase()] || '🌍';
}

// ─── Sold / Unsold Overlay Animation ────────────────────────────────────────
let _aucConfettiRaf = null;
let _aucOverlayTimeout = null;

function ensureSoldOverlay() {
    let el = document.getElementById('aucSoldOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'aucSoldOverlay';
        el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity 0.3s;';
        document.body.appendChild(el);
    }
    let cv = document.getElementById('aucConfettiCanvas');
    if (!cv) {
        cv = document.createElement('canvas');
        cv.id = 'aucConfettiCanvas';
        cv.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9998;display:none;';
        document.body.appendChild(cv);
    }
    return el;
}

function triggerAucSold(teamName, teamColor) {
    let overlay = ensureSoldOverlay();
    overlay.innerHTML = `
        <div style="text-align:center;animation:aucStampIn 0.35s cubic-bezier(0.2,1.5,0.4,1) forwards;">
            <span style="display:block;font-size:clamp(48px,8vw,90px);font-weight:900;color:#22c55e;letter-spacing:6px;text-shadow:0 0 30px rgba(34,197,94,0.9),4px 4px 0 rgba(0,0,0,0.6);border:5px solid #22c55e;border-radius:12px;padding:10px 24px;background:rgba(0,0,0,0.8);backdrop-filter:blur(6px);">SOLD!</span>
            <span style="display:block;font-size:clamp(16px,3vw,28px);font-weight:700;margin-top:10px;letter-spacing:3px;color:${teamColor||'#22c55e'};text-shadow:0 0 20px currentColor;">${esc(teamName)}</span>
        </div>`;
    overlay.style.opacity = '1';
    aucStartConfetti(teamColor);
    clearTimeout(_aucOverlayTimeout);
    _aucOverlayTimeout = setTimeout(() => {
        overlay.style.transition = 'opacity 0.6s';
        overlay.style.opacity = '0';
        aucStopConfetti();
    }, 3200);
}

function triggerAucUnsold() {
    let overlay = ensureSoldOverlay();
    overlay.innerHTML = `
        <div style="animation:aucStampIn 0.35s cubic-bezier(0.2,1.5,0.4,1) forwards;">
            <span style="display:block;font-size:clamp(42px,7vw,80px);font-weight:900;color:#ef4444;letter-spacing:6px;text-shadow:0 0 30px rgba(239,68,68,0.9),4px 4px 0 rgba(0,0,0,0.6);border:5px solid #ef4444;border-radius:12px;padding:10px 24px;background:rgba(0,0,0,0.8);backdrop-filter:blur(6px);transform:rotate(-4deg);display:inline-block;">UNSOLD</span>
        </div>`;
    overlay.style.opacity = '1';
    clearTimeout(_aucOverlayTimeout);
    _aucOverlayTimeout = setTimeout(() => {
        overlay.style.transition = 'opacity 0.6s';
        overlay.style.opacity = '0';
    }, 2500);
}

function aucStartConfetti(primaryColor) {
    let canvas = document.getElementById('aucConfettiCanvas');
    if (!canvas) return;
    canvas.style.display = 'block';
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    let ctx = canvas.getContext('2d');
    let colors = [primaryColor||'#ffd700','#fff','#22c55e','#0dcaf0','#ffc107'];
    let particles = Array.from({length:100}, () => ({
        x: Math.random()*canvas.width, y: -20-Math.random()*200,
        r: Math.random()*6+3, ta:0, ti:Math.random()*0.08+0.04,
        vx:(Math.random()-0.5)*4, vy:Math.random()*3+2.5,
        color:colors[Math.floor(Math.random()*colors.length)],
    }));
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        particles.forEach(p => {
            p.ta+=p.ti; p.x+=p.vx+Math.sin(p.ta)*0.5; p.y+=p.vy;
            ctx.beginPath(); ctx.fillStyle=p.color;
            ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.ta);
            ctx.fillRect(-p.r,-p.r/2,p.r*2,p.r); ctx.restore();
        });
        particles = particles.filter(p => p.y < canvas.height+20);
        if (particles.length) _aucConfettiRaf = requestAnimationFrame(draw);
        else canvas.style.display='none';
    }
    if (_aucConfettiRaf) cancelAnimationFrame(_aucConfettiRaf);
    _aucConfettiRaf = requestAnimationFrame(draw);
}

function aucStopConfetti() {
    if (_aucConfettiRaf) cancelAnimationFrame(_aucConfettiRaf);
    let canvas = document.getElementById('aucConfettiCanvas');
    if (canvas) { canvas.style.display='none'; let ctx=canvas.getContext('2d'); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); }
}

let _liveStateData = {};
let _renderTimer = null;
let _arcTimerTotal = 0;
let _prevTimerEnd = 0;
let localBidTracker = 0;
let _lastTimerWarnSecond = -1;

window.onload = function() {
    setupEventListeners();
    
    let savedKey = sessionStorage.getItem('roomKey');
    if (savedKey) {
        setRoomState(savedKey, db.ref('rooms/' + savedKey));
        executeAdminBoot();
    } else {
        document.getElementById('adminGatewayScreen').style.display = 'flex';
    }
};

// --- Centralized Event Listeners ---
function setupEventListeners() {
    // Gateway Screens
    document.querySelector('.btn-massive[onclick="showCreateRoom()"]')?.addEventListener('click', showCreateRoom);
    document.querySelector('.btn-auctioneer[onclick="showJoinAdminRoom()"]')?.addEventListener('click', showJoinAdminRoom);
    document.querySelector('#createRoomScreen .submit-btn')?.addEventListener('click', createNewRoom);
    document.querySelector('#joinAdminRoomScreen .submit-btn')?.addEventListener('click', joinAdminRoom);
    document.querySelectorAll('.back-btn').forEach(btn => btn.addEventListener('click', backToAdminGateway));
    document.getElementById('dbSelection')?.addEventListener('change', toggleCustomUpload);
    
    // Header & Settings
    document.querySelector('.gear-btn')?.addEventListener('click', openSettings);
    document.querySelector('#settingsOverlay .btn-massive.btn-auctioneer')?.addEventListener('click', saveSettings);
    document.querySelector('#settingsOverlay .btn-outline-danger')?.addEventListener('click', confirmResetAuction);
    
    // Broadcast & Chat
    document.querySelector('.btn-broadcast-send')?.addEventListener('click', sendBroadcast);
    document.getElementById('broadcastInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendBroadcast(); });
    document.getElementById('broadcastClearBtn')?.addEventListener('click', clearBroadcast);
    document.querySelector('.chat-btn')?.addEventListener('click', sendChatMessage);
    document.getElementById('chatInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendChatMessage(); });

    // Action Controls
    document.getElementById('dynamicSellBtn')?.addEventListener('click', function() {
        if (this.classList.contains('btn-green')) sellPlayer();
        else if (this.classList.contains('btn-red')) passPlayer();
    });
    document.getElementById('randomDiceBtn')?.addEventListener('click', pullRandomFromSet);
    document.querySelector('button[title="Undo Sale"]')?.addEventListener('click', undoLastSale);
    document.querySelector('button[title="Undo Last Bid"]')?.addEventListener('click', undoLastBid);
    document.getElementById('btnPause')?.addEventListener('click', togglePause);
    document.querySelector('button[title="Force Start"]')?.addEventListener('click', bypassCooldown);
    
    // Clocks
    document.querySelectorAll('.master-clock').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let secs = parseInt(e.target.innerText);
            if (!isNaN(secs)) startTimer(secs, 'bidding');
        });
    });

    // Right Panel Tabs & Filters
    document.getElementById('auctioneerSearch')?.addEventListener('input', () => {
        clearTimeout(_renderTimer);
        _renderTimer = setTimeout(refreshLists, 200);
    });
    document.getElementById('setSelector')?.addEventListener('change', refreshLists);
    document.getElementById('teamSelector')?.addEventListener('change', refreshLists);
    
    document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let name = e.target.innerText.includes('DECK') ? 'deck' :
                       e.target.innerText.includes('UNSOLD') ? 'unsold' :
                       e.target.innerText.includes('SQUADS') ? 'squads' : 'logs';
            switchTab(name, e.target);
        });
    });

    document.querySelectorAll('.role-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => setRoleFilter(e.target.dataset.role, e.target));
    });

    // Delegation for dynamic lists (Budgets, Deck, Unsold)
    document.getElementById('budgetCards')?.addEventListener('click', e => {
        if (e.target.classList.contains('delete-team-btn')) confirmDeleteTeam(e.target.dataset.team);
        if (e.target.classList.contains('pin-eye')) togglePin(e.target.dataset.pinEye);
    });

    // Attach to dynamic list buttons rendered by shared/render.js
    document.addEventListener('click', e => {
        if (e.target.classList.contains('action-btn') && e.target.dataset.pushIndex) {
            pushPlayerToBlock(e.target.dataset.pushIndex);
        }
    });
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (document.getElementById('adminDashboardWrapper')?.style.display === 'none') return;
    
    let dynBtn = document.getElementById('dynamicSellBtn');
    let pauseBtn = document.getElementById('btnPause');
    
    if (e.key.toLowerCase() === 's' && dynBtn && !dynBtn.disabled && dynBtn.classList.contains('btn-green')) sellPlayer();
    if (e.key.toLowerCase() === 'x' && dynBtn && !dynBtn.disabled && dynBtn.classList.contains('btn-red')) passPlayer();
    if (e.key.toLowerCase() === 'p' && pauseBtn && !pauseBtn.disabled) togglePause();
    if (e.code === 'Space') { e.preventDefault(); pullRandomFromSet(); }
});

// --- Gateway & UI Setup ---

function showCreateRoom() {
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
                o.value = 'preset_' + k; o.text = `Preset: ${k.toUpperCase()} (${dbs[k].length} Players)`; 
                sel.appendChild(o); 
            });
            let co = document.createElement('option'); co.value = 'custom'; co.text = 'Upload Custom CSV'; sel.appendChild(co);
            sel.value = 'preset_' + keys[0];
        } else { sel.value = 'custom'; }
        toggleCustomUpload();
    });
}

function showJoinAdminRoom() {
    document.getElementById('adminGatewayScreen').style.display = 'none';
    document.getElementById('joinAdminRoomScreen').style.display = 'flex';
}

function backToAdminGateway() {
    document.getElementById('createRoomScreen').style.display = 'none';
    document.getElementById('joinAdminRoomScreen').style.display = 'none';
    document.getElementById('adminGatewayScreen').style.display = 'flex';
}

function toggleCustomUpload() {
    document.getElementById('customDbUpload').style.display = document.getElementById('dbSelection').value === 'custom' ? 'block' : 'none';
}

// FIX: CSV Parsing — all stat columns stored FLAT on player object (no nesting)
function parseCSV(text) {
    let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let raw = lines[0].split(',');
    let hdrs = raw.map(h => h.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''));
    let rawHdrs = raw.map(h => h.trim());

    // Core identity columns — everything else is a stat column
    const CORE = new Set(['name','player','baseprice','base_price','set','role','franchise','national_board','nationality']);
    let statColDefs = [];
    hdrs.forEach((h, i) => {
        if (h && !CORE.has(h)) statColDefs.push({ key: h, label: rawHdrs[i], idx: i });
    });

    let result = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        let cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        let obj = { status: 'available' };
        for (let j = 0; j < hdrs.length; j++) {
            let v = (cols[j] || '').replace(/^"|"$/g, '').trim();
            let h = hdrs[j];
            if (!h) continue;
            if (h === 'baseprice' || h === 'base_price') {
                let num = Number(v) || 0;
                obj.base_price = (num > 0 && num <= 100) ? num * CRORE : num;
            } else if (h === 'name' || h === 'player') {
                obj.name = v;
            } else if (CORE.has(h)) {
                obj[h] = v;
            } else {
                // Stat column — stored FLAT directly on the object
                obj[h] = v || '-';
            }
        }
        result.push(obj);
    }
    result._statColumns = statColDefs.map(c => c.key);
    result._statLabels  = statColDefs.map(c => c.label);
    return result;
}
function createNewRoom() {
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
                if(pool.length && pool[0].name !== undefined) {
                    // Store dynamic stat column names in settings for franchises to read
                    let statCols = pool._statColumns || [];
                    let initWithStats = poolData => {
                        db.ref('rooms/'+key).set({
                            settings: { room_name: name, starting_purse: purse, overseas_limit_enabled: true, stat_columns: statCols },
                            player_pool: poolData,
                            live_state: { auction_state: 'idle', current_bid: 0, highest_bidder: '-', timer_end: 0, current_player_index: -1, last_sold_index: -1, bid_stack: null }
                        }).then(() => {
                            sessionStorage.setItem('roomKey', key);
                            setRoomState(key, db.ref('rooms/'+key));
                            executeAdminBoot();
                        });
                    };
                    initWithStats(pool);
                }
                else showAlert('CSV Error','Could not parse the file.'); 
            };
            reader.readAsText(fi.files[0]);
        }
    });
}

function joinAdminRoom() {
    let key = document.getElementById('joinAdminKey').value.trim();
    if (!key || key.length < 4) { showAlert('Invalid Input', 'Please enter a 4-digit Room Key.'); return; }
    db.ref('rooms/'+key).once('value', snap => {
        if (snap.exists()) { 
            sessionStorage.setItem('roomKey', key); 
            setRoomState(key, db.ref('rooms/'+key)); 
            executeAdminBoot(); 
        } else { showAlert('Not Found', 'Invalid Room Key! No room with that PIN exists.'); }
    }, err => {
        showAlert('Firebase Error', 'Could not connect to Firebase. Check your internet connection and Firebase rules.\n\n' + err.message);
    });
}

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
        let bb = document.getElementById('broadcastBanner');
        if (bb) bb.style.top = (connVisible && bb.style.display !== 'none') ? '36px' : '0';
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

    // Load logos separately — global_teams has logo, teams_auth does not
    db.ref('global_teams').on('value', snap => {
        let gt = snap.val() || {};
        state.globalTeamLogos = {};
        for (let code in gt) { if (gt[code].logo) state.globalTeamLogos[code] = gt[code].logo; }
        updateBudgetTracker(); // redraw cards with logos
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
        // Trigger sold/unsold animations on state transitions
        const prev = state.liveState?.auction_state;
        const next = data.auction_state;
        if (next === 'sold' && prev !== 'sold') {
            let winnerColor = state.allRegisteredTeams[data.highest_bidder]?.color || '#22c55e';
            triggerAucSold(data.highest_bidder, winnerColor);
        }
        if (next === 'unsold' && prev !== 'unsold') {
            triggerAucUnsold();
        }
        state.liveState = data;
        updateLiveUI(data);
    });

    state.roomRef.child('broadcast').on('value', snap => {
        let d = snap.val();
        let banner = document.getElementById('broadcastBanner');
        if (d && d.active && d.message) {
            document.getElementById('broadcastText').textContent = d.message;
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    });
    
    state.roomRef.child('logged_in_teams/ADMIN').set(true);
    state.roomRef.child('logged_in_teams/ADMIN').onDisconnect().remove();
}

// --- UI Updaters ---

function logLocal(msg, date) {
    let time = (date || new Date()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    let logDiv = document.getElementById('logContainer');
    let entry = document.createElement('div'); entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${msg}`;
    if (logDiv) { logDiv.appendChild(entry); logDiv.parentElement.scrollTop = logDiv.parentElement.scrollHeight; }
}

function scheduleRender() { 
    clearTimeout(_renderTimer); 
    _renderTimer = setTimeout(refreshLists, 60); 
}

// FIX: Refactored Live UI into manageable helpers
function updateLiveUI(data) {
    let isIdle = data.auction_state === 'idle';
    let isPaused = data.auction_state === 'paused';
    let currentBid = data.current_bid || 0;
    let currentLeader = data.highest_bidder || '-';

    if (data.auction_state === 'bidding' && currentBid > localBidTracker && currentLeader !== '-' && currentLeader !== 'Base Price') {
        playSound('bid');
    }
    localBidTracker = (data.auction_state === 'cooldown' || isIdle) ? 0 : currentBid;

    updatePlayerCard(data, isIdle);
    updateBidDisplay(data, currentBid, currentLeader);
    updateTimerUI(data, isIdle, isPaused);
    updateControlButtons(data, isIdle, isPaused, currentLeader);
    updateBudgetTracker();
}

function updatePlayerCard(data, isIdle) {
    let currentIndex = data.current_player_index !== undefined ? data.current_player_index : -1;
    
    if (currentIndex >= 0 && state.playerPool.length > 0 && !isIdle) {
        let p = state.playerPool[currentIndex];
        if (p) {
            let isOv = !['india','indian','ind'].includes((p.nationality || 'Indian').trim().toLowerCase());
            // Add flag emoji next to name
            let flag = getNatFlag(p.nationality);
            document.getElementById('adminPlayer').innerHTML = esc(p.name) + (isOv ? `<span class="neon-plane" title="${esc(p.nationality)}">✈️</span>` : '') + (flag ? ` <span style="font-size:16px;">${flag}</span>` : '');
            
            let tags = document.getElementById('adminPlayerTags'), rl = document.getElementById('adminPlayerRole');
            const _boardTxt = (p.national_board || '').trim(); const _fraTxt = (p.franchise || '').trim();
            if (_boardTxt || _fraTxt) { tags.textContent = [_boardTxt, _fraTxt].filter(Boolean).join(' / '); tags.style.display = 'inline-block'; } else tags.style.display = 'none';
            if (p.role) { rl.textContent = p.role; rl.style.display = 'inline-block'; } else rl.style.display = 'none';
            
            // Dynamic stats bar — reads stat_columns from settings, falls back to all extra keys on player
            let statsBar = document.getElementById('dynamicStatsBar');
            let statCols = state.settings.stat_columns || [];
            if (!statCols.length && p) {
                // Derive from player object itself: any key that isn't a core field
                const CORE_KEYS = new Set(['name','role','set','franchise','national_board','nationality','base_price','status','sold_price','team','_col_order','stats']);
                statCols = Object.keys(p).filter(k => !CORE_KEYS.has(k) && p[k] !== undefined && p[k] !== '');
            }
            if (statsBar) {
                let html = '';
                statCols.forEach(col => {
                    // Read flat from player — also check legacy p.stats fallback for old data
                    let val = (p[col] !== undefined && p[col] !== '') ? p[col] : (p.stats ? (p.stats[col] || '-') : '-');
                    let label = col.replace(/_/g,' ').toUpperCase();
                    html += `<div class="stat-box"><div class="stat-label">${esc(label)}</div><div class="stat-val">${esc(String(val))}</div></div>`;
                });
                statsBar.innerHTML = html;
            }
            
            let safeNameKey = (p.name || '').replace(/[.#$\[\]\/]/g, '_');
            let imgObj = state.globalImageMap[safeNameKey] || state.globalImageMap[p.name]; 
            let imgUrl = imgObj ? (imgObj.url || imgObj) : ''; 
            
            let photoBox = document.getElementById('playerPhoto');
            if (imgUrl) photoBox.innerHTML = `<img src="${esc(imgUrl)}" style="width:100%; height:100%; object-fit:cover; border-radius:6px;">`;
            else photoBox.innerHTML = 'PHOTO';
        }
    } else {
        document.getElementById('adminPlayer').textContent = 'Waiting…';
        document.getElementById('adminPlayerTags').style.display = 'none';
        document.getElementById('adminPlayerRole').style.display = 'none';
        document.getElementById('playerPhoto').innerHTML = 'PHOTO';
        let statsBar = document.getElementById('dynamicStatsBar');
        if (statsBar) {
            // Render placeholder slots using whatever stat_columns are configured
            let statCols = state.settings.stat_columns || [];
            statCols.forEach(col => {
                let label = col.replace(/_/g,' ').toUpperCase();
                statsBar.innerHTML += `<div class="stat-box"><div class="stat-label">${esc(label)}</div><div class="stat-val">-</div></div>`;
            });
            if (!statCols.length) statsBar.innerHTML = '';
        }
    }
}

function updateBidDisplay(data, currentBid, currentLeader) {
    document.getElementById('adminBid').textContent = `₹${(currentBid/CRORE).toFixed(2)} Cr`;
    
    let leaderEl = document.getElementById('adminLeader');
    leaderEl.textContent = currentLeader;
    leaderEl.style.color = state.allRegisteredTeams[currentLeader]?.color || '#007bff';

    let stackArr = data.bid_stack ? Object.values(data.bid_stack) : [];
    let historyHtml = stackArr.slice().reverse().map(b => {
        let tColor = state.allRegisteredTeams[b.bidder]?.color || '#fff';
        return `<div class="bid-history-item" style="display:flex; justify-content:space-between; padding:2px; border-bottom:1px solid #333;"><span style="color:${tColor}; font-weight:bold;">${esc(b.bidder)}</span><span style="color:#28a745; font-weight:bold;">₹${(b.amount/CRORE).toFixed(2)} Cr</span></div>`;
    }).join('');
    document.getElementById('adminBidHistory').innerHTML = historyHtml || '<div style="text-align:center; color:#666; padding-top:25px;">No bids yet</div>';
}

function updateTimerUI(data, isIdle, isPaused) {
    if (window.uiTimer) clearInterval(window.uiTimer);
    if (window._cooldownAdvance) clearTimeout(window._cooldownAdvance);

    // FIX: Using server time
    if (data.timer_end && data.timer_end !== _prevTimerEnd && !isPaused) {
        _arcTimerTotal = Math.max(1000, data.timer_end - getCurrentServerTime());
        _prevTimerEnd = data.timer_end;
    }

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

        // FIX: Using server time
        let remainMs = data.timer_end ? Math.max(0, data.timer_end - getCurrentServerTime()) : 0;
        let t = Math.ceil(remainMs / 1000);

        // FIX: Wrap Auto-pause in transaction to prevent multiple clients colliding
        if (data.auction_state === 'bidding' && remainMs <= 0) {
            clearInterval(window.uiTimer);
            state.roomRef.child('live_state').transaction(ld => {
                if (ld && ld.auction_state === 'bidding') {
                    ld.auction_state = 'paused';
                    ld.timer_end = 0;
                    ld.paused_remaining = 0;
                }
                return ld;
            });
            return;
        }

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

    // Cooldown Advance logic
    if (data.auction_state === 'cooldown' && data.timer_end) {
        let delay = Math.max(0, data.timer_end - getCurrentServerTime());
        let biddingSecs = state.settings.bid_timer_secs || 15;
        window._cooldownAdvance = setTimeout(() => {
            state.roomRef.child('live_state').transaction(ld => {
                if (ld && ld.auction_state === 'cooldown') {
                    ld.auction_state = 'bidding';
                    ld.timer_end = getCurrentServerTime() + (biddingSecs * 1000);
                }
                return ld;
            });
        }, delay + 200);
    }
}

function updateControlButtons(data, isIdle, isPaused, currentLeader) {
    let dynBtn = document.getElementById('dynamicSellBtn');
    let diceBtn = document.getElementById('randomDiceBtn');
    let clocks = document.querySelectorAll('.master-clock');
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
        if (dynBtn) {
            dynBtn.disabled = true;
            dynBtn.className = 'btn-unsold'; // reset class
            dynBtn.style.background = '#444';
            dynBtn.style.color = '#888';
            dynBtn.textContent = 'WAITING...';
            dynBtn.style.cursor = 'not-allowed';
        }
        clocks.forEach(b => setBtn(b, false));
        setBtn(pauseBtn, false);
        // FIX: Was `if (!isIdle && diceBtn)` — dice was never set to opacity 1 during idle state,
        // so it stayed faded (0.3) after any prior bidding session. Now always shown enabled when
        // auction is not actively running.
        if (diceBtn) diceBtn.style.opacity = '1';
    } else {
        if (dynBtn) {
            dynBtn.disabled = false;
            dynBtn.style.cursor = 'pointer';
            dynBtn.textContent = hasBids ? 'SOLD (S)' : 'UNSOLD (X)';
            // FIX: Assinging classes for keyboard shortcuts to target correctly
            dynBtn.className = hasBids ? 'btn-green' : 'btn-red';
            dynBtn.style.background = ''; // clear inline style to let CSS take over
            dynBtn.style.color = '#fff';
        }
        clocks.forEach(b => setBtn(b, true));
        setBtn(pauseBtn, active || isPaused);
        if (diceBtn) diceBtn.style.opacity = '0.3';
    }
    
    if (isPaused) { 
        if (pauseBtn) {
            pauseBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; 
            pauseBtn.style.background = '#fd7e14';
            pauseBtn.style.color = '#fff';
        }
    } else { 
        if (pauseBtn) {
            pauseBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'; 
            pauseBtn.style.background = '#22222d';
            pauseBtn.style.color = '#fd7e14';
        }
    }
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

            // FIX: Replaced inline onclick with data attributes
            let _tLogo = (state.globalTeamLogos && state.globalTeamLogos[team]) || '';
            let logoInlineHtml = _tLogo ? `<img src="${esc(_tLogo)}" style="height:22px;max-width:32px;object-fit:contain;filter:drop-shadow(0 0 4px rgba(255,255,255,0.15));flex-shrink:0;" alt="">` : '';
            html += `<div class="budget-card${leaderClass}" style="display:flex; flex-direction:column;">
                <button class="delete-team-btn" data-team="${esc(team)}" title="Delete Team">&times;</button>
                <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                    <div style="font-weight:bold; color:${tColor}; font-size:15px; margin-bottom:4px; display:flex; align-items:center; justify-content:center; gap:6px;">${logoInlineHtml}${esc(team)} ${dot}</div>
                    <div style="color:${remaining > 0 ? '#28a745' : '#dc3545'}; font-size:20px; font-weight:bold; margin-bottom:4px;">₹${(remaining/CRORE).toFixed(2)} Cr</div>
                    <div style="color:#888; font-size:10px; font-weight:bold; text-transform:uppercase;">${count} Players</div>
                </div>
                <div style="margin-top:auto; padding-top:6px; border-top:1px solid #222; font-size:10px; color:#888; display:flex; justify-content:space-between; align-items:center;">
                    <span id="rep-name-${esc(team)}" style="display:inline-block; text-transform:uppercase; letter-spacing:.5px; max-width: 75px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(tData.repName || 'Unclaimed')}</span>
                    <span id="rep-pin-${esc(team)}" style="display:none; color:#ffc107; font-weight:bold; letter-spacing:1px;">${esc(tData.pin || 'None')}</span>
                    <span class="pin-eye" data-pin-eye="${esc(team)}">👁️</span>
                </div>
            </div>`;
        } else {
            html += `<div class="budget-card-empty" style="flex:1; display:flex; align-items:center; justify-content:center; color:#333;">WAITING...</div>`;
        }
    }
    document.getElementById('budgetCards').innerHTML = html;
}

// --- Tabs & List Rendering ---

function setRoleFilter(role, el) {
    document.querySelectorAll('.role-filter-btn').forEach(b => {
        let active = b.dataset.role === role;
        b.style.background = active ? '#22222d' : '#111';
        b.style.color      = active ? '#ffc107' : '#888';
        b.style.borderColor= active ? '#ffc107' : '#333';
        if (active) b.classList.add('active'); else b.classList.remove('active');
    });
    refreshLists();
}

function refreshLists() {
    let set = document.getElementById('setSelector')?.value || '';
    let deckSearch = document.getElementById('auctioneerSearch')?.value.toLowerCase() || '';
    let roleFilter = document.querySelector('.role-filter-btn.active')?.dataset.role || '';
    renderDeckList('deckList', set, deckSearch, roleFilter, null, true); 
    renderUnsoldList('unsoldList', deckSearch, true); 
    let team = document.getElementById('teamSelector')?.value || '';
    renderSquadList('squadList', team, deckSearch);
}

function switchTab(name, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    if (el) el.classList.add('active');
    refreshLists();
}

function populateDropdowns() {
    let sets = new Set(); 
    state.playerPool.forEach(p => { if (p && p.set) sets.add(p.set); });
    let setSel = document.getElementById('setSelector');
    if (setSel) {
        let prev = setSel.value;
        setSel.innerHTML = '<option value="" disabled hidden style="background:#161620; color:#888;">SELECT SET</option>';
        sets.forEach(s => { 
            let o = document.createElement('option'); 
            o.value = s; o.text = s; 
            o.style.background = '#161620'; 
            o.style.color = '#fff'; 
            setSel.appendChild(o); 
        });
        if (prev && sets.has(prev)) setSel.value = prev; else if (sets.size > 0) setSel.value = Array.from(sets)[0];
    }

    let tSel = document.getElementById('teamSelector');
    if (tSel) {
        let prevT = tSel.value;
        tSel.innerHTML = '<option value="" disabled hidden style="background:#161620; color:#888;">SELECT TEAM</option>';
        let keys = Object.keys(state.allRegisteredTeams);
        keys.forEach(t => { 
            let o = document.createElement('option'); 
            o.value = t; o.text = t; 
            o.style.background = '#161620'; 
            o.style.color = state.allRegisteredTeams[t]?.color || '#fff'; 
            tSel.appendChild(o); 
        });
        if (prevT && keys.includes(prevT)) tSel.value = prevT; else if (keys.length > 0) tSel.value = keys[0];
    }
}

// --- Specific Actions ---

function confirmDeleteTeam(teamCode) {
    showPrompt('Delete Franchise', `Enter the PIN for '${teamCode}' to confirm deletion:`, '4-digit PIN', val => {
        if (state.allRegisteredTeams[teamCode] && state.allRegisteredTeams[teamCode].pin === val) {
            state.roomRef.child('teams_auth/' + teamCode).remove();
            state.roomRef.child('logged_in_teams/' + teamCode).remove();
            persistEvent(`🗑️ Franchise <strong>${esc(teamCode)}</strong> deleted by auctioneer.`);
        } else { showAlert('Wrong PIN','Incorrect PIN. Deletion cancelled.'); }
    });
}

function togglePin(teamCode) {
    let n = document.getElementById(`rep-name-${teamCode}`), p = document.getElementById(`rep-pin-${teamCode}`);
    if (n && p) { let show = n.style.display !== 'none'; n.style.display = show ? 'none' : 'block'; p.style.display = show ? 'block' : 'none'; }
}

function sendBroadcast() {
    let inp = document.getElementById('broadcastInput'), msg = inp.value.trim();
    if (!msg) { inp.focus(); return; }
    if (state.roomRef) state.roomRef.child('broadcast').set({ message: msg, active: true, ts: getCurrentServerTime() });
    inp.value = ''; persistEvent(`📢 Auctioneer broadcast: <em>${esc(msg)}</em>`);
}

function clearBroadcast() { 
    if (state.roomRef) state.roomRef.child('broadcast').set({ message: '', active: false, ts: getCurrentServerTime() }); 
}

function sendChatMessage() {
    let inp = document.getElementById('chatInput'), msg = inp.value.trim();
    if (msg && state.roomRef) { state.roomRef.child('chat_events').push({ team: 'ADMIN', text: msg, time: getCurrentServerTime() }); inp.value = ''; }
}

function openSettings() {
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
}

function saveSettings() {
    let rName = document.getElementById('set-room-name').value.trim();
    if (state.roomRef && rName) {
        state.roomRef.child('settings').update({
            room_name: rName, 
            starting_purse: parseInt(document.getElementById('set-purse').value) || 100, 
            overseas_limit_enabled: document.getElementById('set-overseas-rule').value === 'true',
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
}

function togglePause() {
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
}

function bypassCooldown() {
    if (!state.roomRef || state.liveState.auction_state !== 'cooldown') return;
    state.roomRef.child('live_state').update({ auction_state: 'bidding', timer_end: getCurrentServerTime() + ((state.settings.bid_timer_secs || 15) * 1000) });
}

function startTimer(secs, auctionState) {
    if (state.roomRef) state.roomRef.child('live_state').update({ auction_state: auctionState || 'bidding', timer_end: getCurrentServerTime() + (secs * 1000) });
}

// ─── Expose module functions to window for inline onclick handlers ────────────
window.showCreateRoom      = showCreateRoom;
window.showJoinAdminRoom   = showJoinAdminRoom;
window.createNewRoom       = createNewRoom;
window.joinAdminRoom       = joinAdminRoom;
window.backToAdminGateway  = backToAdminGateway;
window.toggleCustomUpload  = toggleCustomUpload;
window.openSettings        = openSettings;
window.saveSettings        = saveSettings;
window.confirmResetAuction = confirmResetAuction;
window.clearBroadcast      = clearBroadcast;
window.sendBroadcast       = sendBroadcast;
window.sendChatMessage     = sendChatMessage;
window.startTimer          = startTimer;
window.togglePause         = togglePause;
window.bypassCooldown      = bypassCooldown;
window.setRoleFilter       = setRoleFilter;
window.switchTab           = switchTab;
window.togglePin           = togglePin;
window.confirmDeleteTeam   = confirmDeleteTeam;
window.undoLastSale        = undoLastSale;
window.undoLastBid         = undoLastBid;
window.pullRandomFromSet   = pullRandomFromSet;
window.sellPlayer          = sellPlayer;
window.passPlayer          = passPlayer;
