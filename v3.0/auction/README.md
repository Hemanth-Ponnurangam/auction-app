# 🏏 Cricket HQ — Auction Platform Setup Guide

---

## ⚠️ CRITICAL: You MUST serve these files over HTTP

**Do NOT open HTML files by double-clicking them.** That opens them as `file://` URLs,
which blocks ES module scripts (the core JavaScript) from loading. All buttons will appear
to work visually but do nothing.

### How to run locally

**Option A — VS Code (easiest)**
1. Install the [Live Server extension](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer)
2. Right-click `index.html` → **Open with Live Server**

**Option B — Node.js**
```bash
npx serve .
# or
npx http-server .
```

**Option C — Python**
```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

**Option D — Deploy to Firebase Hosting / Netlify / GitHub Pages** (recommended for live events)

---

## 🔥 Firebase Setup

### Step 1 — Paste your config
Edit `firebase-config.js` (in the `auction/` folder) and paste your Firebase project config.

### Step 2 — Set Security Rules
In **Firebase Console → Realtime Database → Rules**, paste exactly:

```json
{
  "rules": {
    "super_admin_pin":   { ".read": true,  ".write": false },
    "preset_databases":  { ".read": true,  ".write": false },
    "global_teams":      { ".read": true,  ".write": false },
    "global_leagues":    { ".read": true,  ".write": false },
    "global_nat_flags":  { ".read": true,  ".write": false },
    "global_nat_boards": { ".read": true,  ".write": false },
    "global_role_icons": { ".read": true,  ".write": false },
    "platform_settings": { ".read": false, ".write": false },
    "rooms": {
      "$roomId": { ".read": true, ".write": true }
    }
  }
}
```

> **Why?** Without `super_admin_pin` being readable, Admin login always fails even if the PIN is set.  
> Without `preset_databases` being readable, Auctioneer cannot load preset player pools.

### Step 3 — Set the Super Admin PIN
In **Firebase Console → Realtime Database → Data**, add at the root level:

```
super_admin_pin: "1234"   ← replace with your chosen PIN
```

---

## 🖥️ Portal Access

| Portal | URL | Who uses it |
|---|---|---|
| Home | `index.html` | Everyone — pick a module |
| Auction Hub | `auction/index.html` | Auctioneer, Franchise, Admin |
| Auctioneer | `auction/auction/auctioneer.html` | The person running the auction |
| Franchise | `auction/auction/franchise.html` | Team owners placing bids |
| Admin Console | `auction/admin.html` | Super admin managing teams, databases, rooms |

---

## 🔐 Login Flow

### Admin Console
1. Enter your **Super Admin PIN** (set in Firebase as `super_admin_pin`)
2. You're in — manage global teams, player databases, rooms

### Auctioneer
1. **Create New Room** — enter a room name, 4-digit PIN, starting purse, and select a player database
2. Share the **4-digit PIN** with franchise owners
3. **Join Existing Room** — re-enter using your room PIN if you refresh or reconnect

### Franchise
1. Enter the **4-digit Room PIN** (get from auctioneer)
2. Select your franchise from the list (or create a custom team)
3. Enter your **representative name** and **4-digit team PIN**

---

## 🐛 Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Buttons do nothing, no errors visible | Files opened as `file://` | Use a local HTTP server (see above) |
| Admin: "Admin PIN is not set" | `super_admin_pin` not in Firebase DB | Add it in Firebase Console → Data |
| Admin: "Permission denied" | Firebase rules missing `super_admin_pin` | Update rules (see Step 2 above) |
| Franchise: blank team grid | `global_teams` not configured | Add teams via Admin Console first |
| Auctioneer: no preset databases | `preset_databases` rules block reads | Update rules (see Step 2 above) |
| Franchise can't enter room | Room doesn't exist yet | Auctioneer must create a room first |
