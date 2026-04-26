/**
 * js/shared/dom.js
 * * Handles universal DOM utilities like escaping strings and managing the global App Modal.
 */

let _modalCb = null;

/**
 * Escapes HTML characters to prevent XSS attacks when injecting user data.
 */
export function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/**
 * Debounce utility to prevent functions (like search rendering) from firing too rapidly.
 */
export function debounce(fn, ms) {
    let t; 
    return function(...a) { 
        clearTimeout(t); 
        t = setTimeout(() => fn.apply(this, a), ms); 
    };
}

// --- Universal Modal System ---

function _openModal(title, msg, hasInput) {
    document.getElementById('modalTitle').textContent   = title;
    document.getElementById('modalMessage').textContent = msg;
    document.getElementById('modalInput').style.display = hasInput ? 'block' : 'none';
    document.getElementById('appModal').style.display   = 'flex';
}

export function closeModal(result) {
    document.getElementById('appModal').style.display = 'none';
    if (_modalCb) { 
        let cb = _modalCb; 
        _modalCb = null; 
        cb(result); 
    }
}

// Make closeModal globally available so inline HTML onclick="" attributes can find it
window.closeModal = closeModal;

export function showAlert(title, msg, onOk) {
    _openModal(title, msg, false);
    document.getElementById('modalButtons').innerHTML = `<button class="action-btn" style="flex:1;" onclick="closeModal(true)">OK</button>`;
    _modalCb = onOk || null;
}

export function showConfirm(title, msg, onYes, onNo) {
    _openModal(title, msg, false);
    document.getElementById('modalButtons').innerHTML =
        `<button class="action-btn danger" style="flex:1;" onclick="closeModal(true)">CONFIRM</button>
         <button class="action-btn outline" style="flex:1;" onclick="closeModal(false)">CANCEL</button>`;
    _modalCb = r => r ? (onYes && onYes()) : (onNo && onNo());
}

export function showPrompt(title, msg, placeholder, onSubmit) {
    _openModal(title, msg, true);
    let inp = document.getElementById('modalInput');
    inp.placeholder = placeholder || ''; 
    inp.value = '';
    document.getElementById('modalButtons').innerHTML =
        `<button class="action-btn" style="flex:1;" onclick="closeModal(true)">CONFIRM</button>
         <button class="action-btn outline" style="flex:1;" onclick="closeModal(false)">CANCEL</button>`;
    _modalCb = r => { 
        if (r && onSubmit) onSubmit(document.getElementById('modalInput').value.trim()); 
    };
}