import { useState, useEffect, useMemo } from 'react';
import { Undo2, RotateCcw, ListOrdered, Copy, Check, ArrowLeft, Trophy } from 'lucide-react';

// ============= DATA =============

const COASTERS = [
  // ==== REPLACE THIS ARRAY WITH YOUR DATA ====
  // Each entry: { id, name, park, type }
  //   id   - unique integer, 1..N
  //   name - display name (shown in caps on the card)
  //   park - shown under the name; ALSO used to disambiguate same-named rides
  //   type - manufacturer/model label shown in amber (e.g. "B&M Invert", "RMC Hybrid").
  //          Also drives the colored fallback chip if an image is missing.
  // The build script (fetch_coaster_images.py) reads name+park to find photos.
  { id: 1, name: "Example Coaster One", park: "Example Park", type: "B&M Hyper" },
  { id: 2, name: "Example Coaster Two", park: "Another Park", type: "RMC Hybrid" },
  // ... add the rest of yours here ...
];

const STORAGE_KEY = 'coaster-ranking-v1';

// ============= ALGORITHM (unchanged) =============

function shuffleIndices(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============= ALGORITHM: FULL RANKING (bottom-up merge sort) =============

function initRuntime_full(coasters) {
  const queue = coasters.map(c => [c]);
  let state = { mode: 'full', queue, currentMerge: null, comparisonCount: 0, done: false, finalRanking: null };
  if (state.queue.length >= 2) {
    const left = state.queue.shift();
    const right = state.queue.shift();
    state.currentMerge = { left, right, leftIdx: 0, rightIdx: 0, result: [] };
  } else if (state.queue.length === 1) {
    state.done = true;
    state.finalRanking = state.queue[0];
  } else {
    // n=0 — empty list: complete with empty ranking instead of deadlocking the UI
    state.done = true;
    state.finalRanking = [];
  }
  return state;
}

function applyChoice_full(state, choice) {
  if (!state.currentMerge) return state;
  if (choice !== 'l' && choice !== 'r') return state;
  let queue = [...state.queue];
  let merge = {
    left: state.currentMerge.left,
    right: state.currentMerge.right,
    leftIdx: state.currentMerge.leftIdx,
    rightIdx: state.currentMerge.rightIdx,
    result: [...state.currentMerge.result],
  };
  if (choice === 'l') {
    merge.result.push(merge.left[merge.leftIdx]);
    merge.leftIdx++;
  } else {
    merge.result.push(merge.right[merge.rightIdx]);
    merge.rightIdx++;
  }
  let comparisonCount = state.comparisonCount + 1;
  let currentMerge = merge;
  let done = false;
  let finalRanking = null;
  while (currentMerge) {
    if (currentMerge.leftIdx >= currentMerge.left.length) {
      const finalRun = [...currentMerge.result, ...currentMerge.right.slice(currentMerge.rightIdx)];
      queue.push(finalRun);
      currentMerge = null;
    } else if (currentMerge.rightIdx >= currentMerge.right.length) {
      const finalRun = [...currentMerge.result, ...currentMerge.left.slice(currentMerge.leftIdx)];
      queue.push(finalRun);
      currentMerge = null;
    } else {
      break;
    }
    if (queue.length >= 2) {
      const left = queue.shift();
      const right = queue.shift();
      currentMerge = { left, right, leftIdx: 0, rightIdx: 0, result: [] };
    } else if (queue.length === 1) {
      done = true;
      finalRanking = queue[0];
      break;
    }
  }
  return { mode: 'full', queue, currentMerge, comparisonCount, done, finalRanking };
}

function getCurrentComparison_full(state) {
  if (!state.currentMerge) return null;
  return {
    left: state.currentMerge.left[state.currentMerge.leftIdx],
    right: state.currentMerge.right[state.currentMerge.rightIdx],
  };
}

// ============= ALGORITHM: TOP-K (binary-insertion into a sorted leaderboard) =============
// For each item: if topK is at capacity, first compare to the bottom of topK; if it
// wins, remove the bottom and binary-search for its insertion position. If topK is
// not yet full, skip the bottom-check and binary-search directly.

function _topKState(k, topK, pending, ev, comparisonCount, done, finalRanking) {
  return { mode: 'topK', k, topK, pending, ev, comparisonCount, done, finalRanking };
}

function _startNextEval(state) {
  if (state.pending.length === 0) {
    return { ...state, ev: null, done: true, finalRanking: state.topK };
  }
  const newItem = state.pending[0];
  const newPending = state.pending.slice(1);
  if (state.topK.length === 0) {
    // Safety: shouldn't happen post-bootstrap. If it does, seed topK and recurse.
    return _startNextEval({ ...state, topK: [newItem], pending: newPending });
  }
  const ev = (state.topK.length >= state.k)
    ? { newItem, phase: 'vsBottom' }
    : { newItem, phase: 'binarySearch', lo: 0, hi: state.topK.length };
  return { ...state, pending: newPending, ev };
}

function initRuntime_topK(coasters, k) {
  if (coasters.length === 0) return _topKState(k, [], [], null, 0, true, []);
  if (coasters.length === 1) return _topKState(k, coasters, [], null, 0, true, coasters);
  // Bootstrap: first item enters topK without a comparison.
  return _startNextEval(_topKState(k, [coasters[0]], coasters.slice(1), null, 0, false, null));
}

function applyChoice_topK(state, choice) {
  if (!state.ev || state.done) return state;
  if (choice !== 'l' && choice !== 'r') return state;
  const newCount = state.comparisonCount + 1;
  const ev = state.ev;

  if (ev.phase === 'vsBottom') {
    if (choice === 'r') {
      // newItem lost to bottom; discard and move on
      return _startNextEval({ ...state, comparisonCount: newCount });
    }
    // newItem beat bottom; kick out bottom and binary-search for position
    const newTopK = state.topK.slice(0, -1);
    return {
      ...state,
      topK: newTopK,
      ev: { newItem: ev.newItem, phase: 'binarySearch', lo: 0, hi: newTopK.length },
      comparisonCount: newCount,
    };
  }

  if (ev.phase === 'binarySearch') {
    const { lo, hi, newItem } = ev;
    const mid = Math.floor((lo + hi) / 2);
    const newLo = choice === 'l' ? lo : mid + 1;
    const newHi = choice === 'l' ? mid : hi;
    if (newLo >= newHi) {
      const newTopK = [...state.topK.slice(0, newLo), newItem, ...state.topK.slice(newLo)];
      return _startNextEval({ ...state, topK: newTopK, comparisonCount: newCount });
    }
    return {
      ...state,
      ev: { newItem, phase: 'binarySearch', lo: newLo, hi: newHi },
      comparisonCount: newCount,
    };
  }
  return state;
}

function getCurrentComparison_topK(state) {
  if (!state.ev) return null;
  const ev = state.ev;
  if (ev.phase === 'vsBottom') {
    return { left: ev.newItem, right: state.topK[state.topK.length - 1] };
  }
  if (ev.phase === 'binarySearch') {
    const mid = Math.floor((ev.lo + ev.hi) / 2);
    return { left: ev.newItem, right: state.topK[mid] };
  }
  return null;
}

// ============= DISPATCHERS =============

function initRuntime(coasters, mode, k) {
  if (mode === 'topK') return initRuntime_topK(coasters, k);
  return initRuntime_full(coasters);
}

function applyChoice(state, choice) {
  if (!state) return state;
  if (state.mode === 'topK') return applyChoice_topK(state, choice);
  return applyChoice_full(state, choice);
}

function getCurrentComparison(state) {
  if (!state) return null;
  if (state.mode === 'topK') return getCurrentComparison_topK(state);
  return getCurrentComparison_full(state);
}

function isValidSaveData(d) {
  // Cheap structural validation — saves us from rendering an undefined coaster
  // when COASTERS or the mode has changed between sessions.
  if (!d || !Array.isArray(d.initialShuffle) || !Array.isArray(d.choices)) return false;
  if (d.initialShuffle.length !== COASTERS.length) return false;
  if (d.mode !== 'full' && d.mode !== 'topK') return false;
  if (d.mode === 'topK' && (typeof d.k !== 'number' || d.k < 1)) return false;
  for (const i of d.initialShuffle) {
    if (typeof i !== 'number' || i < 0 || i >= COASTERS.length || !COASTERS[i]) return false;
  }
  for (const c of d.choices) {
    if (c !== 'l' && c !== 'r') return false;
  }
  return true;
}

function reconstructState(initialShuffle, choices, mode, k) {
  // Filter undefined defensively — if validation upstream missed something,
  // we'd rather start with a smaller list than crash on coaster.name.toUpperCase().
  const ordered = initialShuffle.map(i => COASTERS[i]).filter(Boolean);
  let state = initRuntime(ordered, mode, k);
  for (const c of choices) state = applyChoice(state, c);
  return state;
}

const SECONDS_PER_PICK = 4;

function estimateComparisons(n, mode, k) {
  if (n <= 1) return 0;
  if (mode === 'topK') {
    const kk = Math.min(k, n);
    const log2k = Math.ceil(Math.log2(Math.max(2, kk)));
    // Bootstrap: bring first k items into a sorted leaderboard via binary insertion
    const bootstrap = Math.ceil(kk * log2k);
    // Steady state: (n-kk) "vsBottom" checks; in a random stream the expected count
    // of items that ever beat the current bottom is ~k·ln(n/k), each costing log₂k extra.
    const wins = (n > kk) ? Math.ceil(kk * Math.log(n / kk)) : 0;
    const steady = (n - kk) + wins * log2k;
    return Math.round(bootstrap + steady);
  }
  return Math.ceil(n * Math.log2(n));
}

function estimateMinutes(comparisons) {
  return Math.max(1, Math.ceil(comparisons * SECONDS_PER_PICK / 60));
}

// ============= IMAGES (baked-in Wikipedia URLs) =============

const IMAGES = {
  // ==== REPLACE THIS OBJECT WITH THE OUTPUT OF fetch_coaster_images.py ====
  // Maps coaster id -> base64 data URL (or null if no image found).
  // Data URLs are used (not external links) because the artifact sandbox's
  // Content-Security-Policy blocks fetch() AND external <img src>. Inline
  // base64 is the only thing that reliably renders.
  // Example shape:
  //   1: "data:image/jpeg;base64,/9j/4AAQSk...",
  //   2: null,
  1: null,
  2: null,
};


// ============= STYLES =============

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');
  :root {
    --bg: #13100c;
    --surface: #1d1813;
    --surface-hi: #221c16;
    --surface-active: #2a2218;
    --text: #f5ebd6;
    --text-soft: #b8ab97;
    --text-mute: #6f6357;
    --border: #3a322a;
    --red: #d63a2f;
    --red-hi: #e85547;
    --amber: #f5a623;
    --amber-hi: #ffb83d;
    --silver: #c0c0c0;
    --bronze: #cd7f32;
  }
  .cr-app {
    background: var(--bg);
    color: var(--text);
    font-family: 'DM Sans', system-ui, sans-serif;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }
  .cr-grid-bg {
    position: absolute; inset: 0; pointer-events: none; opacity: 0.05;
    background-image: linear-gradient(var(--amber) 1px, transparent 1px), linear-gradient(90deg, var(--amber) 1px, transparent 1px);
    background-size: 48px 48px;
  }
  .cr-glow-bg {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse at 50% 0%, rgba(245, 166, 35, 0.07), transparent 60%);
  }
  .cr-display { font-family: 'Bebas Neue', Impact, sans-serif; letter-spacing: 0.02em; }
  .cr-mono { font-family: 'JetBrains Mono', 'Courier New', monospace; }
  .cr-text { color: var(--text); }
  .cr-text-soft { color: var(--text-soft); }
  .cr-text-mute { color: var(--text-mute); }
  .cr-text-amber { color: var(--amber); }
  .cr-text-red { color: var(--red); }
  .cr-text-silver { color: var(--silver); }
  .cr-text-bronze { color: var(--bronze); }

  .cr-progress-track { height: 3px; background: #2a2520; position: relative; overflow: hidden; }
  .cr-progress-fill {
    position: absolute; inset-block: 0; left: 0;
    background: linear-gradient(90deg, var(--red), var(--amber));
    transition: width 320ms ease-out;
  }

  .cr-card {
    background: var(--surface);
    border: 1px solid var(--border);
    transition: all 150ms ease;
    text-align: left;
    cursor: pointer;
    color: inherit;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
  }
  .cr-card:hover { background: var(--surface-hi); border-color: var(--amber); }
  .cr-card:active { background: var(--surface-active); }

  .cr-img-wrap {
    width: 100%;
    aspect-ratio: 16 / 10;
    background: #0e0b08;
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
  }
  .cr-card:hover .cr-img-wrap { border-bottom-color: rgba(245, 166, 35, 0.4); }
  .cr-img {
    width: 100%; height: 100%; object-fit: cover;
    display: block;
    transition: transform 400ms ease;
  }
  .cr-card:hover .cr-img { transform: scale(1.03); }
  .cr-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px;
    text-align: center;
    gap: 4px;
  }
  .cr-chip-label {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 40px;
    letter-spacing: 0.05em;
    line-height: 1;
  }
  @media (min-width: 768px) {
    .cr-chip-label { font-size: 56px; }
  }
  .cr-chip-sub {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
  @media (min-width: 768px) {
    .cr-chip-sub { font-size: 10px; }
  }

  .cr-card-body {
    padding: 16px 18px 18px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    position: relative;
  }
  @media (min-width: 768px) {
    .cr-card-body { padding: 20px 24px 22px; }
  }

  .cr-card-marker {
    position: absolute;
    top: -16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--text);
    background: var(--bg);
    padding: 2px 8px;
    border: 1px solid var(--border);
    transition: all 150ms;
  }
  .cr-card:hover .cr-card-marker { color: var(--bg); background: var(--amber); border-color: var(--amber); }
  .cr-card-marker.left { left: 14px; }
  .cr-card-marker.right { right: 14px; }

  .cr-card-name {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 30px;
    line-height: 0.98;
    letter-spacing: 0.025em;
    color: var(--text);
    word-break: break-word;
    margin: 0;
  }
  @media (min-width: 768px) {
    .cr-card-name { font-size: 42px; }
  }
  .cr-card:hover .cr-card-name { color: white; }

  .cr-card-type {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--amber);
    margin-top: 2px;
  }
  @media (min-width: 768px) {
    .cr-card-type { font-size: 11px; }
  }
  .cr-card-park {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-soft);
    padding-top: 8px;
    border-top: 1px dashed var(--border);
    margin-top: 4px;
  }
  @media (min-width: 768px) {
    .cr-card-park { font-size: 11px; }
  }

  .cr-vs {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 26px;
    letter-spacing: 0.25em;
    color: var(--amber);
    opacity: 0.75;
    text-align: center;
    padding: 4px 0;
  }
  @media (min-width: 768px) {
    .cr-vs { font-size: 36px; }
  }

  .cr-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 9px 13px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 150ms;
  }
  @media (min-width: 768px) { .cr-btn { font-size: 11px; padding: 10px 16px; } }
  .cr-btn:hover:not(:disabled) { border-color: var(--amber); color: var(--amber); }
  .cr-btn.danger:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
  .cr-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .cr-btn.primary { background: var(--amber); color: var(--bg); border-color: var(--amber); }
  .cr-btn.primary:hover:not(:disabled) { background: var(--amber-hi); border-color: var(--amber-hi); color: var(--bg); }
  .cr-btn.reset-primary { background: var(--red); color: white; border-color: var(--red); }
  .cr-btn.reset-primary:hover:not(:disabled) { background: var(--red-hi); border-color: var(--red-hi); }

  .cr-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--text-soft);
  }
  @media (min-width: 768px) { .cr-meta { font-size: 11px; } }

  .cr-headline {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 30px;
    letter-spacing: 0.06em;
    line-height: 1;
  }
  @media (min-width: 768px) { .cr-headline { font-size: 44px; } }

  .cr-rank-row {
    display: flex; align-items: baseline; gap: 14px;
    padding: 9px 0;
    border-bottom: 1px solid #2a2520;
  }
  .cr-rank-row:last-child { border-bottom: 0; }
  .cr-rank-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; color: var(--text-mute);
    width: 36px; text-align: right; font-variant-numeric: tabular-nums;
  }
  @media (min-width: 768px) { .cr-rank-num { font-size: 11px; } }
  .cr-rank-name {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 18px; letter-spacing: 0.03em; flex: 1;
  }
  @media (min-width: 768px) { .cr-rank-name { font-size: 20px; } }
  .cr-rank-type {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: var(--amber);
    opacity: 0.7;
    display: none;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  @media (min-width: 768px) { .cr-rank-type { display: inline; } }
  .cr-rank-park {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px; color: var(--text-mute);
    display: none;
  }
  @media (min-width: 900px) { .cr-rank-park { display: inline; } }

  .cr-podium {
    border: 1px solid; padding: 0; position: relative;
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  .cr-podium.gold { border-color: var(--amber); background: rgba(245, 166, 35, 0.06); }
  .cr-podium.silver { border-color: rgba(192, 192, 192, 0.4); background: rgba(192, 192, 192, 0.05); }
  .cr-podium.bronze { border-color: rgba(205, 127, 50, 0.4); background: rgba(205, 127, 50, 0.05); }
  .cr-podium .cr-img-wrap { aspect-ratio: 16 / 10; border: 0; }
  .cr-podium-body { padding: 18px 20px 20px; }

  .cr-mode-card {
    background: var(--surface);
    border: 1px solid var(--border);
    color: inherit;
    text-align: left;
    padding: 18px 18px 16px;
    cursor: pointer;
    transition: all 150ms ease;
    display: flex; flex-direction: column;
    font-family: inherit;
  }
  .cr-mode-card:hover { background: var(--surface-hi); border-color: var(--amber); }
  .cr-mode-card:active { background: var(--surface-active); }

  .cr-modal-bg {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex; align-items: center; justify-content: center;
    padding: 16px; z-index: 100;
  }
  .cr-modal {
    background: var(--surface); border: 1px solid var(--border);
    padding: 26px; max-width: 400px; width: 100%;
  }

  @keyframes cr-fadein {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .cr-fadein { animation: cr-fadein 240ms ease-out; }

  @keyframes cr-pulse {
    0% { color: var(--amber); transform: scale(1.04); }
    100% { color: inherit; transform: scale(1); }
  }
  .cr-pulse { animation: cr-pulse 380ms ease-out; display: inline-block; }
`;

// ============= COMPONENT =============

export default function App() {
  const [saveData, setSaveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('compare');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyPulse, setKeyPulse] = useState(0);

  const runtimeState = useMemo(() => {
    if (!saveData) return null;
    return reconstructState(saveData.initialShuffle, saveData.choices, saveData.mode, saveData.k);
  }, [saveData]);

  const currentComparison = useMemo(() => getCurrentComparison(runtimeState), [runtimeState]);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (result && result.value) {
          const parsed = JSON.parse(result.value);
          if (isValidSaveData(parsed)) {
            setSaveData(parsed);
          }
          // Otherwise saveData stays null -> ModeSelector renders. We do NOT
          // auto-start; the user must pick a mode each time they begin fresh.
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (runtimeState && runtimeState.done && view === 'compare') {
      setView('final');
    }
  }, [runtimeState, view]);

  function startWithMode(mode, k) {
    const initialShuffle = shuffleIndices(COASTERS.length);
    const data = { mode, k: mode === 'topK' ? k : 0, initialShuffle, choices: [] };
    setSaveData(data);
    persist(data);
    setView('compare');
  }

  async function persist(data) {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function handleChoice(choice) {
    if (!runtimeState || runtimeState.done || !currentComparison) return;
    const next = { ...saveData, choices: [...saveData.choices, choice] };
    setSaveData(next);
    persist(next);
    setKeyPulse(k => k + 1);
  }

  function handleUndo() {
    if (!saveData || saveData.choices.length === 0) return;
    const next = { ...saveData, choices: saveData.choices.slice(0, -1) };
    setSaveData(next);
    persist(next);
    if (view === 'final') setView('compare');
  }

  function handleReset() {
    // Clear save entirely -> ModeSelector reappears on next render
    setSaveData(null);
    setShowResetConfirm(false);
    setView('compare');
    window.storage.delete(STORAGE_KEY).catch(() => {});
  }

  useEffect(() => {
    function onKey(e) {
      if (view !== 'compare') return;
      if (!runtimeState || runtimeState.done) return;
      if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); handleChoice('l'); }
      else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); handleChoice('r'); }
      else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); handleUndo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, runtimeState, saveData]);

  if (loading) {
    return (
      <>
        <style>{styles}</style>
        <div className="cr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="cr-meta">Loading…</div>
        </div>
      </>
    );
  }

  // No save yet -> let the user pick a precision mode
  if (!saveData || !runtimeState) {
    return (
      <>
        <style>{styles}</style>
        <div className="cr-app">
          <div className="cr-grid-bg" />
          <div className="cr-glow-bg" />
          <div style={{ position: 'relative', maxWidth: '900px', margin: '0 auto', padding: '20px 16px 32px' }}>
            <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 22 }}>
              <h1 className="cr-display" style={{ fontSize: 26, letterSpacing: '0.05em', margin: 0 }}>
                COASTER<span className="cr-text-red">/</span>RANKER
              </h1>
              <div className="cr-meta">N={COASTERS.length}</div>
            </header>
            <ModeSelector n={COASTERS.length} onStart={startWithMode} />
          </div>
        </div>
      </>
    );
  }

  const total = estimateComparisons(COASTERS.length, saveData.mode, saveData.k);
  const count = runtimeState.comparisonCount;
  const pct = Math.min(100, total > 0 ? (count / total) * 100 : 100);
  const modeLabel = saveData.mode === 'topK' ? `TOP ${saveData.k}` : 'FULL';

  return (
    <>
      <style>{styles}</style>
      <div className="cr-app">
        <div className="cr-grid-bg" />
        <div className="cr-glow-bg" />
        <div style={{ position: 'relative', maxWidth: '1100px', margin: '0 auto', padding: '20px 16px 32px' }}>
          <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 22 }}>
            <h1 className="cr-display" style={{ fontSize: 26, letterSpacing: '0.05em', margin: 0 }}>
              COASTER<span className="cr-text-red">/</span>RANKER
            </h1>
            <div className="cr-meta">{modeLabel} · N={COASTERS.length}</div>
          </header>

          <div style={{ marginBottom: 22 }}>
            <div className="cr-meta" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span>Comparisons</span>
              <span key={keyPulse} className="cr-pulse">{count} / ~{total}</span>
            </div>
            <div className="cr-progress-track">
              <div className="cr-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {view === 'compare' && currentComparison && (
            <CompareView
              left={currentComparison.left}
              right={currentComparison.right}
              onChoose={handleChoice}
              keyPulse={keyPulse}
            />
          )}

          {view === 'standings' && (
            <StandingsView state={runtimeState} onBack={() => setView('compare')} />
          )}

          {view === 'final' && runtimeState.done && (
            <FinalView
              ranking={runtimeState.finalRanking}
              mode={saveData.mode}
              k={saveData.k}
              totalN={COASTERS.length}
              count={count}
              onCopy={() => {
                copyToClipboard(formatRanking(runtimeState.finalRanking, saveData.mode, saveData.k));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              onCopyCSV={() => {
                copyToClipboard(formatCSV(runtimeState.finalRanking, saveData.mode, saveData.k));
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              copied={copied}
              onReset={() => setShowResetConfirm(true)}
              onUndo={handleUndo}
            />
          )}

          {view === 'compare' && (
            <footer style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={handleUndo} disabled={saveData.choices.length === 0} className="cr-btn">
                <Undo2 size={12} /> Undo
              </button>
              <button onClick={() => setView('standings')} className="cr-btn">
                <ListOrdered size={12} /> Standings
              </button>
              <button onClick={() => setShowResetConfirm(true)} className="cr-btn danger">
                <RotateCcw size={12} /> Reset
              </button>
            </footer>
          )}

          {view === 'compare' && count === 0 && (
            <div className="cr-meta" style={{ textAlign: 'center', marginTop: 20, opacity: 0.55 }}>
              Tap the coaster you prefer · auto-saves
            </div>
          )}
        </div>

        {showResetConfirm && (
          <div className="cr-modal-bg" onClick={() => setShowResetConfirm(false)}>
            <div className="cr-modal" onClick={e => e.stopPropagation()}>
              <h3 className="cr-display" style={{ fontSize: 22, letterSpacing: '0.05em', margin: '0 0 12px' }}>RESET ALL PROGRESS?</h3>
              <p className="cr-text-soft" style={{ fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 }}>
                This erases all {count} comparisons and brings you back to the mode picker.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowResetConfirm(false)} className="cr-btn" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
                <button onClick={handleReset} className="cr-btn reset-primary" style={{ flex: 1, justifyContent: 'center' }}>Reset</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ============= MODE SELECTOR =============

function ModeSelector({ n, onStart }) {
  // Build the option list. Hide top-K modes where k >= n (they degenerate to Full).
  const opts = [];
  opts.push({ label: 'FULL RANKING', desc: `Complete 1 → ${n} ordering.`, mode: 'full', k: 0 });
  for (const k of [50, 25, 10]) {
    if (k < n) opts.push({ label: `TOP ${k}`, desc: `Find and rank just your top ${k}.`, mode: 'topK', k });
  }
  return (
    <div className="cr-fadein">
      <h2 className="cr-display" style={{ fontSize: 32, letterSpacing: '0.05em', margin: '0 0 4px' }}>SELECT MODE</h2>
      <p className="cr-text-soft" style={{ fontSize: 14, margin: '0 0 20px' }}>
        How precise do you want to be? Estimates assume ~4&nbsp;seconds per pick.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {opts.map(o => {
          const cmps = estimateComparisons(n, o.mode, o.k);
          const mins = estimateMinutes(cmps);
          return (
            <button key={o.label + o.k} onClick={() => onStart(o.mode, o.k)} className="cr-mode-card">
              <div className="cr-display" style={{ fontSize: 28, letterSpacing: '0.04em', marginBottom: 4 }}>
                {o.label}
              </div>
              <div className="cr-text-soft" style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.4 }}>
                {o.desc}
              </div>
              <div className="cr-meta cr-text-amber" style={{ fontSize: 11 }}>
                ~{cmps} picks · ~{mins} min
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============= COASTER IMAGE / FALLBACK CHIP =============

function getManufacturerInfo(type) {
  if (!type) return { label: '—', bg: '#2a2218', fg: '#b8ab97' };
  if (type.includes('B&M')) return { label: 'B&M', bg: '#1e3a5c', fg: '#e8f0fa' };
  if (type.includes('RMC')) return { label: 'RMC', bg: '#a8281f', fg: '#fde8e6' };
  if (type.includes('Intamin')) return { label: 'INTAMIN', bg: '#d4a017', fg: '#1a1208' };
  if (type.includes('Vekoma')) return { label: 'VEKOMA', bg: '#c0511a', fg: '#fef0e6' };
  if (type.includes('Arrow')) return { label: 'ARROW', bg: '#5a5a5a', fg: '#f0f0f0' };
  if (type.includes('GCI')) return { label: 'GCI', bg: '#7a4a2a', fg: '#fce8d0' };
  if (type.includes('Schwarzkopf')) return { label: 'SCHWARZKOPF', bg: '#8a2a2a', fg: '#fde8e0' };
  if (type.includes('Wooden') || type.includes('Wood')) return { label: 'WOODEN', bg: '#7a4a2a', fg: '#fce8d0' };
  if (type.includes('Mack')) return { label: 'MACK', bg: '#2a7a4a', fg: '#e0fae8' };
  if (type.includes('Premier')) return { label: 'PREMIER', bg: '#6a3a7a', fg: '#f4e6fa' };
  if (type.includes('S&S')) return { label: 'S&S', bg: '#b08a17', fg: '#fff8e0' };
  if (type.includes('Gerstlauer')) return { label: 'GERSTLAUER', bg: '#2a5a7a', fg: '#e0eefa' };
  if (type.includes('Giovanola')) return { label: 'GIOVANOLA', bg: '#5a6a7a', fg: '#eaf0f5' };
  if (type.includes('Morgan')) return { label: 'MORGAN', bg: '#7a7a3a', fg: '#fafae0' };
  if (type.includes('Zamperla')) return { label: 'ZAMPERLA', bg: '#2a7a7a', fg: '#e0fafa' };
  if (type.includes('Zierer')) return { label: 'ZIERER', bg: '#5a7a3a', fg: '#eafae0' };
  if (type.includes('Reverchon')) return { label: 'REVERCHON', bg: '#7a5a3a', fg: '#fceadc' };
  if (type.includes('Maurer')) return { label: 'MAURER', bg: '#8a7a3a', fg: '#fdf6dc' };
  if (type.includes('Wiegand')) return { label: 'WIEGAND', bg: '#6a6a8a', fg: '#eaeafa' };
  if (type.includes('Indoor')) return { label: 'INDOOR', bg: '#3a3550', fg: '#e0dcfa' };
  if (type.includes('Family')) return { label: 'FAMILY', bg: '#5a7a8a', fg: '#e0f0fa' };
  return { label: '—', bg: '#2a2218', fg: '#b8ab97' };
}

function CoasterImage({ coaster }) {
  const url = IMAGES[coaster.id];
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    const m = getManufacturerInfo(coaster.type);
    return (
      <div className="cr-img-wrap cr-chip" style={{ background: m.bg }}>
        <div className="cr-chip-label" style={{ color: m.fg }}>{m.label}</div>
        <div className="cr-chip-sub" style={{ color: m.fg, opacity: 0.7 }}>{coaster.type}</div>
      </div>
    );
  }

  return (
    <div className="cr-img-wrap">
      <img
        src={url}
        alt={coaster.name}
        className="cr-img"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// ============= SUBVIEWS =============

function CompareView({ left, right, onChoose, keyPulse }) {
  return (
    <div className="cr-fadein" key={keyPulse}>
      <div className="cr-meta" style={{ textAlign: 'center', marginBottom: 16, letterSpacing: '0.3em' }}>
        Which ride wins?
      </div>

      <div className="cr-pair">
        <CoasterCardFull coaster={left} side="L" onClick={() => onChoose('l')} />
        <div className="cr-vs">vs</div>
        <CoasterCardFull coaster={right} side="R" onClick={() => onChoose('r')} />
      </div>

      <style>{`
        .cr-pair {
          display: grid; grid-template-columns: 1fr; gap: 6px;
          align-items: stretch;
        }
        @media (min-width: 900px) {
          .cr-pair { grid-template-columns: 1fr auto 1fr; gap: 20px; }
        }
      `}</style>
    </div>
  );
}

function CoasterCardFull({ coaster, side, onClick }) {
  return (
    <button className="cr-card" onClick={onClick}>
      <CoasterImage coaster={coaster} />
      <div className="cr-card-body">
        <span className={`cr-card-marker ${side === 'L' ? 'left' : 'right'}`}>
          {side === 'L' ? '← 01' : '02 →'}
        </span>
        <div className="cr-card-name">{coaster.name.toUpperCase()}</div>
        <div className="cr-card-type">{coaster.type}</div>
        <div className="cr-card-park">{coaster.park}</div>
      </div>
    </button>
  );
}

function StandingsView({ state, onBack }) {
  // Top-K mode: standings are simply the current leaderboard, already sorted.
  if (state.mode === 'topK') {
    const seen = state.topK.length + (state.pending ? 0 : 0);
    const totalN = state.topK.length + (state.pending ? state.pending.length : 0) + (state.ev ? 1 : 0);
    const remaining = (state.pending ? state.pending.length : 0) + (state.ev ? 1 : 0);
    return (
      <div className="cr-fadein">
        <button onClick={onBack} className="cr-btn" style={{ marginBottom: 18 }}>
          <ArrowLeft size={12} /> Back to comparisons
        </button>
        <h2 className="cr-headline" style={{ margin: '0 0 8px' }}>CURRENT LEADERBOARD</h2>
        <p className="cr-text-soft" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 22, maxWidth: 600 }}>
          These are the {state.topK.length} coasters that have survived so far, in current order.
          {remaining > 0 ? ` ${remaining} more to evaluate.` : ''} The bottom of this list can still be displaced.
        </p>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {state.topK.map((c, i) => (
            <li key={c.id} className="cr-rank-row">
              <span className="cr-rank-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="cr-rank-name">{c.name}</span>
              <span className="cr-rank-type">{c.type}</span>
              <span className="cr-rank-park">{c.park}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // Full mode: longest sorted run is the best partial estimate
  const runs = [...state.queue];
  if (state.currentMerge) {
    const partial = [
      ...state.currentMerge.result,
      ...state.currentMerge.left.slice(state.currentMerge.leftIdx),
      ...state.currentMerge.right.slice(state.currentMerge.rightIdx),
    ];
    runs.push(partial);
  }
  runs.sort((a, b) => b.length - a.length);
  const longest = runs[0] || [];

  return (
    <div className="cr-fadein">
      <button onClick={onBack} className="cr-btn" style={{ marginBottom: 18 }}>
        <ArrowLeft size={12} /> Back to comparisons
      </button>
      <h2 className="cr-headline" style={{ margin: '0 0 8px' }}>PARTIAL STANDINGS</h2>
      <p className="cr-text-soft" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 22, maxWidth: 600 }}>
        Mid-sort, your ranking exists as several sorted groups. The longest is your best partial estimate. Full ranking emerges once all groups merge.
      </p>
      <div style={{ marginBottom: 28 }}>
        <div className="cr-meta" style={{ marginBottom: 12 }}>
          Longest sorted group · {longest.length} of {COASTERS.length}
        </div>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {longest.map((c, i) => (
            <li key={c.id} className="cr-rank-row">
              <span className="cr-rank-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="cr-rank-name">{c.name}</span>
              <span className="cr-rank-type">{c.type}</span>
              <span className="cr-rank-park">{c.park}</span>
            </li>
          ))}
        </ol>
      </div>
      {runs.length > 1 && (
        <div>
          <div className="cr-meta" style={{ marginBottom: 10 }}>Other groups · {runs.length - 1}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {runs.slice(1).map((r, i) => (
              <div key={i} className="cr-meta" style={{ border: '1px solid var(--border)', padding: '6px 10px', opacity: 0.6 }}>
                Group of {r.length}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FinalView({ ranking, mode, k, totalN, count, onCopy, onCopyCSV, copied, onReset, onUndo }) {
  // Guard small rankings: avoid undefined coaster.id / .name / .type / .park crashes
  if (!ranking || ranking.length === 0) {
    return (
      <div className="cr-fadein">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Trophy size={28} className="cr-text-amber" />
          <h2 className="cr-display" style={{ fontSize: 38, letterSpacing: '0.05em', margin: 0 }}>NOTHING TO RANK</h2>
        </div>
        <p className="cr-text-soft" style={{ fontSize: 14, marginBottom: 24, maxWidth: 560 }}>
          The COASTERS list is empty. Add entries to the array at the top of the artifact source and reload.
        </p>
        <button onClick={onReset} className="cr-btn danger">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    );
  }
  const podium = [0, 1, 2].filter(i => ranking[i]);
  const isTopK = mode === 'topK';
  const filteredOut = isTopK ? Math.max(0, (totalN || 0) - ranking.length) : 0;
  const heading = isTopK ? `TOP ${ranking.length}` : 'FINAL RANKING';
  return (
    <div className="cr-fadein">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <Trophy size={28} className="cr-text-amber" />
        <h2 className="cr-display" style={{ fontSize: 38, letterSpacing: '0.05em', margin: 0 }}>{heading}</h2>
      </div>
      <p className="cr-meta" style={{ marginBottom: filteredOut ? 6 : 24 }}>
        {count} comparisons · {ranking.length} coaster{ranking.length === 1 ? '' : 's'} ranked
      </p>
      {filteredOut > 0 && (
        <p className="cr-text-soft" style={{ fontSize: 13, marginBottom: 24 }}>
          {filteredOut} other coaster{filteredOut === 1 ? '' : 's'} didn't make the top {ranking.length} and {filteredOut === 1 ? "isn't" : "aren't"} listed below.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 32 }}>
        {podium.map(i => {
          const c = ranking[i];
          const cls = i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze';
          const num = i === 0 ? 'cr-text-amber' : i === 1 ? 'cr-text-silver' : 'cr-text-bronze';
          return (
            <div key={c.id} className={`cr-podium ${cls}`}>
              <CoasterImage coaster={c} />
              <div className="cr-podium-body">
                <div className={`cr-display ${num}`} style={{ fontSize: 48, letterSpacing: '0.05em', lineHeight: 1, marginBottom: 6 }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="cr-display" style={{ fontSize: 22, lineHeight: 1.05, marginBottom: 6, letterSpacing: '0.02em' }}>
                  {c.name}
                </div>
                <div className="cr-meta cr-text-amber" style={{ marginBottom: 4 }}>{c.type}</div>
                <div className="cr-meta">{c.park}</div>
              </div>
            </div>
          );
        })}
      </div>

      <ol style={{ margin: 0, padding: 0, listStyle: 'none', marginBottom: 24 }}>
        {ranking.slice(3).map((c, i) => (
          <li key={c.id} className="cr-rank-row">
            <span className="cr-rank-num">{String(i + 4).padStart(3, '0')}</span>
            <span className="cr-rank-name">{c.name}</span>
            <span className="cr-rank-type">{c.type}</span>
            <span className="cr-rank-park">{c.park}</span>
          </li>
        ))}
      </ol>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button onClick={onCopy} className="cr-btn primary">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy text'}
        </button>
        <button onClick={onCopyCSV} className="cr-btn">
          <Copy size={14} /> Copy CSV
        </button>
        <button onClick={onUndo} className="cr-btn">
          <Undo2 size={14} /> Undo last
        </button>
        <button onClick={onReset} className="cr-btn danger" style={{ marginLeft: 'auto' }}>
          <RotateCcw size={14} /> Start over
        </button>
      </div>
    </div>
  );
}

// ============= UTIL =============

function formatRanking(ranking, mode, k) {
  const header = mode === 'topK' ? `TOP ${ranking.length}` : `FULL RANKING (1–${ranking.length})`;
  const body = ranking.map((c, i) => `${i + 1}. ${c.name} (${c.type}) — ${c.park}`).join('\n');
  return `${header}\n${body}`;
}

function formatCSV(ranking, mode, k) {
  const lines = ['Rank,Coaster,Type,Park'];
  ranking.forEach((c, i) => {
    const q = s => (typeof s === 'string' && (s.includes(',') || s.includes('"'))) ? `"${s.replace(/"/g, '""')}"` : s;
    lines.push(`${i + 1},${q(c.name)},${q(c.type)},${q(c.park)}`);
  });
  return lines.join('\n');
}

function copyToClipboard(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  else fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}
