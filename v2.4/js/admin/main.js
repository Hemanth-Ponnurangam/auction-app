import { db } from '../shared/firebase.js';
import { showAlert, showConfirm, showPrompt, esc, closeModal } from '../shared/dom.js';
import { parseVanillaCSV } from './csv.js';

let activeDatabases = {};
let globalImages = {};
let globalTeams = {};

window.onload = () => {
    // Dynamically inject the Logo URL input into the Add Team Modal
    const colorInput = document.getElementById('ntColor');
    if (colorInput) {
        const logoHtml = `<label class="modal-label" style="margin-top:15px;">Logo URL (Transparent PNG)</label>
                          <input type="text" id="ntLogo" class="modal-input" placeholder="https://.../logo.png">`;
        colorInput.insertAdjacentHTML('afterend', logoHtml);
    }

    // Convert the Image Directory table into a Card Grid container
    const imgPanel = document.querySelector('#tab-images .panel > div:last-child');
    if (imgPanel) {
        imgPanel.innerHTML = '<div id="imgCardGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:15px; padding:15px;"></div>';
    }

    attachTabListeners();
};

document.getElementById('btnAdminLogin').addEventListener('click', () => {
    let pin = document.getElementById('adminPinInput').value.trim();
    db.ref('super_admin_pin').once('value', snap => {
        if (snap.val() === pin) {
            document.getElementById('adminLoginScreen').style.display = 'none';
            document.getElementById('masterDashboard').style.display = 'flex';
            initAdminSystems();
        } else {
            showAlert('Access Denied', 'Invalid System PIN.');
        }
    });
});

document.getElementById('btnLogoutAdmin').addEventListener('click', () => {
    window.location.reload();
});

function initAdminSystems() {
    db.ref('presets').on('value', snap => {
        activeDatabases = snap.val() || {};
        renderDatabaseManager();
    });

    db.ref('global_player_images').on('value', snap => {
        globalImages = snap.val() || {};
        renderImageCards();
    });

    db.ref('global_teams').on('value', snap => {
        globalTeams = snap.val() || {};
        renderGlobalTeams();
    });
}

function attachTabListeners() {
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById('tab-' + e.target.getAttribute('data-tab')).classList.add('active');
        });
    });
}

// ─ Database Manager (Expandable Player Lists & CSV/Manual Append) ────

function renderDatabaseManager() {
    const list = document.getElementById('presetDbList');
    list.innerHTML = '';

    if (Object.keys(activeDatabases).length === 0) {
        list.innerHTML = '<p style="color:#666; text-align:center;">No databases uploaded yet.</p>';
        return;
    }

    Object.keys(activeDatabases).forEach(dbName => {
        const players = activeDatabases[dbName] || [];
        
        const dbCard = document.createElement('div');
        dbCard.style.cssText = 'background:#111; border:1px solid #333; border-radius:8px; margin-bottom:10px; overflow:hidden;';
        
        // Header
        const header = document.createElement('div');
        header.style.cssText = 'padding:15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; background:#161620;';
        header.innerHTML = `
            <div>
                <strong style="color:#0dcaf0; font-size:16px;">${esc(dbName)}</strong>
                <span style="color:#888; font-size:11px; margin-left:10px;">${players.length} Players</span>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="action-btn" style="background:#28a745;" onclick="appendPlayersToDB(event, '${dbName}')">+ Add Players</button>
                <button class="action-btn outline" onclick="togglePlayerList(event, 'list-${dbName}')">▼ View</button>
            </div>
        `;
        
        // Expandable Player List
        const playerContainer = document.createElement('div');
        playerContainer.id = `list-${dbName}`;
        playerContainer.style.cssText = 'display:none; padding:10px; background:#0a0a0f; border-top:1px solid #222; max-height:300px; overflow-y:auto;';
        
        let pListHtml = players.map((p, i) => `
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
}

window.togglePlayerList = (e, targetId) => {
    e.stopPropagation();
    const container = document.getElementById(targetId);
    if (container.style.display === 'none') {
        container.style.display = 'block';
        e.target.textContent = '▲ Hide';
    } else {
        container.style.display = 'none';
        e.target.textContent = '▼ View';
    }
};

window.appendPlayersToDB = (e, dbName) => {
    e.stopPropagation();
    showConfirm(`Append to ${dbName}`, 'Do you want to upload a CSV file or add names manually?', 
    () => {
        // Upload CSV Path
        let input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = ev => {
            let file = ev.target.files[0];
            if (!file) return;
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
                db.ref(`presets/${dbName}`).set([...existing, ...newPlayers]).then(() => {
                    showAlert('Success', `Appended ${newPlayers.length} players to ${dbName} via CSV.`);
                });
            };
            reader.readAsText(file);
        };
        input.click();
    },
    () => {
        // Manual Entry Path
        setTimeout(() => {
            showPrompt('Manual Entry', 'Enter player names separated by commas (e.g. MS Dhoni, Virat Kohli):', '', (val) => {
                if (!val) return;
                const newNames = val.split(',').map(n => n.trim()).filter(Boolean);
                const existing = activeDatabases[dbName] || [];
                
                const newPlayers = newNames.map(name => ({
                    name: name, base_price: 20000000, role: 'BAT', nationality: 'Indian', status: 'available', set: 'Uncapped'
                }));

                db.ref(`presets/${dbName}`).set([...existing, ...newPlayers]).then(() => {
                    showAlert('Success', `Appended ${newPlayers.length} players to ${dbName}.`);
                });
            });
        }, 100);
    });
};

// ─ Image Directory (Card Layout & Multi-URL) ─────────────────────

function renderImageCards() {
    const grid = document.getElementById('imgCardGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const query = document.getElementById('adminImgSearch')?.value.toLowerCase() || '';

    Object.keys(globalImages).forEach(playerName => {
        if (query && !playerName.toLowerCase().includes(query)) return;

        let imgData = globalImages[playerName];
        if (typeof imgData === 'string') {
            imgData = { active: imgData, urls: [imgData] };
        }
        
        const activeUrl = imgData.active || imgData.urls[0] || '';
        
        const card = document.createElement('div');
        card.style.cssText = 'background:#161620; border:1px solid #2d2d3f; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 5px 15px rgba(0,0,0,0.4);';
        
        card.innerHTML = `
            <div style="height:180px; background:#000; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;">
                <img src="${esc(activeUrl)}" style="width:100%; height:100%; object-fit:cover; object-position:top;" onerror="this.src=''; this.alt='No Image'">
                <div style="position:absolute; bottom:0; left:0; right:0; background:linear-gradient(transparent, rgba(0,0,0,0.9)); padding:10px;">
                    <h3 style="margin:0; color:#fff; font-size:16px;">${esc(playerName)}</h3>
                </div>
            </div>
            <div style="padding:12px; display:flex; flex-direction:column; gap:8px; flex:1;">
                <label style="font-size:10px; color:#888; text-transform:uppercase;">Select Active Source:</label>
                <select class="admin-select" style="min-width:100%; padding:6px; font-size:11px;" onchange="updateActiveUrl('${esc(playerName)}', this.value)">
                    ${imgData.urls.map(u => `<option value="${esc(u)}" ${u === activeUrl ? 'selected' : ''}>${esc(u)}</option>`).join('')}
                </select>
                <button class="action-btn outline" style="width:100%; font-size:10px; margin-top:auto;" onclick="addUrlToPlayer('${esc(playerName)}')">+ Add Alt URL</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

window.updateActiveUrl = (playerName, newUrl) => {
    db.ref(`global_player_images/${playerName}/active`).set(newUrl);
};

window.addUrlToPlayer = (playerName) => {
    showPrompt('Add Image URL', `Paste new image URL for ${playerName}:`, 'https://...', (url) => {
        if (!url) return;
        let imgData = globalImages[playerName];
        if (typeof imgData === 'string') imgData = { active: imgData, urls: [imgData] };
        
        if (!imgData.urls.includes(url)) {
            imgData.urls.push(url);
            imgData.active = url; 
            db.ref(`global_player_images/${playerName}`).set(imgData);
        }
    });
};

document.getElementById('adminImgSearch')?.addEventListener('input', renderImageCards);

// ─ Global Franchises (Transparent Logos) ─────────────────────────

function renderGlobalTeams() {
    const list = document.getElementById('globalTeamsList');
    list.innerHTML = '';

    Object.keys(globalTeams).forEach(code => {
        const t = globalTeams[code];
        const card = document.createElement('div');
        card.className = 'team-card';
        card.style.borderColor = t.color;
        card.style.position = 'relative';
        
        const logoHtml = t.logo ? `<img src="${esc(t.logo)}" style="max-height:50px; max-width:80px; margin-bottom:10px; object-fit:contain; filter:drop-shadow(0 0 5px rgba(255,255,255,0.2));" alt="logo">` : '';

        card.innerHTML = `
            <button class="action-btn danger" style="position:absolute; top:5px; right:5px; padding:2px 6px; font-size:10px;" onclick="deleteGlobalTeam('${esc(code)}')">✕</button>
            ${logoHtml}
            <div class="t-code" style="color:${esc(t.color)}">${esc(code)}</div>
            <div class="t-name">${esc(t.name)}</div>
        `;
        list.appendChild(card);
    });
}

document.getElementById('btnOpenAddTeamModal').addEventListener('click', () => {
    document.getElementById('addTeamModal').style.display = 'flex';
});

document.getElementById('btnCloseAddTeam').addEventListener('click', () => {
    document.getElementById('addTeamModal').style.display = 'none';
});

document.getElementById('btnSubmitAddTeam').addEventListener('click', () => {
    const code = document.getElementById('ntCode').value.trim().toUpperCase();
    const name = document.getElementById('ntName').value.trim();
    const color = document.getElementById('ntColor').value;
    const logoInput = document.getElementById('ntLogo'); 
    const logo = logoInput ? logoInput.value.trim() : '';

    if (!code || !name) {
        showAlert('Error', 'Team code and name are required.');
        return;
    }

    db.ref(`global_teams/${code}`).set({ name, color, logo }).then(() => {
        document.getElementById('addTeamModal').style.display = 'none';
        document.getElementById('ntCode').value = '';
        document.getElementById('ntName').value = '';
        if (logoInput) logoInput.value = '';
    });
});

window.deleteGlobalTeam = (code) => {
    showConfirm('Delete Franchise', `Are you sure you want to delete ${code} from global registry?`, () => {
        db.ref(`global_teams/${code}`).remove();
    });
};
