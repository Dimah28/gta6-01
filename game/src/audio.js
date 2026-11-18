// Generative WebAudio sound: no audio files, everything is synthesised.
// Created lazily on the first user gesture (browsers block audio before one).
// "SOLMAR FM" is a quiet generative radio pad (Am–F–C–G) that plays while
// driving, plus engine, sirens, a NOS whoosh and a helicopter rotor thump.

const RADIO_CHORDS = [
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
];

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let radioGain = null;
  let radioOscs = [];
  let radioChord = 0;
  let radioTimer = 0;
  let heliOsc = null;
  let heliGain = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (started) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // Engine: two detuned saws through a lowpass, pitch follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 28;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filter);
      engineOsc2.connect(filter);
      filter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      // Siren: a triangle wave that alternates between two tones.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 720;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      // Radio: three soft triangles playing a slow chord pad.
      radioGain = ctx.createGain();
      radioGain.gain.value = 0;
      radioGain.connect(master);
      radioOscs = RADIO_CHORDS[0].map((freq) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = 0.33;
        o.connect(g);
        g.connect(radioGain);
        o.start();
        return o;
      });
      // Helicopter rotor: a low square thump, amplitude-modulated.
      heliOsc = ctx.createOscillator();
      heliOsc.type = 'square';
      heliOsc.frequency.value = 42;
      const heliFilter = ctx.createBiquadFilter();
      heliFilter.type = 'lowpass';
      heliFilter.frequency.value = 160;
      heliGain = ctx.createGain();
      heliGain.gain.value = 0;
      heliOsc.connect(heliFilter);
      heliFilter.connect(heliGain);
      heliGain.connect(master);
      heliOsc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, dur, type, vol, slideTo) {
    if (!ensure() || muted) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    } catch { /* audio is best-effort */ }
  }

  function noise(dur, vol, freq) {
    if (!ensure() || muted) return;
    try {
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq || 1200;
      const g = ctx.createGain();
      g.gain.value = vol || 0.3;
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start();
    } catch { /* audio is best-effort */ }
  }

  return {
    ensure,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    /** Called every frame with the driving state. */
    update(dt, { driving, speed, wanted, policeNear, nosBoosting, heli }) {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const target = driving ? 0.05 + Math.min(0.09, speed / 7000) : 0;
      engineGain.gain.setTargetAtTime(muted ? 0 : target, ctx.currentTime, 0.1);
      if (engineOsc) {
        const boost = nosBoosting ? 1.35 : 1;
        engineOsc.frequency.setTargetAtTime((55 + speed * 0.16) * boost, ctx.currentTime, 0.08);
        engineOsc2.frequency.setTargetAtTime((28 + speed * 0.08) * boost, ctx.currentTime, 0.08);
      }
      if (wanted >= 2 && policeNear) {
        sirenTimer += dt;
        const hi = Math.floor(sirenTimer * 1.6) % 2 === 0;
        sirenOsc.frequency.setTargetAtTime(hi ? 880 : 620, ctx.currentTime, 0.05);
        sirenGain.gain.setTargetAtTime(muted ? 0 : 0.035, ctx.currentTime, 0.2);
      } else {
        sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      }
      // Radio pad: on while driving, chord changes every 4 seconds.
      if (driving) {
        radioTimer += dt;
        if (radioTimer > 4) {
          radioTimer = 0;
          radioChord = (radioChord + 1) % RADIO_CHORDS.length;
          RADIO_CHORDS[radioChord].forEach((freq, i) => {
            if (radioOscs[i]) radioOscs[i].frequency.setTargetAtTime(freq, ctx.currentTime, 0.4);
          });
        }
        radioGain.gain.setTargetAtTime(muted ? 0 : 0.05, ctx.currentTime, 0.5);
      } else {
        radioGain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      }
      // Rotor thump while the helicopter is overhead.
      heliGain.gain.setTargetAtTime(muted || !heli ? 0 : 0.05, ctx.currentTime, 0.3);
    },
    shot() { noise(0.12, 0.35, 900); },
    punch() { noise(0.08, 0.25, 300); },
    pickup() { blip(660, 0.09, 'sine', 0.2); setTimeout(() => blip(990, 0.12, 'sine', 0.2), 70); },
    cash() { blip(880, 0.08, 'triangle', 0.22); setTimeout(() => blip(1174, 0.1, 'triangle', 0.22), 80); setTimeout(() => blip(1568, 0.16, 'triangle', 0.22), 160); },
    crash() { noise(0.25, 0.4, 220); },
    alarm() { blip(1200, 0.15, 'square', 0.12, 700); },
    nos() { noise(0.5, 0.25, 2400); },
    mission() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.18, 'triangle', 0.25), i * 110));
    },
    fail() { [400, 320, 240].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'sawtooth', 0.15), i * 140)); },
    click() { blip(900, 0.04, 'square', 0.1); },
  };
}
