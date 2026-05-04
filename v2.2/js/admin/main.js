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
