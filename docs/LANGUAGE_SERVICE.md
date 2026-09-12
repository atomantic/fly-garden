# Language service integration

`createLanguageService({ identities, providers, gate, aggregateSpendMicros, now, timeoutMs })` in `server/language-service.js` wraps the independent gate. The only required dependency is an identity source with synchronous `list()` and `snapshot(id)` methods. Providers default to an empty list; construction, registration, reads and replay never make requests. An injected gate is optional and owns its own limits/clock when supplied.

The wrapper derives evidence exclusively from server identity snapshots. Clients choose a saved window ID, never supply telemetry values. Mean rate represents the fixture's trailing one-second statistic; spike count is instantaneous. Up to 16 event IDs accompany a window. The most recent 64 captured windows per individual are available for explicit historical chat. This is a bounded local observation cache, not durable recording storage.

## Methods and bodies

The root HTTP adapter must apply its existing Host/origin policy and per-individual command session/sequence envelope before calling mutations. The bodies below are operation fields after removing that envelope. A URL recipient ID must match the authenticated command recipient. There are no free-form provider endpoints or credential fields.

| Method | Exact body / behavior |
| --- | --- |
| `snapshot(id)` | No body. Returns gate state, provider availability, detector enablement, audit events and available evidence-window IDs. Refreshes lifecycle but never dispatches. |
| `refresh(id)` | No body. Refreshes lifecycle and returns state without dispatch. |
| `arm(id, body)` | `providerId`, `model`, `maxCalls`, `maxTokens`, `maxSpendMicros`, `cooldownMs`, `detectorThresholdHz`, `detectorEnabled`. The last field is a required boolean, separately enabling automatic detector requests. All other limits follow the gate contract. |
| `chat(id, body)` | `requestId`, `message`, `windowId`. Null window selects current server evidence; a listed window ID selects that individual's historical evidence. Returns a promise for an identity-bound result. Requires explicitly armed, loaded, valid state. |
| `disarm(id, {})` | Disarms both chat and detector and cancels pending work. |
| `cancel(id, {})` | Explicit whole-recipient cancellation and disarm; budgets remain reserved. |
| `cancel(id, {requestId})` | Cleanup cancellation only if the current pending request matches; stale cleanup leaves newer work and arming unchanged. |
| `lifecycle(id)` | Internal hook. Invalidates language even when a repeated Pause or Return Home command leaves observable runtime fields unchanged. |
| `tick()` | Internal hook. Checks up to 64 individuals and returns an all-settled promise for newly dispatched detector work. It must be invoked without blocking the neural stepping loop. |
| `close()` | Internal hook. Disarms and cancels all registered individuals. |

Call `lifecycle(id)` on explicit pause, rest, return-home, unload and restore commands, including their fault paths. Also call `refresh(id)` after lifecycle changes and from the periodic service tick. Session replacement, leaving running state, environment changes and resident/unloaded changes automatically invalidate pending results. A final source check suppresses stale text if lifecycle changed before delivery; changing UI selection never changes the recipient. Failed-source refresh is visible as unavailable rather than fabricated interpretation.

Arming while paused permits explicit caretaker chat, but never detector dispatch. A separately enabled detector starts checking only once the same individual is running. Detector checks require a new positive simulation-time window, satisfied threshold, no pending request, elapsed cooldown and remaining call/token/spend budgets. Duplicate, paused, cooldown and exhausted checks do not flood the audit log. Gate-level checks still enforce all limits immediately before provider dispatch. A failed request never changes neural state.

Provider/model startup, installation and configuration are not performed by this wrapper. No actual provider is contacted by the unit suite. The wrapper has no stimulus, weight, tool or host-permission authority. See [gate policy](LANGUAGE_GATE.md) and [optional local adapter](OLLAMA_LANGUAGE.md).

`node --test server/language-service.test.js` verifies unavailable defaults, explicit detector enablement, live/historical server-derived windows, bounded history, cooldown/budget suppression without log spam, cross-identity isolation, paused/unloaded/restored cancellation and suppression of a delayed stale response.

## HTTP integration

`GET /api/individuals/:id/language` returns status. POST to the same route uses the existing version/recipient/session/sequence envelope plus `operation` (`arm`, `chat`, `disarm`, `cancel`) and `payload` from the table above. Responses return the current `state`, `language` status and operation `result`. Cross-origin mutations and stale envelopes are rejected. Periodic detector checks do not block simulation ticks; pause/rest/home/restore/unload and controller changes explicitly revoke language authority. HTTP tests include same-state pause during a delayed request and confirm no neural feedback.
