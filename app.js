let audioCtx;
let analyser;
let isListening = false;

// 持続音（ドローン）管理用の変数
let baseOscillator = null;
let baseGainNode = null;
let isSoundMuted = false;

// モード管理 ('random' | 'manual')
let currentMode = 'random';

const BASE_NOTES = [
  { name: 'ド (C4)', midi: 60 },
  { name: 'レ (D4)', midi: 62 },
  { name: 'ミ (E4)', midi: 64 },
  { name: 'ファ (F4)', midi: 65 },
  { name: 'ソ (G4)', midi: 67 },
  { name: 'ラ (A4)', midi: 69 }
];

const INTERVALS = [
  { name: '長3度上（明るい上ハモリ）', semitones: 4 },
  { name: '短3度上（切ない上ハモリ）', semitones: 3 },
  { name: '完全5度上（力強い上ハモリ）', semitones: 7 },
  { name: '長3度下（低いハモリ）', semitones: -4 },
  { name: '短3度下（低いハモリ）', semitones: -3 }
];

const NOTE_NAMES = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

let currentBaseFreq = 261.63;
let currentTargetFreq = 329.63;
let isCleared = false;
let holdStartTime = null;
const REQUIRED_HOLD_MS = 1200;

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

// ==========================================
// 持続音（ドローン）の制御ロジック
// ==========================================
function startSustainedBase(freq) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (baseOscillator && baseGainNode) {
    baseOscillator.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.03);
    updateSoundVolume();
    return;
  }

  baseOscillator = audioCtx.createOscillator();
  baseGainNode = audioCtx.createGain();

  baseOscillator.type = 'triangle';
  baseOscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);

  baseGainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
  baseOscillator.connect(baseGainNode);
  baseGainNode.connect(audioCtx.destination);
  baseOscillator.start();

  updateSoundVolume();
}

function updateSoundVolume() {
  if (!baseGainNode || !audioCtx) return;
  const targetVol = isSoundMuted ? 0.0001 : 0.15;
  baseGainNode.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.05);

  const btn = document.getElementById('toggle-sound-btn');
  if (isSoundMuted) {
    btn.innerText = '🔇 基準音: 停止中（クリックで再生）';
    btn.classList.add('muted');
  } else {
    btn.innerText = '🔊 基準音: 再生中（クリックで停止）';
    btn.classList.remove('muted');
  }
}

// 正解の音だけを3秒間鳴らし、その間は基準音をミュートする
function playTargetSolo(duration = 3.0) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const now = audioCtx.currentTime;

  // 1. 鳴り続けている基準音を一時的にミュート（消音）する
  if (baseGainNode) {
    baseGainNode.gain.cancelScheduledValues(now);
    baseGainNode.gain.setTargetAtTime(0.0001, now, 0.03);

    // 3秒後、ユーザー自身が手動ミュートしていなければ基準音を元の音量に戻す
    if (!isSoundMuted) {
      baseGainNode.gain.setTargetAtTime(0.15, now + duration, 0.05);
    }
  }

  // 2. 正解の音（ターゲット音）だけを3秒間再生する
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(currentTargetFreq, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
  // 終了直前まで音量を維持し、最後にフェードアウト
  gain.gain.setValueAtTime(0.18, now + duration - 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration);
}

// ==========================================
// 問題セットとモード管理
// ==========================================
function setQuestion(baseObj, intervalObj) {
  const targetMidi = baseObj.midi + intervalObj.semitones;
  currentBaseFreq = midiToFreq(baseObj.midi);
  currentTargetFreq = midiToFreq(targetMidi);

  isCleared = false;
  holdStartTime = null;
  document.getElementById('progress-bar').style.width = '0%';

  document.getElementById('question-title').innerText = `基準音: ${baseObj.name}`;
  document.getElementById('question-sub').innerText = `お題: ${intervalObj.name} → 正解音: ${midiToNoteName(targetMidi)}`;

  if (isListening) {
    document.getElementById('status').innerText = '流れている音にハモらせてください...';
    document.getElementById('status').style.color = '#333';
    startSustainedBase(currentBaseFreq);
  }
}

function nextQuestion() {
  if (currentMode === 'random') {
    const base = BASE_NOTES[Math.floor(Math.random() * BASE_NOTES.length)];
    const interval = INTERVALS[Math.floor(Math.random() * INTERVALS.length)];
    setQuestion(base, interval);
  } else {
    const baseIdx = document.getElementById('select-base').value;
    const intervalIdx = document.getElementById('select-interval').value;
    setQuestion(BASE_NOTES[baseIdx], INTERVALS[intervalIdx]);
  }
}

// ==========================================
// UIイベント設定
// ==========================================
document.getElementById('tab-random').addEventListener('click', () => {
  currentMode = 'random';
  document.getElementById('tab-random').classList.add('active');
  document.getElementById('tab-manual').classList.remove('active');
  document.getElementById('manual-controls').style.display = 'none';
  document.getElementById('next-btn').style.display = 'inline-block';
  nextQuestion();
});

document.getElementById('tab-manual').addEventListener('click', () => {
  currentMode = 'manual';
  document.getElementById('tab-manual').classList.add('active');
  document.getElementById('tab-random').classList.remove('active');
  document.getElementById('manual-controls').style.display = 'block';
  document.getElementById('next-btn').style.display = 'none';
  nextQuestion();
});

document.getElementById('select-base').addEventListener('change', nextQuestion);
document.getElementById('select-interval').addEventListener('change', nextQuestion);

document.getElementById('toggle-sound-btn').addEventListener('click', () => {
  if (!isListening) return;
  isSoundMuted = !isSoundMuted;
  updateSoundVolume();
});

document.getElementById('play-chord-btn').addEventListener('click', () => {
  playTargetSolo(3.0);
});

document.getElementById('next-btn').addEventListener('click', () => {
  nextQuestion();
});

document.getElementById('start-btn').addEventListener('click', async () => {
  if (isListening) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    isListening = true;
    document.getElementById('start-btn').style.display = 'none';
    nextQuestion();
    detectPitch();
  } catch (err) {
    alert('マイクの使用が許可されませんでした: ' + err);
  }
});

// ==========================================
// ピッチ検出ループ
// ==========================================
function detectPitch() {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  const freq = autoCorrelate(buffer, audioCtx.sampleRate);
  const statusEl = document.getElementById('status');
  const pitchEl = document.getElementById('pitch-display');
  const progressEl = document.getElementById('progress-bar');

  if (freq !== -1 && !isCleared) {
    pitchEl.innerText = `現在の周波数: ${freq.toFixed(1)} Hz (目標: ${currentTargetFreq.toFixed(1)} Hz)`;
    const cents = 1200 * Math.log2(freq / currentTargetFreq);

    if (Math.abs(cents) <= 25) {
      if (!holdStartTime) holdStartTime = performance.now();
      const elapsed = performance.now() - holdStartTime;
      const progress = Math.min((elapsed / REQUIRED_HOLD_MS) * 100, 100);
      progressEl.style.width = `${progress}%`;

      statusEl.innerText = '✨ そのままキープ！響きを感じて！';
      statusEl.style.color = '#059669';

      if (elapsed >= REQUIRED_HOLD_MS) {
        isCleared = true;
        statusEl.innerText = '🎉 クリア！完璧なハモリです！';
        playTargetSolo(3.0); // クリア時も正解の音だけを3秒間再生して答え合わせ
      }
    } else {
      holdStartTime = null;
      progressEl.style.width = '0%';

      if (cents > 25) {
        statusEl.innerText = '🔺 少し高いです（下げて）';
        statusEl.style.color = '#d97706';
      } else {
        statusEl.innerText = '🔻 少し低いです（上げて）';
        statusEl.style.color = '#2563eb';
      }
    }
  }

  if (isListening) {
    requestAnimationFrame(detectPitch);
  }
}

function autoCorrelate(buf, sampleRate) {
  let size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = size - 1, thres = 0.2;
  for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }

  buf = buf.slice(r1, r2);
  size = buf.length;

  const c = new Array(size).fill(0);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size - i; j++) c[i] = c[i] + buf[j] * buf[j + i];
  }

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < size; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  return sampleRate / maxpos;
}

// 初期化処理
window.addEventListener('DOMContentLoaded', () => {
  const baseSelect = document.getElementById('select-base');
  BASE_NOTES.forEach((note, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.innerText = note.name;
    baseSelect.appendChild(opt);
  });

  const intervalSelect = document.getElementById('select-interval');
  INTERVALS.forEach((inv, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.innerText = inv.name;
    intervalSelect.appendChild(opt);
  });

  setQuestion(BASE_NOTES[0], INTERVALS[0]);
});