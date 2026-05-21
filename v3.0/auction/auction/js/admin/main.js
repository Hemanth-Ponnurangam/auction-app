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
let globalNatFlags = {};
let globalRoleIcons = {};
let globalNatBoards = {};
let globalLeagues = {};

// ─ Sub-tab switcher ─────────────────────────────────────────────────
window.switchSubTab = (group, btn) => {
    const subId = btn.getAttribute('data-sub');
    document.querySelectorAll(`[id^="sub-${group}-"]`).forEach(el => el.style.display = 'none');
    document.querySelectorAll(`.sub-tab-btn`).forEach(b => b.classList.remove('active'));
    const target = document.getElementById(`sub-${subId}`);
    if (target) target.style.display = '';
    btn.classList.add('active');
};

// ─ SAFE DOM INJECTOR ───────────────────────────────────────────────
function getSafeContainer(tabId, newContainerId, cssStyles) {
    let container = document.getElementById(newContainerId);
    if (!container) {
        const tab = document.getElementById(tabId);
        if (!tab) return null;
        
        const panel = tab.querySelector('.panel');
        if (!panel) return null;

        const oldTable = panel.querySelector('.table-responsive');
        if (oldTable) oldTable.style.display = 'none';

        container = document.createElement('div');
        container.id = newContainerId;
        container.style.cssText = cssStyles;
        panel.appendChild(container);
    }
    return container;
}

window.onload = function() {
    const colorInput = document.getElementById('ntColor');
    if (colorInput && !document.getElementById('ntLogoFile')) {
        const logoHtml = `
            <label class="modal-label" style="margin-top:15px;">Team Logo (PNG with transparent background)</label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input type="file" id="ntLogoFile" accept="image/png,image/webp,image/svg+xml" class="modal-input" style="flex:1;min-width:0;padding:6px;cursor:pointer;" onchange="window.previewLogoUpload(this)">
                <button type="button" onclick="document.getElementById('ntLogoFile').value='';document.getElementById('ntLogoPreview').style.display='none';window._logoBase64='';" style="background:#333;border:1px solid #555;color:#ccc;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:11px;">Clear</button>
            </div>
            <div id="ntLogoPreview" style="display:none;margin-top:8px;text-align:center;">
                <img id="ntLogoPreviewImg" style="max-height:60px;max-width:120px;object-fit:contain;background:repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 0 0 / 12px 12px;border-radius:6px;padding:4px;" alt="Logo preview">
                <div style="font-size:10px;color:#0dcaf0;margin-top:4px;">✓ Logo ready — transparent background visible above</div>
            </div>
            <input type="hidden" id="ntLogo" value="">`;
        colorInput.insertAdjacentHTML('afterend', logoHtml);
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
    document.getElementById('adminFlagSearch')?.addEventListener('input', renderNatFlags);
    document.getElementById('adminRoleSearch')?.addEventListener('input', renderRoleIcons);
    document.getElementById('adminBoardSearch')?.addEventListener('input', renderNatBoards);

    document.getElementById('btnAddFlag')?.addEventListener('click', () => { document.getElementById('flagCountryKey').readOnly = false; document.getElementById('addFlagModal').style.display = 'flex'; });
    document.getElementById('btnCloseFlag')?.addEventListener('click', () => { document.getElementById('flagCountryKey').readOnly = false; _flagBase64 = ''; const t = document.querySelector('#addFlagModal h2'); if(t) t.textContent='Upload National Flag'; const b = document.getElementById('btnSubmitFlag'); if(b) b.textContent='UPLOAD FLAG'; document.getElementById('addFlagModal').style.display = 'none'; });
    document.getElementById('btnSubmitFlag')?.addEventListener('click', handleFlagUpload);

    document.getElementById('btnAddRoleIcon')?.addEventListener('click', () => { document.getElementById('roleIconKey').readOnly = false; document.getElementById('addRoleIconModal').style.display = 'flex'; });
    document.getElementById('btnCloseRoleIcon')?.addEventListener('click', () => { document.getElementById('roleIconKey').readOnly = false; _roleIconBase64 = ''; const t = document.querySelector('#addRoleIconModal h2'); if(t) t.textContent='Upload Role Icon'; const b = document.getElementById('btnSubmitRoleIcon'); if(b) b.textContent='UPLOAD ICON'; document.getElementById('addRoleIconModal').style.display = 'none'; });
    document.getElementById('btnSubmitRoleIcon')?.addEventListener('click', handleRoleIconUpload);

    document.getElementById('btnAddBoard')?.addEventListener('click', () => { document.getElementById('boardKey').readOnly = false; document.getElementById('addBoardModal').style.display = 'flex'; });
    document.getElementById('btnCloseBoard')?.addEventListener('click', () => { _boardBase64 = ''; document.getElementById('addBoardModal').style.display = 'none'; document.getElementById('boardKey').readOnly = false; const t = document.querySelector('#addBoardModal h2'); if(t) t.textContent='Upload Board Logo'; const b = document.getElementById('btnSubmitBoard'); if(b) b.textContent='UPLOAD BOARD'; });

    document.getElementById('btnAddLeague')?.addEventListener('click', () => { document.getElementById('leagueKey').readOnly = false; document.getElementById('addLeagueModal').style.display = 'flex'; });
    document.getElementById('btnCloseLeague')?.addEventListener('click', () => { _leagueLogoBase64 = ''; document.getElementById('addLeagueModal').style.display = 'none'; document.getElementById('leagueKey').readOnly = false; const t = document.querySelector('#addLeagueModal h2'); if(t) t.textContent='Create League'; const b = document.getElementById('btnSubmitLeague'); if(b) b.textContent='CREATE LEAGUE'; });
}

window.handleAdminLogin = handleAdminLogin;
window.logoutAdmin = logoutAdmin;
window.handleDatabaseUpload = handleDatabaseUpload;
window.handleAddGlobalTeam = handleAddGlobalTeam;
window.handleBulkImageImport = handleBulkImageImport;
window.openSingleImagePrompt = openSingleImagePrompt;

window.downloadCsvTemplate = function() {
    const header = 'name,base_price,set,role,nationality,national_board,franchise,stat_1,stat_2,stat_3';
    const rows = [
        'Virat Kohli,2.5,Marquee,BAT,Indian,BCCI,RCB,237,8263,48.7',
        'Pat Cummins,2,Capped,BOWL,Australia,Cricket Australia,KKR,,,',
        'Jasprit Bumrah,2,Marquee,BOWL,Indian,BCCI,MI,,,',
    ];
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'auction_player_template.csv';
    a.click(); URL.revokeObjectURL(url);
};

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
    
    function onFirebaseError(path, err) {
        let msg = err.code === 'PERMISSION_DENIED'
            ? `Firebase PERMISSION_DENIED on "${path}".\n\nFix: open Firebase Console → Realtime Database → Rules and ensure "${path}" has { ".read": true, ".write": true }.\n\nSee firebase-config.js for the full recommended rules.`
            : `Firebase error on "${path}": ${err.message}`;
        console.error(msg);
        showAlert('Firebase Rules Error', msg);
    }

    db.ref('preset_databases').on('value', snap => {
        activeDatabases = snap.val() || {};
        updateDbDropdown();
        renderDatabaseManager();
    }, err => onFirebaseError('preset_databases', err));
    
    db.ref('global_player_images').on('value', snap => {
        globalImages = snap.val() || {};
        renderImageCards();
    }, err => onFirebaseError('global_player_images', err));
    
    db.ref('rooms').on('value', snap => {
        activeRooms = snap.val() || {};
        renderActiveRooms();
    }, err => onFirebaseError('rooms', err));
    
    db.ref('global_teams').on('value', snap => {
        globalTeams = snap.val() || {};
        renderGlobalTeams();
    }, err => onFirebaseError('global_teams', err));

    db.ref('global_nat_flags').on('value', snap => {
        globalNatFlags = snap.val() || {};
        renderNatFlags();
    }, err => onFirebaseError('global_nat_flags', err));

    db.ref('global_role_icons').on('value', snap => {
        globalRoleIcons = snap.val() || {};
        renderRoleIcons();
    }, err => onFirebaseError('global_role_icons', err));

    db.ref('global_nat_boards').on('value', snap => {
        globalNatBoards = snap.val() || {};
        renderNatBoards();
    }, err => onFirebaseError('global_nat_boards', err));

    db.ref('global_leagues').on('value', snap => {
        globalLeagues = snap.val() || {};
        renderLeagues();
    }, err => onFirebaseError('global_leagues', err));
}

// ─ 1. Database Manager (WITH FIREBASE NULL PROTECTION) ──────────────
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
    // FIX: Was calling getSafeContainer('tab-databases', 'dbCardContainer', ...) which looks for
    // an element id="dbCardContainer" that doesn't exist in admin.html. getSafeContainer then
    // created a new orphan div appended below the real scroll wrapper, leaving presetDbList empty.
    // Now we target the correct element that already exists in the HTML.
    const list = document.getElementById('presetDbList');
    if (!list) return;
    list.innerHTML = '';
    
    let filterDb = document.getElementById('dbSelector')?.value || '';
    let filterText = document.getElementById('adminDbSearch')?.value.toLowerCase() || '';
    let dbKeys = filterDb ? [filterDb] : Object.keys(activeDatabases);

    let validDbs = 0;
    
    dbKeys.forEach(dbName => {
        try {
            let playersRaw = activeDatabases[dbName] || [];
            let rawArray = Array.isArray(playersRaw) ? playersRaw : Object.values(playersRaw);
            
            // FIREBASE CORRUPTION FIX: Actively remove nulls/undefined entries before processing
            let validPlayers = rawArray.filter(p => p !== null && typeof p === 'object');
            
            const filteredPlayers = filterText 
                ? validPlayers.filter(p => (p.name || '').toLowerCase().includes(filterText)) 
                : validPlayers;

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
                    <button class="action-btn" style="background:#dc3545; border-color:#dc3545;" onclick="deleteDatabase(event, '${esc(dbName)}')">✕ Delete</button>
                    <button class="action-btn outline" onclick="togglePlayerList(event, 'list-${esc(dbName)}')">▼ View</button>
                </div>
            `;
            
            const playerContainer = document.createElement('div');
            playerContainer.id = `list-${dbName}`;
            playerContainer.style.cssText = 'display:none; background:#0a0a0f; border-top:1px solid #222; max-height:400px; overflow:auto;';
            
            // Build full table with all columns — name first, then standard, then extras
            const SKIP_KEYS = new Set(['status', '_col_order']);
            const STANDARD_ORDER = ['name','base_price','set','role','nationality','national_board','franchise'];
            
            // Get all keys from players, preserving a logical order
            const allRawKeys = [...new Set(filteredPlayers.flatMap(p => Object.keys(p)))].filter(k => !SKIP_KEYS.has(k));
            const standardPresent = STANDARD_ORDER.filter(k => allRawKeys.includes(k));
            const extraKeys = allRawKeys.filter(k => !STANDARD_ORDER.includes(k) && k !== 'stats');
            const allKeys = [...standardPresent, ...extraKeys];

            const thHtml = allKeys.map(k => `<th style="padding:6px 12px; font-size:10px; color:#ffc107; text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; border-bottom:1px solid #333; border-right:1px solid #1a1a24; background:#0d0d18; position:sticky; top:0;">${esc(k)}</th>`).join('');
            const trHtml = filteredPlayers.map((p, i) => {
                const cells = allKeys.map(k => {
                    let v = p[k];
                    // Skip nested objects silently
                    if (v !== null && typeof v === 'object') v = '';
                    const display = v !== undefined && v !== null ? String(v) : '';
                    return `<td style="padding:5px 12px; font-size:11px; color:${k==='name'?'#fff':'#aaa'}; border-bottom:1px solid #111; border-right:1px solid #1a1a24; white-space:nowrap;">${esc(display)}</td>`;
                }).join('');
                return `<tr style="background:${i%2===0?'#0a0a0f':'#0d0d14'};">${cells}</tr>`;
            }).join('');
            playerContainer.innerHTML = `<table style="width:max-content; min-width:100%; border-collapse:collapse;"><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table>`;

            dbCard.appendChild(header);
            dbCard.appendChild(playerContainer);
            list.appendChild(dbCard);
            
        } catch (err) {
            console.error(`Skipped rendering corrupted DB: ${dbName}`, err);
        }
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
    showConfirm('Delete Database', `Are you sure you want to permanently delete "${dbName}"?`, () => { db.ref(`preset_databases/${dbName}`).remove(); });
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
                        else if (h === 'base_price' || h === 'price') {
                            let num = parseFloat(val.replace(/[^0-9.]/g,'')) || 0;
                            p.base_price = num <= 1000 ? Math.round(num * 10000000) : Math.round(num);
                        }
                        else p[h] = val;  // stores national_board, franchise, role, set, nationality, stats
                    });
                    return p;
                }).filter(p => p.name);
                
                let raw = activeDatabases[dbName] || [];
                let existing = Array.isArray(raw) ? raw : Object.values(raw);
                existing = existing.filter(p => p !== null); // Clean before saving
                
                db.ref(`preset_databases/${dbName}`).set([...existing, ...newPlayers]).then(() => showAlert('Success', `Appended ${newPlayers.length} players to ${dbName} via CSV.`));
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
                let raw = activeDatabases[dbName] || [];
                let existing = Array.isArray(raw) ? raw : Object.values(raw);
                existing = existing.filter(p => p !== null); // Clean before saving
                
                const newPlayers = newNames.map(name => ({
                    name: name, base_price: 20000000, role: 'BAT', nationality: 'Indian', status: 'available', set: 'Uncapped'
                }));
                db.ref(`preset_databases/${dbName}`).set([...existing, ...newPlayers]).then(() => showAlert('Success', `Appended ${newPlayers.length} players to ${dbName}.`));
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
        
        // Validate required columns
        const required = ['name', 'base_price', 'role', 'set', 'nationality', 'franchise'];
        // Support legacy aliases
        const hasName = headers.includes('name') || headers.includes('player');
        const hasPrice = headers.includes('base_price') || headers.includes('price');
        if (!hasName || !hasPrice) {
            return showAlert('Error', 'CSV missing required columns. Need at least: name, base_price');
        }

        // Stat columns = anything beyond the standard fields (flexible, max 6)
        const CORE_COLS = new Set(['name','player','base_price','price','role','set','nationality','national_board','franchise']);
        const statCols = headers.filter(h => h && !CORE_COLS.has(h));
        if (statCols.length > 6) {
            return showAlert('Error', `Too many stat columns (${statCols.length}). Maximum 6 allowed.`);
        }

        // Store column order for table display
        const colOrder = headers.filter(h => h);

        let pool = rows.slice(1).map(row => {
            let p = { status: 'available', _col_order: colOrder };
            headers.forEach((h, i) => {
                let val = row[i] ? row[i].trim() : '';
                if (h === 'player' || h === 'name') p.name = val;
                else if (h === 'base_price' || h === 'price') {
                    let num = parseFloat(val.replace(/[^0-9.]/g,'')) || 0;
                    p.base_price = num <= 1000 ? Math.round(num * 10000000) : Math.round(num);
                }
                else if (h) p[h] = val;   // stores national_board, franchise, role, set, nationality, stats
            });
            return p;
        }).filter(p => p.name);
        
        db.ref('preset_databases/' + dbName).set(pool).then(() => {
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
    // FIX: Was calling getSafeContainer('tab-images', 'imgCardGrid', ...) which looked for
    // id="imgCardGrid" (doesn't exist). It tried to hide a '.table-responsive' wrapper but the
    // HTML has no such class — so the old table stayed visible and the new grid was appended below it.
    // Now we correctly find and hide the table's scroll wrapper, then create/reuse the grid div.
    let grid = document.getElementById('imgCardGrid');
    if (!grid) {
        const panel = document.querySelector('#tab-images .panel');
        if (!panel) return;
        // Hide the existing scroll wrapper that contains the old <table>
        const tableWrapper = panel.querySelector('div[style*="overflow-y"]');
        if (tableWrapper) tableWrapper.style.display = 'none';
        grid = document.createElement('div');
        grid.id = 'imgCardGrid';
        grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px; padding:15px;';
        panel.appendChild(grid);
    }
    grid.innerHTML = '';

    const query = document.getElementById('adminImgSearch')?.value.toLowerCase() || '';
    let validCards = 0;

    Object.keys(globalImages).forEach(playerName => {
        if (query && !playerName.toLowerCase().includes(query)) return;

        let rawData = globalImages[playerName];
        let activeUrl = '';
        let urlList = [];

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
    // FIX: Was calling getSafeContainer('tab-rooms', 'activeRoomsContainer', ...) — id doesn't
    // exist in HTML. The correct element is id="roomsContainer". Same orphan-div bug as above.
    const container = document.getElementById('roomsContainer');
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
    // FIX: Was calling getSafeContainer('tab-franchises', 'globalTeamsGridCard', ...) — id doesn't
    // exist in HTML. The correct element is id="globalTeamsList". Same orphan-div bug as above.
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
            <div class="t-name" style="color:#888; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:${t.label ? '6px' : '15px'};">${esc(t.name)}</div>
            ${t.label ? `<div style="display:inline-block; background:rgba(255,193,7,0.12); border:1px solid rgba(255,193,7,0.35); color:#ffc107; font-size:9px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:2px 8px; border-radius:10px; margin-bottom:10px;">${esc(t.label)}</div>` : ''}
        `;
        list.appendChild(card);
    });
}

// ─── Logo file → base64 upload helper ──────────────────────────────────────
window._logoBase64 = '';

window.previewLogoUpload = function(input) {
    let file = input.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = e => {
        window._logoBase64 = e.target.result; // full data URL
        document.getElementById('ntLogo').value = e.target.result;
        let preview = document.getElementById('ntLogoPreview');
        let previewImg = document.getElementById('ntLogoPreviewImg');
        if (preview && previewImg) {
            previewImg.src = e.target.result;
            preview.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);
};

function handleAddGlobalTeam() {
    const code = document.getElementById('ntCode').value.trim().toUpperCase();
    const name = document.getElementById('ntName').value.trim();
    const color = document.getElementById('ntColor').value;
    const label = (document.getElementById('ntLabel')?.value || '').trim();
    const logoInput = document.getElementById('ntLogo');
    const logo = (logoInput ? logoInput.value.trim() : '') || window._logoBase64 || '';

    if (!code || !name) return showAlert('Error', 'Team code and name are required.');

    const payload = { name, color, logo };
    if (label) payload.label = label;

    db.ref(`global_teams/${code}`).update(payload).then(() => {
        window._logoBase64 = '';
        closeAddTeamModal();
    });
}

function closeAddTeamModal() {
    let modal = document.getElementById('addTeamModal');
    if (modal) modal.style.display = 'none';
    
    document.getElementById('ntCode').value = '';
    document.getElementById('ntCode').disabled = false;
    document.getElementById('ntName').value = '';
    if (document.getElementById('ntLabel')) document.getElementById('ntLabel').value = '';
    
    let logoInput = document.getElementById('ntLogo');
    if (logoInput) logoInput.value = '';
    let logoFile = document.getElementById('ntLogoFile');
    if (logoFile) logoFile.value = '';
    let preview = document.getElementById('ntLogoPreview');
    if (preview) preview.style.display = 'none';
    window._logoBase64 = '';
    
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
    if (document.getElementById('ntLabel')) document.getElementById('ntLabel').value = t.label || '';
    
    // Populate existing logo for preview (base64 data URL or external URL)
    let logoInput = document.getElementById('ntLogo');
    if (logoInput) logoInput.value = t.logo || '';
    window._logoBase64 = t.logo || '';
    let preview = document.getElementById('ntLogoPreview');
    let previewImg = document.getElementById('ntLogoPreviewImg');
    if (preview && previewImg && t.logo) {
        previewImg.src = t.logo;
        preview.style.display = 'block';
    } else if (preview) {
        preview.style.display = 'none';
    }
    
    let title = document.querySelector('#addTeamModal h2');
    if(title) title.textContent = 'Edit Franchise';
    let btn = document.getElementById('btnSubmitAddTeam');
    if(btn) btn.textContent = 'UPDATE TEAM';
    
    let modal = document.getElementById('addTeamModal');
    if (modal) modal.style.display = 'flex';
};

window.deleteGlobalTeam = (code) => {
    showConfirm('Delete Franchise', `Are you sure you want to delete ${code} from global registry?`, () => { db.ref(`global_teams/${code}`).remove(); });
};

// ─ 5. National Flags ────────────────────────────────────────────────
function renderNatFlags() {
    const grid = document.getElementById('flagsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const query = (document.getElementById('adminFlagSearch')?.value || '').toLowerCase();
    const keys = Object.keys(globalNatFlags).filter(k => !query || k.toLowerCase().includes(query) || (globalNatFlags[k]?.name || '').toLowerCase().includes(query));

    if (!keys.length) {
        grid.innerHTML = '<p style="color:#666; text-align:center; grid-column:1/-1; padding:20px;">No flags uploaded yet.</p>';
        return;
    }

    keys.forEach(key => {
        const entry = globalNatFlags[key];
        const src   = typeof entry === 'string' ? entry : (entry?.image || entry?.url || '');
        const name  = typeof entry === 'object' ? (entry?.name || key) : key;
        if (!src) return;

        const card = document.createElement('div');
        card.style.cssText = 'background:#111; border:1px solid #2d2d3f; border-radius:10px; overflow:hidden; text-align:center; padding:16px 10px; position:relative;';
        card.innerHTML = `
            <div style="position:absolute; top:6px; right:6px; display:flex; gap:4px;">
                <button onclick="window.editNatFlag('${esc(key)}')" style="background:rgba(0,123,255,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">✏️</button>
                <button onclick="window.deleteNatFlag('${esc(key)}')" style="background:rgba(220,53,69,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">✕</button>
            </div>
            <div style="width:60px; height:60px; border-radius:50%; overflow:hidden; margin:0 auto 10px; border:2px solid #333; background:#000;">
                <img src="${esc(src)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.alt='Error'">
            </div>
            <div style="color:#fff; font-size:12px; font-weight:bold;">${esc(name)}</div>
            <div style="color:#555; font-size:10px; font-family:monospace; margin-top:2px;">${esc(key)}</div>
            ${Array.isArray(entry?.aliases) && entry.aliases.length ? `<div style="color:#444; font-size:9px; margin-top:4px; line-height:1.4;">${entry.aliases.map(a => `<span style="background:#1a1a24; padding:1px 4px; border-radius:3px; margin:1px; display:inline-block;">${esc(a)}</span>`).join('')}</div>` : ''}
        `;
        grid.appendChild(card);
    });
}

let _flagBase64 = '';
window.previewFlagUpload = function(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        _flagBase64 = e.target.result;
        const preview = document.getElementById('flagPreview');
        const previewImg = document.getElementById('flagPreviewImg');
        if (preview && previewImg) { previewImg.src = _flagBase64; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
};

function handleFlagUpload() {
    const key  = (document.getElementById('flagCountryKey')?.value || '').trim().toLowerCase().replace(/\s+/g, '_');
    const name = (document.getElementById('flagCountryName')?.value || '').trim();
    const aliasesRaw = (document.getElementById('flagAliases')?.value || '').trim();
    const aliases = aliasesRaw
        ? aliasesRaw.split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
        : [];
    if (!key || !name) return showAlert('Error', 'Country key and name are required.');
    const isEditing = document.getElementById('flagCountryKey')?.readOnly;
    if (!_flagBase64 && !isEditing) return showAlert('Error', 'Please select a flag image.');

    const payload = { name, key, aliases };
    if (_flagBase64) payload.image = _flagBase64;

    db.ref(`global_nat_flags/${key}`).update(payload).then(() => {
        document.getElementById('addFlagModal').style.display = 'none';
        document.getElementById('flagCountryKey').value = '';
        document.getElementById('flagCountryKey').readOnly = false;
        document.getElementById('flagCountryName').value = '';
        document.getElementById('flagAliases').value = '';
        document.getElementById('flagImageFile').value = '';
        document.getElementById('flagPreview').style.display = 'none';
        const title = document.querySelector('#addFlagModal h2');
        if (title) title.textContent = 'Upload National Flag';
        const btn = document.getElementById('btnSubmitFlag');
        if (btn) btn.textContent = 'UPLOAD FLAG';
        _flagBase64 = '';
        showAlert('Success', `Flag for "${name}" uploaded successfully!`);
    });
}

window.deleteNatFlag = (key) => {
    showConfirm('Delete Flag', `Remove flag for "${key}"?`, () => db.ref(`global_nat_flags/${key}`).remove());
};

window.editNatFlag = (key) => {
    const entry = globalNatFlags[key];
    if (!entry) return;
    const name  = typeof entry === 'object' ? (entry.name || key) : key;
    const aliases = Array.isArray(entry?.aliases) ? entry.aliases.join(', ') : '';

    document.getElementById('flagCountryKey').value = key;
    document.getElementById('flagCountryKey').readOnly = true;
    document.getElementById('flagCountryName').value = name;
    document.getElementById('flagAliases').value = aliases;
    _flagBase64 = entry.image || entry.url || '';
    const preview = document.getElementById('flagPreview');
    const previewImg = document.getElementById('flagPreviewImg');
    if (preview && previewImg && _flagBase64) { previewImg.src = _flagBase64; preview.style.display = 'block'; }
    const modal = document.getElementById('addFlagModal');
    const title = modal?.querySelector('h2');
    if (title) title.textContent = 'Edit National Flag';
    const btn = document.getElementById('btnSubmitFlag');
    if (btn) btn.textContent = 'UPDATE FLAG';
    if (modal) modal.style.display = 'flex';
};

// ─ 6. Role Icons ────────────────────────────────────────────────────
function renderRoleIcons() {
    const grid = document.getElementById('roleIconsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const query = (document.getElementById('adminRoleSearch')?.value || '').toLowerCase();
    const keys = Object.keys(globalRoleIcons).filter(k => !query || k.toLowerCase().includes(query) || (globalRoleIcons[k]?.name || '').toLowerCase().includes(query));

    if (!keys.length) {
        grid.innerHTML = '<p style="color:#666; text-align:center; grid-column:1/-1; padding:20px;">No role icons uploaded yet.</p>';
        return;
    }

    keys.forEach(key => {
        const entry = globalRoleIcons[key];
        const src   = typeof entry === 'string' ? entry : (entry?.image || entry?.url || '');
        const name  = typeof entry === 'object' ? (entry?.name || key) : key;
        if (!src) return;

        const card = document.createElement('div');
        card.style.cssText = 'background:#111; border:1px solid #2d2d3f; border-radius:10px; overflow:hidden; text-align:center; padding:16px 10px; position:relative;';
        card.innerHTML = `
            <div style="position:absolute; top:6px; right:6px; display:flex; gap:4px;">
                <button onclick="window.editRoleIcon('${esc(key)}')" style="background:rgba(0,123,255,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">✏️</button>
                <button onclick="window.deleteRoleIcon('${esc(key)}')" style="background:rgba(220,53,69,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">✕</button>
            </div>
            <div style="width:60px; height:60px; margin:0 auto 10px; background:repeating-conic-gradient(#2a2a3a 0% 25%, #1a1a24 0% 50%) 0 0/12px 12px; border-radius:8px; display:flex; align-items:center; justify-content:center;">
                <img src="${esc(src)}" style="max-width:50px;max-height:50px;object-fit:contain;" onerror="this.alt='Error'">
            </div>
            <div style="color:#fff; font-size:12px; font-weight:bold;">${esc(name)}</div>
            <div style="color:#0dcaf0; font-size:10px; font-family:monospace; margin-top:2px; font-weight:bold;">${esc(key)}</div>
            ${Array.isArray(entry?.aliases) && entry.aliases.length ? `<div style="color:#444; font-size:9px; margin-top:4px; line-height:1.4;">${entry.aliases.map(a => `<span style="background:#1a1a24; padding:1px 4px; border-radius:3px; margin:1px; display:inline-block;">${esc(a)}</span>`).join('')}</div>` : ''}
        `;
        grid.appendChild(card);
    });
}

let _roleIconBase64 = '';
window.previewRoleIconUpload = function(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        _roleIconBase64 = e.target.result;
        const preview = document.getElementById('roleIconPreview');
        const previewImg = document.getElementById('roleIconPreviewImg');
        if (preview && previewImg) { previewImg.src = _roleIconBase64; preview.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
};

function handleRoleIconUpload() {
    const key  = (document.getElementById('roleIconKey')?.value || '').trim().toUpperCase().replace(/\s+/g, '_');
    const name = (document.getElementById('roleIconName')?.value || '').trim();
    const aliasesRaw = (document.getElementById('roleIconAliases')?.value || '').trim();
    const aliases = aliasesRaw
        ? aliasesRaw.split(',').map(a => a.trim().toUpperCase()).filter(Boolean)
        : [];
    if (!key || !name) return showAlert('Error', 'Role key and name are required.');
    const isEditing = document.getElementById('roleIconKey')?.readOnly;
    if (!_roleIconBase64 && !isEditing) return showAlert('Error', 'Please select an icon image.');

    const payload = { name, key, aliases };
    if (_roleIconBase64) payload.image = _roleIconBase64;

    db.ref(`global_role_icons/${key}`).update(payload).then(() => {
        document.getElementById('addRoleIconModal').style.display = 'none';
        document.getElementById('roleIconKey').value = '';
        document.getElementById('roleIconKey').readOnly = false;
        document.getElementById('roleIconName').value = '';
        document.getElementById('roleIconAliases').value = '';
        document.getElementById('roleIconFile').value = '';
        document.getElementById('roleIconPreview').style.display = 'none';
        const title = document.querySelector('#addRoleIconModal h2');
        if (title) title.textContent = 'Upload Role Icon';
        const btn = document.getElementById('btnSubmitRoleIcon');
        if (btn) btn.textContent = 'UPLOAD ICON';
        _roleIconBase64 = '';
        showAlert('Success', `Role icon for "${name}" (${key}) saved successfully!`);
    });
}

window.deleteRoleIcon = (key) => {
    showConfirm('Delete Role Icon', `Remove icon for role "${key}"?`, () => db.ref(`global_role_icons/${key}`).remove());
};

window.editRoleIcon = (key) => {
    const entry = globalRoleIcons[key];
    if (!entry) return;
    const name    = typeof entry === 'object' ? (entry.name || key) : key;
    const aliases = Array.isArray(entry?.aliases) ? entry.aliases.join(', ') : '';

    document.getElementById('roleIconKey').value = key;
    document.getElementById('roleIconKey').readOnly = true;
    document.getElementById('roleIconName').value = name;
    document.getElementById('roleIconAliases').value = aliases;
    _roleIconBase64 = entry.image || entry.url || '';
    const preview = document.getElementById('roleIconPreview');
    const previewImg = document.getElementById('roleIconPreviewImg');
    if (preview && previewImg && _roleIconBase64) { previewImg.src = _roleIconBase64; preview.style.display = 'block'; }
    const modal = document.getElementById('addRoleIconModal');
    const title = modal?.querySelector('h2');
    if (title) title.textContent = 'Edit Role Icon';
    const btn = document.getElementById('btnSubmitRoleIcon');
    if (btn) btn.textContent = 'UPDATE ICON';
    if (modal) modal.style.display = 'flex';
};

// ─ 7. National Boards ───────────────────────────────────────────────
function renderNatBoards() {
    const grid = document.getElementById('boardsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const query = (document.getElementById('adminBoardSearch')?.value || '').toLowerCase();
    const keys = Object.keys(globalNatBoards).filter(k =>
        !query || k.toLowerCase().includes(query) || (globalNatBoards[k]?.name || '').toLowerCase().includes(query)
    );
    if (!keys.length) {
        grid.innerHTML = '<p style="color:#666; text-align:center; grid-column:1/-1; padding:20px;">No boards uploaded yet.</p>';
        return;
    }
    keys.forEach(key => {
        const entry = globalNatBoards[key];
        const src  = typeof entry === 'string' ? entry : (entry?.image || '');
        const name = typeof entry === 'object' ? (entry?.name || key) : key;
        const aliases = Array.isArray(entry?.aliases) ? entry.aliases : [];
        const card = document.createElement('div');
        card.style.cssText = 'background:#111; border:1px solid #2d2d3f; border-radius:10px; text-align:center; padding:16px 10px; position:relative;';
        card.innerHTML = `
            <div style="position:absolute; top:6px; right:6px; display:flex; gap:4px;">
                <button onclick="window.editNatBoard('${esc(key)}')" style="background:rgba(0,123,255,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">✏️</button>
                <button onclick="window.deleteNatBoard('${esc(key)}')" style="background:rgba(220,53,69,0.8); color:#fff; border:none; border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;">✕</button>
            </div>
            <div style="width:64px; height:64px; border-radius:8px; overflow:hidden; margin:0 auto 10px; border:1px solid #333; background:#000; display:flex; align-items:center; justify-content:center;">
                ${src ? `<img src="${esc(src)}" style="max-width:60px;max-height:60px;object-fit:contain;" onerror="this.alt='?'">` : '<span style="color:#444; font-size:20px;">🏢</span>'}
            </div>
            <div style="color:#fff; font-size:12px; font-weight:bold;">${esc(name)}</div>
            <div style="color:#555; font-size:10px; font-family:monospace; margin-top:2px;">${esc(key)}</div>
            ${aliases.length ? `<div style="color:#444; font-size:9px; margin-top:4px;">${aliases.map(a => `<span style="background:#1a1a24; padding:1px 4px; border-radius:3px; margin:1px; display:inline-block;">${esc(a)}</span>`).join('')}</div>` : ''}
        `;
        grid.appendChild(card);
    });
}

let _boardBase64 = '';
window.previewBoardUpload = function(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        _boardBase64 = e.target.result;
        const p = document.getElementById('boardPreview');
        const pi = document.getElementById('boardPreviewImg');
        if (p && pi) { pi.src = _boardBase64; p.style.display = 'block'; }
    };
    reader.readAsDataURL(file);
};

window.handleBoardUpload = function() {
    const key  = (document.getElementById('boardKey')?.value || '').trim().toLowerCase().replace(/\s+/g,'_');
    const name = (document.getElementById('boardName')?.value || '').trim();
    const aliasesRaw = (document.getElementById('boardAliases')?.value || '').trim();
    const aliases = aliasesRaw ? aliasesRaw.split(',').map(a=>a.trim().toLowerCase()).filter(Boolean) : [];
    if (!key || !name) return showAlert('Error', 'Board key and name are required.');
    const isEditing = document.getElementById('boardKey')?.readOnly;
    if (!_boardBase64 && !isEditing) return showAlert('Error', 'Please select a logo image.');
    const payload = { name, key, aliases };
    if (_boardBase64) payload.image = _boardBase64;
    db.ref(`global_nat_boards/${key}`).update(payload).then(() => {
        document.getElementById('addBoardModal').style.display = 'none';
        document.getElementById('boardKey').value = '';
        document.getElementById('boardKey').readOnly = false;
        document.getElementById('boardName').value = '';
        document.getElementById('boardAliases').value = '';
        document.getElementById('boardImageFile').value = '';
        document.getElementById('boardPreview').style.display = 'none';
        const t = document.querySelector('#addBoardModal h2'); if(t) t.textContent='Upload Board Logo';
        const b = document.getElementById('btnSubmitBoard'); if(b) b.textContent='UPLOAD BOARD';
        _boardBase64 = '';
        showAlert('Success', `Board logo for "${name}" saved.`);
    });
};

window.editNatBoard = (key) => {
    const entry = globalNatBoards[key]; if (!entry) return;
    const name = typeof entry === 'object' ? (entry.name || key) : key;
    document.getElementById('boardKey').value = key;
    document.getElementById('boardKey').readOnly = true;
    document.getElementById('boardName').value = name;
    document.getElementById('boardAliases').value = Array.isArray(entry?.aliases) ? entry.aliases.join(', ') : '';
    _boardBase64 = entry.image || '';
    const p = document.getElementById('boardPreview'), pi = document.getElementById('boardPreviewImg');
    if (p && pi && _boardBase64) { pi.src = _boardBase64; p.style.display='block'; }
    const t = document.querySelector('#addBoardModal h2'); if(t) t.textContent='Edit Board Logo';
    const b = document.getElementById('btnSubmitBoard'); if(b) b.textContent='UPDATE BOARD';
    document.getElementById('addBoardModal').style.display = 'flex';
};
window.deleteNatBoard = (key) => showConfirm('Delete Board', `Remove "${key}"?`, () => db.ref(`global_nat_boards/${key}`).remove());

// ─ 8. Leagues ───────────────────────────────────────────────────────
function renderLeagues() {
    const container = document.getElementById('leaguesContainer');
    if (!container) return;
    const keys = Object.keys(globalLeagues);
    if (!keys.length) {
        container.innerHTML = '<p style="color:#666; text-align:center; padding:20px;">No leagues created yet. Click "+ Create League" to start.</p>';
        return;
    }
    container.innerHTML = '';
    keys.forEach(key => {
        const lg = globalLeagues[key] || {};
        const logo = lg.logo || '';
        const section = document.createElement('div');
        section.style.cssText = 'background:#111; border:1px solid #2d2d3f; border-radius:10px; margin-bottom:14px; overflow:hidden;';
        section.innerHTML = `
            <div style="display:flex; align-items:center; gap:14px; padding:14px 16px; background:#0d0d18; position:relative;">
                ${logo ? `<img src="${esc(logo)}" style="height:40px; width:40px; object-fit:contain; flex-shrink:0; filter:drop-shadow(0 0 4px rgba(255,255,255,0.2));">` : '<div style="width:40px;height:40px;background:#1a1a2e;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#444;font-size:18px;">🏆</div>'}
                <div style="flex:1; min-width:0;">
                    <div style="color:#fff; font-weight:800; font-size:14px;">${esc(lg.short || key.toUpperCase())}</div>
                    <div style="color:#666; font-size:10px; margin-top:2px;">${esc(lg.name || '')} · <span style="color:#0dcaf0; font-family:monospace;">${esc(key)}</span></div>
                    <div style="margin-top:4px; font-size:9px; color:#555; background:#0a0a0f; padding:2px 8px; border-radius:10px; display:inline-block;">Set as <code style="color:#ffc107;">${esc(lg.short || key)}</code> in the Franchise label to group teams here</div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    <button onclick="window.editLeague('${esc(key)}')" style="background:rgba(0,123,255,0.8); color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:10px; cursor:pointer;">✏️ Edit</button>
                    <button onclick="window.deleteLeague('${esc(key)}')" style="background:rgba(220,53,69,0.8); color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:10px; cursor:pointer;">✕</button>
                </div>
            </div>
        `;
        container.appendChild(section);
    });
}

let _leagueLogoBase64 = '';
window.previewLeagueLogo = function(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        _leagueLogoBase64 = e.target.result;
        const p = document.getElementById('leagueLogoPreview');
        const pi = document.getElementById('leagueLogoPreviewImg');
        if (p && pi) { pi.src = _leagueLogoBase64; p.style.display='block'; }
    };
    reader.readAsDataURL(file);
};

window.handleLeagueSave = function() {
    const key   = (document.getElementById('leagueKey')?.value || '').trim().toLowerCase().replace(/\s+/g,'_');
    const name  = (document.getElementById('leagueName')?.value || '').trim();
    const short = (document.getElementById('leagueShort')?.value || '').trim();
    if (!key || !name) return showAlert('Error', 'League key and name are required.');
    const payload = { name, short: short || key.toUpperCase() };
    if (_leagueLogoBase64) payload.logo = _leagueLogoBase64;
    db.ref(`global_leagues/${key}`).update(payload).then(() => {
        document.getElementById('addLeagueModal').style.display = 'none';
        document.getElementById('leagueKey').value = '';
        document.getElementById('leagueKey').readOnly = false;
        document.getElementById('leagueName').value = '';
        document.getElementById('leagueShort').value = '';
        document.getElementById('leagueLogoFile').value = '';
        document.getElementById('leagueLogoPreview').style.display = 'none';
        const t = document.querySelector('#addLeagueModal h2'); if(t) t.textContent='Create League';
        const b = document.getElementById('btnSubmitLeague'); if(b) b.textContent='CREATE LEAGUE';
        _leagueLogoBase64 = '';
        showAlert('Success', `League "${name}" saved. Set franchise labels to "${short || key.toUpperCase()}" to group teams here.`);
    });
};

window.editLeague = (key) => {
    const lg = globalLeagues[key]; if (!lg) return;
    document.getElementById('leagueKey').value = key;
    document.getElementById('leagueKey').readOnly = true;
    document.getElementById('leagueName').value = lg.name || '';
    document.getElementById('leagueShort').value = lg.short || '';
    _leagueLogoBase64 = lg.logo || '';
    const p = document.getElementById('leagueLogoPreview'), pi = document.getElementById('leagueLogoPreviewImg');
    if (p && pi && _leagueLogoBase64) { pi.src = _leagueLogoBase64; p.style.display='block'; }
    const t = document.querySelector('#addLeagueModal h2'); if(t) t.textContent='Edit League';
    const b = document.getElementById('btnSubmitLeague'); if(b) b.textContent='UPDATE LEAGUE';
    document.getElementById('addLeagueModal').style.display = 'flex';
};
window.deleteLeague = (key) => showConfirm('Delete League', `Remove league "${key}"?`, () => db.ref(`global_leagues/${key}`).remove());
