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
  apiKey: "AIzaSyCuI1I49e6QairBH5Nzy6uRTvkIRP4B4pA",
  authDomain: "auction-465dc.firebaseapp.com",
  databaseURL: "https://auction-465dc-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "auction-465dc",
  storageBucket: "auction-465dc.firebasestorage.app",
  messagingSenderId: "903670398882",
  appId: "1:903670398882:web:09522c17419dee21d9fcfb",
  measurementId: "G-PNGMZN8PJR"
};

// ── Shared Game Constants ──────────────────────────────────────────────────
const CRORE         = 10_000_000;   // ₹1 Crore in rupees
const BID_INCREMENT = 2_000_000;    // Standard bid step (₹20 Lakh)





