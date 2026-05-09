import { state } from './state.js';
import { esc } from './dom.js';

const CRORE = 10_000_000;

export function renderDeckList(containerId, activeSet, searchQuery, roleFilter, watchlistSet = null, isAuctioneer = false) {
    let list = document.getElementById(containerId);
    if (!list) return;

    let filtered = state.playerPool.map((p, i) => ({ p, i })).filter(item => {
        if (!item.p || item.p.status === 'sold' || item.p.status === 'unsold') return false;
        if (activeSet && item.p.set !== activeSet) return false;
        if (searchQuery && !(item.p.name||'').toLowerCase().includes(searchQuery)) return false;
        
        if (roleFilter === 'STAR' && watchlistSet) {
            if (!watchlistSet.has(item.p.name)) return false;
        } else if (roleFilter) {
            let pR = (item.p.role || '').toUpperCase();
            if (roleFilter === 'BAT' && !pR.includes('BAT')) return false;
            if (roleFilter === 'BWL' && !pR.includes('BOWL')) return false;
            if (roleFilter === 'ALL' && !pR.includes('ALL')) return false;
            if (roleFilter === 'WK' && !pR.includes('WK')) return false;
        }
        return true;
    });

    if (!filtered.length) { list.innerHTML = `<div style="text-align:center; padding:20px; color:#666; font-size:12px;">No players found.</div>`; return; }

    let html = '';
    filtered.forEach(item => {
        let isStar = watchlistSet ? watchlistSet.has(item.p.name) : false;
        let starBtn = watchlistSet ? `<button style="background:transparent; border:none; color:${isStar?'#ffc107':'#444'}; font-size:14px; cursor:pointer;" onclick="toggleWatch('${esc(item.p.name)}')">★</button>` : '';
        // FIX: Was using onclick="pushPlayerToBlock()" which calls window.pushPlayerToBlock — never defined.
        // Now uses data-push-index so the event delegation in auctioneer/main.js catches it correctly.
        let btn = isAuctioneer ? `<button class="action-btn" style="padding:4px 8px; font-size:10px;" data-push-index="${item.i}">PUSH</button>` : `<div style="text-align:right;">${starBtn}</div>`;
        let roleStr = item.p.role ? `<span style="font-size:9px; background:#222; padding:2px 6px; border-radius:4px; color:#0dcaf0;">${esc(item.p.role)}</span>` : '';
        let isOv = !['india','indian','ind'].includes((item.p.nationality || 'Indian').trim().toLowerCase());
        let plane = isOv ? '✈️' : '';

        html += `<div class="list-item"><div class="item-info"><span class="item-name">${esc(item.p.name)} <span style="font-size:10px;">${plane}</span></span><span class="item-price">Base: ₹${(item.p.base_price/CRORE).toFixed(2)} Cr ${roleStr}</span></div>${btn}</div>`;
    });
    list.innerHTML = html;
}

export function renderUnsoldList(containerId, searchQuery, isAuctioneer = false) {
    let list = document.getElementById(containerId);
    if (!list) return;

    let filtered = state.playerPool.map((p, i) => ({ p, i })).filter(item => {
        if (!item.p || item.p.status !== 'unsold') return false;
        if (searchQuery && !(item.p.name||'').toLowerCase().includes(searchQuery)) return false;
        return true;
    });

    if (!filtered.length) { list.innerHTML = `<div style="text-align:center; padding:20px; color:#666; font-size:12px;">No unsold players.</div>`; return; }

    let html = '';
    filtered.forEach(item => {
        // FIX: Same as PUSH — was using onclick="pushPlayerToBlock()" which calls undefined window fn.
        let btn = isAuctioneer ? `<button class="action-btn danger" style="padding:4px 8px; font-size:10px; background:#dc3545; color:#fff;" data-push-index="${item.i}">RE-PUSH</button>` : `<span style="color:#dc3545; font-size:10px; font-weight:bold;">UNSOLD</span>`;
        html += `<div class="list-item" style="border-left-color:#dc3545;"><div class="item-info"><span class="item-name">${esc(item.p.name)}</span><span class="item-price">Base: ₹${(item.p.base_price/CRORE).toFixed(2)} Cr</span></div>${btn}</div>`;
    });
    list.innerHTML = html;
}

export function renderSquadList(containerId, targetTeam, searchQuery) {
    let list = document.getElementById(containerId);
    if (!list) return;
    if (!targetTeam) { list.innerHTML = ''; return; }

    let filtered = state.playerPool.filter(p => {
        if (!p || p.status !== 'sold' || p.team !== targetTeam) return false;
        if (searchQuery && !(p.name||'').toLowerCase().includes(searchQuery)) return false;
        return true;
    });

    if (!filtered.length) { list.innerHTML = `<div style="text-align:center; padding:20px; color:#666; font-size:12px;">Squad is empty.</div>`; return; }

    let html = '';
    filtered.forEach(p => {
        let roleStr = p.role ? `<span style="font-size:9px; background:#222; padding:2px 6px; border-radius:4px; color:#0dcaf0;">${esc(p.role)}</span>` : '';
        html += `<div class="list-item" style="border-left-color:#28a745;"><div class="item-info"><span class="item-name">${esc(p.name)}</span><span class="item-price">Bought: <strong style="color:#28a745;">₹${(p.sold_price/CRORE).toFixed(2)} Cr</strong> ${roleStr}</span></div></div>`;
    });
    list.innerHTML = html;
}
