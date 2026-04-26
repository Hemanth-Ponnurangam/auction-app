/**
 * js/shared/audio.js
 * * Handles the synthesized Web Audio API sound effects.
 */

let _audioCtx = null;

function _getCtx() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
}

/**
 * Plays a synthesized sound based on the auction event type.
 * @param {string} type - 'bid', 'sold', or 'timer_warn'
 */
export function playSound(type) {
    try {
        let ctx = _getCtx();
        
        if (type === 'bid') {
            let o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.setValueAtTime(520, ctx.currentTime);
            o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
            g.gain.setValueAtTime(0.2, ctx.currentTime); // 0.2 for Franchise, Auctioneer used 0.25
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
            o.start(ctx.currentTime); 
            o.stop(ctx.currentTime + 0.12);
        } 
        else if (type === 'sold') {
            [0, 0.18, 0.36].forEach(delay => {
                let o = ctx.createOscillator(), g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(220, ctx.currentTime + delay);
                g.gain.setValueAtTime(0.4, ctx.currentTime + delay);
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
                o.start(ctx.currentTime + delay); 
                o.stop(ctx.currentTime + delay + 0.14);
            });
        } 
        else if (type === 'timer_warn') {
            let o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'square';
            o.frequency.setValueAtTime(660, ctx.currentTime);
            g.gain.setValueAtTime(0.09, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
            o.start(ctx.currentTime); 
            o.stop(ctx.currentTime + 0.07);
        }
    } catch(e) { 
        console.warn("Audio context failed or not allowed by browser:", e);
    }
}