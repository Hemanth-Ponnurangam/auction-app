// js/shared/state.js

export const CONSTANTS = {
    CRORE: 10000000,
    LAKH: 100000,
    ARC_CIRCUMFERENCE: 283,
};

// Real IPL Bid Brackets Logic
export function getNextBidAmount(currentBidAmount) {
    const bidInLakhs = currentBidAmount / CONSTANTS.LAKH;
    if (bidInLakhs < 100) {
        return currentBidAmount + (5 * CONSTANTS.LAKH);
    } else if (bidInLakhs < 200) {
        return currentBidAmount + (10 * CONSTANTS.LAKH);
    } else {
        return currentBidAmount + (20 * CONSTANTS.LAKH);
    }
}

// ---------------------------------------------------------------------------
// Shared mutable state — imported by every module as a live reference.
// Never replace the object itself; always mutate properties so all modules
// see the same updated values.
// ---------------------------------------------------------------------------
export const state = {
    // Room
    roomKey: null,
    roomRef: null,

    // Franchise identity (franchise portal only)
    myTeamName: null,
    myRepName: null,
    myTeamColor: null,

    // Live data
    playerPool: [],
    allRegisteredTeams: {},
    activePresence: {},
    liveState: {
        auction_state: 'idle',
        current_bid: 0,
        highest_bidder: '-',
        timer_end: 0,
        current_player_index: -1,
        last_sold_index: -1,
        bid_stack: null,
    },

    // Config
    settings: {
        starting_purse: 90,
        bid_timer_secs: 15,
        cooldown_secs: 10,
        overseas_limit_enabled: true,
    },

    // Derived
    teamBudgets: {},
    globalImageMap: {},
};

/**
 * Called after a room key is verified / created.
 */
export function setRoomState(key, ref) {
    state.roomKey = key;
    state.roomRef  = ref;
}

/**
 * Called after franchise login is confirmed.
 */
export function setMyTeamState(name, rep, color) {
    state.myTeamName  = name;
    state.myRepName   = rep;
    state.myTeamColor = color || '#007bff';
}

/**
 * Re-computes each team's remaining purse from the player pool.
 * Call whenever allRegisteredTeams, playerPool, or settings change.
 */
export function recalculateBudgets() {
    const startingPurse = (state.settings.starting_purse || 90) * CONSTANTS.CRORE;
    Object.keys(state.allRegisteredTeams).forEach(team => {
        const spent = state.playerPool
            .filter(p => p.status === 'sold' && p.team === team)
            .reduce((sum, p) => sum + (p.sold_price || 0), 0);
        state.teamBudgets[team] = startingPurse - spent;
    });
}
