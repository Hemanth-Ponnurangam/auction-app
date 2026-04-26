/**
 * squad.js
 * Handles Playing XI / Bench drag-and-drop sorting and Role Assignments (C, VC, WK).
 */

import { state } from '../shared/state.js';
import { showAlert } from '../shared/dom.js';

export let currentRolePlayer = '';

// --- Role Assignment ---

export function openRolePopup(e, playerName) {
    e.stopPropagation(); 
    currentRolePlayer = playerName;
    let popup = document.getElementById('rolePopup');
    popup.style.display = 'flex';
    let rect = e.target.getBoundingClientRect();
    popup.style.top  = rect.top + 'px';
    popup.style.left = rect.left + 'px';
}

export function setRole(role) {
    if (!currentRolePlayer || !state.roomRef) return;
    let curRoles = state.allRegisteredTeams[state.myTeamName]?.playerRoles || {};
    let updates  = {};
    let activeArr = (curRoles[currentRolePlayer] || '').split(',').filter(Boolean);

    if (role === '') {
        updates[currentRolePlayer] = null;
    } else {
        // Clear this role from all other players to prevent multiple Captains
        for (let p in curRoles) {
            if (p !== currentRolePlayer) {
                let pArr = (curRoles[p] || '').split(',').filter(r => r !== role);
                updates[p] = pArr.join(',') || null;
            }
        }

        if (activeArr.includes(role)) {
            activeArr = activeArr.filter(r => r !== role);
        } else {
            if (role === 'C') activeArr = activeArr.filter(r => r !== 'VC');
            if (role === 'VC') activeArr = activeArr.filter(r => r !== 'C');
            activeArr.push(role);

            if (role === 'C' || role === 'VC') {
                let title = role === 'C' ? 'Captain' : 'Vice Captain';
                let msg = `👑 ${currentRolePlayer} has been appointed as the ${title} of ${state.myTeamName}!`;
                state.roomRef.child('chat_events').push({ team: 'SYSTEM', text: msg, time: Date.now() });
            }
        }
        updates[currentRolePlayer] = activeArr.join(',') || null;
    }
    state.roomRef.child('teams_auth/' + state.myTeamName + '/playerRoles').update(updates);
    document.getElementById('rolePopup').style.display = 'none';
}

document.addEventListener('click', e => {
    let popup = document.getElementById('rolePopup');
    if (popup && popup.style.display === 'flex' && !popup.contains(e.target) && !e.target.classList.contains('role-badge')) {
        popup.style.display = 'none';
    }
});

// --- Drag and Drop Handlers ---

let dragSrcEl = null;
export let isDragging = false;

export function handleDragStart(e) {
    dragSrcEl = this;
    isDragging = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.getAttribute('data-player'));
    this.style.opacity = '.4';
}

export function handleDragOver(e)  { e.preventDefault(); return false; }
export function handleDragEnterItem() { this.classList.add('over'); }
export function handleDragLeaveItem() { this.classList.remove('over'); }
export function handleDragEnterZone() { this.classList.add('over-zone'); }
export function handleDragLeaveZone() { this.classList.remove('over-zone'); }

export function handleDrop(e) {
    e.stopPropagation();
    if (!dragSrcEl || dragSrcEl === this) return false;
    
    let destIsXI   = this.id === 'playingXIList' || !!this.closest('#playingXIList');
    let srcIsBench = !!dragSrcEl.closest('#benchList');
    
    if (destIsXI && srcIsBench) {
        let xiCount = document.querySelectorAll('#playingXIList .roster-item-drag').length;
        if (xiCount >= 11) { 
            showAlert('XI Full', 'Playing XI already has 11 players.'); 
            return false; 
        }
    }
    if (this.classList.contains('drop-zone')) {
        this.appendChild(dragSrcEl);
    } else {
        this.parentNode.insertBefore(dragSrcEl, this.nextSibling);
    }
    saveRosterOrder();
    return false;
}

export function handleDragEnd() {
    isDragging = false;
    if (dragSrcEl) dragSrcEl.style.opacity = '1';
    dragSrcEl = null;
    document.querySelectorAll('.roster-item').forEach(i => i.classList.remove('over'));
    document.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('over-zone'));
    
    // Dispatch a custom event to tell the UI to run updateMyTeamUI()
    window.dispatchEvent(new Event('rosterOrderUpdated'));
}

export function attachDragEvents(item) {
    item.addEventListener('dragstart',   handleDragStart,    false);
    item.addEventListener('dragenter',   handleDragEnterItem,false);
    item.addEventListener('dragover',    handleDragOver,     false);
    item.addEventListener('dragleave',   handleDragLeaveItem,false);
    item.addEventListener('drop',        handleDrop,         false);
    item.addEventListener('dragend',     handleDragEnd,      false);
}

export function saveRosterOrder() {
    let xi    = [...document.querySelectorAll('#playingXIList .roster-item-drag')].map(i => i.getAttribute('data-player'));
    let bench = [...document.querySelectorAll('#benchList .roster-item-drag')].map(i => i.getAttribute('data-player'));
    state.roomRef.child('teams_auth/' + state.myTeamName).update({ playingXI: xi, bench });
}

export function initDropZones() {
    document.querySelectorAll('.drop-zone').forEach(z => {
        z.addEventListener('dragover',       handleDragOver,      false);
        z.addEventListener('dragenter',      handleDragEnterZone, false);
        z.addEventListener('dragleave',      handleDragLeaveZone, false);
        z.addEventListener('drop',           handleDrop,          false);
    });
}

// Attach globals for HTML inline onclick
window.openRolePopup = openRolePopup;
window.setRole = setRole;