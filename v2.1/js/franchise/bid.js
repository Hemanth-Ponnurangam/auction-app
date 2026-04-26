/**
 * bid.js
 * Handles all bidding logic, jump menus, and bid button state for the Franchise portal.
 */

import { state } from '../shared/state.js';
import { playSound } from '../shared/audio.js';
import { showAlert, showPrompt } from '../shared/dom.js';

const CRORE = 10_000_000;

export function getCurrentBidIncrement() {
    let set = state.settings;
    let base = (set.inc_base || 20) * 100_000;
    let mid = (set.inc_mid || 50) * 100_000;
    let high = (set.inc_high || 100) * 100_000;
    
    let limitMid = set.limit_mid || 2;
    let limitHigh = set.limit_high || 5;
    
    let cr = state.liveState.current_bid / CRORE;

    if (cr >= limitHigh) return high;
    if (cr >= limitMid) return mid;
    return base;
}

export function placeExactBid(amount) {
    closeJumpMenu();
    let myBudget = state.teamBudgets[state.myTeamName] !== undefined 
        ? state.teamBudgets[state.myTeamName] 
        : (state.settings.starting_purse * CRORE);

    state.roomRef.child('live_state').transaction(liveData => {
        if (!liveData) return liveData;
        let currentStatus = liveData.auction_state;
        if (currentStatus !== 'bidding' && currentStatus !== 'cooldown') return liveData; 
        
        let isDataFirstBid = liveData.highest_bidder === 'Base Price' || liveData.highest_bidder === '-' || liveData.highest_bidder === '';

        if (isDataFirstBid) {
            if (amount < (liveData.current_bid || 0)) return liveData;
        } else {
            if (amount <= (liveData.current_bid || 0)) return liveData;
        }

        if (amount > myBudget) return liveData; 
        
        let stack = liveData.bid_stack ? Object.values(liveData.bid_stack) : [];
        stack.push({ bidder: state.myTeamName, amount: amount });
        
        liveData.bid_stack       = stack;
        liveData.current_bid     = amount;
        liveData.highest_bidder  = state.myTeamName;
        liveData.timer_end       = Date.now() + (state.settings.bid_timer_secs * 1000);
        liveData.auction_state   = 'bidding';
        return liveData;
    }, (err, committed, snap) => {
        if (err) console.error('Bid transaction failed:', err);
        else if (committed) {
            playSound('bid');
        } else {
            let d = snap.val();
            let isDataFirstBid = d && (d.highest_bidder === 'Base Price' || d.highest_bidder === '-' || d.highest_bidder === '');
            if (d && isDataFirstBid && amount < (d.current_bid || 0)) showAlert('Invalid Bid', 'Bid must be at least the base price.');
            else if (d && !isDataFirstBid && amount <= (d.current_bid || 0)) showAlert('Invalid Bid', 'Bid must be strictly higher than the current bid.');
            else if (amount > myBudget) showAlert('Insufficient Funds', 'You do not have enough purse remaining for this bid.');
        }
    });
}

export function placeBid() { 
    let isFirstBid = state.liveState.highest_bidder === 'Base Price' || state.liveState.highest_bidder === '-' || state.liveState.highest_bidder === '';
    let amount = isFirstBid ? state.liveState.current_bid : (state.liveState.current_bid || 0) + getCurrentBidIncrement();
    placeExactBid(amount); 
}

export function promptManualBid() {
    closeJumpMenu();
    showPrompt('Manual Bid', 'Enter exact bid amount in Crores (e.g. 7.5)', '', val => {
        let cr = parseFloat(val);
        if (!isNaN(cr) && cr > 0) {
            placeExactBid(Math.round(cr * CRORE));
        } else {
            showAlert('Invalid', 'Please enter a valid number.');
        }
    });
}

export function openJumpMenu(e) {
    if (e) e.stopPropagation();
    let popup = document.getElementById('jumpBidPopup');
    let mainBtn = document.getElementById('mainActionButton');
    popup.style.display = 'flex';
    let btnRect = mainBtn.getBoundingClientRect();
    popup.style.top = (btnRect.top - 10) + 'px';
    popup.style.left = (btnRect.left + btnRect.width / 2) + 'px';
}

export function closeJumpMenu() {
    document.getElementById('jumpBidPopup').style.display = 'none';
}

export function evaluateBidButtonStatus(amIWinning) {
    let btn = document.getElementById('mainActionButton');
    let bidZone = document.getElementById('bidZoneBox');
    if (!btn || !bidZone) return;

    let maxOv = state.settings.max_overseas || 8;
    let maxSq = state.settings.max_squad || 25;

    let myOverseasCount = state.playerPool.filter(p => p.status === 'sold' && p.team === state.myTeamName && !['india','indian','ind'].includes((p.nationality||'').trim().toLowerCase())).length;
    let myRosterCount = state.playerPool.filter(p => p.status === 'sold' && p.team === state.myTeamName).length;
    
    let currentPlayer = state.playerPool[state.liveState.current_player_index] || {};
    let isOvMaxed = state.settings.overseas_limit_enabled && 
                    !['india','indian','ind'].includes((currentPlayer.nationality||'').trim().toLowerCase()) && 
                    myOverseasCount >= maxOv;
    
    let isSquadMaxed = myRosterCount >= maxSq;
    let myBudget = state.teamBudgets[state.myTeamName] !== undefined ? state.teamBudgets[state.myTeamName] : (state.settings.starting_purse * CRORE);
    
    let isFirstBid = state.liveState.highest_bidder === 'Base Price' || state.liveState.highest_bidder === '-' || state.liveState.highest_bidder === '';
    let requiredBid = isFirstBid ? state.liveState.current_bid : state.liveState.current_bid + getCurrentBidIncrement();
    let isInsufficient = requiredBid > myBudget;

    let currentStatus = state.liveState.auction_state;
    
    const setBtn = (cls, text, enabled) => {
        btn.className = `action-btn-bid ${cls}`; 
        btn.textContent = text; 
        btn.disabled = !enabled;
        bidZone.style.borderColor = enabled ? 'rgba(220,53,69,.3)' : '#222';
    };
    const setStatus = cls => { document.getElementById('currentBidContainer').className = `current-bid-display ${cls}`; };

    if (currentStatus === 'idle') {
        setStatus('status-neutral'); setBtn('btn-bid-locked','WAITING…',false);
    } else if (currentStatus === 'sold') {
        setStatus('status-winning'); setBtn('btn-bid-locked', `SOLD TO ${state.liveState.highest_bidder}`, false);
    } else if (currentStatus === 'unsold') {
        setStatus('status-losing');  setBtn('btn-bid-unsold','UNSOLD',false);
    } else if (currentStatus === 'cooldown' || currentStatus === 'paused') {
        setStatus('status-neutral'); setBtn('btn-cooldown', currentStatus.toUpperCase() + '…', false);
    } else if (amIWinning) {
        setStatus('status-winning'); bidZone.style.borderColor='rgba(40,167,69,.3)';
        setBtn('btn-bid-locked','BID',false);
    } else if (isSquadMaxed) {
        setStatus('status-losing');  setBtn('btn-bid-insufficient', `SQUAD FULL (${maxSq})`, false);
    } else if (isOvMaxed) {
        setStatus('status-losing');  setBtn('btn-bid-insufficient', `MAX OVERSEAS (${maxOv})`, false);
    } else if (isInsufficient) {
        setStatus('status-losing');  setBtn('btn-bid-insufficient', 'INSUFFICIENT FUNDS', false);
    } else {
        setStatus('status-losing');  
        let btnText = isFirstBid ? `BID BASE (₹${(state.liveState.current_bid/CRORE).toFixed(2)} Cr)` : `BID (+₹${(getCurrentBidIncrement()/100000)}L)`;
        setBtn('btn-bid-active', btnText, true);
    }
}

export function attachBidListeners() {
    const mainBtn = document.getElementById('mainActionButton');
    let bidPressTimer;
    let isLongPress = false;

    const onPointerDown = (e) => {
        if (e.button !== 0 && e.type !== 'touchstart') return; 
        if (mainBtn.disabled) return;
        isLongPress = false;
        bidPressTimer = setTimeout(() => {
            isLongPress = true;
            openJumpMenu(e);
        }, 600); 
    };

    const onPointerUp = (e) => {
        clearTimeout(bidPressTimer);
        let stateName = state.liveState.auction_state;
        if (!isLongPress && !mainBtn.disabled && stateName !== 'idle' && stateName !== 'sold' && stateName !== 'unsold' && stateName !== 'paused') {
            placeBid();
        }
        if (e.type === 'touchend') e.preventDefault(); 
    };

    mainBtn.addEventListener('mousedown', onPointerDown);
    mainBtn.addEventListener('touchstart', onPointerDown, {passive: false});
    mainBtn.addEventListener('mouseup', onPointerUp);
    mainBtn.addEventListener('touchend', onPointerUp);
    mainBtn.addEventListener('mouseleave', () => clearTimeout(bidPressTimer));
    mainBtn.addEventListener('touchcancel', () => clearTimeout(bidPressTimer));
    mainBtn.oncontextmenu = function() { return false; }; 
    
    // External click closer
    document.addEventListener('click', e => {
        let popup = document.getElementById('jumpBidPopup');
        if (popup && popup.style.display === 'flex' && !popup.contains(e.target) && e.target.id !== 'mainActionButton') {
            closeJumpMenu();
        }
    });
}

// Attach globals for HTML inline onclick attributes
window.placeExactBid = placeExactBid;
window.promptManualBid = promptManualBid;
window.closeJumpMenu = closeJumpMenu;