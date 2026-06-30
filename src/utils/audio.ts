let sirenInterval: any = null;
let sirenCtx: AudioContext | null = null;
let sirenOscs: Array<OscillatorNode> = [];

/**
 * Triggers a beautiful, cascading ambient focus drone using the Web Audio API.
 * Synthesizes a calming sound similar to a Tibetan singing bowl.
 */
export function playPavlovianCue() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const playTone = (freq: number, startDelay: number, duration: number, type: OscillatorType = "sine") => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);

      // Low pass filter to make it warmer
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, ctx.currentTime);

      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      // Gentle fade in
      gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + startDelay + 0.3);
      // Long slow fade out
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startDelay + duration);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(ctx.currentTime + startDelay);
      osc.stop(ctx.currentTime + startDelay + duration);
    };

    // Synthesize a harmonious chord (C major 9: C, E, G, B, D)
    playTone(130.81, 0.0, 3.5, "sine"); // C3
    playTone(196.00, 0.2, 3.0, "sine"); // G3
    playTone(246.94, 0.4, 2.5, "triangle"); // B3 (warm triangle)
    playTone(293.66, 0.6, 2.0, "sine"); // D4
  } catch (err) {
    console.warn("Failed to play Web Audio cue:", err);
  }
}

/**
 * Plays a loud, persistent, pulsing alarm siren for the Zero-Miss Alert.
 * Alternates between 880Hz and 660Hz until stopped.
 */
export function startSiren() {
  stopSiren();
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    sirenCtx = new AudioContextClass();

    let high = true;
    const triggerBeep = () => {
      if (!sirenCtx) return;
      
      const osc = sirenCtx.createOscillator();
      const gainNode = sirenCtx.createGain();
      
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(high ? 880 : 587, sirenCtx.currentTime);
      high = !high;

      // Filter to take off the harsh edge but keep it extremely attention-grabbing
      const filter = sirenCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = 1000;

      gainNode.gain.setValueAtTime(0.2, sirenCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, sirenCtx.currentTime + 0.35);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(sirenCtx.destination);

      osc.start();
      osc.stop(sirenCtx.currentTime + 0.4);
      sirenOscs.push(osc);
    };

    triggerBeep();
    sirenInterval = setInterval(triggerBeep, 400);
  } catch (err) {
    console.warn("Failed to start siren:", err);
  }
}

/**
 * Stops the Zero-Miss Alarm.
 */
export function stopSiren() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  sirenOscs.forEach(o => {
    try { o.stop(); } catch(e){}
  });
  sirenOscs = [];
  if (sirenCtx) {
    try { sirenCtx.close(); } catch(e){}
    sirenCtx = null;
  }
}
