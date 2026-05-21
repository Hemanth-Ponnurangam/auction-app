/**
 * firebase-config.js
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 1 — Paste your Firebase config below.
 * STEP 2 — Apply these Security Rules in the Firebase Console → Realtime DB → Rules:
 *
 * {
 *   "rules": {
 *     "super_admin_pin":      { ".read": true,  ".write": false },
 *     "preset_databases":     { ".read": true,  ".write": true  },
 *     "global_teams":         { ".read": true,  ".write": true  },
 *     "global_leagues":       { ".read": true,  ".write": true  },
 *     "global_nat_flags":     { ".read": true,  ".write": true  },
 *     "global_nat_boards":    { ".read": true,  ".write": true  },
 *     "global_role_icons":    { ".read": true,  ".write": true  },
 *     "global_player_images": { ".read": true,  ".write": true  },
 *     "platform_settings":    { ".read": false, ".write": false },
 *     "rooms":                { ".read": true,  ".write": true  }
 *   }
 * }
 *
 * CRITICAL FIXES vs older versions:
 *  - global_player_images MUST be present — omitting it causes the Image
 *    Directory to silently show "No images mapped yet" even when data exists.
 *  - rooms needs ".read": true at the PARENT level so the admin can list
 *    all rooms at once (db.ref('rooms').on('value', ...)). Using only
 *    $roomId rules blocks the parent-level read, leaving Live Servers blank.
 *  - All global_* paths need ".write": true so the admin console can upload
 *    flags, boards, role icons, teams, databases, and player images.
 *
 * IMPORTANT: super_admin_pin must be readable — otherwise Admin login always
 * fails with "Admin PIN is not set in the database." even when it IS set.
 * preset_databases must be readable — otherwise Auctioneer cannot load
 * preset player pools when creating a room.
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

// ── Initialize Firebase (once, shared by all pages) ───────────────────────
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// ── Shared Game Constants ──────────────────────────────────────────────────
const CRORE         = 10_000_000;   // ₹1 Crore in rupees
const BID_INCREMENT = 2_000_000;    // Standard bid step (₹20 Lakh)
