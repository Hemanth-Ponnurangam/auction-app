/**
 * render.js
 * Builds the HTML lists for the Deck, Unsold, and Squads tabs.
 */

import { state } from './state.js';
import { esc } from './dom.js';

const CRORE = 10_000_000;

function isOverseas(p) {
    return !['india','indian','ind'].includes((p.nationality || 'Indian').trim().toLowerCase());
}

function planeIcon(p) {
    return isOverseas(p) ? `<span class="neon-plane" title="${esc(p.nationality)}">✈️</span>` : '';
}

/**
 * Renders the On Deck player list.
 * @param {string} containerId - The HTML element ID to output to.
 * @param {string} activeSet - The currently selected set.
 * @param {string} searchTerm - Search input value.
 * @param {string} roleFilter - Active role filter ('BAT', 'BWL', etc.).
 * @param {Set} watchlist - (Franchise only) Set of watchlisted player names.
 * @param {boolean} isAuctioneer - If true, shows "Push" buttons instead of stars.
 */
export function renderDeckList(containerId, activeSet, searchTerm, roleFilter, watchlist, isAuctioneer = false) {
    let inProgress = state.liveState.auction_state === 'bidding' || state.liveState.auction_state === 'cooldown';
    let html = '';
    
    let filtered = state.playerPool.map((p, index) => ({ p, index })).filter(item => {
        let p = item.p;
        if (p.set !== activeSet || p.status === 'sold' || p.status === 'unsold') return false;
        if (searchTerm && !p.name.toLowerCase().includes(searchTerm)) return false;
        
        if (roleFilter === 'STAR' && watchlist) {
            if (!watchlist.has(p.name)) return false;
        } else if (roleFilter && !(p.role || '').toUpperCase().includes(roleFilter)) {
            return false;
        }
        return true;
    });

    // Sort: Stars first (if franchise), then price descending, then name
    filtered.sort((a, b) => {
        if (!isAuctioneer && watchlist) {
            let aStar = watchlist.has(a.p.name) ? 1 : 0;
            let bStar = watchlist.has(b.p.name) ? 1 : 0;
            if (aStar !== bStar) return bStar - aStar;
        }
        if (b.p.base_price !== a.p.base_price) return b.p.base_price - a.p.base_price;
        return (a.p.name || '').localeCompare(b.p.name || '');
    });

    filtered.forEach(item => {
        let p = item.p;
        let roleLabel = p.role ? `<span style="font-size:9px; color:#007bff; font-weight:bold; margin-left:6px; background:rgba(0,123,255,.1); border:1px solid rgba(0,123,255,.2); padding:1px 4px; border-radius:4px;">${esc(p.role)}</span>` : '';
        
        let actionHTML = '';
        let bgStyle = '';

        if (isAuctioneer) {
            let disabled = inProgress ? 'disabled style="opacity:.3; cursor:not-allowed;"' : '';
            actionHTML = `<button class="btn-push" ${disabled} onclick="pushPlayerToBlock(${item.index})">Push</button>`;
        } else if (watchlist) {
            let isStarred = watchlist.has(p.name);
            let starCol = isStarred ? '#ffc107' : '#444';
            bgStyle = isStarred ? 'background:rgba(255,193,7,.05);' : '';
            actionHTML = `<button onclick="toggleWatch('${esc(p.name)}')" style="background:transparent; border:none; color:${starCol}; font-size:18px; cursor:pointer; padding:0 5px; transition:0.2s;">★</button>`;
        }

        html += `<div class="list-item" style="${bgStyle}">
            <div class="item-info">
                <div style="display:flex; align-items:center; margin-bottom:3px;">
                    <span class="item-name">${esc(p.name)} ${planeIcon(p)}</span>${roleLabel}
                </div>
                <span class="item-price">Base: ₹${(p.base_price/CRORE).toFixed(2)} Cr</span>
            </div>
            ${actionHTML}
        </div>`;
    });

    document.getElementById(containerId).innerHTML = html || "<p style='color:#666; font-size:11px; text-align:center; margin-top:10px;'>No players match filters.</p>";
}

/**
 * Renders the Unsold player list.
 */
export function renderUnsoldList(containerId, searchTerm, isAuctioneer = false) {
    let inProgress = state.liveState.auction_state === 'bidding' || state.liveState.auction_state === 'cooldown';
    let html = '';

    state.playerPool.forEach((p, index) => {
        if (p.status !== 'unsold') return;
        if (searchTerm && !p.name.toLowerCase().includes(searchTerm)) return;
        
        let roleLabel = p.role ? `<span style="font-size:9px; color:#007bff; font-weight:bold; margin-left:6px; background:rgba(0,123,255,.1); border:1px solid rgba(0,123,255,.2); padding:1px 4px; border-radius:4px;">${esc(p.role)}</span>` : '';
        
        let actionHTML = '';
        if (isAuctioneer) {
            let disabled = inProgress ? 'disabled style="opacity:.3; cursor:not-allowed;"' : '';
            actionHTML = `<button class="btn-repush" ${disabled} onclick="pushPlayerToBlock(${index})">Re-Push</button>`;
        }

        html += `<div class="list-item" style="border-left-color:#dc3545;">
            <div class="item-info">
                <div style="display:flex; align-items:center; margin-bottom:3px;">
                    <span class="item-name">${esc(p.name)} ${planeIcon(p)}</span>${roleLabel}
                </div>
                <span class="item-price">Base: ₹${(p.base_price/CRORE).toFixed(2)} Cr | Set: ${esc(p.set)}</span>
            </div>
            ${actionHTML}
        </div>`;
    });

    document.getElementById(containerId).innerHTML = html || "<p style='color:#666; font-size:11px; text-align:center; margin-top:10px;'>No unsold players.</p>";
}

/**
 * Renders a specific team's squad list.
 */
export function renderSquadList(containerId, targetTeam, searchTerm) {
    if (!targetTeam) { 
        document.getElementById(containerId).innerHTML = "<p style='color:#666; font-size:11px; text-align:center;'>Select a team.</p>"; 
        return; 
    }

    let roster = state.playerPool.filter(p => p.status === 'sold' && p.team === targetTeam && (!searchTerm || p.name.toLowerCase().includes(searchTerm)));
    let order = state.allRegisteredTeams[targetTeam]?.rosterOrder || [];
    
    roster.sort((a,b) => { 
        let ai = order.indexOf(a.name), bi = order.indexOf(b.name); 
        if(ai === -1) ai = 999; 
        if(bi === -1) bi = 999; 
        return ai - bi; 
    });

    let ranks = [...new Set(roster.map(p => p.sold_price))].filter(v => v > 0).sort((a,b) => b - a);
    let [gold, silver, bronze] = [ranks[0]||-1, ranks[1]||-1, ranks[2]||-1];
    
    let tColor = state.allRegisteredTeams[targetTeam]?.color || '#333';
    let roles = state.allRegisteredTeams[targetTeam]?.playerRoles || {};
    let xiOrder = state.allRegisteredTeams[targetTeam]?.playingXI || [];

    let html = roster.map(p => {
        let rawR = roles[p.name] || '';
        let roleHtml = rawR.split(',').filter(Boolean).map(r => `<span style="font-size:9px; color:${r==='WK'?'#0dcaf0':'#ffc107'}; font-weight:bold; margin-left:3px;">${r}</span>`).join('');
        let pc = p.sold_price === gold ? '#eab308' : p.sold_price === silver ? '#c0c0c0' : p.sold_price === bronze ? '#cd7f32' : '#aaa';
        
        // Show XI/Bench badge (primarily used by Franchise, harmless to show for Auctioneer)
        let isXI = xiOrder.includes(p.name);
        let xiBadge = isXI
            ? `<span style="font-size:8px; color:#28a745; border:1px solid #28a745; padding:1px 3px; border-radius:3px; margin-left:6px;">XI</span>`
            : `<span style="font-size:8px; color:#666; border:1px solid #444; padding:1px 3px; border-radius:3px; margin-left:6px;">BENCH</span>`;

        return `<div class="list-item" style="border-left-color:${tColor}">
            <div class="item-info">
                <div style="display:flex; align-items:center; margin-bottom:3px;">
                    <span class="item-name">${esc(p.name)} ${planeIcon(p)}</span>${roleHtml}${xiBadge}
                </div>
                <span class="item-price" style="color:${pc}; font-weight:bold;">₹${(p.sold_price/CRORE).toFixed(2)} Cr</span>
            </div>
        </div>`;
    }).join('');

    document.getElementById(containerId).innerHTML = html || `<p style='color:#666; font-size:11px; text-align:center;'>Squad is empty.</p>`;
}