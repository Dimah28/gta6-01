// Solmar Bay — procedural sound engine (Web Audio, no audio files).
// Everything is synthesized at runtime: engine hum, sirens, cash chimes,
// mission fanfare and wind. All calls are safe before the AudioContext
// exists (ensure() is called from a user gesture) and never throw.
const MUTE_KEY = 'solmar-bay.muted.v1';

function loadMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = loadMuted();
  let engine = null; // { osc, gain, filter }
  let siren = null; // { osc, gain, lfo }
  let wind = null; // { src, gain, filter }
  let lastNos = false;
  let sirenOn = false;

  function ensureContext() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  // Short enveloped tone. notes: [freq, timeOffset] pairs.
  function blip(notes, type, vol, dur) {
    if (!ensureContext() || muted) return;
    try {
      const t0 = ctx.currentTime;
      for (const [freq, at] of notes) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0 + at);
        g.gain.setValueAtTime(0, t0 + at);
        g.gain.linearRampToValueAtTime(vol, t0 + at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(t0 + at);
        osc.stop(t0 + at + dur + 0.05);
      }
    } catch { /* audio must never break the game */ }
  }

  // Looping noise source (wind / NOS whoosh) built from a 2s buffer.
  function makeNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  function startLoops() {
    if (!ctx) return;
    try {
      // Engine: sawtooth through a lowpass, pitch follows speed.
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 2;
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start();
      engine = { osc, gain, filter };

      // Police siren: triangle wave whose frequency is wobbled by an LFO.
      const sOsc = ctx.createOscillator();
      const sGain = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      sOsc.type = 'triangle';
      sOsc.frequency.value = 780;
      lfo.type = 'square';
      lfo.frequency.value = 0.55;
      lfoGain.gain.value = 190;
      lfo.connect(lfoGain);
      lfoGain.connect(sOsc.frequency);
      sGain.gain.value = 0;
      sOsc.connect(sGain);
      sGain.connect(master);
      sOsc.start();
      lfo.start();
      siren = { osc: sOsc, gain: sGain, lfo };

      // Wind: looped noise through a bandpass, gain follows speed.
      const src = makeNoise();
      const wFilter = ctx.createBiquadFilter();
      const wGain = ctx.createGain();
      wFilter.type = 'bandpass';
      wFilter.frequency.value = 900;
      wFilter.Q.value = 0.6;
      wGain.gain.value = 0;
      src.connect(wFilter);
      wFilter.connect(wGain);
      wGain.connect(master);
      src.start();
      wind = { src, gain: wGain, filter: wFilter };
    } catch { /* loops are optional ambience */ }
  }

  function whoosh() {
    if (!ensureContext() || muted) return;
    try {
      const src = makeNoise();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(500, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(3200, ctx.currentTime + 0.45);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
      src.stop(ctx.currentTime + 0.75);
    } catch { /* ignore */ }
  }

  return {
    // One-shot: cash register chime (two bright sine blips, major third up).
    cash() {
      blip([[987.77, 0], [1318.51, 0.07]], 'sine', 0.22, 0.28);
    },
    // One-shot: police wail when the player first gets spotted.
    alarm() {
      blip([[659.25, 0], [880, 0.22], [659.25, 0.44], [880, 0.66]], 'triangle', 0.16, 0.24);
    },
    // One-shot: mission complete fanfare (C major arpeggio, rising).
    mission() {
      blip([[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27]], 'sine', 0.2, 0.34);
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      return muted;
    },
    get muted() { return muted; },
    ensure() {
      if (ensureContext() && !engine) startLoops();
    },
    // Per-frame ambience. info: { driving, speed, wanted, policeNear,
    // nosBoosting, heli }. All gains are smoothed so nothing clicks.
    update(dt, info) {
      if (!ctx || muted) return;
      try {
        const speed = Math.abs(info.speed || 0);
        const driving = !!info.driving;
        const t = ctx.currentTime;
        if (engine) {
          const targetFreq = 52 + speed * 0.22 + (info.nosBoosting ? 55 : 0);
          engine.osc.frequency.setTargetAtTime(targetFreq, t, 0.08);
          engine.filter.frequency.setTargetAtTime(380 + speed * 1.1, t, 0.1);
          engine.gain.gain.setTargetAtTime(driving ? 0.05 + Math.min(0.09, speed * 0.00012) : 0, t, 0.12);
        }
        const wantSiren = info.wanted >= 2 && !!info.policeNear;
        if (siren) {
          if (wantSiren && !sirenOn) sirenOn = true;
          if (!wantSiren && sirenOn) sirenOn = false;
          siren.gain.gain.setTargetAtTime(wantSiren ? 0.045 : 0, t, 0.25);
        }
        if (wind) {
          wind.gain.gain.setTargetAtTime(driving ? Math.min(0.12, speed * 0.00016) : 0, t, 0.2);
          wind.filter.frequency.setTargetAtTime(700 + speed * 1.6, t, 0.2);
        }
        if (info.nosBoosting && !lastNos) whoosh();
        lastNos = !!info.nosBoosting;
      } catch { /* ambience must never break the game */ }
    },
  };
}
