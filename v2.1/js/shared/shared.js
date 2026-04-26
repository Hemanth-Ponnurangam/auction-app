/**
 * js/shared/state.js
 * * The Single Source of Truth for the application.
 * All modules will read and write to this shared object to prevent global variable pollution.
 */

export const state = {
    // Authentication & Room
    roomKey: sessionStorage.getItem('roomKey') || '',
    roomRef: null, // Will hold the active db.ref('rooms/' + roomKey)
    myTeamName: sessionStorage.getItem('myAuctionTeam') || '',
    myRepName: sessionStorage.getItem('myRepName') || '',
    myTeamColor: sessionStorage.getItem('myTeamColor') || '#fff',

    // Core Data
    playerPool: [],
    allRegisteredTeams: {},
    activePresence: {},
    teamBudgets: {},
    globalImageMap: {},
    
    // Live Auction Status
    liveState: {
        auction_state: 'idle',
        current_bid: 0,
        highest_bidder: '-',
        current_player_index: -1,
        last_sold_index: -1,
        timer_end: 0,
        bid_stack: []
    },

    // Room Settings (Default fallbacks)
    settings: {
        starting_purse: 100, // In Crores
        overseas_limit_enabled: true,
        max_overseas: 8,
        min_squad: 18,
        max_squad: 25,
        bid_timer_secs: 15,
        cooldown_secs: 10,
        inc_base: 20, // Lakhs
        inc_mid: 50,
        inc_high: 100,
        limit_mid: 2, // Crores
        limit_high: 5
    }
};

// --- State Mutation Helpers ---

/**
 * Safely updates the room key and reference.
 */
export function setRoomState(key, ref) {
    state.roomKey = key;
    state.roomRef = ref;
}

/**
 * Safely updates the logged-in team details.
 */
export function setMyTeamState(name, rep, color) {
    state.myTeamName = name;
    state.myRepName = rep;
    state.myTeamColor = color;
}

/**
 * Recalculates remaining budgets for all teams based on sold players.
 * (Imported by Firebase listener files whenever the player pool updates).
 */
export function recalculateBudgets() {
    const CRORE = 10_000_000;
    const teamBudgetBase = state.settings.starting_purse * CRORE;

    Object.keys(state.allRegisteredTeams).forEach(team => { 
        state.teamBudgets[team] = teamBudgetBase; 
    });

    state.playerPool.forEach(p => {
        if (p.status === 'sold' && p.team && state.teamBudgets[p.team] !== undefined) {
            state.teamBudgets[p.team] -= (Number(p.sold_price) || 0);
        }
    });
}