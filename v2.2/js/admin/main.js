/**
 * main.js (Admin)
 * The main controller for the Super Admin platform console.
 */

import { db } from '../shared/firebase.js';
import { verifySuperAdmin } from '../shared/auth.js';
import { esc, showAlert, showConfirm } from '../shared/dom.js';

let isSuperAdmin = false;

window.onload = function() {
    setupEventListeners();
    
    let savedPin = sessionStorage.getItem('superAdminPin');
    if (savedPin) {
        verifySuperAdmin(savedPin).then(valid => {
            if (valid) {
                isSuperAdmin = true;
                executeAdminBoot();
            } else {
                document.getElementById('adminLoginScreen').style.display = 'flex';
            }
        });
    } else {
        document.getElementById('adminLoginScreen').style.display = 'flex';
    }
};

// --- Centralized Event Listeners ---
function setupEventListeners() {
    // Login Screen
    document.getElementById('btnAdminLogin')?.addEventListener('click', handleAdminLogin);
    document.getElementById('adminPinInput')?.addEventListener('keypress', e => {
        if(e.key === 'Enter') handleAdminLogin();
    });
    document.getElementById('btnAdminBack')?.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
    
    // Header
    document.getElementById('btnLogoutAdmin')?.addEventListener('click', logoutAdmin);
    
    // Modals - Global Teams
    document.getElementById('btnOpenAddTeamModal')?.addEventListener('click', openAddTeamModal);
    document.getElementById('btnSubmitAddTeam')?.addEventListener('click', saveNewTeam);
    document.getElementById('btnCloseAddTeam')?.addEventListener('click', closeAddTeamModal);
    
    // Modals - Database Upload
    document.getElementById('btnOpenUploadModal')?.addEventListener('click', () => {
        document.getElementById('uploadModal').style.display = 'flex';
    });
    document.getElementById('btnSubmitDbUpload')?.addEventListener('click', submitPresetUpload);
    document.getElementById('btnCloseDbUpload')?.addEventListener('click', () => {
        document.getElementById('uploadModal').style.display = 'none';
    });

    // Modals - Image Upload
    document.getElementById('btnOpenImgModal')?.addEventListener('click', () => {
        document.getElementById('uploadImageCsvModal').style.display = 'flex';
    });
    document.getElementById('btnCloseImgModal')?.addEventListener('click', () => {
        document.getElementById('uploadImageCsvModal').style.display = 'none';
    });
    
    // Tab Switching (Bulletproof Data-Attribute Method)
    document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let tabId = e.currentTarget.dataset.tab;
            switchAdminTab(tabId, e.currentTarget);
        });
    });

    // Event Delegation for dynamic "Delete" buttons (Fixes XSS Vulnerability)
    document.getElementById('globalTeamsList')?.addEventListener('click', e => {
        if (e.target.classList.contains('delete-team-btn')) {
            confirmDeleteTeam(e.target.dataset.team);
        }
    });

    document.getElementById('presetDbList')?.addEventListener('click', e => {
        if (e.target.classList.contains('delete-db-btn')) {
            deletePresetDB(e.target.dataset.key);
        }
    });

    // Add these inside setupEventListeners()

    // 1. Process the Image CSV Upload
    document.querySelector('#uploadImageCsvModal .action-btn:not(.outline)').addEventListener('click', processImageCsvUpload);

    // 2. Delegate the Delete Image buttons
    document.getElementById('imgTableBody')?.addEventListener('click', e => {
        if (e.target.classList.contains('delete-img-btn')) {
            deletePlayerImage(e.target.dataset.name);
        }
    });

    // 3. Image Search Bar Filtering
    document.getElementById('adminImgSearch')?.addEventListener('input', e => {
        let term = e.target.value.toLowerCase();
        document.querySelectorAll('#imgTableBody tr').forEach(row => {
            if (row.cells.length > 1) { // Ignore the "no images" placeholder row
                let name = row.cells[1].textContent.toLowerCase();
                row.style.display = name.includes(term) ? '' : 'none';
            }
        });
    });
}

// --- Auth & Boot ---

function handleAdminLogin() {
    const pin = document.getElementById('adminPinInput').value.trim();
    if (!pin) {
        showAlert("Error", "Please enter a PIN.");
        return;
    }

    verifySuperAdmin(pin).then(isValid => {
        if (isValid) {
            sessionStorage.setItem('superAdminPin', pin);
            isSuperAdmin = true;
            document.getElementById('adminLoginScreen').style.display = 'none';
            executeAdminBoot();
        } else {
            document.getElementById('adminPinInput').value = '';
        }
    });
}

function logoutAdmin() {
    sessionStorage.removeItem('superAdminPin');
    window.location.reload();
}

function executeAdminBoot() {
    document.getElementById('masterDashboard').style.display = 'flex';
    attachFirebaseListeners();
}

// --- Firebase Listeners ---

function attachFirebaseListeners() {
    db.ref('.info/connected').on('value', snap => {
        document.getElementById('connBanner').style.display = !snap.val() ? 'block' : 'none';
    });

    db.ref('global_teams').on('value', snap => {
        renderGlobalTeams(snap.val() || {});
    });

    db.ref('preset_databases').on('value', snap => {
        renderPresetDBs(snap.val() || {});
    });

    // Add this inside attachFirebaseListeners()
    db.ref('global_player_images').on('value', snap => {
        renderGlobalImages(snap.val() || {});
    });

    // Add this inside attachFirebaseListeners()
    db.ref('rooms').on('value', snap => {
        renderActiveRooms(snap.val() || {});
    });
    
}

// --- Global Teams Management ---

function openAddTeamModal() {
    document.getElementById('addTeamModal').style.display = 'flex';
}

function closeAddTeamModal() {
    document.getElementById('addTeamModal').style.display = 'none';
    document.getElementById('ntCode').value = '';
    document.getElementById('ntName').value = '';
}

function saveNewTeam() {
    let code = document.getElementById('ntCode').value.trim().toUpperCase();
    let name = document.getElementById('ntName').value.trim();
    let color = document.getElementById('ntColor').value;
    
    if (!code || !name) { 
        showAlert('Missing Fields', 'Provide Team Code and Name.'); 
        return; 
    }
    
    db.ref('global_teams/' + code).set({ name, color }).then(() => {
        closeAddTeamModal();
    });
}

function confirmDeleteTeam(code) {
    showConfirm('Remove Franchise', `Are you sure you want to completely remove ${code} from the global platform?`, 
        () => {
            db.ref('global_teams/' + code).remove();
        }
    );
}

function renderGlobalTeams(teams) {
    let el = document.getElementById('globalTeamsList');
    if (!el) return;
    
    let keys = Object.keys(teams);
    if (!keys.length) { 
        el.innerHTML = "<p style='color:#666; font-size:12px; text-align:center;'>No franchises found. Add one above.</p>"; 
        return; 
    }
    
    let html = '';
    keys.forEach(code => {
        let t = teams[code];
        html += `
        <div class="team-card" style="border-top:4px solid ${t.color};">
            <div class="t-code" style="color:${t.color}">${esc(code)}</div>
            <div class="t-name">${esc(t.name)}</div>
            <button class="action-btn outline delete-team-btn" style="padding:4px 8px; font-size:10px; margin-top:5px;" data-team="${esc(code)}">Remove</button>
        </div>`;
    });
    el.innerHTML = html;
}

// --- Preset Database UI ---

function submitPresetUpload() {
    let dbName = document.getElementById('dbNameInput').value.trim();
    let fileInput = document.getElementById('csvFileInput');
    
    // NOTE: Requires uploadPresetDB to be correctly exported from csv.js in the future.
    if (typeof uploadPresetDB === 'function') {
        uploadPresetDB(dbName, fileInput.files.length ? fileInput.files[0] : null);
    } else {
        showAlert('Coming Soon', 'CSV Upload module is not fully implemented yet.');
    }
}

function deletePresetDB(dbKey) {
    showConfirm('Delete Database', `Permanently delete the preset '${dbKey}'?`, () => {
        db.ref('preset_databases/' + dbKey).remove();
    });
}

function renderPresetDBs(dbs) {
    let el = document.getElementById('presetDbList');
    if (!el) return;
    
    let keys = Object.keys(dbs);
    if (!keys.length) {
        el.innerHTML = "<p style='color:#666; font-size:12px;'>No databases uploaded yet.</p>";
        return;
    }

    let html = '';
    keys.forEach(key => {
        let count = dbs[key].length || 0;
        html += `
        <div style="background:#111; border:1px solid #333; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="color:#ffc107; font-weight:bold; font-size:14px; text-transform:uppercase;">${esc(key)}</div>
                <div style="color:#888; font-size:10px;">${count} Players</div>
            </div>
            <button class="action-btn danger delete-db-btn" style="padding:4px 8px; font-size:10px;" data-key="${esc(key)}">Delete</button>
        </div>`;
    });
    el.innerHTML = html;
}

// Tab Switching (Bulletproof Inline Version)
    document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let tabId = e.currentTarget.dataset.tab;
            
            // 1. Hide all tab content panels
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            // 2. Remove the yellow highlight from all tab buttons
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            
            // 3. Show the targeted content panel
            let target = document.getElementById(`tab-${tabId}`);
            if (target) target.classList.add('active');
            
            // 4. Add the yellow highlight to the clicked button
            e.currentTarget.classList.add('active');
        });
    });

// ==========================================
// IMAGE DIRECTORY LOGIC
// ==========================================

function processImageCsvUpload() {
    let fileInput = document.getElementById('uploadImageFile');
    if (!fileInput.files.length) {
        showAlert('Missing File', 'Please select a CSV file first.');
        return;
    }

    let reader = new FileReader();
    reader.onload = e => {
        let text = e.target.result;
        let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        let updates = {};
        let count = 0;
        
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            let cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length >= 2) {
                let name = cols[0].replace(/^"|"$/g, '').trim();
                let url = cols[1].replace(/^"|"$/g, '').trim();
                if (name && url) {
                    // Firebase keys can't contain . # $ [ ] or /, so we sanitize the name key
                    let safeKey = name.replace(/[.#$\[\]\/]/g, '_');
                    updates[safeKey] = { url: url, originalName: name };
                    count++;
                }
            }
        }
        
        if (count > 0) {
            db.ref('global_player_images').update(updates).then(() => {
                showAlert('Success', `Successfully imported ${count} image mappings.`);
                document.getElementById('uploadImageCsvModal').style.display = 'none';
                fileInput.value = ''; // Reset input
            });
        } else {
            showAlert('Error', 'No valid rows found. Ensure CSV has Name and URL columns.');
        }
    };
    reader.readAsText(fileInput.files[0]);
}

function renderGlobalImages(images) {
    let tbody = document.getElementById('imgTableBody');
    if (!tbody) return;

    let keys = Object.keys(images);
    if (!keys.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#666; padding:20px;">No images mapped yet.</td></tr>';
        return;
    }

    let html = '';
    keys.forEach(key => {
        let imgData = images[key];
        // Handle both older string URLs and newer object formats {url: '', originalName: ''}
        let url = typeof imgData === 'string' ? imgData : imgData.url; 
        let displayName = imgData.originalName || key;
        
        let safeName = esc(displayName);
        let safeKey = esc(key);
        let safeUrl = esc(url);
        
        // Include a fallback onerror SVG just in case the link breaks
        html += `
        <tr>
            <td><img src="${safeUrl}" class="img-preview" alt="preview" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzMzMyIvPjwvc3ZnPg=='"></td>
            <td style="font-weight:bold; color:#fff;">${safeName}</td>
            <td style="color:#888; font-size:11px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeUrl}</td>
            <td>
                <button class="action-btn danger delete-img-btn" style="padding:4px 8px; font-size:10px;" data-name="${safeKey}">Remove</button>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

function deletePlayerImage(imageKey) {
    showConfirm('Remove Image', `Are you sure you want to delete this image mapping?`, () => {
        db.ref('global_player_images/' + imageKey).remove();
    });
}


// ==========================================
// LIVE SERVERS (ROOMS) LOGIC
// ==========================================
function renderActiveRooms(rooms) {
    let container = document.getElementById('roomsContainer');
    if (!container) return;

    let keys = Object.keys(rooms);
    if (!keys.length) {
        container.innerHTML = "<p style='color:#666; font-size:12px; grid-column:1/-1;'>No active auction rooms running.</p>";
        return;
    }

    let html = '';
    keys.forEach(key => {
        let room = rooms[key];
        let settings = room.settings || {};
        let live = room.live_state || {};
        let status = live.auction_state || 'idle';
        let currentBid = (live.current_bid || 0) / 10000000;
        let leader = live.highest_bidder || '-';

        // Using the CSS classes already defined in your admin.css
        html += `
        <div class="room-card">
            <div class="r-title">
                ${esc(settings.room_name || 'Unnamed Room')}
                <span class="r-pin">${esc(key)}</span>
            </div>
            <div class="r-stat"><span>Status</span><span style="color:${status==='bidding'?'#28a745':'#ffc107'}">${status.toUpperCase()}</span></div>
            <div class="r-stat"><span>Current Bid</span><span style="color:#28a745">₹${currentBid.toFixed(2)} Cr</span></div>
            <div class="r-stat"><span>Leader</span><span>${esc(leader)}</span></div>
            <button class="action-btn outline danger delete-room-btn" style="width:100%; margin-top:10px; font-size:11px;" data-room="${esc(key)}">Terminate Room</button>
        </div>`;
    });
    container.innerHTML = html;
}

function deleteAuctionRoom(roomKey) {
    showConfirm('Terminate Room', `Are you sure you want to permanently delete room PIN: ${roomKey}? This will kick all users.`, () => {
        db.ref('rooms/' + roomKey).remove();
    });
}

// ==========================================
// DATABASE MANAGER (UPDATED)
// ==========================================
// Replace your existing renderPresetDBs function with this updated one:
function renderPresetDBs(dbs) {
    let el = document.getElementById('presetDbList');
    let selector = document.getElementById('dbSelector'); // Grab the dropdown
    if (!el) return;
    
    let keys = Object.keys(dbs);
    if (!keys.length) {
        el.innerHTML = "<p style='color:#666; font-size:12px;'>No databases uploaded yet.</p>";
        if (selector) selector.innerHTML = '<option value="">No presets available</option>';
        return;
    }

    let html = '';
    let selHtml = '';
    
    keys.forEach(key => {
        let count = dbs[key].length || 0;
        
        // Build the dropdown options
        selHtml += `<option value="${esc(key)}">${esc(key).toUpperCase()} (${count} Players)</option>`;
        
        // Build the list below
        html += `
        <div style="background:#111; border:1px solid #333; padding:10px; border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="color:#ffc107; font-weight:bold; font-size:14px; text-transform:uppercase;">${esc(key)}</div>
                <div style="color:#888; font-size:10px;">${count} Players</div>
            </div>
            <button class="action-btn danger delete-db-btn" style="padding:4px 8px; font-size:10px;" data-key="${esc(key)}">Delete</button>
        </div>`;
    });
    
    el.innerHTML = html;
    if (selector) selector.innerHTML = selHtml; // Populate the dropdown
}
