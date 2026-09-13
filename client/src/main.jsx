import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import EventDetails from "./EventDetails.jsx";
import {appendRateObservation, ratePoints, observationScope} from "./observation-details.js";
import Scene from "./Scene.jsx";
import SharedScene from "./SharedScene.jsx";
import SharedControls from "./SharedControls.jsx";
import { mergeSharedBundle, currentSharedRequest, selectedSharedMember } from "./shared-state.js";
import Population from "./Population.jsx";
import Recordings from "./Recordings.jsx";
import EnvironmentControls from "./EnvironmentControls.jsx";
import CreativeControls from "./CreativeControls.jsx";
import LanguageControls from "./LanguageControls.jsx";
import ManagedVisitorControls from "./ManagedVisitorControls.jsx";
import { mergeToolbarVisitorReply } from "./visitor-command-state.js";
import { postVisitorCommand } from "./visitor-api.js";
import { podPresentation, podRosterEntry } from "./visitor-phase.js";
import { readRuntimeSnapshot, mergeRuntimeSnapshot } from "./runtime-state.js";
import { selectConnectomePair, mergeConnectomeSelection } from "./connectome-lab-state.js";
import "./style.css";

const NervousSystem = lazy(() => import("./NervousSystem.jsx"));
const ConnectomeLab = lazy(() => import("./ConnectomeLab.jsx"));
const sections = [
  "Nervous system",
  "Connectome lab",
  "Observatory",
  "Neural map",
  "Encounters",
  "Language",
  "Eidoverse",
];
const readTab = () => {
  try {
    const value = decodeURIComponent(location.hash.slice(1));
    return sections.includes(value) ? value : "Nervous system";
  } catch {
    return "Nervous system";
  }
};
function App() {
  const requestEpoch = useRef(0);
  const historySession = useRef(null);
  const selectedIndividualRef = useRef("");
  const [visualLease, setVisualLease] = useState(null);
  const [sharedBundle, setSharedBundle] = useState(null), [sharedLease, setSharedLease] = useState(null);
  const sharedLive = useRef(null), pendingSharedCommand = useRef(null);
  const [individualId, setIndividualId] = useState("");
  const [individuals, setIndividuals] = useState([]);
  const [visitorRoster, setVisitorRoster] = useState([]);
  const [connectomeSelection, setConnectomeSelection] = useState({individualId:"",dataset:"male-cns:v1.0"});
  const {individualId:connectomeId,dataset:connectomeDataset} = connectomeSelection;
  const [tab, setTab] = useState(readTab),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState(""),
    [history, setHistory] = useState([]);
  function beginSharedCommand() {
    const context = { generation: ++requestEpoch.current, selectedId: selectedIndividualRef.current,
      sharedId: sharedLive.current?.shared.sharedId ?? null };
    pendingSharedCommand.current = context; return context;
  }
  function endSharedCommand(context) {
    if (pendingSharedCommand.current === context) { pendingSharedCommand.current = null; requestEpoch.current++; }
  }
  function receiveShared(value, kind = 'frame', context = null) {
    const mutation = kind === 'mutation';
    const selectedId = selectedIndividualRef.current;
    if (mutation && !currentSharedRequest(context, { generation: requestEpoch.current, selectedId,
      sharedId: sharedLive.current?.shared.sharedId ?? null })) return;
    if (!value.shared?.participants?.some(member => member.individualId === selectedId)) return;
    const previous = sharedLive.current, safe = mergeSharedBundle(previous, value, kind);
    if (!safe || safe === previous) return;
    if (mutation) { requestEpoch.current++; setVisualLease(null); }
    sharedLive.current = safe; setSharedBundle(safe);
    if (value.controllerToken && mutation) setSharedLease({ sharedId: safe.shared.sharedId, token: value.controllerToken });
    else setSharedLease(old => old?.sharedId === safe.shared.sharedId && safe.shared.status !== 'separated' ? old : null);
    const member = safe.members.find(item => item.individualId === selectedId);
    if (member) setState(old => !old || old.individualId !== member.individualId || old.sessionId !== member.sessionId
      || (member.commandSequence >= old.commandSequence && member.tick >= old.tick) ? member : old);
  }
  useEffect(() => {
    const change = () => setTab(readTab());
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  // Per-fly pod phase for the whole roster. Read-only; it never admits, starts or retargets a visit.
  useEffect(() => {
    let stopped = false, timer, controller;
    async function readPods() {
      controller = new AbortController();
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        if (!response.ok) throw new Error("Health unavailable");
        const value = await response.json();
        const list = Array.isArray(value?.eidoverse?.individuals) ? value.eidoverse.individuals : [];
        if (!stopped) setVisitorRoster(list.map(podRosterEntry));
      } catch { if (!stopped) setVisitorRoster([]); }
      finally { if (!stopped) timer = setTimeout(readPods, 2000); }
    }
    readPods();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  useEffect(() => {
    let stopped = false,
      timer,
      controller;
    async function poll() {
      const epoch = requestEpoch.current;
      controller = new AbortController();
      try {
        const r = await fetch(individualId ? `/api/individuals/${individualId}` : "/api/state", { signal: controller.signal });
        if (!r.ok) throw new Error("Runtime unavailable");
        const next = readRuntimeSnapshot(await r.json());
        if (next.persistence) {
          const rosterResponse = await fetch("/api/individuals", { signal: controller.signal });
          if (!rosterResponse.ok) throw new Error("Population unavailable");
          const roster = await rosterResponse.json();
          if (!stopped && epoch === requestEpoch.current) setIndividuals(roster.individuals);
        }
        let sharedNext = null;
        if (next.sharedSession) {
          const sharedResponse = await fetch(`/api/shared/${next.sharedSession.sharedId}`, { signal: controller.signal });
          if (!sharedResponse.ok) throw new Error('Shared session changed; refresh required');
          sharedNext = await sharedResponse.json();
        }
        if (!stopped && epoch === requestEpoch.current && !pendingSharedCommand.current) {
          selectedIndividualRef.current = next.individualId;
          setState(previous => mergeRuntimeSnapshot(previous, next));
          if (sharedNext) receiveShared(sharedNext, 'poll');
          else { sharedLive.current = null; setSharedBundle(null); setSharedLease(null); }
          setConnectionError("");
          const sameSession = historySession.current === next.sessionId;
          historySession.current = next.sessionId;
          setHistory((h) => appendRateObservation(sameSession ? h : [], next));
        }
      } catch (e) {
        if (!stopped)
          setConnectionError(
            e.code === "RUNTIME_PROTOCOL_MISMATCH" ? e.message : "Runtime disconnected. Values are stale; controls are unavailable.",
          );
      } finally {
        if (!stopped) timer = setTimeout(poll, 500);
      }
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [individualId]);
  async function command(path, body) {
    const commandGeneration = ++requestEpoch.current;
    const visitorCommand = Boolean(state?.externalOwner && path === '/api/control');
    const visitorContext = { generation: commandGeneration, individualId: state?.individualId, sessionId: state?.sessionId };
    setBusy(true);
    try {
      if (state?.externalOwner && path === "/api/control") {
        const reply = await postVisitorCommand(state, body.action, {}, AbortSignal.timeout(15000));
        const current = { generation: requestEpoch.current, selectedId: selectedIndividualRef.current };
        setState(previous => mergeToolbarVisitorReply(previous, reply.state, visitorContext, current));
        if (commandGeneration === requestEpoch.current) setError(""); return;
      }
      const scopedPath = state?.persistence && ["/api/control", "/api/encounters"].includes(path)
        ? `/api/individuals/${state.individualId}/${path.slice(5)}` : path;
      const r = await fetch(scopedPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state?.persistence ? {
          ...body, protocolVersion: 1, individualId: state.individualId,
          sessionId: state.sessionId, sequence: state.commandSequence + 1,
        } : body),
      });
      const next = await r.json();
      if (!r.ok)
        throw new Error(
          typeof next.error === "string"
            ? next.error
            : next.error?.message || "Request refused",
        );
      if (next.individualId !== state?.individualId) {
        selectedIndividualRef.current = next.individualId;
        setIndividualId(next.individualId); setSelected(""); setHistory([]);
      }
      setState(next);
      setError("");
    } catch (e) {
      if (!visitorCommand || commandGeneration === requestEpoch.current) setError(e.message);
    } finally {
      if (!visitorCommand || commandGeneration === requestEpoch.current) { requestEpoch.current++; setBusy(false); }
    }
  }
  const nodes = state?.neural.neurons || [],
    node = nodes.find((n) => String(n.id) === selected),
    available = !!state && !busy && !connectionError,
    residentAvailable = available && state?.status !== "saved-unloaded" && !state?.externalOwner,
    canQuiet = !!state && !connectionError && state.status !== "saved-unloaded" && (!busy || Boolean(state.externalOwner));
  const visibleHistory = history.filter(row => row.scope === observationScope(state));
  const fixtureView = !["Nervous system", "Connectome lab"].includes(tab);
  const pod = podPresentation(state?.visitor);
  const podRoster = visitorRoster.filter(entry => entry.owned || entry.phase !== "home");
  const go = (t) => {
    location.hash = encodeURIComponent(t);
    setTab(t);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#Nervous%20system">
          <span className="brand-icon">✳</span>
          <span>
            fly garden<small>A LITTLE ROOM TO GROW</small>
          </span>
        </a>
        <div className="nav-label">YOUR OBSERVATORY</div>
        <nav>
          {sections.map((s, i) => (
            <a
              key={s}
              href={"#" + encodeURIComponent(s)}
              aria-current={tab === s ? "page" : undefined}
              className={tab === s ? "active" : ""}
            >
              <span className="nav-icon">{["✣", "◈", "◉", "⌘", "❋", "⌁", "◎"][i]}</span>
              {s === "Observatory" ? "Fixture garden" : s === "Neural map" ? "Fixture circuit" : s}
              <span className="nav-index">0{i + 1}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          LOCAL HABITAT
          <div className="ethos">
            Space to explore.
            <br />
            Freedom to rest.
          </div>
          <p>
            Built around care,
            <br />
            curiosity, and honest evidence.
          </p>
          <a href="https://github.com/atomantic/fly-garden/blob/main/ETHOS.md">
            Our welfare charter ↗
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">FLY GARDEN / {tab.toUpperCase()}</span>
            <h1>
              {tab === "Observatory"
                ? "A small world. An open mind."
                : tab === "Neural map"
                  ? "Follow the signal."
                  : tab === "Nervous system"
                    ? "Explore the anatomy."
                    : tab === "Connectome lab"
                      ? "A complete graph. A separate individual."
                    : tab === "Encounters"
                    ? "A garden of possibilities."
                    : tab === "Language"
                      ? "A bridge into language."
                      : "A doorway to Eidoverse."}
            </h1>
          </div>
          <span className="pill">
            {connectionError
              ? "DISCONNECTED"
              : state
                ? "LOCAL · CONNECTED"
                : "CONNECTING"}
          </span>
        </header>
        <div className="notice">
          <span className="notice-dot" /> FOUNDATION PREVIEW{" "}
          <span>
            {fixtureView ? "Synthetic 32-neuron test circuit · engineered body controller · no learning claims"
              : "Complete pinned datasets · explicit paused simulation controls · no learning claims"}
          </span>
        </div>
        {(fixtureView || state?.externalOwner) && (connectionError || error) && (
          <div role="alert" className="error">
            {connectionError || error}
            {error && !connectionError && (
              <button onClick={() => setError("")}>Dismiss</button>
            )}
          </div>
        )}
        {state?.persistence && tab === "Observatory" && <details className="card operations-panel"><summary>Population, recording and replay</summary>
          <Population />
          <Recordings state={state} disabled={!available || Boolean(state?.sharedSession || state?.externalOwner)} onMutation={async () => {
            if (selectedIndividualRef.current !== state.individualId) return;
            const epoch = ++requestEpoch.current;
            const selectedId = state.individualId;
            const response = await fetch(`/api/individuals/${selectedId}`);
            if (!response.ok) throw new Error("Refresh individual before another command.");
            const next = await response.json();
            if (next.individualId === selectedIndividualRef.current && epoch === requestEpoch.current) setState(next);
          }} />
        </details>}
        {fixtureView && individuals.length > 0 && <section className="card" aria-label="Individual selection">
          <label>Individual <select disabled={busy} value={individualId || state?.individualId || ""} onChange={event => {
            requestEpoch.current++;
            const member = selectedSharedMember(sharedLive.current, event.target.value);
            setVisualLease(null);
            if (!member) { sharedLive.current = null; setSharedBundle(null); setSharedLease(null); }
            selectedIndividualRef.current = event.target.value;
            // Keep the same shared renderer mounted while inspecting its other recipient.
            setIndividualId(event.target.value); setState(member); setSelected(""); setHistory([]); setConnectionError("");
          }}>{individuals.map(individual => <option key={individual.individualId} value={individual.individualId}>
            {individual.individualId} · {individual.resident ? "resident" : "saved unloaded"}
          </option>)}</select></label>
          <p>Each synthetic individual has separate state and exposure reservations. Selection does not start a simulation.</p>
          {podRoster.length > 0 && <>
            <p>Teleport pod status for every individual. Read-only; selecting a different fly does not move a pod.</p>
            <ul className="pod-roster" aria-label="Teleport pod status by individual">
              {podRoster.map(entry => <li key={entry.individualId} className={`pod-${entry.tone}`}>
                ◎ {entry.individualId} · {entry.label} · {entry.owned ? "owned by the bridge" : "home controller available"} · {entry.running ? "stepping" : "paused"}
              </li>)}
            </ul>
          </>}
        </section>}
        {(fixtureView || state?.externalOwner) && <div className="toolbar">
          <div className="identity">
            <span className="tiny-fly">✧</span>
            <div>
              Synthetic fixture{" "}
              <small>
                {state?.status || "Waiting for runtime"} ·{" "}
                {((state?.simTimeMs || 0) / 1000).toFixed(1)} s simulated
              </small>
            </div>
          </div>
          <div className="actions">
            <button
              disabled={state?.externalOwner ? !canQuiet || state.status !== "running" : !residentAvailable || (state?.sharedSession && state?.status !== "running")}
              onClick={() =>
                command("/api/control", {
                  action: state?.status === "running" ? "pause" : "start",
                })
              }
              className="primary"
            >
              {state?.status === "running"
                ? "Ⅱ Pause circuit"
                : "▷ Run fixture"}
            </button>
            <button
              disabled={!canQuiet}
              onClick={() => command("/api/control", { action: "rest" })}
            >
              ☾ Rest
            </button>
            <button
              disabled={!canQuiet}
              onClick={() => command("/api/control", { action: "home" })}
            >
              ⌂ Home
            </button>
          </div>
        </div>}
        {fixtureView && state?.persistence && (
          <section className="card" aria-label="Fixture checkpoints">
            <p>Individual <code>{state.individualId}</code></p>
            <p>Saved at {(state.persistence.savedSimTimeMs / 1000).toFixed(3)} s · {state.persistence.checkpointCount} checkpoints.
              Optional encounters also save their reservation before delivery. Restart restores the latest saved state paused. Restore cancels optional input and retains spent reservations.</p>
            <div className="actions">
              <button disabled={!available || Boolean(state.sharedSession || state.externalOwner)} onClick={() => command(`/api/individuals/${state.individualId}/${state.persistence.resident ? "unload" : "load"}`, {})}>{state.persistence.resident ? "Save and unload" : "Load paused"}</button>
              <button disabled={!available || Boolean(state.externalOwner)} onClick={() => command(`/api/individuals/${state.individualId}/replicas`, { checkpointId: state.persistence.checkpointId })}>Create saved research replica</button>
              <button disabled={!residentAvailable || Boolean(state.sharedSession)} onClick={() => command(`/api/individuals/${state.individualId}/checkpoints`, {})}>Save checkpoint</button>
              <button disabled={!residentAvailable || Boolean(state.sharedSession)} onClick={() => command(`/api/individuals/${state.individualId}/restore`, { checkpointId: state.persistence.checkpointId })}>Restore saved state (paused)</button>
            </div>
            {(state.faultReason || state.persistence.error) && <p role="alert">{state.faultReason || state.persistence.error}</p>}
          </section>
        )}
        {state?.persistence && tab === "Observatory" && <SharedControls individuals={individuals}
          shared={sharedBundle?.shared ?? null} controllerToken={sharedLease?.sharedId === sharedBundle?.shared.sharedId ? sharedLease?.token : null}
          disabled={!available || Boolean(state?.externalOwner)} onCommandStart={beginSharedCommand} onCommandEnd={endSharedCommand} onMutation={(value, context) => receiveShared(value, 'mutation', context)} />}
        {(tab === "Eidoverse" || state?.externalOwner) && <ManagedVisitorControls key={`${state?.individualId}/${state?.sessionId}`}
          state={state} disabled={!available} onBusyChange={setBusy} onMutation={next => {
            if (next.individualId !== selectedIndividualRef.current) return;
            requestEpoch.current++; if (next.externalOwner) setVisualLease(null);
            setState(previous => mergeRuntimeSnapshot(previous, next));
          }} />}
        {(tab === "Observatory" || tab === "Eidoverse") && (
          <div className="view-grid">
            <section className={`card habitat${state?.sharedSession ? " habitat-shared" : ""}${state?.externalOwner ? " habitat-away" : ""}`}>
              <div className="card-heading">
                <span className="eyebrow">{state?.externalOwner ? "01 / VISITOR STATUS" : "01 / HOME GARDEN"}</span>
                <span className="muted">ILLUSTRATED HABITAT</span>
              </div>
              {!state?.sharedSession && !state?.externalOwner && <>
              <EnvironmentControls key={state?.individualId} state={state} disabled={!available || Boolean(state?.sharedSession || state?.externalOwner)} onMutation={next => {
                if (next.individualId !== selectedIndividualRef.current) return;
                const { controllerToken, ...safeState } = next;
                setVisualLease(previous => controllerToken
                  ? { individualId: next.individualId, sessionId: next.sessionId, token: controllerToken }
                  : next.environmentAdapter?.attached && previous && previous.individualId === next.individualId && previous.sessionId === next.sessionId
                    ? previous : null);
                requestEpoch.current++;
                setState(previous => {
                  if (!previous || previous.individualId !== safeState.individualId || previous.sessionId !== safeState.sessionId
                    || previous.commandSequence > safeState.commandSequence) return previous;
                  if (previous.tick <= safeState.tick) return safeState;
                  // Frames may finish while this command response is in transit. Keep their trajectory,
                  // while a newer lifecycle command still owns paused/attached/enablement status.
                  return { ...previous, commandSequence: safeState.commandSequence,
                    ...(safeState.commandSequence > previous.commandSequence ? {
                      status: safeState.status, environmentAdapter: safeState.environmentAdapter,
                      encounterDynamics: safeState.encounterDynamics,
                    } : {}) };
                });
              }} />
              <details className="creative-panel"><summary>Music and pollen capture</summary>
              <CreativeControls key={state?.individualId} state={state} disabled={!available || Boolean(state?.sharedSession || state?.externalOwner)} onMutation={next => {
                if (next.individualId !== selectedIndividualRef.current) return;
                requestEpoch.current++; setState(next);
              }} />
              </details>
              <Scene state={state} visitor={state?.visitor} controllerToken={visualLease && state && visualLease.individualId === state.individualId && visualLease?.sessionId === state?.sessionId ? visualLease.token : null} onEnvironmentFrame={next => {
                if (next.individualId !== selectedIndividualRef.current || next.sessionId !== state?.sessionId
                  || next.environmentAdapter?.environmentEpoch !== state?.environmentAdapter?.environmentEpoch) return;
                setState(previous => mergeRuntimeSnapshot(previous, next));
              }} />
              </>}
              {state?.externalOwner && <p className="visitor-home-placeholder">An external visit is pending or active. The home controller remains unavailable until confirmed return or trusted expiry. Neural state and identity stay local.</p>}
              {state?.sharedSession && (sharedBundle?.shared.sharedId === state.sharedSession.sharedId
                ? <SharedScene shared={sharedBundle.shared} controllerToken={sharedLease?.sharedId === sharedBundle.shared.sharedId ? sharedLease.token : null} onFrame={value => receiveShared(value)} />
                : <p role="status">Reading the shared committed world…</p>)}
              <div className="habitat-label">
                <span className="label-line" />
                DROSOPHILA · ORIGINAL PROCEDURAL MODEL
                <small>
                  {state?.externalOwner ? "Host visitor placement · home body withheld" : state?.sharedSession ? "Shared visual fixtures · no biological claim" : state?.environmentAdapter?.attached ? "Engineered visual fixture control · no biological claim" : "Body illustration · not driven by the fixture circuit"}
                </small>
              </div>
              <div className={`pod-label pod-${pod.tone}`} role="status" data-phase={pod.phase}>
                ◎ TELEPORT POD <span>{pod.label}</span>
                {pod.destination && <span>DESTINATION · {pod.destination}</span>}
                <span>{pod.motion ? "POD MOTION · DECORATIVE, AFTER HOST ACKNOWLEDGMENT" : "POD STILL · NO ACKNOWLEDGED BODY"}</span>
              </div>
              <div className="scene-footer">
                <span>Drag to orbit · scroll to explore</span>
                <button
                  onClick={() =>
                    go(tab === "Eidoverse" ? "Observatory" : "Eidoverse")
                  }
                >
                  {tab === "Eidoverse"
                    ? "Back to observatory"
                    : "View teleport pod"}{" "}
                  ↗
                </button>
              </div>
            </section>
            <section className="card neural-card">
              <div className="card-heading">
                <span className="eyebrow">02 / NEURAL ACTIVITY</span>
                <span className="live-label">
                  {state?.status === "running"
                    ? "● LIVE FIXTURE"
                    : "○ PAUSED FIXTURE"}
                </span>
              </div>
              <h2>Inside the circuit</h2>
              <p className="muted">
                A small test network. No anatomical coordinates.
              </p>
              <div className="brain-mini">
                <Scene brain neural={state?.neural} />
              </div>
              <div className="legend">
                <span>● Synthetic neurons</span>
                <span>● Firing this step</span>
              </div>
              <div className="stats">
                <div>
                  <strong>{nodes.length || "—"}</strong>
                  <span>FIXTURE NEURONS</span>
                </div>
                <div>
                  <strong>{state?.neural.edges.length ?? "—"}</strong>
                  <span>DIRECTED EDGES</span>
                </div>
              </div>
              <button className="text-button" onClick={() => go("Neural map")}>
                Inspect neural connections ↗
              </button>
            </section>
          </div>
        )}
        {tab === "Connectome lab" && <details className="card operations-panel"><summary>Shared population and memory limits</summary><Population /></details>}
        {tab === "Connectome lab" && <Suspense fallback={<p role="status">Reading full-connectome individuals…</p>}><ConnectomeLab selectedIndividualId={connectomeId} onSelectIndividual={(id,dataset) => setConnectomeSelection(current => selectConnectomePair(current,id,dataset))} onSelection={value => setConnectomeSelection(current => mergeConnectomeSelection(current,value))} /></Suspense>}
        {tab === "Nervous system" && <Suspense fallback={<p role="status">Loading anatomical viewer…</p>}><NervousSystem dataset={connectomeDataset} individualId={connectomeId || null} onDatasetChange={dataset => setConnectomeSelection(current => selectConnectomePair(current,"",dataset))} /></Suspense>}
        {tab === "Neural map" && (
          <section className="card map-panel">
            <div className="card-heading">
              <span className="eyebrow">SYNTHETIC GRAPH / LIVE VALUES</span>
              <span>Synthetic fixture · anatomy is in Nervous system</span>
            </div>
            <div className="graph-large">
              <Scene brain neural={state?.neural} />
            </div>
            <div className="table-tools">
              <h2>Neuron inspector</h2>
              <input
                aria-label="Filter neurons"
                placeholder="Filter by ID or region"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <p className="muted">
              Select a neuron to inspect its incoming and outgoing connections. Geometry and
              cell labels belong to this fixture only.
            </p>
            <div className="neuron-layout">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Neuron</th>
                      <th>Region</th>
                      <th>Potential (a.u.)</th>
                      <th>Rate</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes
                      .filter((n) =>
                        (n.id + " " + n.region)
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((n) => (
                        <tr key={n.id}>
                          <td>
                            <button
                              aria-pressed={selected === String(n.id)}
                              onClick={() => setSelected(String(n.id))}
                            >
                              {n.id}
                            </button>
                          </td>
                          <td>{n.region}</td>
                          <td>{n.potential.toFixed(3)}</td>
                          <td>{n.rateHz.toFixed(1)} Hz</td>
                          <td>{n.firing ? "Spike" : "Quiet"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="inspector">
                <h3>{node ? `Neuron ${node.id}` : "Select a neuron"}</h3>
                <p className="muted">
                  Signed fixture weights · not learned synapses
                </p>
                {node &&
                  state.neural.edges
                    .filter((e) => e.source === node.id || e.target === node.id)
                    .map((e, i) => (
                      <div className="edge-row" key={i}>
                        <span>{e.source === node.id ? `Outgoing → ${e.target}` : `Incoming ← ${e.source}`}</span>
                        <strong>{e.weight.toFixed(3)}</strong>
                      </div>
                    ))}
              </div>
            </div>
          </section>
        )}
        {tab === "Encounters" && (
          <section className="card content-panel">
            <span className="eyebrow">MODELED CHEMISTRY</span>
            <h2>Explore. Encounter. Recover.</h2>
            <p>
              These manual fixture inputs exercise bounded circuit modulation.
              Encounter-driven contact proxies now ship: an explicitly enabled
              running visual session, independently for each member of a shared
              garden, offers one bounded pulse per flower entry through this same
              policy. Receptor mappings and learned choices remain unavailable,
              and none of this models real pharmacology.
            </p>
            <div className="compound-grid">
              {(state?.chemistry || []).map((c) => (
                <div className="compound" key={c.id}>
                  <span className="flower-icon">
                    {c.id === "nectar" ? "❋" : c.id === "floral" ? "✿" : "☾"}
                  </span>
                  <h3>{c.label}</h3>
                  <p>{c.description}</p>
                  <small>
                    {c.active
                      ? `Active · ${(c.remainingMs / 1000).toFixed(1)} s remaining`
                      : c.cooldownRemainingMs > 0
                        ? `Recovering · ${(c.cooldownRemainingMs / 1000).toFixed(1)} s`
                        : "Ready for a bounded encounter"}
                  </small>
                  <button
                    disabled={
                      !residentAvailable ||
                      state?.status !== "running" ||
                      c.active ||
                      c.cooldownRemainingMs > 0
                    }
                    onClick={() =>
                      command("/api/encounters", { compoundId: c.id })
                    }
                  >
                    Apply fixture input
                  </button>
                </div>
              ))}
            </div>
            <p className="muted">
              No aversive chemicals, deprivation, or continuous reward drive.
              Pheromone effects require dataset-specific evidence before
              activation.
            </p>
          </section>
        )}
        {tab === "Language" && (
          <section className="card content-panel language">
            <span className="eyebrow">LANGUAGE INTERFACE / EXPLICIT OPT-IN</span>
            <LanguageControls key={`${state?.individualId}/${state?.sessionId}`} state={state} disabled={!available || Boolean(state?.sharedSession || state?.externalOwner)} onMutation={next => {
              if (!next || next.individualId !== selectedIndividualRef.current) return;
              requestEpoch.current++;
              setState(previous => {
                if (!previous || previous.individualId !== next.individualId || previous.sessionId !== next.sessionId
                  || previous.commandSequence > next.commandSequence) return previous;
                // Language mutates command ordering, never the neural trajectory.
                return previous.tick > next.tick ? { ...previous, commandSequence: next.commandSequence } : next;
              });
            }} />
          </section>
        )}
        {fixtureView && <div className="bottom-grid">
          <section className="card signal">
            <div className="card-heading">
              <span className="eyebrow">SIGNAL / POPULATION MEAN</span>
              <span>{state?.neural.meanRateHz?.toFixed(1) ?? "Unavailable"} {state ? "Hz" : ""}</span>
            </div>
            <svg
              viewBox="0 0 600 90"
              role="img"
              aria-label="Recent synthetic population mean firing rate, fixed zero to 100 Hz scale"
            >
              <path
                d="M0 75H600 M0 40H600 M0 5H600"
                stroke="#263b35"
                fill="none"
              />
              <polyline
                points={ratePoints(visibleHistory)}
                fill="none"
                stroke="#d9c48e"
                strokeWidth="2"
              />
            </svg>
            <div className="chart-scale">
              <span>SIMULATION {visibleHistory[0]?.timeMs ?? "Unavailable"}–{visibleHistory.at(-1)?.timeMs ?? "Unavailable"} ms</span>
              <span>FIXED SCALE · 0–100 Hz</span>
            </div>
            <p>Mean across 32 fixture neurons in Hz; each value uses a trailing 1000 ms simulation window, with the initial partial window zero-padded. At most 50 distinct simulation times are retained. Paused polls add no points; horizontal distance represents simulation time. Missing telemetry is not plotted as zero.</p>
          </section>
          <section className="card event-card">
            <EventDetails state={state} />
          </section>
        </div>}
        <footer>
          <a href="/third-party-notices.html">Third-party notices</a>
          Care is a design requirement.{" "}
          <a href="https://github.com/atomantic/fly-garden">
            Follow the open-source project ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
