/**
 * main.js (Admin)
 * The main controller for the Super Admin platform console.
 */

import { db } from '../shared/firebase.js';
import { verifySuperAdmin } from '../shared/auth.js';
import { esc, showAlert, showConfirm } from '../shared/dom.js';
//import { uploadPresetDB } from './csv.js';

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
// Replaces all inline HTML onclick="" attributes
function setupEventListeners() {
    // Login Screen
    document.querySelector('#adminLoginScreen .submit-btn').addEventListener('click', handleAdminLogin);
    document.getElementById('adminPinInput').addEventListener('keypress', e => {
        if(e.key === 'Enter') handleAdminLogin();
    });
    
    // Header
    document.querySelector('.header .action-btn').addEventListener('click', logoutAdmin);
    
    // Modals - Global Teams
    const addTeamBtn = document.querySelector('#tab-franchises .action-btn');
    if (addTeamBtn) addTeamBtn.addEventListener('click', openAddTeamModal);
    
    document.querySelector('#addTeamModal .action-btn').addEventListener('click', saveNewTeam);
    document.querySelector('#addTeamModal .action-btn.outline').addEventListener('click', closeAddTeamModal);
    
    // Modals - Database Upload
    const uploadBtn = document.querySelector('#tab-databases .action-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', () => {
        document.getElementById('uploadModal').style.display = 'flex';
    });
    
    document.querySelector('#uploadModal .action-btn').addEventListener('click', submitPresetUpload);
    document.querySelector('#uploadModal .action-btn.outline').addEventListener('click', () => {
        document.getElementById('uploadModal').style.display = 'none';
    });

    // Modals - Image Upload
    const uploadImgBtn = document.querySelector('#tab-images .action-btn');
    if (uploadImgBtn) uploadImgBtn.addEventListener('click', () => {
        document.getElementById('uploadImageCsvModal').style.display = 'flex';
    });
    document.querySelector('#uploadImageCsvModal .action-btn.outline').addEventListener('click', () => {
        document.getElementById('uploadImageCsvModal').style.display = 'none';
    });
    
    // Tab Switching
    document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            let text = e.target.innerText;
            let tabId = text.includes('Database') ? 'databases' :
                        text.includes('Image') ? 'images' :
                        text.includes('Live') ? 'rooms' : 'franchises';
            switchAdminTab(tabId, e.target);
        });
    });

    // Event Delegation for dynamic "Delete" buttons (Fixes XSS Vulnerability)
    document.getElementById('globalTeamsList').addEventListener('click', e => {
        if (e.target.classList.contains('delete-team-btn')) {
            let code = e.target.dataset.team;
            confirmDeleteTeam(code);
        }
    });

    document.getElementById('presetDbList').addEventListener('click', e => {
        if (e.target.classList.contains('delete-db-btn')) {
            let key = e.target.dataset.key;
            deletePresetDB(key);
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
        // Note: Using data-team attribute instead of inline onclick for security
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
    uploadPresetDB(dbName, fileInput.files.length ? fileInput.files[0] : null);
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
        // Note: Using data-key attribute instead of inline onclick
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


// Tab Switching (Bulletproof Version)
    document.querySelectorAll('.tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // We use currentTarget to ignore emoji clicks, and toLowerCase to bypass CSS caps
            let text = e.currentTarget.textContent.toLowerCase();
            
            let tabId = text.includes('database') ? 'databases' :
                        text.includes('image') ? 'images' :
                        text.includes('live') ? 'rooms' : 'franchises';
                        
            switchAdminTab(tabId, e.currentTarget);
        });
    });
