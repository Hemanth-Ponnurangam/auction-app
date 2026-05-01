/**
 * controls.js
 * Handles the core auction actions: Push, Sell, Unsold, Random, Undo, and Reset.
 */

import { state } from '../shared/state.js';
import { showAlert, showConfirm, showPrompt, esc } from '../shared/dom.js';
import { playSound } from '../shared/audio.js';

const CRORE = 10_000_000;

/**
 * Writes an action to the persistent Firebase auction log.
 */
export function persistEvent(msg) {
    if (state.roomRef) {
        state.roomRef.child('auction_log').push({ msg, t: Date.now() });
    }
}

export function pushPlayerToBlock(index) {
    let currentStatus = state.liveState.auction_state;
    if (currentStatus === 'bidding' || currentStatus === 'cooldown') { 
        showAlert('In Progress', 'An auction is already running.'); 
        return; 
    }
    
    let p = state.playerPool[index];
    let cooldownSecs = state.settings.cooldown_secs || 10;
    let msg = `▶️ <strong>${esc(p.name)}</strong> is on the block. Base: ₹${(p.base_price/CRORE).toFixed(2)} Cr`;
    
    state.roomRef.child('live_state').update({
        current_player_index: parseInt(index),
        current_bid: p.base_price,
        highest_bidder: 'Base Price',
        auction_state: 'cooldown',
        timer_end: Date.now() + (cooldownSecs * 1000),
        bid_stack: []
    });
    persistEvent(msg);
}

export function pullRandomFromSet() {
    let currentStatus = state.liveState.auction_state;
    if (currentStatus === 'bidding' || currentStatus === 'cooldown') return;
    
    let setDropdown = document.getElementById('setSelector');
    let activeSet = setDropdown ? setDropdown.value : '';
    
    let available = state.playerPool
        .map((p, i) => ({ p, i }))
        .filter(item => item.p.set === activeSet && item.p.status !== 'sold' && item.p.status !== 'unsold');
        
    if (!available.length) { 
        showAlert('Empty Set', 'No available players left in this set!'); 
        return; 
    }
    pushPlayerToBlock(available[Math.floor(Math.random() * available.length)].i);
}

export function sellPlayer() {
    let idx = state.liveState.current_player_index;
    let leader = state.liveState.highest_bidder;
    let currentBid = state.liveState.current_bid;

    if (idx < 0 || leader === '-' || leader === 'Base Price') return;
    
    let p = state.playerPool[idx];
    let msg = `🔨 <strong>${esc(p.name)}</strong> SOLD to ${esc(leader)} for ₹${(currentBid/CRORE).toFixed(2)} Cr`;
    
    let updates = {};
    updates[`player_pool/${idx}/status`] = 'sold';
    updates[`player_pool/${idx}/team`] = leader;
    updates[`player_pool/${idx}/sold_price`] = currentBid;
    
    state.roomRef.update(updates);
    state.roomRef.child('live_state').update({ 
        auction_state: 'sold', 
        timer_end: 0, 
        last_sold_index: idx, 
        bid_stack: null 
    });
    
    persistEvent(msg);
    playSound('sold');
}

export function passPlayer() {
    let idx = state.liveState.current_player_index;
    if (idx < 0) return;
    
    let p = state.playerPool[idx];
    let msg = `❌ <strong>${esc(p.name)}</strong> went UNSOLD.`;
    
    state.roomRef.update({ [`player_pool/${idx}/status`]: 'unsold' });
    state.roomRef.child('live_state').update({ auction_state: 'unsold', timer_end: 0 });
    persistEvent(msg);
}

export function undoLastSale() {
    state.roomRef.child('live_state').once('value').then(snap => {
        let lsi = snap.val()?.last_sold_index;
        if (lsi === undefined || lsi === -1) { 
            showAlert('Nothing to Undo', 'No recent sale to revert.'); 
            return; 
        }
        
        let p = state.playerPool[lsi];
        if (!p || p.status !== 'sold') { 
            showAlert('Nothing to Undo', 'The last tracked player is not currently sold.'); 
            return; 
        }
        
        showConfirm('⏪ Undo Sale',
            `Revert the sale of ${p.name} to ${p.team} for ₹${(p.sold_price/CRORE).toFixed(2)} Cr?`,
            () => showPrompt('Type to Confirm', 'Type UNDO to proceed:', 'UNDO', val => {
                if (val === 'UNDO') {
                    let msg = `⏪ UNDO: <strong>${esc(p.name)}</strong> sale to ${esc(p.team)} was reverted.`;
                    let updates = {};
                    updates[`player_pool/${lsi}/status`] = 'available';
                    updates[`player_pool/${lsi}/team`] = null;
                    updates[`player_pool/${lsi}/sold_price`] = null;
                    
                    state.roomRef.update(updates);
                    state.roomRef.child('live_state').update({ 
                        auction_state: 'idle', 
                        last_sold_index: -1, 
                        timer_end: 0 
                    });
                    persistEvent(msg);
                } else { 
                    showAlert('Cancelled', 'Incorrect confirmation. Undo cancelled.'); 
                }
            })
        );
    });
}

export function undoLastBid() {
    let currentStatus = state.liveState.auction_state;
    let idx = state.liveState.current_player_index;

    if (idx < 0 || currentStatus === 'sold' || currentStatus === 'unsold') {
        showAlert('Cannot Undo Bid', 'Auction is not currently active for a player.');
        return;
    }
    
    let stackArr = state.liveState.bid_stack ? Object.values(state.liveState.bid_stack) : [];
    if (!stackArr.length) {
        showAlert('Nothing to Undo', 'No bids have been placed on this player yet.');
        return;
    }
    
    let p = state.playerPool[idx];
    let topBid = stackArr[stackArr.length - 1];
    
    showConfirm('↩️ Undo Last Bid',
        `Undo ${esc(topBid.bidder)}'s bid of ₹${(topBid.amount/CRORE).toFixed(2)} Cr?`,
        () => {
            state.roomRef.child('live_state').transaction(liveData => {
                if (!liveData) return liveData;
                let arr = liveData.bid_stack ? Object.values(liveData.bid_stack) : [];
                if (!arr.length) return liveData; 
                
                arr.pop(); // Remove the top bid
                let prev = arr.length ? arr[arr.length - 1] : null;
                
                liveData.bid_stack = arr.length ? arr : null;
                liveData.current_bid = prev ? prev.amount : (p.base_price || 0);
                liveData.highest_bidder = prev ? prev.bidder : 'Base Price';
                liveData.timer_end = Date.now() + ((state.settings.bid_timer_secs || 15) * 1000);
                liveData.auction_state = 'bidding';
                
                return liveData;
            }, (err, committed) => {
                if (!err && committed) {
                    let newBidder = stackArr.length > 1 ? stackArr[stackArr.length - 2].bidder : 'Base Price';
                    let newAmt    = stackArr.length > 1 ? stackArr[stackArr.length - 2].amount : p.base_price;
                    persistEvent(`↩️ Auctioneer reversed ${esc(topBid.bidder)}'s bid. Bid back to <strong>${esc(newBidder)}</strong> at ₹${(newAmt/CRORE).toFixed(2)} Cr.`);
                }
            });
        }
    );
}

export function confirmResetAuction() {
    showConfirm('☢️ Full Reset',
        'This erases ALL squads, budgets, and bids. Every player returns to Available.\n\nTeam PINs are preserved — franchises can log back in without re-registering.\n\nThis cannot be undone.',
        () => showPrompt('Final Confirmation', 'Type RESET to wipe the entire auction:', 'RESET', val => {
            if (val === 'RESET') {
                let resetPool = state.playerPool.map(p => { 
                    p.status = 'available'; p.team = null; p.sold_price = null; return p; 
                });
                
                state.roomRef.update({ player_pool: resetPool, logged_in_teams: null });
                
                let teamKeys = Object.keys(state.allRegisteredTeams);
                let authUpdates = {};
                teamKeys.forEach(t => {
                    authUpdates[`${t}/playingXI`] = [];
                    authUpdates[`${t}/bench`] = [];
                    authUpdates[`${t}/playerRoles`] = {};
                });
                
                state.roomRef.child('teams_auth').update(authUpdates);
                state.roomRef.child('live_state').update({ 
                    current_bid: 0, highest_bidder: '-', timer_end: 0, 
                    current_player_index: -1, last_sold_index: -1, 
                    auction_state: 'idle', bid_stack: null 
                });
                state.roomRef.child('auction_log').remove(); 
                
                persistEvent('🔄 <strong>FULL AUCTION RESET</strong> performed by auctioneer. Team PINs preserved.');
            } else { 
                showAlert('Cancelled', 'Incorrect confirmation. Reset cancelled.'); 
            }
        })
    );
}

// Global attachments for HTML
window.pushPlayerToBlock = pushPlayerToBlock;
window.pullRandomFromSet = pullRandomFromSet;
window.sellPlayer = sellPlayer;
window.passPlayer = passPlayer;
window.undoLastSale = undoLastSale;
window.undoLastBid = undoLastBid;
window.confirmResetAuction = confirmResetAuction;