const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function resumeCtx() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function playSound(type) {
    if (!audioCtx) return;
    resumeCtx();

    const now = audioCtx.currentTime;

    if (type === 'bid') {
        // Sharp metallic tick — paddle snap
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
        gain.gain.setValueAtTime(0.55, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.start(now); osc.stop(now + 0.07);

    } else if (type === 'sold') {
        // Gavel hammer — three descending wooden thuds
        [0, 0.14, 0.28].forEach((delay, i) => {
            const buf  = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.25), audioCtx.sampleRate);
            const data = buf.getChannelData(0);
            const decay = audioCtx.sampleRate * 0.04;
            for (let j = 0; j < data.length; j++) {
                data[j] = (Math.random() * 2 - 1) * Math.exp(-j / decay);
            }
            const src  = audioCtx.createBufferSource();
            const lp   = audioCtx.createBiquadFilter();
            const gain = audioCtx.createGain();
            lp.type = 'lowpass';
            lp.frequency.value = i === 2 ? 600 : 1100;
            src.buffer = buf;
            src.connect(lp); lp.connect(gain); gain.connect(audioCtx.destination);
            const vol = i === 2 ? 0.95 : 0.55;
            gain.gain.setValueAtTime(vol, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.22);
            src.start(now + delay); src.stop(now + delay + 0.25);
        });

    } else if (type === 'timer_warn') {
        // Urgent short beep
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1100, now + 0.08);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.12);
        osc.start(now); osc.stop(now + 0.13);

    } else if (type === 'new_player') {
        // Ascending double-chime — spotlight moment
        [0, 0.11].forEach((delay, i) => {
            const osc  = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(i === 0 ? 880 : 1320, now + delay);
            gain.gain.setValueAtTime(0.35, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);
            osc.start(now + delay); osc.stop(now + delay + 0.35);
        });

    } else if (type === 'unsold') {
        // Low dull thud — rejected
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.26);
        gain.gain.setValueAtTime(0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now); osc.stop(now + 0.3);

    } else if (type === 'paddle_pass') {
        // Double ping — paddle handover
        [0, 0.15].forEach(delay => {
            const osc  = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1047, now + delay);
            gain.gain.setValueAtTime(0.28, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.25);
            osc.start(now + delay); osc.stop(now + delay + 0.28);
        });
    }
}
