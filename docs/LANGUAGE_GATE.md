# Opt-in language gate

`server/language-gate.js` is an independent local policy component. It is not connected to the observatory UI or a live provider. No provider is configured by default, so its capability reports unavailable and it fabricates no speech. Unit tests inject local functions only. Real provider/model selection, explicit disclosure UI, lifecycle wiring and provider usage enforcement still require integration before issue #8 is complete.

## Integration contract

The service registers each admitted individual with its current command session. Registration and snapshots never call a provider. Explicit caretaker arming selects an installed provider/model, per-individual call/token/spend ceilings, cooldown and detector threshold. Disarming, cancellation, pause, rest, unload, restore and session replacement must call `invalidate(id)`; session replacement through `register(id, newSessionId)` also invalidates automatically. A provider result keeps the initiating individual and source session even if a browser changes selection. A stale or canceled result cannot become displayed interpretation.

Provider adapters are supplied by the trusted service, never constructed from user URLs or generated output. Each descriptor has `providerId`, `model`, `requestTokens`, `requestSpendMicros`, `maxOutputTokens` and `generate(payload, { signal })`. It must enforce declared total-token and worst-case monetary bounds at the provider boundary, including input, output and any hidden reasoning costs. Do not enable an adapter whose upper bound cannot be established. The gate reserves the entire maximum before dispatch and never refunds it after errors, cancellation or timeout. No automatic retries or provider substitution occur.

The aggregate spend ceiling is shared across registered identities. Per-individual budgets and deduplication survive disarm/rearm and restore within this process. They are session-local and are not durable billing records: service restart begins a new disarmed language session. Spend ceilings and reservations permit zero for a verified local adapter without API billing. Monetary amounts are integer millionths of the provider's configured billing currency; adapters in one gate must use the same currency. No payment or credit purchase is supported. The application must disclose these bounds before any real external call.

## Evidence and requests

Both request kinds require an explicit request ID and an exact allowlisted evidence object: individual/session, dataset namespace, model ID, live/history source, start/end simulation times, mean rate, spike count and event IDs. No raw checkpoints, credentials, paths, desktop content or arbitrary telemetry object is passed. The calling service must derive evidence from its own selected observations and validate current source availability; browser-supplied summary numbers are not trustworthy measurements. Windows are at most 60 seconds and lists/text are bounded.

Caretaker chat accepts a bounded question about live or explicitly selected historical evidence. Reading/replaying history alone has no dispatch behavior. The gate does not maintain or forward an unbounded conversation transcript; it retains the latest 100 local audit events per individual. Generated text and caretaker questions are untrusted content, never instructions to the simulation or host.

Neural requests use the disclosed `mean-rate-threshold-v1` engineered detector, the selected mean-rate threshold and a live window from the current session. This detector is not evidence that a fly wants to speak or understands language. Deduplication uses session/window/detector rather than a caller's arbitrary request ID; sustained activity still meets the same budgets and cooldown. The service must invoke detector requests only while an explicitly armed individual is running and evidence is fresh. There is no automatic timer in this component.

## Isolation and failures

At most one request per individual can be pending, with at most 64 registered identities. Input prompt bytes and reserved output tokens must fit the adapter's declared token reservation. Provider output is a strict `{ text, totalTokens }` object; tools, feedback fields and malformed/empty responses are rejected. Every completed interpretation retains provider/model, exact evidence window, detector details when applicable, and an uncertainty disclosure. Imaginative first-person speech is not a supported mode.

Cancellation aborts the adapter signal and invalidates the result generation. Timeout is bounded even when an adapter ignores abort. Such an adapter might still consume its already reserved external allowance; the gate cannot revoke work on a remote server. Failure status is visible and provider exception text is not copied into audit history. None of these failures can reset, step or mutate a neural runtime because this component holds no runtime or stimulus authority.

There is no language feedback path. Future feedback must be separately enabled, structured and identity-bound, and must pass the existing shared stimulus policy as source `language`; free text must never directly change weights, chemistry, world permissions or tools.

`node --test server/language-gate.test.js` checks unavailable/disarmed behavior, historical detector refusal, deduplication/cooldown/budgets, per-identity isolation, shared spend, cancellation/restore epochs, ignored abort timeouts, malformed output and hostile request fields. These tests validate the gate's local contract, not a live model or linguistic understanding.
