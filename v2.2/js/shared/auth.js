import { db } from './firebase.js';
import { state, setRoomState } from './state.js';
import { showAlert } from './dom.js';

export function verifyRoomKey(key) {
    return db.ref('rooms/' + key).once('value').then(snap => {
        if (snap.exists()) {
            sessionStorage.setItem('roomKey', key);
            setRoomState(key, db.ref('rooms/' + key));
            return true;
        } else {
            showAlert('Not Found', 'Invalid Room Key!');
            return false;
        }
    });
}

export function submitTeamAuth(code, pin, color, repName) {
    if (!state.roomRef) return Promise.resolve(false);
    if (!code || !pin || !repName) {
        showAlert('Missing Info', 'Please fill in all fields.');
        return Promise.resolve(false);
    }
    
    return state.roomRef.child('teams_auth/' + code).once('value').then(snap => {
        let existing = snap.val();
        if (existing) {
            if (existing.pin !== pin) {
                showAlert('Access Denied', 'Incorrect PIN for this franchise.');
                return false;
            }
        } else {
            state.roomRef.child('teams_auth/' + code).set({ pin, color, repName, playingXI: [], bench: [], playerRoles: {} });
        }
        sessionStorage.setItem('myAuctionTeam', code);
        sessionStorage.setItem('myRepName', repName);
        sessionStorage.setItem('myTeamColor', color);
        
        // ADD THIS LINE to immediately update live state without refreshing
        setMyTeamState(code, repName, color); 
        
        return true;
    });
}

export function verifySuperAdmin(pin) {
    return db.ref('super_admin_pin').once('value').then(snap => {
        let correct = snap.val();
        
        // FIX: No fallback. Fail if not configured.
        if (!correct) {
            showAlert('Configuration Error', 'Admin PIN is not set in the database.');
            return false;
        }
        if (pin === correct) return true;
        
        showAlert('Access Denied', 'Incorrect Super Admin PIN.');
        return false;
    });
}
