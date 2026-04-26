import { db } from './firebase.js';

export const state = {
    roomKey: '', roomRef: null,
    myTeamName: '', myRepName: '', myTeamColor: '',
    settings: {}, playerPool: [], allRegisteredTeams: {}, activePresence: {},
    liveState: { auction_state: 'idle', current_bid: 0, highest_bidder: '-', current_player_index: -1, timer_end: 0 },
    teamBudgets: {}, globalImageMap: {}
};

export function setRoomState(key, ref) { state.roomKey = key; state.roomRef = ref; }
export function setMyTeamState(team, rep, color) { state.myTeamName = team; state.myRepName = rep; state.myTeamColor = color; }

const CRORE = 10_000_000;

export function recalculateBudgets() {
    let startingPurseCr = state.settings.starting_purse || 100;
    let startPurse = startingPurseCr * CRORE;
    let spents = {};
    Object.keys(state.allRegisteredTeams).forEach(t => spents[t] = 0);
    
    state.playerPool.forEach(p => {
        if (p && p.status === 'sold' && p.team) {
            if (spents[p.team] === undefined) spents[p.team] = 0;
            spents[p.team] += (p.sold_price || 0);
        }
    });
    
    Object.keys(state.allRegisteredTeams).forEach(t => {
        state.teamBudgets[t] = startPurse - (spents[t] || 0);
    });
}
