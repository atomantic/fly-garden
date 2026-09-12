# Optional local Ollama interpreter

`createOllamaLanguageProvider` in `server/ollama-language-provider.js` supplies an optional adapter for the language gate. It returns `null` unless explicitly configured with `enabled: true`. Construction performs no discovery, requests, model download, provider startup or generation. Installing this source does not enable language. The application exposes provider availability in the Language tab. Arming and the optional activity detector are separate explicit controls.

The configuration requires an explicit model name and both `verifiedLocalNonThinkingModel: true` and `verifiedByteTokenBound: true`. These are operator assertions after inspecting the installed model, not automatic validation. No model has been inspected or validated by this implementation. Do not enable it for an unverified model. In particular, loopback routing alone does not prove a model is local: the local Ollama service must not proxy generation to a cloud model. Names containing `cloud` are refused as an additional guard, not proof of locality.

Only HTTP origins using the literal loopback IP `127.0.0.1` or `[::1]` are supported; the default is port 11434. DNS hostnames, credentials, paths, query strings and fragments are rejected. Redirects fail. The fixed route is `/api/generate`. There are no auth headers, images, tools, callbacks or dynamic URLs.

## Bounds and assumptions

The exact serialized raw prompt is capped at 3,072 UTF-8 bytes. The selected model must have a verified tokenizer upper bound of at most one token per input byte plus at most 128 special tokens. This assumption is **not a universal tokenizer guarantee**. Character/byte estimates alone cannot certify arbitrary model tokenization; an incompatible or unverified model must stay disabled. Output is limited to 512 tokens and total reservation is 4,096. Reported input/output counts are checked after generation; violations invalidate the result but cannot undo already consumed compute.

Generation uses `raw: true`, `stream: false`, `think: false`, `keep_alive: 0`, a 4,096-token context, and `num_predict: 512`; speculative drafting is disabled. Raw mode avoids server prompt templates. The adapter rejects explicit thinking output, tool fields, incomplete/truncated output and invalid usage counts. Disabling thinking is not supported by every model; for example Ollama documents that GPT-OSS cannot fully disable its trace. Only a verified non-thinking local model is eligible. See the official [generation API](https://docs.ollama.com/api/generate), [parameter reference](https://docs.ollama.com/modelfile) and [thinking behavior](https://docs.ollama.com/capabilities/thinking).

Although Ollama returns one non-streaming JSON document, the HTTP body is read incrementally with a 32 KiB ceiling and canceled on overflow. The adapter has a bounded timeout and honors the gate's abort signal. Partial transport, provider errors, redirect attempts and invalid responses produce a generic failure without forwarding private provider exception text.

Local billing reservation is zero microcurrency units; this does not mean inference uses no memory, electricity or compute. Per-individual calls, token reservations, cooldown, cancellation and aggregate session budgets remain enforced by the gate. Existing positive spend caps still govern any other adapters. There are no billing credentials or payment actions.

## Application configuration

The following environment variables are read only at application startup:

| Variable | Default and meaning |
| --- | --- |
| `FLY_GARDEN_LANGUAGE_OLLAMA_ENABLED` | Disabled; only `1` enables adapter registration. |
| `FLY_GARDEN_LANGUAGE_OLLAMA_MODEL` | No default; installed, verified local model name. |
| `FLY_GARDEN_LANGUAGE_OLLAMA_ORIGIN` | `http://127.0.0.1:11434`; literal loopback only. |
| `FLY_GARDEN_LANGUAGE_LOCAL_MODEL_VERIFIED` | Only `1` attests the chosen model is local and non-thinking. |
| `FLY_GARDEN_LANGUAGE_TOKEN_BOUND_VERIFIED` | Only `1` attests the documented tokenizer bound. |
| `FLY_GARDEN_LANGUAGE_AGGREGATE_SPEND_MICROS` | `0`; nonnegative session spend limit shared by all individuals. Local adapter reserves zero billing spend, while each individual's call/token limits still apply. |

Invalid enabled configuration fails startup. Restart always clears arming and starts the fixture paused; no provider is contacted. Provider installation, model verification and any generation require operator action. The UI displays aggregate reservations and permits per-individual budgets within this ceiling.

## Evidence

`node --test server/ollama-language-provider.test.js server/language-gate.test.js` uses injected fetch and synthetic HTTP responses. Tests verify construction makes no calls, endpoint restrictions, fixed generation parameters, bounded chunked bodies, redirect refusal, invalid/truncated/thinking responses, cancellation, strict payload allowlisting and zero-spend compatibility. No installed provider or model is contacted. This is adapter contract evidence, not an end-to-end language quality, tokenizer or local-model validation claim.
