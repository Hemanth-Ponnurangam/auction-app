// js/auctioneer/timer.js
import { database } from '../shared/firebase.js';

let serverOffset = 0;

// Sync client time with Firebase server time
database.ref('.info/serverTimeOffset').on('value', snap => {
    serverOffset = snap.val() || 0;
});

export function startTimer(durationSeconds) {
    const now = Date.now() + serverOffset;
    const endTime = now + (durationSeconds * 1000);
    
    database.ref('/auctionState/timer').set({
        endTime: endTime,
        isPaused: false
    });
}

// Global listen event for the timer display
database.ref('/auctionState/timer').on('value', snap => {
    const timerData = snap.val();
    if (!timerData) return;

    if (timerData.isPaused) return;

    const interval = setInterval(() => {
        const currentServerTime = Date.now() + serverOffset;
        const remaining = Math.max(0, timerData.endTime - currentServerTime);
        
        document.getElementById('timerDisplay').innerText = Math.ceil(remaining / 1000);
        
        if (remaining <= 0) clearInterval(interval);
    }, 100);
});