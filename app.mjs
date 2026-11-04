// app.mjs — browser wiring for Plain Privacy.
// The app shell makes no outside requests. The only outside calls are the
// one-time engine + weight download, and only after the user taps
// "Load on-phone model" (on Wi-Fi). No analytics anywhere.

import {
  fallbackAnswer,
  answerFromModelOrFallback,
} from './pipeline.mjs';

const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';
// Pinned to one release, so a newer upstream release never runs next to the pasted text unreviewed.
const ENGINE_URL = 'https://esm.sh/@mlc-ai/web-llm@0.2.86';

let engine = null;

const $ = (id) => document.getElementById(id);

function render(sections, source) {
  $('outCollected').textContent = sections.collected;
  $('outRecipients').textContent = sections.recipients;
  $('outControls').textContent = sections.controls;
  $('sourceNote').textContent =
    source === 'model'
      ? 'Answer refined by the on-phone model.'
      : 'Answer from the on-phone check (no model needed).';
}

async function explain() {
  const text = $('input').value;
  if (!text.trim()) {
    $('sourceNote').textContent = 'Paste something first.';
    return;
  }
  // The pipeline answers at once, with no network and no model.
  render(fallbackAnswer(text), 'pipeline');
  if (engine) {
    const res = await answerFromModelOrFallback(engine, text);
    render(res.sections, res.source);
  }
}

async function loadModel() {
  const status = $('modelStatus');
  if (!('gpu' in navigator)) {
    status.textContent =
      'This device cannot run the on-phone model: WebGPU was not found. The on-phone check still works.';
    return;
  }
  status.textContent =
    'Loading the on-phone model… One download, on Wi-Fi, about 600–800 MB. It is kept on the phone after this.';
  try {
    const webllm = await import(ENGINE_URL);
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (progress) => {
        if (progress && progress.text) status.textContent = progress.text;
      },
    });
    status.textContent = 'On-phone model ready. Tap Explain to use it.';
  } catch (err) {
    engine = null;
    status.textContent =
      'The on-phone model could not load on this device. The on-phone check still works.';
  }
}

$('explainBtn').addEventListener('click', explain);
$('loadBtn').addEventListener('click', loadModel);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
