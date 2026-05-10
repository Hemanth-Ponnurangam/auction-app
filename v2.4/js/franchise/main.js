/**
 * main.js (Franchise)
 * The main controller for the Franchise portal.
 */

import { db, getCurrentServerTime } from '../shared/firebase.js';
import { state, setRoomState, setMyTeamState, recalculateBudgets } from '../shared/state.js';
import { esc, showAlert, closeModal, showConfirm } from '../shared/dom.js';
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

// ─── National flag emoji lookup ─────────────────────────────────────────────
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

// ─── Flip card state ─────────────────────────────────────────────────────────
let _cardIsFlipped = false;
window.togglePlayerCardFlip = function() {
    _cardIsFlipped = !_cardIsFlipped;
    let inner = document.getElementById('playerFlipInner');
    if (inner) inner.classList.toggle('is-flipped', _cardIsFlipped);
    let btn = document.getElementById('flipStatBtn');
    if (btn) btn.classList.toggle('flipped', _cardIsFlipped);
};

// ─── Sold / Unsold Animations ────────────────────────────────────────────────
let _soldFlipTimer = null;
let _soldHideTimer = null;

function _clearSoldUI() {
    // Photo stamps
    let ps = document.getElementById('photoSoldStamp');
    let pu = document.getElementById('photoUnsoldStamp');
    if (ps) { ps.classList.remove('show','hide'); }
    if (pu) { pu.classList.remove('show','hide'); }
    // Info flip
    let flip = document.getElementById('infoSoldFlip');
    let inner = document.getElementById('isfInner');
    if (flip)  { flip.classList.remove('show','hiding'); }
    if (inner) { inner.classList.remove('flipped'); }
    clearTimeout(_soldFlipTimer);
    clearTimeout(_soldHideTimer);
}

function triggerSoldAnimation(teamName, teamColor, soldPrice) {
    _clearSoldUI();

    // ── 1. Slant stamp on photo ──────────────────────────────────────────
    let photoStamp = document.getElementById('photoSoldStamp');
    if (photoStamp) {
        photoStamp.classList.add('show');
    }

    // ── 2. Flip card on info area ─────────────────────────────────────────
    let flip  = document.getElementById('infoSoldFlip');
    let inner = document.getElementById('isfInner');
    let priceEl = document.getElementById('isfPrice');
    let teamEl  = document.getElementById('isfTeam');
    let logoImg = document.getElementById('isfLogo');
    let initEl  = document.getElementById('isfInitials');

    if (priceEl) priceEl.textContent = soldPrice || '';
    if (teamEl)  { teamEl.textContent = teamName; teamEl.style.color = teamColor || '#ffd700'; }
    if (initEl)  { initEl.style.display = 'none'; initEl.textContent = ''; }
    if (logoImg) { logoImg.style.display = 'none'; logoImg.src = ''; }

    // Preload logo before showing flip
    let tData   = state.allRegisteredTeams[teamName] || {};
    let logoSrc = tData.logo || '';

    function _showFlip() {
        if (!flip || !inner) return;
        inner.classList.remove('flipped');
        flip.classList.remove('hiding');
        flip.classList.add('show');

        // Flip 1 → logo side at 1.5s
        _soldFlipTimer = setTimeout(() => {
            inner.classList.add('flipped');
            // Flip 2 → back to SOLD! at 3.1s
            setTimeout(() => {
                inner.classList.remove('flipped');
                // Fade out at 4.8s
                _soldHideTimer = setTimeout(() => {
                    flip.classList.add('hiding');
                    photoStamp && photoStamp.classList.add('hide');
                    setTimeout(() => _clearSoldUI(), 550);
                }, 1700);
            }, 1600);
        }, 1500);
    }

    if (logoSrc) {
        let img = new Image();
        img.onload = () => {
            if (logoImg) { logoImg.src = logoSrc; logoImg.style.display = 'block'; }
            if (initEl)  initEl.style.display = 'none';
            _showFlip();
        };
        img.onerror = () => {
            if (logoImg) logoImg.style.display = 'none';
            if (initEl)  {
                initEl.textContent = teamName.slice(0,3).toUpperCase();
                initEl.style.color = teamColor || '#ffd700';
                initEl.style.display = 'block';
            }
            _showFlip();
        };
        img.src = logoSrc;
    } else {
        if (initEl) {
            initEl.textContent = teamName.slice(0,3).toUpperCase();
            initEl.style.color = teamColor || '#ffd700';
            initEl.style.display = 'block';
        }
        _showFlip();
    }

    // ── 3. Card tickers ───────────────────────────────────────────────────
    let playerName = state._lastSoldPlayerName || '';
    let color = teamColor || '#22c55e';
    let chip = `<span style="color:#22c55e;margin-right:6px;">●</span><span style="color:#fff;font-weight:700;">${esc(playerName)}</span><span style="color:#888;margin:0 8px;">→</span><span style="color:${color};font-weight:800;letter-spacing:1px;">${esc(teamName)}</span><span style="color:#ffd700;margin-left:8px;font-weight:700;">${soldPrice || ''}</span>`;
    let trackContent = `<span style="padding-right:60px;">${chip}</span>`.repeat(4);

    document.querySelectorAll('.card-ticker-wrap').forEach(wrap => {
        wrap.innerHTML = `<div class="card-ticker-track">${trackContent}</div>`;
        wrap.classList.remove('hide');
        void wrap.offsetWidth;
        wrap.classList.add('show');
        let teamKey = wrap.id ? wrap.id.replace('ctw-','') : '';
        clearTimeout(window['_ctw_' + teamKey]);
        window['_ctw_' + teamKey] = setTimeout(() => {
            wrap.classList.add('hide');
            setTimeout(() => { wrap.innerHTML = ''; wrap.classList.remove('show','hide'); }, 400);
        }, 7000);
    });
}

function triggerUnsoldAnimation() {
    _clearSoldUI();

    let photoStamp = document.getElementById('photoUnsoldStamp');
    if (photoStamp) {
        photoStamp.classList.add('show');
        setTimeout(() => {
            photoStamp.classList.add('hide');
            setTimeout(() => _clearSoldUI(), 400);
        }, 2600);
    }
}

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

// --- CORE LOGIN & GATEWAY FUNCTIONS ---
window.showRoomKeyScreen = () => { document.getElementById('roomKeyScreen').style.display = 'flex'; };
window.backToGateway = () => { window.location.href = 'index.html'; };

window.handleVerifyRoomKey = () => {
    let key = document.getElementById('joinRoomKey').value.trim();
    if(!key) return showAlert('Missing Key', 'Please enter a Room Key.');
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
        if (!teams) { grid.innerHTML = '<p style="grid-column:span 2; color:#dc3545; font-size:11px;">No global franchises found. Contact your Admin.</p>'; return; }
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

    let myUid = state.myRepName.replace(/\s+/g, '_') + '_' + Math.random().toString(36).substr(2, 5);
    initializeWarRoom(state.myTeamName, myUid, state.myRepName);
}

window.logout = () => {
    if (state.roomRef && state.myTeamName) state.roomRef.child('logged_in_teams/' + state.myTeamName).remove();
    sessionStorage.clear();
    window.location.reload();
};

function attachFirebaseListeners() {
    db.ref('.info/connected').on('value', snap => {
        document.getElementById('connBanner').style.display = snap.val() ? 'none' : 'block';
    });

    state.roomRef.child('settings').on('value', snap => {
        let s = snap.val() || {};
        state.settings = { ...state.settings, ...s };
    });

    state.roomRef.child('teams_auth').on('value', snap => {
        state.allRegisteredTeams = snap.val() || {};
        updateTeamDropdown(); recalculateBudgets(); updateMyTeamUI();
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

    state.roomRef.child('player_pool').once('value', snap => {
        let raw = snap.val() || [];
        state.playerPool = Array.isArray(raw) ? raw : Object.values(raw);
        populateSetDropdown(); recalculateBudgets(); window.refreshLists(); updateMyTeamUI();
    });

    state.roomRef.child('player_pool').on('child_changed', snap => {
        let idx = parseInt(snap.key);
        if (!isNaN(idx)) {
            state.playerPool[idx] = snap.val();
            recalculateBudgets(); window.refreshLists(); updateMyTeamUI();
            if (state.liveState.auction_state === 'sold' && _latestLiveData) {
                let soldP = state.playerPool[_latestLiveData.current_player_index];
                let amIWinning = soldP?.team === state.myTeamName;
                updateLiveUI(_latestLiveData, amIWinning);
            }
        }
    });
    
    db.ref('global_player_images').on('value', snap => {
        state.globalImageMap = snap.val() || {};
        if (state.liveState.current_player_index >= 0 && state.playerPool.length > 0) {
            updateLiveUI(state.liveState, state.liveState.highest_bidder === state.myTeamName); 
        }
    });

    let _prevAuctionState = null;
    let _prevPlayerIndex  = -1;

    state.roomRef.child('live_state').on('value', snap => {
        let data = snap.val(); 
        if (!data) return;
        _latestLiveData = data;

        // — Sound triggers on state transitions —
        const prevState = _prevAuctionState;
        const newState  = data.auction_state;
        const newPIdx   = data.current_player_index;

        if (newState === 'bidding' && newPIdx !== _prevPlayerIndex) {
            playSound('new_player');  // New player on the block
        } else if (newState === 'bidding' && prevState !== 'bidding') {
            playSound('new_player');  // Timer restarted / round resumed
        }
        if (newState === 'sold' && prevState !== 'sold') {
            playSound('sold');
            let soldP = state.playerPool[data.current_player_index];
            let winnerColor = state.allRegisteredTeams[data.highest_bidder]?.color || '#22c55e';
            let soldPriceStr = data.current_bid ? '₹' + (data.current_bid / 10_000_000).toFixed(2) + ' Cr' : '';
            // Store player name for ticker
            state._lastSoldPlayerName = soldP ? soldP.name : '';
            triggerSoldAnimation(data.highest_bidder, winnerColor, soldPriceStr);
        }
        if (newState === 'unsold' && prevState !== 'unsold') {
            playSound('unsold');
            triggerUnsoldAnimation();
        }
        if (newState === 'bidding' && prevState === 'cooldown') {
            playSound('bid'); // New highest bid confirmed
        }

        _prevAuctionState = newState;
        _prevPlayerIndex  = newPIdx;

        state.liveState = data;
        let amIWinning = (data.highest_bidder === state.myTeamName);
        updateLiveUI(data, amIWinning);
        updateMyTeamUI(); 
    });

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
        Object.values(entries).sort((a,b) => a.t - b.t).forEach(e => logAction(e.msg));
        isLogLoaded = true;
    });
    state.roomRef.child('auction_log').limitToLast(100).on('child_added', snap => {
        if (!isLogLoaded) return;
        let e = snap.val(); logAction(e.msg);
    });

    state.roomRef.child('broadcast').on('value', snap => {
        let d = snap.val();
        let banner = document.getElementById('broadcastBanner');
        if (d && d.active && d.message) {
            document.getElementById('broadcastText').textContent = d.message;
            banner.classList.remove('show');
            void banner.offsetWidth; 
            banner.classList.add('show');
            let connVisible = document.getElementById('connBanner').style.display !== 'none';
            banner.style.top = connVisible ? '36px' : '0';
        } else {
            banner.classList.remove('show');
        }
    });
}

let _arcTimerTotal = 0;
let _prevTimerEnd  = 0;

function updateLiveUI(data, amIWinning) {
    document.getElementById('actualBidAmount').textContent = `₹${((data.current_bid || 0) / CRORE).toFixed(2)} Cr`;
    
    if (window.uiTimer) clearInterval(window.uiTimer);

    // Store the total arc duration when a new timer_end arrives (same approach as auctioneer)
    if (data.timer_end && data.timer_end !== _prevTimerEnd && data.auction_state === 'bidding') {
        _arcTimerTotal = Math.max(1000, data.timer_end - getCurrentServerTime());
        _prevTimerEnd  = data.timer_end;
    }

    window.uiTimer = setInterval(() => {
        let el  = document.getElementById('playerTimer');
        let arc = document.getElementById('timerArcFill');
        const CIRCUM = 188.5;

        el.classList.remove('timer-green','timer-warn','timer-danger','timer-paused');

        if (data.auction_state === 'idle') {
            el.textContent = '--';
            if (arc) { arc.style.stroke = '#333'; arc.style.strokeDashoffset = CIRCUM; }
            return;
        }
        if (data.auction_state === 'paused') {
            el.textContent = '⏸'; el.classList.add('timer-paused');
            if (arc) arc.style.stroke = '#fd7e14';
            return;
        }

        let remainMs = data.timer_end ? Math.max(0, data.timer_end - getCurrentServerTime()) : 0;
        let t = Math.ceil(remainMs / 1000);
        el.textContent = t + 's';

        // Use stored total for smooth arc (fallback to settings if not set)
        let totalMs = _arcTimerTotal > 0 ? _arcTimerTotal
            : (data.auction_state === 'cooldown'
                ? (state.settings.cooldown_secs  || 10) * 1000
                : (state.settings.bid_timer_secs || 15) * 1000);
        let frac   = totalMs > 0 ? Math.min(1, remainMs / totalMs) : 0;
        let offset = (CIRCUM * (1 - frac)).toFixed(2);

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

            // (flag badge removed)
            
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

            // Populate flip-back stats grid from dynamic stats on player object
            let statsGrid = document.getElementById('statsFlipGrid');
            if (statsGrid) {
                let statCols = state.settings.stat_columns || [];
                let statsHtml = '';
                if (statCols.length) {
                    statCols.forEach(col => {
                        let val = p.stats ? (p.stats[col] || '-') : '-';
                        let label = col.replace(/_/g,' ').toUpperCase();
                        statsHtml += `<div class="stat-flip-item"><div class="stat-flip-label">${esc(label)}</div><div class="stat-flip-val">${esc(String(val))}</div></div>`;
                    });
                } else {
                    // Fallback to legacy hardcoded stats
                    const legacyStats = [
                        ['RUNS', p.runs], ['AVG', p.average], ['SR', p.bat_sr],
                        ['WKTS', p.wickets], ['ECON', p.economy], ['BSR', p.bowl_sr]
                    ];
                    legacyStats.forEach(([label, val]) => {
                        if (val && val !== '-') {
                            statsHtml += `<div class="stat-flip-item"><div class="stat-flip-label">${label}</div><div class="stat-flip-val">${esc(String(val))}</div></div>`;
                        }
                    });
                }
                statsGrid.innerHTML = statsHtml || '<div style="color:#555;font-size:11px;text-align:center;grid-column:1/-1;">No stats available</div>';
            }
        }
    } else {
        document.getElementById('playerName').textContent = 'Waiting…';
        document.getElementById('playerFranchise').style.display = 'none';
        document.getElementById('playerRole').style.display = 'none';
        document.getElementById('playerPhoto').innerHTML = 'PHOTO';
        document.getElementById('playerPhoto').classList.remove('has-photo');
        // (flag badge removed)
        let statsGrid = document.getElementById('statsFlipGrid');
        if (statsGrid) statsGrid.innerHTML = '';
        // Reset flip to front when player changes
        _cardIsFlipped = false;
        let inner = document.getElementById('playerFlipInner');
        if (inner) inner.classList.remove('is-flipped');
        let btn = document.getElementById('flipStatBtn');
        if (btn) btn.classList.remove('flipped');
    }

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
        return `<div style="display:flex; justify-content:space-between; align-items:center; width:100%; box-sizing:border-box; padding:4px 6px; background:#111; border-radius:4px; font-size:10px;"><span style="color:${tColor}; font-weight:bold;">${esc(b.bidder)}</span><span style="color:#28a745; font-weight:bold;">₹${(b.amount/CRORE).toFixed(2)} Cr</span></div>`;
    }).join('');
    document.getElementById('franchiseBidHistory').innerHTML = historyHtml;
}

function updateMyTeamUI() {
    try {
        if (!state.myTeamName || !Object.keys(state.allRegisteredTeams).length) return;

        let myColor = state.allRegisteredTeams[state.myTeamName]?.color || state.myTeamColor || '#fff';
        document.getElementById('myTeamBox').style.borderColor = myColor;
        document.getElementById('myTeamDisplay').style.color   = myColor;
        // Show franchise logo next to team name
        let myLogoEl = document.getElementById('myTeamLogo');
        let myLogoSrc = state.allRegisteredTeams[state.myTeamName]?.logo || '';
        if (myLogoEl) {
            if (myLogoSrc) { myLogoEl.src = myLogoSrc; myLogoEl.style.display = 'inline-block'; }
            else myLogoEl.style.display = 'none';
        }

        let startingPurseCr = state.settings.starting_purse || 100;
        let myBudget = state.teamBudgets[state.myTeamName] !== undefined ? state.teamBudgets[state.myTeamName] : (startingPurseCr * CRORE);
        let myPurseCr = myBudget / CRORE;
        let purseEl = document.getElementById('myTeamPurse');
        if (purseEl) {
            purseEl.textContent = `₹${myPurseCr.toFixed(2)} Cr`;
            purseEl.style.color = myPurseCr > 0 ? '#28a745' : '#dc3545';
        }

        let myRoster = state.playerPool.filter(p => p && p.status === 'sold' && p.team === state.myTeamName);
        
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
            let tPaddle = tData.paddleHolder || 'Available'; 
            let rCr    = (state.teamBudgets[t] !== undefined ? state.teamBudgets[t] : (startingPurseCr * CRORE)) / CRORE;
            let count  = state.playerPool.filter(p => p && p.status === 'sold' && p.team === t).length;
            let isOnline = state.activePresence[t];
            let dot = isOnline ? '<span class="live-dot"></span>' : '<span class="offline-dot"></span>';
            
            let curWin = state.liveState.highest_bidder;
            let isValidLeader = curWin !== '-' && curWin !== 'Base Price' && curWin !== '';
            let currentAuctionState = state.liveState.auction_state;
            
            let lgClass = (t === curWin && isValidLeader && (currentAuctionState==='bidding'||currentAuctionState==='cooldown')) ? ' leader-card-glow-silver' :
                          (t === curWin && isValidLeader && currentAuctionState==='sold') ? ' sold-card-glow' : '';
                          
            // Logo watermark div — sits behind all text
            let bgLogoDivHtml = tData.logo
                ? `<div class="card-bg-logo" style="background-image:url('${tData.logo}');"></div>`
                : '';
            othersHtml += `
            <div class="other-team-card-hz${lgClass}" data-team="${esc(t)}" style="border-top-color:${tColor};">
                ${bgLogoDivHtml}
                <!-- Ticker at TOP of card — slides down from top edge -->
                <div class="card-ticker-wrap" id="ctw-${esc(t)}"></div>
                <div class="team-msg-popup" id="msg-popup-${esc(t)}"></div>
                <div style="font-weight:bold; font-size:13px; margin-bottom:2px;position:relative;z-index:2;">${esc(t)} ${dot}</div>
                <div class="other-team-rep-name" style="position:relative;z-index:2;">${esc(tRep)}</div>
                <div class="purse-val" style="color:${rCr > 0 ? '#28a745' : '#dc3545'};position:relative;z-index:2;">₹${rCr.toFixed(2)} Cr</div>
                <div style="font-size:9px; color:#0dcaf0; margin-top:2px;position:relative;z-index:2;">Paddle: ${esc(tPaddle)}</div>
                <div style="font-size:9px; color:#666; text-transform:uppercase; margin-top:2px;position:relative;z-index:2;">${count} Players</div>
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

window.addEventListener('watchlistUpdated', () => window.refreshLists());
window.addEventListener('rosterOrderUpdated', updateMyTeamUI);

let _deckRoleFilter = '';
let _isStarFilterActive = false; 

window.toggleStarFilter = function(el) {
    _isStarFilterActive = !_isStarFilterActive;
    if (!_isStarFilterActive) {
        el.style.background = '#111';
        el.style.borderColor = '#333';
        el.style.boxShadow = 'none';
        el.style.color = '#888';
    } else {
        el.style.background = '#22222d';
        el.style.borderColor = '#ffc107';
        el.style.boxShadow = '0 0 10px rgba(255,193,7,0.2)';
        el.style.color = '#fff';
    }
    window.refreshLists();
};

window.refreshLists = function() {
    let set = document.getElementById('setSelector')?.value || '';
    let deckSearch = document.getElementById('deckSearch')?.value.toLowerCase() || '';
    
    // Pass the _isStarFilterActive flag explicitly to bypass normal filters
    renderDeckList('deckList', set, deckSearch, _deckRoleFilter, watchlist, false, _isStarFilterActive);
    
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

window.sendChatMessage = () => {
    let inp = document.getElementById('chatInput'), msg = inp.value.trim();
    if (msg && state.myTeamName && state.roomRef) {
        state.roomRef.child('chat_events').push({ team: state.myTeamName, text: msg, time: Date.now() });
        inp.value = '';
    }
};

function triggerChatPopup(team, text) { activePopups[team] = { text, expiry: Date.now() + 5000 }; }

function updateAllPopups() {
    let now = Date.now();
    [state.myTeamName, ...Object.keys(state.allRegisteredTeams)].forEach(t => {
        let pop = t === state.myTeamName ? document.getElementById('msg-popup-myteam') : document.getElementById('msg-popup-'+t);
        if (!pop) return;
        if (activePopups[t] && activePopups[t].expiry > now) {
            pop.textContent = activePopups[t].text; pop.classList.add('show');
        } else { pop.classList.remove('show'); }
    });
}

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

window.openFranchiseSettings = () => { document.getElementById('franchiseSettingsOverlay').style.display = 'flex'; };

window.exportMySquadCSV = () => {
    let sold = state.playerPool.filter(p => p.status === 'sold' && p.team === state.myTeamName);
    let csv = `"Player","Role","Bought For (Cr)"\n` + sold.map(p => {
        let role = (state.allRegisteredTeams[state.myTeamName]?.playerRoles && state.allRegisteredTeams[state.myTeamName].playerRoles[p.name]) || '-';
        return `"${p.name}","${role}","${(p.sold_price/CRORE).toFixed(2)}"`;
    }).join('\n');
    let blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    let a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${state.myTeamName}_Squad.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

document.addEventListener('keydown', e => {
    if (document.getElementById('mainDashboard').style.display === 'none') return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { 
        e.preventDefault(); 
        if (!document.getElementById('mainActionButton').disabled && typeof window.placeBid === 'function') window.placeBid(); 
    }
});

let isPaddleHolder = false;

function initializeWarRoom(teamId, myUid, myName) {
    const connectedRef = db.ref('.info/connected');
    const userStatusRef = db.ref(`rooms/${state.roomKey}/franchises/${teamId}/onlineUsers/${myUid}`);

    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            userStatusRef.set(true);
            userStatusRef.onDisconnect().remove();
        }
    });

    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/onlineUsers`).on('value', (snap) => {
        const users = snap.val() || {};
        const userIds = Object.keys(users);
        const count = userIds.length;
        
        const countElement = document.getElementById('onlineRepsCount');
        if(countElement) countElement.innerText = count;

        if (userIds.length > 0 && userIds[0] === myUid) {
            db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).once('value', pSnap => {
                const paddle = pSnap.val();
                if (!paddle || !users[paddle.uid]) {
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).set({ uid: myUid, name: myName });
                }
            });
        }
    });

    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).on('value', (snap) => {
        const paddleData = snap.val();
        const bidBtn = document.getElementById('mainActionButton'); 
        const reqBtn = document.getElementById('requestPaddleBtn');
        const sugBtn = document.getElementById('suggestBidBtn');
        const nameTag = document.getElementById('paddleHolderName');

        if (paddleData && paddleData.uid === myUid) {
            isPaddleHolder = true;
            if(bidBtn) bidBtn.style.display = 'block';
            if(reqBtn) reqBtn.style.display = 'none';
            if(sugBtn) sugBtn.style.display = 'none';
            state.roomRef.child(`teams_auth/${teamId}/paddleHolder`).set(paddleData.name);
        } else {
            isPaddleHolder = false;
            if(bidBtn) bidBtn.style.display = 'none';
            if(reqBtn) reqBtn.style.display = 'block';
            if(sugBtn) sugBtn.style.display = 'block';
        }
        
        if(nameTag) nameTag.innerText = paddleData ? paddleData.name : "Available";
    });

    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/suggestedBid`).on('value', (snap) => {
        if (isPaddleHolder && snap.exists()) {
            const bidBtn = document.getElementById('mainActionButton');
            if(bidBtn) {
                bidBtn.classList.add('pulse-green');
                setTimeout(() => bidBtn.classList.remove('pulse-green'), 2000);
            }
        }
    });

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
            db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).once('value', pSnap => {
                const currentPaddle = pSnap.val();
                if (currentPaddle && currentPaddle.uid !== myUid) {
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddleRequest`).set({ 
                        requesterUid: myUid, 
                        requesterName: myName, 
                        timestamp: Date.now() 
                    });
                    showAlert('Paddle Requested', `Requested paddle from ${currentPaddle.name}. They have 10 seconds to cancel.`);
                } else {
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).set({ uid: myUid, name: myName });
                }
            });
        });
    }

    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddleRequest`).on('value', snap => {
        const req = snap.val();
        if (req && isPaddleHolder && req.requesterUid !== myUid) {
            let transferTimeout = setTimeout(() => {
                // Time ran out — automatically pass the paddle
                db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).set({ uid: req.requesterUid, name: req.requesterName });
                db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddleRequest`).remove();
                playSound('paddle_pass');
            }, 5000);

            showConfirm(
                '🏏 Paddle Transfer Request',
                `${req.requesterName} wants the paddle. Auto-passes in 5 seconds — reject now to keep it.`,
                () => {
                    // PASS — transfer immediately
                    clearTimeout(transferTimeout);
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddle`).set({ uid: req.requesterUid, name: req.requesterName });
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddleRequest`).remove();
                    playSound('paddle_pass');
                },
                () => {
                    // REJECT — cancel within 5 seconds
                    clearTimeout(transferTimeout);
                    db.ref(`rooms/${state.roomKey}/franchises/${teamId}/paddleRequest`).remove();
                },
                'PASS PADDLE',
                'REJECT'
            );
        }
    });
}
