// Web Audio API can be sensitive to user interaction. 
// Sounds may not play until the user has interacted with the page (e.g., clicked a button).
// This service attempts to resume the audio context if it's suspended.
const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

const playTone = (frequency: number, duration: number, type: OscillatorType = 'sine') => {
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.01); // Reduced volume
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + duration);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
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
            break;
        case 'default':
        default:
            playTone(600, 0.2, 'sine');
            break;
    }
};
