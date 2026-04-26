/**
 * main.js (Admin)
 * The main controller for the Super Admin platform console.
 */

import { db } from '../shared/firebase.js';
import { verifySuperAdmin } from '../shared/auth.js';
import { esc, showAlert, showConfirm } from '../shared/dom.js';
import { uploadPresetDB } from './csv.js';

let isSuperAdmin = false;

window.onload = function() {
    let savedPin = sessionStorage.getItem('superAdminPin');
    if (savedPin) {
        verifySuperAdmin(savedPin).then(valid => {
            if (valid) {
                isSuperAdmin = true;
                executeAdminBoot();
            } else {
                document.getElementById('loginScreen').style.display = 'flex';
            }
        });
    } else {
        document.getElementById('loginScreen').style.display = 'flex';
    }
};

window.handleAdminLogin = () => {
    let pin = document.getElementById('adminPinInput').value.trim();
    verifySuperAdmin(pin).then(valid => {
        if (valid) {
            sessionStorage.setItem('superAdminPin', pin);
            isSuperAdmin = true;
            document.getElementById('loginScreen').style.display = 'none';
            executeAdminBoot();
        }
    });
};

window.logoutAdmin = () => {
    sessionStorage.removeItem('superAdminPin');
    window.location.reload();
};

function executeAdminBoot() {
    document.getElementById('mainDashboard').style.display = 'flex';
    attachFirebaseListeners();
}

// --- Firebase Listeners ---

function attachFirebaseListeners() {
    // Connection state
    db.ref('.info/connected').on('value', snap => {
        document.getElementById('connBanner').style.display = !snap.val() ? 'block' : 'none';
    });

    // Global Teams
    db.ref('global_teams').on('value', snap => {
        renderGlobalTeams(snap.val() || {});
    });

    // Preset Databases
    db.ref('preset_databases').on('value', snap => {
        renderPresetDBs(snap.val() || {});
    });
}

// --- Global Teams Management ---

window.openAddTeamModal = () => {
    document.getElementById('addTeamModal').style.display = 'flex';
};

window.closeAddTeamModal = () => {
    document.getElementById('addTeamModal').style.display = 'none';
    document.getElementById('ntCode').value = '';
    document.getElementById('ntName').value = '';
};

window.saveNewTeam = () => {
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
};

window.confirmDeleteTeam = (code) => {
    showConfirm('Remove Franchise', `Are you sure you want to completely remove ${code} from the global platform?`, 
        () => {
            db.ref('global_teams/' + code).remove();
        }
    );
};

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
            <button class="action-btn outline" style="padding:4px 8px; font-size:10px; margin-top:5px;"
                    onclick="confirmDeleteTeam('${esc(code)}')">Remove</button>
        </div>`;
    });
    el.innerHTML = html;
}

// --- Preset Database UI ---

window.submitPresetUpload = () => {
    let dbName = document.getElementById('dbNameInput').value.trim();
    let fileInput = document.getElementById('csvFileInput');
    uploadPresetDB(dbName, fileInput.files.length ? fileInput.files[0] : null);
};

window.deletePresetDB = (dbKey) => {
    showConfirm('Delete Database', `Permanently delete the preset '${dbKey}'?`, () => {
        db.ref('preset_databases/' + dbKey).remove();
    });
};

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
            <button class="action-btn danger" style="padding:4px 8px; font-size:10px;" onclick="deletePresetDB('${esc(key)}')">Delete</button>
        </div>`;
    });
    el.innerHTML = html;
}

// --- Tab Switching ---

window.switchAdminTab = (tabName, el) => {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    let target = document.getElementById(`tab-${tabName}`);
    if (target) target.classList.add('active');
    if (el) el.classList.add('active');
};