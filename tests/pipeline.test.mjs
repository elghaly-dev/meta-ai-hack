// Tests for the Plain Privacy text pipeline, with a stub model.
// Run: node --test tests/pipeline.test.mjs
// No weight download, no keys, no outside calls. A stub engine stands in
// for the WebLLM engine by implementing the same streaming chat interface.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHUNK_CHARS,
  MAX_INPUT_CHARS,
  chunkText,
  buildPrompt,
  parseAnswer,
  fallbackAnswer,
  answerFromModelOrFallback,
} from '../pipeline.mjs';

// Stub engine: mimics engine.chat.completions.create({ stream: true }).
// It yields the given answer in small chunks, or throws when fail is set.
function stubEngine(answer, { fail = false } = {}) {
  return {
    chat: {
      completions: {
        create: async () => {
          if (fail) throw new Error('stub model failure');
          async function* gen() {
            // [\s\S] (not .) so newlines survive the split: a streamed
            // answer must reassemble byte-for-byte, headers on own lines.
            const parts = answer.match(/[\s\S]{1,37}/g) || [];
            for (const part of parts) {
              yield { choices: [{ delta: { content: part } }] };
            }
          }
          return gen();
        },
      },
    },
  };
}

const SAMPLE_POLICY =
  'We collect your location and your contacts to run the app. ' +
  'We share data with third parties and advertisers. ' +
  'You can delete your data and turn off location in settings.';

test('chunking splits long text into bounded, non-empty chunks', () => {
  const sentence = 'We collect location data to show nearby places. ';
  const text = sentence.repeat(400); // about 19,000 chars
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1, 'long text must split into several chunks');
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0, 'no chunk may be empty');
    assert.ok(chunk.length <= MAX_CHUNK_CHARS, `chunk over limit: ${chunk.length}`);
  }
  assert.ok(chunks.join(' ').includes('nearby places'), 'chunks must keep the content');
});

test('chunking returns one chunk for short text and none for empty text', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   '), []);
  assert.equal(chunkText('A short policy line.').length, 1);
});

test('prompt building names all three sections and keeps the pasted text', () => {
  const prompt = buildPrompt(SAMPLE_POLICY);
  assert.ok(prompt.system.includes('What is collected'));
  assert.ok(prompt.system.includes('Who gets it'));
  assert.ok(prompt.system.includes('What you can turn off'));
  assert.ok(prompt.user.includes('location'), 'prompt must carry the pasted text');
  assert.equal(prompt.truncated, false);
});

test('prompt building truncates very long input and says so', () => {
  const text = 'word '.repeat(6000); // about 30,000 chars
  const prompt = buildPrompt(text);
  assert.equal(prompt.truncated, true);
  assert.ok(prompt.usedChars <= MAX_INPUT_CHARS);
  assert.ok(prompt.inputChars > prompt.usedChars);
  for (const chunk of prompt.chunks) {
    assert.ok(chunk.length <= MAX_CHUNK_CHARS);
  }
});

test('parsing accepts a well-formed three-section answer', () => {
  const answer = [
    '## What is collected',
    'Location and contacts.',
    '## Who gets it',
    'Third parties.',
    '## What you can turn off',
    'Location in settings.',
  ].join('\n');
  const parsed = parseAnswer(answer);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.collected, 'Location and contacts.');
  assert.equal(parsed.recipients, 'Third parties.');
  assert.equal(parsed.controls, 'Location in settings.');
});

test('parsing tolerates bold and numbered headers', () => {
  const answer = [
    '**What is collected**',
    'Usage data.',
    '2. Who gets it',
    'Partners.',
    '3) What you can turn off',
    'Permissions.',
  ].join('\n');
  const parsed = parseAnswer(answer);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.recipients, 'Partners.');
});

test('parsing rejects an answer missing a section', () => {
  const answer = 'What is collected\nLocation.\n\nWho gets it\nNobody.';
  const parsed = parseAnswer(answer);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.missing.includes('What you can turn off'));
});

test('fallback names mentioned items and invents nothing', () => {
  const fb = fallbackAnswer(SAMPLE_POLICY);
  assert.ok(fb.collected.includes('location'), 'must name location');
  assert.ok(fb.collected.includes('contacts'), 'must name contacts');
  assert.ok(!fb.collected.includes('payment'), 'must not invent payment details');
  assert.ok(fb.recipients.includes('third parties'));
  assert.ok(fb.recipients.includes('advertisers'));
  assert.ok(fb.controls.includes('delete your data'));
});

test('fallback names the camera and microphone in a permission list, not the camera roll', () => {
  const perms = fallbackAnswer('This app asks for camera and microphone permission.');
  assert.ok(perms.collected.includes('camera'), 'must name the camera');
  assert.ok(perms.collected.includes('microphone'), 'must name the microphone');
  assert.ok(perms.controls.includes('change app permissions'));
  const roll = fallbackAnswer('We read your camera roll.');
  assert.equal(roll.collected, 'The pasted text mentions: photos and videos.');
});

test('fallback is honest when nothing is named', () => {
  const fb = fallbackAnswer('Hello world. The sky is blue today.');
  assert.ok(fb.collected.includes('does not name'));
  assert.ok(fb.recipients.includes('does not name'));
  assert.ok(fb.controls.includes('does not name'));
});

test('model path returns a valid streamed answer with source model', async () => {
  const answer = [
    'What is collected',
    'Location.',
    'Who gets it',
    'Advertisers.',
    'What you can turn off',
    'Location permission.',
  ].join('\n');
  const res = await answerFromModelOrFallback(stubEngine(answer), SAMPLE_POLICY);
  assert.equal(res.source, 'model');
  assert.equal(res.sections.collected, 'Location.');
  assert.equal(res.sections.recipients, 'Advertisers.');
  assert.equal(res.sections.controls, 'Location permission.');
});

test('model failure falls back to the pipeline with three sections', async () => {
  const res = await answerFromModelOrFallback(stubEngine('', { fail: true }), SAMPLE_POLICY);
  assert.equal(res.source, 'pipeline');
  assert.ok(res.sections.collected.includes('location'));
  assert.ok(res.sections.recipients.includes('third parties'));
  assert.ok(res.sections.controls.includes('delete your data'));
});

test('an incomplete model answer falls back to the pipeline', async () => {
  const res = await answerFromModelOrFallback(stubEngine('Just some words, no sections.'), SAMPLE_POLICY);
  assert.equal(res.source, 'pipeline');
  assert.ok(res.sections.collected.length > 0);
  assert.ok(res.sections.recipients.length > 0);
  assert.ok(res.sections.controls.length > 0);
});
