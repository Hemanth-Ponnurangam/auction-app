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
import { initDropZones, attachDragEvents, isDragging, openRolePopup, setRole } from './squad.js';
// Expose to window so inline onclick handlers can reach them
window.openRolePopup = openRolePopup;
window.setRole = setRole;
import { watchlist, initWatchlistListener } from './watchlist.js';

const CRORE = 10_000_000;
let _latestLiveData = null;
let _lastTimerWarnSecond = -1;
let activePopups = {};
let isUserScrollingLog = false;
let pendingCode = '', pendingColor = '', isCustomFlow = false;

// ─── National flag emoji lookup (fallback) ──────────────────────────────────
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

// Global nat flags from Firebase (country key → image URL/base64)
let _globalNatFlagImages = {};

// Global national board logos from Firebase (board key → {image, name, aliases})
let _globalNatBoards = {};

// Global role icons from Firebase (role key → image URL/base64)
let _globalRoleIconImages = {};

// ─── Flip card state ─────────────────────────────────────────────────────────
let _cardIsFlipped = false;
window.togglePlayerCardFlip = function() {
    _cardIsFlipped = !_cardIsFlipped;
    let inner = document.getElementById('playerFlipInner');
    if (inner) inner.classList.toggle('is-flipped', _cardIsFlipped);
    let btn = document.getElementById('flipStatBtn');
    if (btn) btn.classList.toggle('flipped', _cardIsFlipped);
};

// ─── Flag Circle helpers ─────────────────────────────────────────────────────

function _updateFlagCircle(nationality) {
    let imgEl   = document.getElementById('flagCircleImg');
    let emojiEl = document.getElementById('flagCircleEmoji');
    let frontEl = document.getElementById('flagFaceFront');
    let soldEl  = document.getElementById('flagFaceSold');
    if (!imgEl || !emojiEl) return;

    // Always reset sold face
    if (soldEl) soldEl.classList.remove('show');

    if (!nationality) {
        imgEl.style.display = 'none';
        emojiEl.textContent = '';
        return;
    }

    const natKey = nationality.trim().toLowerCase();
    // Check Firebase-uploaded flags first — direct key match or alias match
    let flagEntry = _globalNatFlagImages[natKey]
        || Object.values(_globalNatFlagImages).find(f => f && (
            (f.key || '').toLowerCase() === natKey
            || (Array.isArray(f.aliases) && f.aliases.some(a => (a || '').toLowerCase() === natKey))
        ));
    
    if (flagEntry) {
        let src = typeof flagEntry === 'string' ? flagEntry : (flagEntry.image || flagEntry.url || '');
        if (src) {
            imgEl.src = src;
            imgEl.style.display = 'block';
            emojiEl.textContent = '';
            return;
        }
    }
    // Fallback to emoji
    imgEl.style.display = 'none';
    emojiEl.textContent = getNatFlag(nationality);
}

// ─── Role Icon display in player info area ───────────────────────────────────

function _getRoleIconSrc(role) {
    if (!role) return null;
    const roleKey = role.trim().toUpperCase().replace(/\s+/g, '_');
    let entry = _globalRoleIconImages[roleKey]
        || Object.values(_globalRoleIconImages).find(e => e && (
            (e.key || '').toUpperCase() === roleKey
            || (Array.isArray(e.aliases) && e.aliases.some(a => (a || '').toUpperCase() === roleKey))
        ));
    if (!entry) return null;
    return typeof entry === 'string' ? entry : (entry.image || entry.url || null);
}

function _updateRoleIconDisplay(role) {
    let wrap = document.getElementById('playerRoleIconWrap');
    let img  = document.getElementById('playerRoleIconImg');
    if (!wrap || !img) return;
    const src = _getRoleIconSrc(role);
    if (src) {
        img.src = src;
        wrap.style.display = 'flex';
    } else {
        wrap.style.display = 'none';
    }
}

// ─── Sold / Unsold Animations ────────────────────────────────────────────────
let _soldT1 = null, _soldT2 = null, _soldT3 = null;

function _clearSoldUI() {
    clearTimeout(_soldT1); clearTimeout(_soldT2); clearTimeout(_soldT3);

    // Photo stamps
    let ps = document.getElementById('photoSoldStamp');
    let pu = document.getElementById('photoUnsoldStamp');
    if (ps) ps.classList.remove('show','hide');
    if (pu) pu.classList.remove('show','hide');
}

function triggerSoldAnimation(teamName, teamColor, soldPrice) {
    _clearSoldUI();

    // Slant stamp on photo
    let photoStamp = document.getElementById('photoSoldStamp');
    if (photoStamp) {
        _soldT1 = setTimeout(() => {
            photoStamp.classList.add('hide');
            setTimeout(() => _clearSoldUI(), 380);
        }, 2800);
        photoStamp.classList.add('show');
    }

    // Card tickers on other franchise cards
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
        }, 6000);
    });
}

function triggerUnsoldAnimation() {
    _clearSoldUI();
    let pu = document.getElementById('photoUnsoldStamp');
    if (pu) {
        pu.classList.add('show');
        setTimeout(() => {
            pu.classList.add('hide');
            setTimeout(() => _clearSoldUI(), 380);
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
    db.ref('global_teams').once('value', teamsSnap => {
        const teams = teamsSnap.val() || {};
        const grid  = document.getElementById('globalTeamsGrid');
        if (!Object.keys(teams).length) {
            grid.innerHTML = '<p style="grid-column:span 2; color:#dc3545; font-size:11px;">No global franchises found. Contact your Admin.</p>';
            return;
        }

        // Load league logos alongside teams
        db.ref('global_leagues').once('value', leagueSnap => {
            const leagues = leagueSnap.val() || {};

            // Group teams by label (e.g. "IPL", "SA20", "National Board")
            const groups = {};   // label → [{ code, team }]
            const UNGROUPED = '— Other Franchises —';
            for (let code in teams) {
                const t = teams[code];
                const label = (t.label || '').trim() || UNGROUPED;
                if (!groups[label]) groups[label] = [];
                groups[label].push({ code, team: t });
            }

            let html = '';
            Object.keys(groups).forEach(label => {
                // Find league logo for this label (case-insensitive key match)
                const leagueKey = Object.keys(leagues).find(k => k.toLowerCase() === label.toLowerCase() || (leagues[k]?.name || '').toLowerCase() === label.toLowerCase());
                const leagueLogo = leagueKey ? (leagues[leagueKey]?.logo || '') : '';

                    html += `<div style="grid-column:1/-1; display:flex; align-items:center; gap:10px; margin:14px 0 6px; padding-bottom:6px; border-bottom:1px solid #2a2a3a;">
                    ${leagueLogo ? `<img src="${esc(leagueLogo)}" style="height:22px; width:auto; object-fit:contain; opacity:0.85; filter:drop-shadow(0 0 4px rgba(255,255,255,0.2));">` : ''}
                    <span style="color:#666; font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase;">${esc(label)}</span>
                </div>`;

                groups[label].forEach(({ code, team: t }) => {
                    const c = t.color || '#007bff';
                    const logoHtml = t.logo
                        ? `<img src="${esc(t.logo)}" style="height:34px; width:34px; object-fit:contain; margin-bottom:4px; filter:drop-shadow(0 0 6px rgba(255,255,255,0.25));">`
                        : `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:${esc(c)};text-shadow:0 0 10px ${esc(c)};margin-bottom:4px;">${esc(code.slice(0,3))}</div>`;
                    html += `<button class="team-btn" style="
                        background: #0e0e18;
                        border: 1px solid ${esc(c)};
                        box-shadow: 0 0 10px ${esc(c)}44, inset 0 0 12px ${esc(c)}11;
                        color: #fff;
                        display:flex; flex-direction:column; align-items:center; justify-content:center; padding:10px 8px; gap:3px;
                    " onmouseover="this.style.boxShadow='0 0 18px ${esc(c)}99, inset 0 0 18px ${esc(c)}22'; this.style.borderColor='${esc(c)}'; this.style.transform='translateY(-2px)'"
                       onmouseout="this.style.boxShadow='0 0 10px ${esc(c)}44, inset 0 0 12px ${esc(c)}11'; this.style.transform=''"
                       onclick="prepareLogin('${esc(code)}','${esc(c)}')">
                        ${logoHtml}
                        <span style="font-size:11px; font-weight:900; letter-spacing:1px; color:${esc(c)}; text-shadow:0 0 8px ${esc(c)};">${esc(code)}</span>
                    </button>`;
                });
            });

            grid.innerHTML = html || '<p style="grid-column:span 2; color:#666; font-size:11px;">No teams found.</p>';
        });
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
    document.getElementById('myTeamDisplay').textContent = state.globalTeamNames?.[state.myTeamName] || state.myTeamName;
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

    // Load logos from global_teams (teams_auth does NOT contain logo field)
    db.ref('global_teams').on('value', snap => {
        let gt = snap.val() || {};
        state.globalTeamLogos = {};
        state.globalTeamNames = {};
        state.globalTeamColors = {};
        for (let code in gt) {
            if (gt[code].logo)  state.globalTeamLogos[code]  = gt[code].logo;
            if (gt[code].name)  state.globalTeamNames[code]  = gt[code].name;
            if (gt[code].color) state.globalTeamColors[code] = gt[code].color;
        }
        // Refresh logo banner now that we have data
        let myLogoBigEl2 = document.getElementById('myTeamLogoBig');
        if (myLogoBigEl2 && state.myTeamName) {
            let src = state.globalTeamLogos[state.myTeamName] || '';
            if (src) { myLogoBigEl2.src = src; myLogoBigEl2.style.display = 'block'; }
            else { myLogoBigEl2.style.display = 'none'; }
        }
        // Refresh full name display
        let nameEl = document.getElementById('myTeamDisplay');
        if (nameEl && state.myTeamName) {
            nameEl.textContent = state.globalTeamNames?.[state.myTeamName] || state.myTeamName;
        }
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

    // National flag images uploaded by admin
    db.ref('global_nat_flags').on('value', snap => {
        _globalNatFlagImages = snap.val() || {};
    });

    // National board logos uploaded by admin
    db.ref('global_nat_boards').on('value', snap => {
        _globalNatBoards = snap.val() || {};
    });

    // Role icons uploaded by admin
    db.ref('global_role_icons').on('value', snap => {
        _globalRoleIconImages = snap.val() || {};
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
            document.getElementById('playerNameText').innerHTML = esc(p.name) + (isOv ? `<span class="overseas-wrap" title="${esc(p.nationality)}"><svg class="overseas-icon" viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M5 3v18h2v-7h12l-3-4 3-4H7V3H5z"/></svg></span>` : '');
            
            let tags = document.getElementById('playerFranchise');
            let rl = document.getElementById('playerRole');
            // Show national_board + franchise as separate logo badges (with text pill fallback)
            const boardText     = (p.national_board || '').trim();
            const franchiseText = (p.franchise      || '').trim();

            // ── Board logo / text pill ──────────────────────────────
            const boardKey = boardText.toLowerCase().replace(/\s+/g, '_');
            // UNCAPPED / UC players have no board affiliation — skip badge entirely
            const isUncapped = ['uncapped', 'uc', 'un-capped'].includes(boardText.toLowerCase());
            let boardEntry = !isUncapped && (_globalNatBoards[boardKey]
                || Object.values(_globalNatBoards).find(b => b && (
                    (b.key  || '').toLowerCase() === boardKey
                    || (b.name || '').toLowerCase() === boardText.toLowerCase()
                    || (Array.isArray(b.aliases) && b.aliases.some(a => (a || '').toLowerCase() === boardKey))
                )));
            let boardImgSrc = boardEntry ? (typeof boardEntry === 'string' ? boardEntry : (boardEntry.image || '')) : '';

            const boardLogoBadge = document.getElementById('boardLogoBadge');
            const boardLogoImg   = document.getElementById('boardLogoImg');
            const boardTextPill  = document.getElementById('boardTextPill');
            if (boardImgSrc) {
                if (boardLogoImg) boardLogoImg.src = boardImgSrc;
                if (boardLogoBadge) boardLogoBadge.style.display = 'flex';
                if (boardTextPill)  boardTextPill.style.display  = 'none';
            } else if (boardText && !isUncapped) {
                if (boardLogoBadge) boardLogoBadge.style.display = 'none';
                if (boardTextPill)  { boardTextPill.textContent = boardText; boardTextPill.style.display = 'inline-block'; }
            } else {
                if (boardLogoBadge) boardLogoBadge.style.display = 'none';
                if (boardTextPill)  boardTextPill.style.display  = 'none';
            }

            // ── Franchise logo / text pill ──────────────────────────
            const franchiseKey = franchiseText.trim();
            let franchiseLogoSrc = '';
            if (state.globalTeamLogos) {
                franchiseLogoSrc = state.globalTeamLogos[franchiseKey]
                    || state.globalTeamLogos[franchiseKey.toLowerCase()]
                    || Object.entries(state.globalTeamLogos).find(([k]) => k.toLowerCase() === franchiseKey.toLowerCase())?.[1]
                    || '';
            }

            const franchiseLogoBadge = document.getElementById('franchiseLogoBadge');
            const franchiseLogoImg   = document.getElementById('franchiseLogoImg');
            // Apply team theme color as glowing border on franchise badge
            const teamColor = (state.globalTeamColors && (
                state.globalTeamColors[franchiseKey] ||
                state.globalTeamColors[franchiseKey.toLowerCase()] ||
                Object.entries(state.globalTeamColors).find(([k]) => k.toLowerCase() === franchiseKey.toLowerCase())?.[1]
            )) || null;
            if (franchiseLogoBadge && teamColor) {
                franchiseLogoBadge.style.borderColor = teamColor;
                franchiseLogoBadge.style.boxShadow = `0 0 14px ${teamColor}66, 0 0 4px ${teamColor}44`;
            } else if (franchiseLogoBadge) {
                franchiseLogoBadge.style.borderColor = 'rgba(255,255,255,0.2)';
                franchiseLogoBadge.style.boxShadow = '';
            }
            if (franchiseLogoSrc) {
                if (franchiseLogoImg)   franchiseLogoImg.src = franchiseLogoSrc;
                if (franchiseLogoBadge) franchiseLogoBadge.style.display = 'flex';
                if (tags) tags.style.display = 'none';
            } else if (franchiseText) {
                if (franchiseLogoBadge) franchiseLogoBadge.style.display = 'none';
                if (tags) { tags.textContent = franchiseText; tags.style.display = 'inline-block'; }
            } else {
                if (franchiseLogoBadge) franchiseLogoBadge.style.display = 'none';
                if (tags) tags.style.display = 'none';
            }
            if (p.role) { rl.textContent = p.role; rl.style.display = 'inline-block'; } else rl.style.display = 'none';

            // Update flag circle
            _updateFlagCircle(p.nationality || 'Indian');
            // Update role icon
            _updateRoleIconDisplay(p.role || '');
            
            let safeNameKey = (p.name || '').replace(/[.#$\[\]\/]/g, '_');
            let imgObj = state.globalImageMap[safeNameKey] || state.globalImageMap[p.name]; 
            let imgUrl = imgObj ? (imgObj.active || imgObj.url || (typeof imgObj === 'string' ? imgObj : '')) : ''; 
            
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
                // If no stat_columns configured, derive from player's own keys
                if (!statCols.length && p) {
                    const CORE_KEYS = new Set(['name','role','set','franchise','national_board','nationality','base_price','status','sold_price','team','_col_order','stats']);
                    statCols = Object.keys(p).filter(k => !CORE_KEYS.has(k) && p[k] !== undefined && p[k] !== '');
                }
                let statsHtml = '';
                statCols.forEach(col => {
                    // Flat read first, fallback to legacy nested p.stats for old data
                    let val = (p[col] !== undefined && p[col] !== '') ? p[col] : (p.stats ? (p.stats[col] || '-') : '-');
                    let label = col.replace(/_/g,' ').toUpperCase();
                    statsHtml += `<div class="stat-flip-item"><div class="stat-flip-label">${esc(label)}</div><div class="stat-flip-val">${esc(String(val))}</div></div>`;
                });
                statsGrid.innerHTML = statsHtml || '<div style="color:#555;font-size:11px;text-align:center;grid-column:1/-1;">No stats available</div>';
            }
        }
    } else {
        document.getElementById('playerNameText').textContent = 'Waiting…';
        document.getElementById('playerFranchise').style.display = 'none';
        document.getElementById('playerRole').style.display = 'none';
        const _bLB = document.getElementById('boardLogoBadge');   if (_bLB) _bLB.style.display = 'none';
        const _bTP = document.getElementById('boardTextPill');    if (_bTP) _bTP.style.display = 'none';
        const _fLB = document.getElementById('franchiseLogoBadge'); if (_fLB) _fLB.style.display = 'none';
        document.getElementById('playerPhoto').innerHTML = 'PHOTO';
        document.getElementById('playerPhoto').classList.remove('has-photo');
        _updateFlagCircle(null);
        _updateRoleIconDisplay('');
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
        document.getElementById('myTeamDisplay').textContent   = state.globalTeamNames?.[state.myTeamName] || state.myTeamName;
        // Show franchise logo in top-left of panel
        let myLogoBigEl = document.getElementById('myTeamLogoBig');
        let myLogoSrc = (state.globalTeamLogos && state.globalTeamLogos[state.myTeamName]) || '';
        if (myLogoBigEl) {
            if (myLogoSrc) {
                myLogoBigEl.src = myLogoSrc;
                myLogoBigEl.style.display = 'block';
            } else {
                myLogoBigEl.style.display = 'none';
            }
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
                ? `<span class="overseas-wrap" title="${esc(p.nationality)}"><svg class=\"overseas-icon\" viewBox=\"0 0 24 24\" width=\"13\" height=\"13\" fill=\"currentColor\"><path d=\"M5 3v18h2v-7h12l-3-4 3-4H7V3H5z\"/></svg></span>` : '';
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
        
        let squadTotalEl = document.getElementById('squadTotal');
        if (squadTotalEl) squadTotalEl.textContent = `SQUAD: ${xiCount + benchPlayers.length}`;

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
            // Logo on left edge — only right half visible
            let tLogo = (state.globalTeamLogos && state.globalTeamLogos[t]) || '';
            let tFullName = (state.globalTeamNames && state.globalTeamNames[t]) || '';
            let bgLogoDivHtml = tLogo
                ? `<div class="card-edge-logo" style="background-image:url('${tLogo}');"></div>`
                : '';
            // Theme colour tint overlay
            let tColorRgb = tColor.replace('#','');
            let r16 = parseInt(tColorRgb.slice(0,2),16)||0, g16 = parseInt(tColorRgb.slice(2,4),16)||0, b16 = parseInt(tColorRgb.slice(4,6),16)||0;
            othersHtml += `
            <div class="other-team-card-hz${lgClass}" data-team="${esc(t)}" style="border-top-color:${tColor}; background: linear-gradient(to left, rgba(${r16},${g16},${b16},0.07) 0%, #0a0a0f 60%); border-color: rgba(${r16},${g16},${b16},0.18);">
                ${bgLogoDivHtml}
                <!-- Ticker at TOP of card — slides down from top edge -->
                <div class="card-ticker-wrap" id="ctw-${esc(t)}"></div>
                <div class="team-msg-popup" id="msg-popup-${esc(t)}"></div>
                <div style="font-weight:900; font-size:16px; color:${tColor}; margin-bottom:1px; position:relative; z-index:2; letter-spacing:1px; text-shadow:0 0 12px rgba(${r16},${g16},${b16},0.5);">${esc(t)} ${dot}</div>
                ${tFullName ? `<div style="font-size:9px; color:rgba(${r16},${g16},${b16},0.85); font-weight:700; text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; position:relative; z-index:2; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(tFullName)}</div>` : ''}
                <div style="font-size:9px; color:#666; text-transform:uppercase; margin-top:2px; position:relative; z-index:2;">Paddle: ${esc(tPaddle)}</div>
                <div style="font-size:9px; color:#555; text-transform:uppercase; margin-top:2px; position:relative; z-index:2;">${count} Players</div>
                <div class="purse-val" style="color:${rCr > 0 ? '#28a745' : '#dc3545'}; font-size:17px; margin-top:3px; position:relative; z-index:2;">₹${rCr.toFixed(2)} Cr</div>
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

// ─── Missing export functions (PDF/CSV) ───────────────────────────────────────
window.exportMySquadPDF = () => {
    let sold = state.playerPool.filter(p => p.status === 'sold' && p.team === state.myTeamName);
    if (!sold.length) return showAlert('Empty Squad', 'No players bought yet.');
    let rows = sold.map(p => {
        let role = (state.allRegisteredTeams[state.myTeamName]?.playerRoles?.[p.name]) || '-';
        return `<tr><td>${esc(p.name)}</td><td>${esc(p.nationality||'-')}</td><td>${esc(role)}</td><td style="text-align:right">₹${(p.sold_price/CRORE).toFixed(2)} Cr</td></tr>`;
    }).join('');
    let win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${state.myTeamName} Squad</title>
    <style>body{font-family:Arial,sans-serif;padding:20px;}h1{color:#333;}table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #ccc;padding:8px 12px;text-align:left;}th{background:#f5f5f5;font-weight:bold;}
    @media print{button{display:none;}}</style></head><body>
    <h1>🏏 ${esc(state.myTeamName)} — Squad</h1>
    <table><thead><tr><th>Player</th><th>Nationality</th><th>Role</th><th>Price</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <br><button onclick="window.print()">🖨 Print / Save PDF</button></body></html>`);
    win.document.close();
};

window.exportAllSquadsCSV = () => {
    let lines = ['"Team","Player","Nationality","Role","Price (Cr)"'];
    Object.keys(state.allRegisteredTeams).forEach(teamCode => {
        let players = state.playerPool.filter(p => p.status === 'sold' && p.team === teamCode);
        players.forEach(p => {
            let role = (state.allRegisteredTeams[teamCode]?.playerRoles?.[p.name]) || '-';
            lines.push(`"${teamCode}","${p.name}","${p.nationality||'-'}","${role}","${(p.sold_price/CRORE).toFixed(2)}"`);
        });
    });
    let blob = new Blob([lines.join('\n')], {type: 'text/csv;charset=utf-8;'});
    let a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'all_squads.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

window.exportAllSquadsPDF = () => {
    let win = window.open('', '_blank');
    let body = '';
    Object.keys(state.allRegisteredTeams).forEach(teamCode => {
        let players = state.playerPool.filter(p => p.status === 'sold' && p.team === teamCode);
        if (!players.length) return;
        let rows = players.map(p => {
            let role = (state.allRegisteredTeams[teamCode]?.playerRoles?.[p.name]) || '-';
            return `<tr><td>${esc(p.name)}</td><td>${esc(p.nationality||'-')}</td><td>${esc(role)}</td><td style="text-align:right">₹${(p.sold_price/CRORE).toFixed(2)} Cr</td></tr>`;
        }).join('');
        body += `<h2>${esc(teamCode)}</h2><table><thead><tr><th>Player</th><th>Nationality</th><th>Role</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table><br>`;
    });
    win.document.write(`<!DOCTYPE html><html><head><title>All Squads</title>
    <style>body{font-family:Arial,sans-serif;padding:20px;}h2{color:#333;margin-top:30px;}
    table{width:100%;border-collapse:collapse;margin-bottom:10px;}
    th,td{border:1px solid #ccc;padding:8px 12px;text-align:left;}th{background:#f5f5f5;}
    @media print{button{display:none;}}</style></head><body>
    <h1>🏏 All Squads — Auction Results</h1>${body}
    <button onclick="window.print()">🖨 Print / Save PDF</button></body></html>`);
    win.document.close();
};
