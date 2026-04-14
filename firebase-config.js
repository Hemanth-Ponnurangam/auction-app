/**
 * firebase-config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Paste your Firebase config below.
 * STEP 2 — Apply these Security Rules in the Firebase Console → Realtime DB → Rules:
 *
 * {
 *   "rules": {
 *     "platform_settings": { ".read": false, ".write": false },
 *     "preset_databases":  { ".read": false, ".write": false },
 *     "global_teams":      { ".read": true,  ".write": false },
 *     "rooms": {
 *       "$roomId": { ".read": true, ".write": true }
 *     }
 *   }
 * }
 *
 * WARNING: Without Firebase Auth, any user who discovers a room PIN can write
 * to that room. This is acceptable for closed private events. For public use,
 * add Firebase Authentication and tighten the room rules.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyCjJaWjPwK57YDkhPMBLmadg8iaZj5C70A",
    authDomain: "auction-ea32b.firebaseapp.com",
    databaseURL: "https://auction-ea32b-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "auction-ea32b",
    storageBucket: "auction-ea32b.firebasestorage.app",
    messagingSenderId: "621695853292",
    appId: "1:621695853292:web:d6dcfe11ee1c7b4fea3bc9",
    measurementId: "G-31Z19QTDEX"
};

// ── Shared Game Constants ──────────────────────────────────────────────────
const CRORE         = 10_000_000;   // ₹1 Crore in rupees
const BID_INCREMENT = 2_000_000;    // Standard bid step (₹20 Lakh)
