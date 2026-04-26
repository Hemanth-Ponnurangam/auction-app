/**
 * auth.js
 * Handles all authentication and PIN verification across the platform.
 */

import { db } from './firebase.js';
import { state, setRoomState, setMyTeamState } from './state.js';
import { showAlert } from './dom.js';

/**
 * Verifies the 4-digit room key for Franchises and Auctioneers.
 * @param {string} key - The 4-digit room PIN.
 * @returns {Promise<boolean>} - Resolves true if valid, false otherwise.
 */
export function verifyRoomKey(key) {
    if (!key) {
        showAlert('Missing PIN', 'Enter the Room PIN.');
        return Promise.resolve(false);
    }
    
    return db.ref('rooms/' + key).once('value').then(snap => {
        if (snap.exists()) {
            sessionStorage.setItem('roomKey', key);
            setRoomState(key, db.ref('rooms/' + key));
            return true;
        } else {
            showAlert('Invalid Key', 'Room not found. Check the PIN with your auctioneer.');
            return false;
        }
    });
}

/**
 * Handles franchise team login or registration.
 */
export function submitTeamAuth(finalCode, pin, finalColor, repName) {
    if (!repName || !pin || !finalCode) { 
        showAlert('Missing Fields', 'Fill in your Name, Code, and PIN.'); 
        return Promise.resolve(false); 
    }
    if (pin.length < 4) { 
        showAlert('Short PIN', 'PIN must be at least 4 digits.'); 
        return Promise.resolve(false); 
    }

    return state.roomRef.child('teams_auth/' + finalCode).once('value').then(snap => {
        let existing = snap.val();
        if (existing) {
            if (existing.pin === pin) {
                _saveLocalTeamState(finalCode, existing.color, existing.repName);
                return true;
            } else {
                showAlert('Wrong PIN', `${finalCode} is already claimed. Incorrect PIN.`);
                return false;
            }
        } else {
            // Register new team
            return state.roomRef.child('teams_auth/' + finalCode).set({
                repName: repName, 
                pin: pin, 
                color: finalColor,
                playingXI: [], 
                bench: [], 
                playerRoles: {}
            }).then(() => {
                _saveLocalTeamState(finalCode, finalColor, repName);
                return true;
            });
        }
    });
}

function _saveLocalTeamState(code, color, rep) {
    sessionStorage.setItem('myAuctionTeam', code);
    sessionStorage.setItem('myRepName', rep);
    sessionStorage.setItem('myTeamColor', color);
    setMyTeamState(code, rep, color);
}

/**
 * Verifies the Super Admin PIN for the Admin portal.
 */
export function verifySuperAdmin(enteredPin) {
    if (!enteredPin) { 
        showAlert('Missing PIN', 'Please enter the Admin PIN.'); 
        return Promise.resolve(false); 
    }
    
    return db.ref('platform_settings/admin_pin').once('value').then(snap => {
        let stored = snap.val();
        if (!stored) {
            showAlert('Not Configured', 'No Admin PIN set in Firebase. Set platform_settings -> admin_pin');
            return false;
        }
        if (enteredPin === String(stored)) {
            return true;
        } else {
            showAlert('Access Denied', 'Incorrect PIN.');
            return false;
        }
    }).catch(() => {
        showAlert('Read Error', 'Cannot read platform_settings. Check Firebase Rules.');
        return false;
    });
}