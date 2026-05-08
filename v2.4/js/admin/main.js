/**
 * main.js (Admin)
 * The main controller for the Super Admin platform console.
 */

import { db } from '../shared/firebase.js';
import { verifySuperAdmin } from '../shared/auth.js';
import { esc, showAlert, showConfirm, showPrompt } from '../shared/dom.js';
import { parseVanillaCSV } from './csv.js';

let isSuperAdmin = false;
let activeDatabases = {};
let globalImages = {};
let globalTeams = {};
let activeRooms = {};

window.onload = function() {
    // 1. Inject Logo URL into Add Team Modal safely
    const colorInput = document.getElementById('ntColor');
    if (colorInput && !document.getElementById('ntLogo')) {
        const logoHtml = `<label class="modal-label" style="margin-top:15px;">Logo URL (Transparent PNG)</label>
                          <input type="text" id="ntLogo" class="modal-input" placeholder="https://.../logo.png">`;
        colorInput.insertAdjacentHTML('afterend', logoHtml);
    }

    // 2. Convert Image Directory table to Grid safely INSIDE the bordered box
    const imgTable = document.querySelector('.db-table');
    if (imgTable) {
        const parentDiv = imgTable.parentElement;
        imgTable.style.display = 'none'; // Hide old table
        if (!document.getElementById('imgCardGrid')) {
            const grid = document.createElement('div');
            grid.id = 'imgCardGrid';
            grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px; padding:15px;';
            parentDiv.appendChild(grid);
        }
    }

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

function setupEventListeners() {
    document.getElementById('btnAdminLogin')?.addEventListener('click', handleAdminLogin);
    document.getElementById('adminPinInput')?.addEventListener('keypress', e => { if(e.key === 'Enter') handleAdminLogin(); });
    document.getElementById('btnAdminBack')?.addEventListener('click', () => { window.location.href = 'index.html'; });
    document.getElementById('btnLogoutAdmin')?.addEventListener('click', logoutAdmin);
    
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', e => {
            const targetBtn = e.currentTarget; 
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            targetBtn.classList.add('active');
            let tabId = 'tab-' + targetBtn.getAttribute('data-tab');
            let tab = document.getElementById(tabId);
            if (tab) tab.classList.add('active');
        });
    });
    
    document.getElementById('btnOpenUploadModal')?.addEventListener('click', () => document.getElementById('uploadModal').style.display = 'flex');
    document.getElementById('btnOpenImgModal')?.addEventListener('click', () => document.getElementById('uploadImageCsvModal').style.display = 'flex');
    document.getElementById('btnOpenAddTeamModal')?.addEventListener('click', () => document.getElementById('addTeamModal').style.display = 'flex');
    
    document.getElementById('btnCloseDbUpload')?.addEventListener('click', () => document.getElementById('uploadModal').style.display = 'none');
    document.getElementById('btnCloseImgModal')?.addEventListener('click', () => document.getElementById('uploadImageCsvModal').style.display = 'none');
    document.getElementById('btnCloseAddTeam')?.addEventListener('click', closeAddTeamModal);
    
    document.getElementById('btnSubmitDbUpload')?.addEventListener('click', handleDatabaseUpload);
    document.getElementById('btnSubmitAddTeam')?.addEventListener('click', handleAddGlobalTeam);
    
    const addSingleImgBtn = document.querySelector('#tab-images .panel-header button.outline');
    if (addSingleImgBtn) addSingleImgBtn.addEventListener('click', openSingleImagePrompt);
    
    const btnImportImgMapping = document.querySelector('#uploadImageCsvModal .action-btn');
    if (btnImportImgMapping && btnImportImgMapping.textContent.includes('IMPORT')) {
        btnImportImgMapping.addEventListener('click', handleBulkImageImport);
    }
    
    document.getElementById('adminDbSearch')?.addEventListener('input', renderDatabaseManager);
    document.getElementById('adminImgSearch')?.addEventListener('input', renderImageCards);
}

// Bind Globals for HTML onclicks
window.handleAdminLogin = handleAdminLogin;
window.logoutAdmin = logoutAdmin;
window.handleDatabaseUpload = handleDatabaseUpload;
window.handleAddGlobalTeam = handleAddGlobalTeam;
window.handleBulkImageImport = handleBulkImageImport;
window.openSingleImagePrompt = openSingleImagePrompt;

function handleAdminLogin() {
    let pin = document.getElementById('adminPinInput').value.trim();
    if (!pin) return showAlert('Error', 'Please enter PIN');
    verifySuperAdmin(pin).then(valid => {
        if (valid) {
            sessionStorage.setItem('superAdminPin', pin);
            isSuperAdmin = true;
            executeAdminBoot();
        }
    });
}

function logoutAdmin() {
    sessionStorage.removeItem('superAdminPin');
    window.location.reload();
}

function executeAdminBoot() {
    document.getElementById('adminLoginScreen').style.display = 'none';
    let dash = document.getElementById('masterDashboard');
    if (dash) dash.style.display = 'flex';
    
    db.ref('presets').on('value', snap => {
        activeDatabases = snap.val() || {};
        updateDbDropdown();
        renderDatabaseManager();
    });
    
    db.ref('global_player_images').on('value', snap => {
        globalImages = snap.val() || {};
        renderImageCards();
    });
    
    db.ref('rooms').on('value', snap => {
        activeRooms = snap.val() || {};
        renderActiveRooms();
    });
    
    db.ref('global_teams').on('value', snap => {
        globalTeams = snap.val() || {};
        renderGlobalTeams();
    });
}

// ─ 1. Database Manager ──────────────────────────────────────────────
function updateDbDropdown() {
    let sel = document.getElementById('dbSelector');
    if (!sel) return;
    let prev = sel.value;
    sel.innerHTML = '<option value="">-- View All Presets --</option>';
    Object.keys(activeDatabases).forEach(k => { sel.innerHTML += `<option value="${esc(k)}">${esc(k)}</option>`; });
    if (prev && activeDatabases[prev]) sel.value = prev;
}

document.getElementById('dbSelector')?.addEventListener('change', renderDatabaseManager);

function renderDatabaseManager() {
    const list = document.getElementById('presetDbList');
    if (!list) return;
    list.innerHTML = '';
    
    let filterDb = document.getElementById('dbSelector')?.value || '';
    let filterText = document.getElementById('adminDbSearch')?.value.toLowerCase() || '';
    let dbKeys = filterDb ? [filterDb] : Object.keys(activeDatabases);

    let validDbs = 0;
    dbKeys.forEach(dbName => {
        let playersRaw = activeDatabases[dbName] || [];
        let players = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);
        const filteredPlayers = filterText ? players.filter(p => (p.name || '').toLowerCase().includes(filterText)) : players;

        if (filterText && filteredPlayers.length === 0) return;
        validDbs++;

        const dbCard = document.createElement('div');
        dbCard.style.cssText = 'background:#111; border:1px solid #333; border-radius:8px; margin-bottom:10px; overflow:hidden;';
        
        const header = document.createElement('div');
        header.style.cssText = 'padding:15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; background:#161620;';
        header.innerHTML = `
            <div>
                <strong style="color:#0dcaf0; font-size:16px;">${esc(dbName)}</strong>
                <span style="color:#888; font-size:11px; margin-left:10px;">${filteredPlayers.length} Players</span>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="action-btn" style="background:#28a745;" onclick="appendPlayersToDB(event, '${esc(dbName)}')">+ Add Players</button>
                <button class="action-btn danger outline" onclick="deleteDatabase(event, '${esc(dbName)}')">✕ Delete</button>
                <button class="action-btn outline" onclick="togglePlayerList(event, 'list-${esc(dbName)}')">▼ View</button>
            </div>
        `;
        
        const playerContainer = document.createElement('div');
        playerContainer.id = `list-${dbName}`;
        playerContainer.style.cssText = 'display:none; padding:10px; background:#0a0a0f; border-top:1px solid #222; max-height:300px; overflow-y:auto;';
        
        let pListHtml = filteredPlayers.map((p, i) => `
            <div style="display:flex; justify-content:space-between; padding:6px; border-bottom:1px solid #1a1a24; font-size:12px;">
                <span style="color:#ccc;">${i+1}. ${esc(p.name)}</span>
                <span style="color:#888;">${esc(p.role)} | ${esc(p.nationality)}</span>
            </div>
        `).join('');
        playerContainer.innerHTML = pListHtml;

        dbCard.appendChild(header);
        dbCard.appendChild(playerContainer);
        list.appendChild(dbCard);
    });

    if (validDbs === 0) {
        list.innerHTML = '<p style="color:#666; text-align:center; padding:20px;">No databases uploaded yet or no players matched your search.</p>';
    }
}

window.togglePlayerList = (e, targetId) => {
    e.stopPropagation();
    const container = document.getElementById(targetId);
    if (container.style.display === 'none') {
        container.style.display = 'block'; e.target.textContent = '▲ Hide';
    } else {
        container.style.display = 'none'; e.target.textContent = '▼ View';
    }
};

window.deleteDatabase = (e, dbName) => {
    e.stopPropagation();
    showConfirm('Delete Database', `Are you sure you want to permanently delete "${dbName}"?`, () => { db.ref(`presets/${dbName}`).remove(); });
};

window.appendPlayersToDB = (e, dbName) => {
    e.stopPropagation();
    showConfirm(`Append to ${dbName}`, 'Do you want to upload a CSV file or add names manually?', 
    () => {
        let input = document.createElement('input'); input.type = 'file'; input.accept = '.csv';
        input.onchange = ev => {
            let file = ev.target.files[0]; if (!file) return;
            let reader = new FileReader();
            reader.onload = fileEvent => {
                let rows = parseVanillaCSV(fileEvent.target.result);
                if (rows.length < 2) return showAlert('Error', 'CSV format error or empty file.');
                let headers = rows[0].map(h => h.toLowerCase().trim());
                let newPlayers = rows.slice(1).map(row => {
                    let p = { status: 'available' };
                    headers.forEach((h, i) => {
                        let val = row[i] ? row[i].trim() : '';
                        if (h === 'player' || h === 'name') p.name = val;
                        else if (h === 'base_price' || h === 'price') p.base_price = parseInt(val) || 0;
                        else p[h] = val;
                    });
                    return p;
                }).filter(p => p.name);
                
                const existing = activeDatabases[dbName] || [];
                db.ref(`presets/${dbName}`).set([...existing, ...newPlayers]).then(() => showAlert('Success', `Appended ${newPlayers.length} players to ${dbName} via CSV.`));
            };
            reader.readAsText(file);
        };
        input.click();
    },
    () => {
        setTimeout(() => {
            showPrompt('Manual Entry', 'Enter player names separated by commas (e.g. MS Dhoni, Virat Kohli):', '', (val) => {
                if (!val) return;
                const newNames = val.split(',').map(n => n.trim()).filter(Boolean);
                let existingRaw = activeDatabases[dbName] || [];
                const existing = Array.isArray(existingRaw) ? existingRaw : Object.values(existingRaw);
                const newPlayers = newNames.map(name => ({
                    name: name, base_price: 20000000, role: 'BAT', nationality: 'Indian', status: 'available', set: 'Uncapped'
                }));
                db.ref(`presets/${dbName}`).set([...existing, ...newPlayers]).then(() => showAlert('Success', `Appended ${newPlayers.length} players to ${dbName}.`));
            });
        }, 100);
    });
};

function handleDatabaseUpload() {
    let dbName = document.getElementById('dbNameInput').value.trim();
    let file = document.getElementById('csvFileInput').files[0];
    if (!dbName || !file) return showAlert('Error', 'Please provide a name and select a file.');
    
    let reader = new FileReader();
    reader.onload = e => {
        let rows = parseVanillaCSV(e.target.result);
        if (rows.length < 2) return showAlert('Error', 'Invalid CSV format.');
        
        let headers = rows[0].map(h => h.toLowerCase().trim());
        let pool = rows.slice(1).map(row => {
            let p = { status: 'available' };
            headers.forEach((h, i) => {
                let val = row[i] ? row[i].trim() : '';
                if (h === 'player' || h === 'name') p.name = val;
                else if (h === 'base_price' || h === 'price') p.base_price = parseInt(val) || 0;
                else p[h] = val;
            });
            return p;
        }).filter(p => p.name);
        
        db.ref('presets/' + dbName).set(pool).then(() => {
            let modal = document.getElementById('uploadModal');
            if (modal) modal.style.display = 'none';
            document.getElementById('dbNameInput').value = '';
            document.getElementById('csvFileInput').value = '';
            showAlert('Success', `Database '${dbName}' uploaded with ${pool.length} players.`);
        });
    };
    reader.readAsText(file);
}

// ─ 2. Image Directory ───────────────────────────────────────────────
function renderImageCards() {
    let grid = document.getElementById('imgCardGrid');
    if (!grid) return; 
    grid.innerHTML = '';

    const query = document.getElementById('adminImgSearch')?.value.toLowerCase() || '';
    let validCards = 0;

    Object.keys(globalImages).forEach(playerName => {
        if (query && !playerName.toLowerCase().includes(query)) return;

        let rawData = globalImages[playerName];
        let activeUrl = '';
        let urlList = [];

        // Safe Normalization for corrupted Firebase entries
        if (typeof rawData === 'string') {
            activeUrl = rawData; urlList = [rawData];
        } else if (rawData && rawData.active) {
            activeUrl = rawData.active; urlList = rawData.urls || [rawData.active];
        } else if (rawData && rawData.url) {
            activeUrl = rawData.url; urlList = [rawData.url];
        } else {
            return; 
        }
        
        validCards++;

        const card = document.createElement('div');
        card.style.cssText = 'background:#161620; border:1px solid #2d2d3f; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 5px 15px rgba(0,0,0,0.4);';
        card.innerHTML = `
            <div style="height:180px; background:#000; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
                <button onclick="deleteImageMapping('${esc(playerName)}')" style="position:absolute; top:5px; right:5px; background:rgba(220,53,69,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer; z-index:10;">✕</button>
                <img src="${esc(activeUrl)}" style="width:100%; height:100%; object-fit:cover; object-position:top;" onerror="this.src=''; this.alt='No Image'">
                <div style="position:absolute; bottom:0; left:0; right:0; background:linear-gradient(transparent, rgba(0,0,0,0.9)); padding:10px;">
                    <h3 style="margin:0; color:#fff; font-size:16px;">${esc(playerName)}</h3>
                </div>
            </div>
            <div style="padding:12px; display:flex; flex-direction:column; gap:8px; flex:1;">
                <label style="font-size:10px; color:#888; text-transform:uppercase;">Select Active Source:</label>
                <select class="admin-select" style="min-width:100%; padding:6px; font-size:11px;" onchange="updateActiveUrl('${esc(playerName)}', this.value)">
                    ${urlList.map(u => `<option value="${esc(u)}" ${u === activeUrl ? 'selected' : ''}>${esc(u)}</option>`).join('')}
                </select>
                <button class="action-btn outline" style="width:100%; font-size:10px; margin-top:auto;" onclick="addUrlToPlayer('${esc(playerName)}')">+ Add Alt URL</button>
            </div>
        `;
        grid.appendChild(card);
    });

    if (validCards === 0) {
        grid.innerHTML = '<p style="color:#666; text-align:center; grid-column:1/-1; padding:20px;">No images mapped yet.</p>';
    }
}

function handleBulkImageImport() {
    let file = document.getElementById('uploadImageFile')?.files[0];
    if (!file) return showAlert('Error', 'Please select a CSV file.');
    let reader = new FileReader();
    reader.onload = e => {
        let rows = parseVanillaCSV(e.target.result);
        if(rows.length < 2) return showAlert('Error', 'Invalid CSV or empty file.');
        
        let updates = {};
        rows.slice(1).forEach(r => {
            let name = r[0]?.trim(); let url = r[1]?.trim();
            if(name && url) updates[name] = { active: url, urls: [url] };
        });
        db.ref('global_player_images').update(updates).then(() => {
            let modal = document.getElementById('uploadImageCsvModal');
            if (modal) modal.style.display = 'none';
            document.getElementById('uploadImageFile').value = '';
            showAlert('Success', `Imported ${Object.keys(updates).length} image mappings.`);
        });
    };
    reader.readAsText(file);
}

function openSingleImagePrompt() {
    showPrompt('Add Single Image', 'Enter exact Player Name:', '', (playerName) => {
        if (playerName && playerName.trim()) {
            setTimeout(() => {
                showPrompt('Add Image URL', `Enter transparent PNG URL for ${playerName}:`, 'https://...', (url) => {
                    if (url && url.trim()) {
                        let safeName = playerName.trim(); let safeUrl = url.trim();
                        db.ref(`global_player_images/${safeName}`).set({ active: safeUrl, urls: [safeUrl] });
                        showAlert('Success', `Image successfully mapped to ${safeName}`);
                    }
                });
            }, 400); 
        }
    });
}

window.updateActiveUrl = (playerName, newUrl) => { db.ref(`global_player_images/${playerName}/active`).set(newUrl); };
window.deleteImageMapping = (playerName) => { showConfirm('Delete Mapping', `Remove all images mapped to ${playerName}?`, () => { db.ref(`global_player_images/${playerName}`).remove(); }); };
window.addUrlToPlayer = (playerName) => {
    showPrompt('Add Image URL', `Paste new image URL for ${playerName}:`, 'https://...', (url) => {
        if (!url) return;
        let imgData = globalImages[playerName];
        if (typeof imgData === 'string') { imgData = { active: imgData, urls: [imgData] }; } 
        else if (imgData && imgData.url && !imgData.urls) { imgData = { active: imgData.url, urls: [imgData.url] }; } 
        else if (!imgData || !imgData.urls) { imgData = { active: url, urls: [] }; }
        
        if (!imgData.urls.includes(url)) {
            imgData.urls.push(url);
            imgData.active = url; 
            db.ref(`global_player_images/${playerName}`).set(imgData);
        }
    });
};

// ─ 3. Active Rooms ──────────────────────────────────────────────────
function renderActiveRooms() {
    let container = document.getElementById('roomsContainer');
    if (!container) return;
    
    let keys = Object.keys(activeRooms);
    if (!keys.length) {
        container.innerHTML = "<p style='color:#666; font-size:12px; text-align:center; padding:20px; grid-column:1/-1;'>No active auction rooms running.</p>";
        return;
    }

    let html = '';
    keys.forEach(key => {
        let room = activeRooms[key];
        let settings = room.settings || {}; let live = room.live_state || {};
        let status = live.auction_state || 'idle';
        let currentBid = (live.current_bid || 0) / 10000000;
        let leader = live.highest_bidder || '-';

        html += `
        <div class="room-card" style="background:#161620; border:1px solid #333; border-radius:10px; padding:15px;">
            <div class="r-title" style="color:#fff; font-size:16px; font-weight:bold; margin-bottom:10px; display:flex; justify-content:space-between;">
                ${esc(settings.room_name || 'Unnamed Room')}
                <span class="r-pin" style="color:#0dcaf0; font-family:monospace; background:#000; padding:2px 6px; border-radius:4px; font-size:14px;">${esc(key)}</span>
            </div>
            <div class="r-stat" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed #222; font-size:12px; color:#aaa;"><span>Status</span><span style="color:${status==='bidding'?'#28a745':'#ffc107'}; font-weight:bold;">${status.toUpperCase()}</span></div>
            <div class="r-stat" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px dashed #222; font-size:12px; color:#aaa;"><span>Current Bid</span><span style="color:#28a745; font-weight:bold;">₹${currentBid.toFixed(2)} Cr</span></div>
            <div class="r-stat" style="display:flex; justify-content:space-between; padding:8px 0; margin-bottom:10px; font-size:12px; color:#aaa;"><span>Leader</span><span style="color:#fff; font-weight:bold;">${esc(leader)}</span></div>
            <button class="action-btn outline danger delete-room-btn" style="width:100%; font-size:11px;" onclick="deleteRoom('${esc(key)}')">Terminate Room</button>
        </div>`;
    });
    container.innerHTML = html;
}

window.deleteRoom = (key) => {
    showConfirm('Terminate Room', `Are you sure you want to permanently delete room [${key}]?`, () => { db.ref('rooms/' + key).remove(); });
};

// ─ 4. Global Franchises ─────────────────────────────────────────────
function renderGlobalTeams() {
    const list = document.getElementById('globalTeamsList');
    if (!list) return;
    list.innerHTML = '';

    Object.keys(globalTeams).forEach(code => {
        const t = globalTeams[code];
        const card = document.createElement('div');
        card.className = 'team-card';
        card.style.cssText = `border: 1px solid ${t.color || '#333'}; position: relative; background: #000; border-radius: 8px; padding: 15px; text-align: center;`;
        
        const logoHtml = t.logo ? `<img src="${esc(t.logo)}" style="max-height:50px; max-width:80px; margin-bottom:10px; object-fit:contain; filter:drop-shadow(0 0 5px rgba(255,255,255,0.2));" alt="logo">` : '';

        card.innerHTML = `
            <div style="position:absolute; top:5px; right:5px; display:flex; gap:5px;">
                <button class="action-btn outline" style="padding:2px 6px; font-size:10px; border-color:#888; color:#fff;" onclick="editGlobalTeam('${esc(code)}')">✏️</button>
                <button class="action-btn danger" style="padding:2px 6px; font-size:10px;" onclick="deleteGlobalTeam('${esc(code)}')">✕</button>
            </div>
            ${logoHtml}
            <div class="t-code" style="color:${esc(t.color || '#fff')}; font-size:24px; font-weight:900; margin-bottom:5px;">${esc(code)}</div>
            <div class="t-name" style="color:#888; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:15px;">${esc(t.name)}</div>
        `;
        list.appendChild(card);
    });
}

function handleAddGlobalTeam() {
    const code = document.getElementById('ntCode').value.trim().toUpperCase();
    const name = document.getElementById('ntName').value.trim();
    const color = document.getElementById('ntColor').value;
    const logoInput = document.getElementById('ntLogo'); 
    const logo = logoInput ? logoInput.value.trim() : '';

    if (!code || !name) return showAlert('Error', 'Team code and name are required.');

    db.ref(`global_teams/${code}`).update({ name, color, logo }).then(() => { closeAddTeamModal(); });
}

function closeAddTeamModal() {
    let modal = document.getElementById('addTeamModal');
    if (modal) modal.style.display = 'none';
    
    document.getElementById('ntCode').value = '';
    document.getElementById('ntCode').disabled = false;
    document.getElementById('ntName').value = '';
    
    let logoInput = document.getElementById('ntLogo');
    if (logoInput) logoInput.value = '';
    
    let title = document.querySelector('#addTeamModal h2');
    if(title) title.textContent = 'Add Global Franchise';
    let btn = document.getElementById('btnSubmitAddTeam');
    if(btn) btn.textContent = 'ADD TEAM';
}

window.editGlobalTeam = (code) => {
    const t = globalTeams[code];
    if(!t) return;
    
    document.getElementById('ntCode').value = code;
    document.getElementById('ntCode').disabled = true;
    document.getElementById('ntName').value = t.name || '';
    document.getElementById('ntColor').value = t.color || '#007bff';
    
    let logoInput = document.getElementById('ntLogo');
    if(logoInput) logoInput.value = t.logo || '';
    
    let title = document.querySelector('#addTeamModal h2');
    if(title) title.textContent = 'Edit Global Franchise';
    let btn = document.getElementById('btnSubmitAddTeam');
    if(btn) btn.textContent = 'UPDATE TEAM';
    
    let modal = document.getElementById('addTeamModal');
    if (modal) modal.style.display = 'flex';
};

window.deleteGlobalTeam = (code) => {
    showConfirm('Delete Franchise', `Are you sure you want to delete ${code} from global registry?`, () => { db.ref(`global_teams/${code}`).remove(); });
};
