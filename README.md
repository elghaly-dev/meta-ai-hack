# Plain Privacy

A small app that explains your privacy data in plain words, on the phone itself.

Paste a privacy policy, an app's permission list, or a data-export file. You get
a short answer in exactly three sections:

1. What is collected
2. Who gets it
3. What you can turn off

Nothing leaves the phone. There is no account, no analytics, and no outside call
from the app shell.

## How it works

- **The on-phone check is the core.** It reads only what you paste, on the phone
  itself, and answers at once — with no network and no model. It only names what
  the pasted text actually mentions; when the text does not name something, it
  says so plainly instead of guessing.
- **The on-phone model is optional.** One tap loads a small Llama model
  (Llama 3.2 1B Instruct, quantised, about 600–800 MB) on Wi-Fi. After that it
  refines the wording. If the model cannot load, the check still answers — the
  app never leaves you with a blank screen.
- **After the model is kept on the phone, the app works in Airplane mode.**
  The model weights are kept in the model runtime's own Cache Storage. That
  storage is best-effort, not promised: clearing site data, or storage
  pressure, means the model must download again.
- **The first weight download is the only outside call**, and it happens once,
  on the user's tap, on Wi-Fi. The app shell itself makes no outside requests.

## Run it

Serve the folder over https or on localhost — for example:

```
python3 -m http.server 8000
```

Then open the served page. Opening `index.html` as a file does not work: the
page uses modules and a service worker, which need a served origin.

## Model requirement

The model needs WebGPU: Safari 26 / iOS 26 or later, iPhone 11 and later.
Older phones cannot run the model, but the on-phone check still answers.
If WebGPU is not found, the app says so plainly and never lets the engine throw.

## Unknown — measured on the owner's phone, not claimed here

- Model load time on iPhone: UNKNOWN.
- First-answer time on iPhone: UNKNOWN.
- iPhone model and iOS version tested: UNKNOWN (no iPhone was available here).
- Whether the 1B model loads in iPhone Safari: UNPROVEN. Safari tab memory on
  iOS is quoted under 500 MB, against about 1 GB for the 1B model. No public
  source shows this model running inside iPhone Safari, so the phone test is
  the only proof. Nothing in this repo claims otherwise.

## Tests

```
node --test tests/pipeline.test.mjs
```

Tests use a stub engine that implements the same streaming chat interface as
the model engine, so every test runs with no weight download, no keys, and no
outside calls. The same commands run in CI: `.github/workflows/test.yml`.

## Licences

| Reused item | Licence |
|---|---|
| Meta Llama 3.2 1B Instruct weights, MLC build `Llama-3.2-1B-Instruct-q4f32_1-MLC` | Llama 3.2 Community License (Meta) — use requires accepting Meta's terms |
| `@mlc-ai/web-llm` 0.2.86 (MLC AI), pinned in `app.mjs` | Apache 2.0 |
| Apache TVM / MLC-LLM (the compiler and runtime WebLLM is built on) | Apache 2.0 |
| Our own code (PWA shell, text pipeline, tests, demo script) | MIT (see `LICENSE`) — original work by Wyndham Heaven (elghaly), kept clearly separate from the reused items above |

Built with Llama. The optional on-phone model is Meta Llama 3.2 1B Instruct,
used under the Llama 3.2 Community License.

Wyndham Heaven (elghaly)
