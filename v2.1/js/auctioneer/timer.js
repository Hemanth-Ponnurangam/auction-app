/**
 * timer.js
 * Handles manual timer injections, pausing, and skipping cooldown phases.
 */

import { state } from '../shared/state.js';
import { persistEvent } from './controls.js';

/**
 * Manually injects a specific countdown time.
 */
export function startTimer(seconds, auctionState = 'bidding') {
    if (!state.roomRef) return;
    state.roomRef.child('live_state').update({ 
        timer_end: Date.now() + (seconds * 1000), 
        auction_state: auctionState 
    });
}

/**
 * Forces the auction out of the 'cooldown' state directly into 'bidding'.
 */
export function bypassCooldown() {
    if (state.liveState.auction_state === 'cooldown' && state.roomRef) {
        let bidTimerSecs = state.settings.bid_timer_secs || 15;
        state.roomRef.child('live_state').update({ 
            auction_state: 'bidding', 
            timer_end: Date.now() + (bidTimerSecs * 1000)
        });
        persistEvent('⏩ Cooldown bypassed. Bidding is LIVE!');
    }
}

/**
 * Pauses or Resumes the live auction timer and bidding state.
 */
export function togglePause() {
    if (!state.roomRef) return;
    
    let currentStatus = state.liveState.auction_state;

    if (currentStatus === 'paused') {
        // Resume
        let remaining = state.liveState.paused_remaining || 15000;
        state.roomRef.child('live_state').update({ 
            auction_state: 'bidding', 
            timer_end: Date.now() + remaining, 
            paused_remaining: null 
        });
        persistEvent('▶️ Auction <strong>RESUMED</strong>.');
        
    } else if (currentStatus === 'bidding' || currentStatus === 'cooldown') {
        // Pause
        let remaining = Math.max(0, (state.liveState.timer_end || 0) - Date.now());
        state.roomRef.child('live_state').update({ 
            auction_state: 'paused', 
            timer_end: 0, 
            paused_remaining: remaining 
        });
        persistEvent('⏸️ Auction <strong>PAUSED</strong> by auctioneer.');
    }
}

// Global attachments for HTML
window.startTimer = startTimer;
window.bypassCooldown = bypassCooldown;
window.togglePause = togglePause;