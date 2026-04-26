/**
 * watchlist.js
 * Handles the Franchise-specific player watchlist (starring players).
 */

import { state } from '../shared/state.js';

export let watchlist = new Set();
let watchlistRef = null;

/**
 * Initializes the listener for the team's watchlist in Firebase.
 */
export function initWatchlistListener() {
    if (!state.roomRef || !state.myTeamName) return;
    
    watchlistRef = state.roomRef.child('teams_auth/' + state.myTeamName + '/watchlist');
    watchlistRef.on('value', snap => {
        let arr = snap.val();
        watchlist = new Set(Array.isArray(arr) ? arr : []);
        
        // Dispatch an event so main.js knows to re-render the deck
        window.dispatchEvent(new Event('watchlistUpdated'));
    });
}

/**
 * Toggles a player's starred status and updates Firebase.
 */
export function toggleWatch(playerName) {
    if (watchlist.has(playerName)) {
        watchlist.delete(playerName);
    } else {
        watchlist.add(playerName);
    }
    if (watchlistRef) {
        watchlistRef.set([...watchlist]);
    }
    window.dispatchEvent(new Event('watchlistUpdated'));
}

// Attach to window for inline onclick attributes
window.toggleWatch = toggleWatch;