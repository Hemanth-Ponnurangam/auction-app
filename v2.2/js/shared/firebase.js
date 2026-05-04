// Initialize Firebase only if it hasn't been initialized yet
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig); 
}

export const db = firebase.database();

// --- NEW: Centralized Server Time ---
let serverOffset = 0;
db.ref('.info/serverTimeOffset').on('value', snap => {
    serverOffset = snap.val() || 0;
});

// Use this instead of Date.now() across the app
export function getCurrentServerTime() {
    return Date.now() + serverOffset;
}
