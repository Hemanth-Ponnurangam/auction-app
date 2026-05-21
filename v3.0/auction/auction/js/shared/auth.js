import { db } from './firebase.js';
import { state, setRoomState, setMyTeamState } from './state.js';
import { showAlert } from './dom.js';

export function verifyRoomKey(key) {
    return db.ref('rooms/' + key).once('value').then(snap => {
        if (snap.exists()) {
            sessionStorage.setItem('roomKey', key);
            setRoomState(key, db.ref('rooms/' + key));
            return true;
        } else {
            showAlert('Not Found', 'Invalid Room Key! Make sure the auctioneer has created a room first.');
            return false;
        }
    }).catch(err => {
        if (err.code === 'PERMISSION_DENIED') {
            showAlert('Firebase Rules Error',
                'Cannot read rooms — permission denied.\n\n' +
                'In Firebase Console → Realtime Database → Rules, ensure:\n' +
                '  "rooms": { "$roomId": { ".read": true, ".write": true } }');
        } else {
            showAlert('Connection Error', 'Could not reach Firebase: ' + err.message);
        }
        return false;
    });
}

export function submitTeamAuth(code, pin, color, repName) {
    if (!state.roomRef) return Promise.resolve(false);
    if (!code || !pin || !repName) {
        showAlert('Missing Info', 'Please fill in all fields.');
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        state.roomRef.child('teams_auth/' + code).transaction(existing => {
            if (existing === null) {
                // Slot is free — claim it atomically
                return { pin, color, repName, playingXI: [], bench: [], playerRoles: {} };
            }
            if (existing.pin !== pin) {
                // Wrong PIN — abort the transaction by returning undefined
                return undefined;
            }
            // Correct PIN on an existing registration — no data change needed
            return existing;
        }, (err, committed, snap) => {
            if (err) {
                showAlert('Error', 'Connection error. Please try again.');
                return resolve(false);
            }

            const data = snap.val();

            // Transaction aborted = PIN mismatch on an existing team
            if (!committed && data !== null) {
                showAlert('Access Denied', 'Incorrect PIN for this franchise.');
                return resolve(false);
            }

            sessionStorage.setItem('myAuctionTeam', code);
            sessionStorage.setItem('myRepName', repName);
            sessionStorage.setItem('myTeamColor', color);
            setMyTeamState(code, repName, color);
            resolve(true);
        });
    });
}

export function verifySuperAdmin(pin) {
    return db.ref('super_admin_pin').once('value').then(snap => {
        let correct = snap.val();
        if (!correct) {
            showAlert('Configuration Error',
                'Admin PIN is not set in the database.\n\n' +
                'Fix: In Firebase Console → Realtime Database → Data, add a field:\n' +
                '  super_admin_pin: "your4digitpin"\n\n' +
                'Also ensure your Firebase Security Rules include:\n' +
                '  "super_admin_pin": { ".read": true, ".write": false }');
            return false;
        }
        if (pin === correct) return true;
        showAlert('Access Denied', 'Incorrect Super Admin PIN.');
        return false;
    }).catch(err => {
        if (err.code === 'PERMISSION_DENIED') {
            showAlert('Firebase Rules Error',
                'Cannot read super_admin_pin — permission denied.\n\n' +
                'In Firebase Console → Realtime Database → Rules, add:\n' +
                '  "super_admin_pin": { ".read": true, ".write": false }');
        } else {
            showAlert('Connection Error', 'Could not reach Firebase: ' + err.message);
        }
        return false;
    });
}
