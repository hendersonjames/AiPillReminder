// soundService.ts
// AudioContext is created lazily on first user interaction to comply with
// browser autoplay policies (especially iOS Safari).

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
  } catch {
    console.warn('Web Audio API not supported in this browser.');
    return null;
  }
};

const playTone = (frequency: number, duration: number, type: OscillatorType = 'sine') => {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (required after user gesture on iOS)
  const doPlay = () => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  };

  if (ctx.state === 'suspended') {
    ctx.resume().then(doPlay).catch(err => console.warn('AudioContext resume failed:', err));
  } else {
    doPlay();
  }
};

export const soundOptions: { [key: string]: string } = {
  'default': 'Default Beep',
  'chime': 'Chime',
  'alert': 'Alert',
};

export const playSound = (soundId: string = 'default') => {
  switch (soundId) {
    case 'chime':
      playTone(880, 0.2);
      setTimeout(() => playTone(1046.50, 0.3), 150);
      break;
    case 'alert':
      playTone(1200, 0.1, 'sawtooth');
      setTimeout(() => playTone(1200, 0.1, 'sawtooth'), 150);
      setTimeout(() => playTone(1200, 0.1, 'sawtooth'), 300);
      break;
    case 'default':
    default:
      playTone(600, 0.15, 'sine');
      setTimeout(() => playTone(600, 0.15, 'sine'), 200);
      break;
  }
};
