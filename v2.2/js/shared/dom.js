export function esc(str) {
    if (!str) return '';
    let div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

export function closeModal() {
    let modal = document.getElementById('appModal');
    if (modal) modal.style.display = 'none';
}

export function showAlert(title, msg) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = msg;
    document.getElementById('modalInput').style.display = 'none';
    let btnDiv = document.getElementById('modalButtons');
    btnDiv.innerHTML = `<button class="action-btn" style="width:100%;" onclick="closeModal()">OK</button>`;
    document.getElementById('appModal').style.display = 'flex';
}

export function showConfirm(title, msg, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = msg;
    document.getElementById('modalInput').style.display = 'none';
    let btnDiv = document.getElementById('modalButtons');
    btnDiv.innerHTML = `<button class="action-btn danger" style="flex:1;" id="btnConfOk">CONFIRM</button><button class="action-btn outline" style="flex:1;" onclick="closeModal()">CANCEL</button>`;
    document.getElementById('appModal').style.display = 'flex';
    document.getElementById('btnConfOk').onclick = () => { closeModal(); onConfirm(); };
}

// ... (keep esc, closeModal, showConfirm as they are) ...

export function showPrompt(title, msg, placeholder, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = msg;
    let inp = document.getElementById('modalInput');
    inp.style.display = 'block'; 
    inp.value = ''; 
    inp.placeholder = placeholder || '';
    
    let btnDiv = document.getElementById('modalButtons');
    btnDiv.innerHTML = `<button class="action-btn" style="flex:1;" id="btnPromptOk">SUBMIT</button><button class="action-btn outline" style="flex:1;" id="btnPromptCancel">CANCEL</button>`;
    
    document.getElementById('appModal').style.display = 'flex';
    inp.focus();
    
    // FIX: Use event listeners, always call onConfirm
    document.getElementById('btnPromptOk').addEventListener('click', () => {
        let val = inp.value.trim(); 
        closeModal(); 
        onConfirm(val); 
    });
    
    document.getElementById('btnPromptCancel').addEventListener('click', closeModal);
    
    inp.onkeypress = (e) => { 
        if (e.key === 'Enter') document.getElementById('btnPromptOk').click(); 
    };
}

window.closeModal = closeModal;
