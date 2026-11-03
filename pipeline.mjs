// pipeline.mjs — deterministic text pipeline for Plain Privacy.
// Pure ESM: runs in the browser and under node with no imports.
// The pipeline is the core: it always answers, with no model and no network.
// A model, when present, only refines the wording.

export const MAX_CHUNK_CHARS = 3000;
export const MAX_INPUT_CHARS = 12000;

export const SYSTEM_PROMPT =
  'You explain privacy text in short, plain words. ' +
  'Answer with exactly these three sections, in this order, using these exact headers: ' +
  "'What is collected', 'Who gets it', 'What you can turn off'. " +
  'One short line per item. Only use facts from the pasted text. ' +
  "If the text does not say something, write 'Not named in the pasted text.' " +
  'Do not add other sections.';

const SECTION_HEADERS = ['What is collected', 'Who gets it', 'What you can turn off'];

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*/g);
  if (!parts) return [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

// Split text into chunks no longer than maxChars, without cutting a sentence
// in half unless a single sentence is longer than the limit.
export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = splitSentences(clean);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (!current) { current = sentence; continue; }
    if (current.length + 1 + sentence.length <= maxChars) {
      current += ' ' + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildPrompt(text) {
  const clean = String(text || '').trim();
  const truncated = clean.length > MAX_INPUT_CHARS;
  const body = truncated ? clean.slice(0, MAX_INPUT_CHARS) : clean;
  const chunks = chunkText(body);
  const user = chunks.map((c, i) => `Part ${i + 1} of ${chunks.length}:\n${c}`).join('\n\n');
  return { system: SYSTEM_PROMPT, user, chunks, truncated, inputChars: clean.length, usedChars: body.length };
}

// Parse a model answer into the three sections. Headers may carry markdown
// marks (##, **), numbering (1., 1)), or a trailing colon, in any case.
// A section counts only when its header is present with a non-empty body.
export function parseAnswer(text) {
  const input = String(text || '');
  const pattern = /^\s*(?:#{1,3}\s*)?(?:\*\*)?(?:\d+[.)]\s*)?(What is collected|Who gets it|What you can turn off)(?:\*\*)?\s*:?\s*$/gim;
  const found = [];
  let m;
  while ((m = pattern.exec(input)) !== null) {
    found.push({ name: m[1].toLowerCase(), start: m.index, bodyStart: pattern.lastIndex });
  }
  const out = { collected: '', recipients: '', controls: '', valid: false, missing: [] };
  const keyOf = (name) =>
    name === 'what is collected' ? 'collected' : name === 'who gets it' ? 'recipients' : 'controls';
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].start : input.length;
    out[keyOf(found[i].name)] = input.slice(found[i].bodyStart, end).trim();
  }
  out.missing = SECTION_HEADERS.filter((h) => !out[keyOf(h.toLowerCase())]);
  out.valid = out.missing.length === 0;
  return out;
}

const DATA_TYPES = [
  ['location', ['location', 'gps', 'precise location', 'where you are']],
  ['contacts', ['contacts', 'address book']],
  ['photos and videos', ['photos', 'videos', 'camera roll']],
  ['messages', ['messages', 'sms', 'chat history']],
  ['call history', ['call log', 'call history']],
  ['device information', ['device id', 'device information', 'device model']],
  ['account details', ['email address', 'phone number', 'account information', 'your name']],
  ['usage data', ['usage data', 'how you use', 'activity', 'interactions']],
  ['payment details', ['payment', 'card number', 'billing']],
  ['browsing data', ['browsing history', 'cookies', 'pages you visit']],
  ['voice recordings', ['voice recordings', 'microphone', 'audio recordings']],
];

const RECIPIENT_TYPES = [
  ['third parties', ['third part']],
  ['advertisers', ['advertis']],
  ['partners', ['partner']],
  ['analytics providers', ['analytics']],
  ['service providers', ['service provider']],
];

const CONTROL_TYPES = [
  ['delete your data', ['delete']],
  ['opt out', ['opt out', 'opt-out']],
  ['change app permissions', ['permission']],
  ['turn off a setting', ['turn off', 'disable']],
  ['withdraw consent', ['withdraw']],
  ['change settings', ['settings']],
];

function findMentioned(text, table) {
  const lower = String(text || '').toLowerCase();
  return table.filter(([, keys]) => keys.some((k) => lower.includes(k))).map(([label]) => label);
}

// Deterministic fallback: only names what the pasted text actually mentions.
// When nothing is named, it says so plainly instead of inventing an answer.
export function fallbackAnswer(text) {
  const input = String(text || '');
  const data = findMentioned(input, DATA_TYPES);
  const people = findMentioned(input, RECIPIENT_TYPES);
  const controls = findMentioned(input, CONTROL_TYPES);
  return {
    collected: data.length
      ? `The pasted text mentions: ${data.join(', ')}.`
      : 'The pasted text does not name what is collected.',
    recipients: people.length
      ? `The pasted text mentions: ${people.join(', ')}.`
      : 'The pasted text does not name who receives it.',
    controls: controls.length
      ? `The pasted text mentions you can: ${controls.join(', ')}.`
      : 'The pasted text does not name what you can turn off.',
    source: 'pipeline',
  };
}

// Run the model when one is present; fall back to the pipeline on any
// failure or on an answer that does not carry all three sections.
// This function never throws for a model problem: the app always answers.
export async function answerFromModelOrFallback(engine, text) {
  try {
    const prompt = buildPrompt(text);
    const messages = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];
    const stream = await engine.chat.completions.create({ messages, stream: true });
    let out = '';
    for await (const chunk of stream) {
      const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) out += delta.content;
    }
    const parsed = parseAnswer(out);
    if (parsed.valid) {
      return {
        sections: { collected: parsed.collected, recipients: parsed.recipients, controls: parsed.controls },
        source: 'model',
      };
    }
    return { sections: fallbackAnswer(text), source: 'pipeline', reason: 'model-answer-incomplete' };
  } catch (err) {
    return { sections: fallbackAnswer(text), source: 'pipeline', reason: 'model-error' };
  }
}
