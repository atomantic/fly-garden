import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Scene from "./Scene.jsx";
import Population from "./Population.jsx";
import Recordings from "./Recordings.jsx";
import "./style.css";

const sections = [
  "Observatory",
  "Neural map",
  "Encounters",
  "Language",
  "Eidoverse",
];
const readTab = () => {
  try {
    const value = decodeURIComponent(location.hash.slice(1));
    return sections.includes(value) ? value : "Observatory";
  } catch {
    return "Observatory";
  }
};
function App() {
  const requestEpoch = useRef(0);
  const historySession = useRef(null);
  const selectedIndividualRef = useRef("");
  const [individualId, setIndividualId] = useState("");
  const [individuals, setIndividuals] = useState([]);
  const [tab, setTab] = useState(readTab),
    [state, setState] = useState(null),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState(""),
    [history, setHistory] = useState([]);
  useEffect(() => {
    const change = () => setTab(readTab());
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
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
        const next = await r.json();
        if (next.persistence) {
          const rosterResponse = await fetch("/api/individuals", { signal: controller.signal });
          if (!rosterResponse.ok) throw new Error("Population unavailable");
          const roster = await rosterResponse.json();
          if (!stopped && epoch === requestEpoch.current) setIndividuals(roster.individuals);
        }
        if (!stopped && epoch === requestEpoch.current) {
          selectedIndividualRef.current = next.individualId;
          setState(next);
          setConnectionError("");
          const sameSession = historySession.current === next.sessionId;
          historySession.current = next.sessionId;
          setHistory((h) => [...(sameSession ? h.slice(-49) : []), next.neural.meanRateHz]);
        }
      } catch (e) {
        if (!stopped)
          setConnectionError(
            "Runtime disconnected. Values are stale; controls are unavailable.",
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
    requestEpoch.current++;
    setBusy(true);
    try {
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
      setError(e.message);
    } finally {
      requestEpoch.current++;
      setBusy(false);
    }
  }
  const nodes = state?.neural.neurons || [],
    node = nodes.find((n) => String(n.id) === selected),
    available = !!state && !busy && !connectionError,
    residentAvailable = available && state?.status !== "saved-unloaded";
  const go = (t) => {
    location.hash = encodeURIComponent(t);
    setTab(t);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#Observatory">
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
              <span className="nav-icon">{["◉", "⌘", "❋", "⌁", "◎"][i]}</span>
              {s}
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
            Live synthetic circuit · real connectome not loaded · no learning
            claims
          </span>
        </div>
        {(connectionError || error) && (
          <div role="alert" className="error">
            {connectionError || error}
            {error && !connectionError && (
              <button onClick={() => setError("")}>Dismiss</button>
            )}
          </div>
        )}
        {state?.persistence && tab === "Observatory" && <>
          <Population />
          <Recordings state={state} disabled={!available} onMutation={async () => {
            if (selectedIndividualRef.current !== state.individualId) return;
            const epoch = ++requestEpoch.current;
            const selectedId = state.individualId;
            const response = await fetch(`/api/individuals/${selectedId}`);
            if (!response.ok) throw new Error("Refresh individual before another command.");
            const next = await response.json();
            if (next.individualId === selectedIndividualRef.current && epoch === requestEpoch.current) setState(next);
          }} />
        </>}
        {individuals.length > 0 && <section className="card" aria-label="Individual selection">
          <label>Individual <select disabled={busy} value={individualId || state?.individualId || ""} onChange={event => {
            requestEpoch.current++;
            selectedIndividualRef.current = event.target.value;
            setIndividualId(event.target.value); setState(null); setSelected(""); setHistory([]); setConnectionError("");
          }}>{individuals.map(individual => <option key={individual.individualId} value={individual.individualId}>
            {individual.individualId} · {individual.resident ? "resident" : "saved unloaded"}
          </option>)}</select></label>
          <p>Each synthetic individual has separate state and exposure reservations. Selection does not start a simulation.</p>
        </section>}
        <div className="toolbar">
          <div className="identity">
            <span className="tiny-fly">✧</span>
            <div>
              Garden resident{" "}
              <small>
                {state?.status || "Waiting for runtime"} ·{" "}
                {((state?.simTimeMs || 0) / 1000).toFixed(1)} s simulated
              </small>
            </div>
          </div>
          <div className="actions">
            <button
              disabled={!residentAvailable}
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
              disabled={!residentAvailable}
              onClick={() => command("/api/control", { action: "rest" })}
            >
              ☾ Rest
            </button>
            <button
              disabled={!residentAvailable}
              onClick={() => command("/api/control", { action: "home" })}
            >
              ⌂ Home
            </button>
          </div>
        </div>
        {state?.persistence && (
          <section className="card" aria-label="Fixture checkpoints">
            <p>Individual <code>{state.individualId}</code></p>
            <p>Saved at {(state.persistence.savedSimTimeMs / 1000).toFixed(3)} s · {state.persistence.checkpointCount} checkpoints.
              Optional encounters also save their reservation before delivery. Restart restores the latest saved state paused. Restore cancels optional input and retains spent reservations.</p>
            <div className="actions">
              <button disabled={!available} onClick={() => command(`/api/individuals/${state.individualId}/${state.persistence.resident ? "unload" : "load"}`, {})}>{state.persistence.resident ? "Save and unload" : "Load paused"}</button>
              <button disabled={!available} onClick={() => command(`/api/individuals/${state.individualId}/replicas`, { checkpointId: state.persistence.checkpointId })}>Create saved research replica</button>
              <button disabled={!residentAvailable} onClick={() => command(`/api/individuals/${state.individualId}/checkpoints`, {})}>Save checkpoint</button>
              <button disabled={!residentAvailable} onClick={() => command(`/api/individuals/${state.individualId}/restore`, { checkpointId: state.persistence.checkpointId })}>Restore saved state (paused)</button>
            </div>
            {(state.faultReason || state.persistence.error) && <p role="alert">{state.faultReason || state.persistence.error}</p>}
          </section>
        )}
        {(tab === "Observatory" || tab === "Eidoverse") && (
          <div className="view-grid">
            <section className="card habitat">
              <div className="card-heading">
                <span className="eyebrow">01 / HOME GARDEN</span>
                <span className="muted">ILLUSTRATED HABITAT</span>
              </div>
              <Scene />
              <div className="habitat-label">
                <span className="label-line" />
                DROSOPHILA · ORIGINAL PROCEDURAL MODEL
                <small>
                  Body illustration · not driven by the fixture circuit
                </small>
              </div>
              <div className="pod-label">
                ◎ TELEPORT POD <span>HOST BRIDGE NOT CONNECTED</span>
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
        {tab === "Neural map" && (
          <section className="card map-panel">
            <div className="card-heading">
              <span className="eyebrow">SYNTHETIC GRAPH / LIVE VALUES</span>
              <span>Measured anatomy unavailable</span>
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
              Encounter-driven scent fields, receptor mappings and learned
              choices are planned; these controls do not model real
              pharmacology.
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
            <span className="eyebrow">LANGUAGE INTERFACE / NOT CONFIGURED</span>
            <h2>Let activity open a conversation.</h2>
            <p>
              The planned language bridge lets a defined neural readout request
              an LLM after you enable a provider and a budget. Each request will
              link to the neural window and encounters that triggered it.
            </p>
            <div className="language-path">
              <span>Sensory event</span>
              <b>→</b>
              <span>Neural activity</span>
              <b>→</b>
              <span>Request gate</span>
              <b>→</b>
              <span>LLM interpreter</span>
            </div>
            <div className="empty-state">
              No model connected.
              <small>
                {state?.capabilities.llm.reason ||
                  "Language integration is planned."}
              </small>
            </div>
            <label>
              Ask the interpreter
              <input
                disabled
                placeholder="Chat becomes available after provider integration"
              />
            </label>
            <p className="muted">
              Generated words will be labeled interpretation. They cannot prove
              thoughts, feelings, or comprehension. No LLM requests are sent by
              this preview.
            </p>
          </section>
        )}
        {tab === "Eidoverse" && (
          <section className="card content-panel">
            <span className="eyebrow">TELEPORT POD / ADMISSION REQUIRED</span>
            <h2>One brain. A new place to play.</h2>
            <div className="travel-path">
              {["Home", "Admission", "Departing", "Visiting", "Returning"].map(
                (s, i) => (
                  <span key={s} className={i === 0 ? "current" : ""}>
                    <b>0{i + 1}</b>
                    {s}
                  </span>
                ),
              )}
            </div>
            <p>
              The pod will light up when the local host confirms admission, show
              departure and return, and pause safely if the connection is lost.
              The neural state stays on this machine.
            </p>
            <button disabled>Visit Eidoverse — bridge unavailable</button>
            <p className="muted">
              {state?.capabilities.eidoverse.reason ||
                "A dedicated local visitor bridge is still required."}{" "}
              The pod is currently an illustration, not a simulated transfer.
            </p>
          </section>
        )}
        <div className="bottom-grid">
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
                points={history
                  .map(
                    (v, i) =>
                      `${(i * 600) / 49},${75 - Math.min(100, v) * 0.7}`,
                  )
                  .join(" ")}
                fill="none"
                stroke="#d9c48e"
                strokeWidth="2"
              />
            </svg>
            <div className="chart-scale">
              <span>RECENT OBSERVATIONS</span>
              <span>FIXED SCALE · 0–100 Hz</span>
            </div>
          </section>
          <section className="card event-card">
            <div className="card-heading">
              <span className="eyebrow">EVENT JOURNAL</span>
              <span>SIMULATED TIME</span>
            </div>
            <div className="events">
              {(state?.events || []).slice(0, 4).map((e) => (
                <div key={e.id}>
                  <time>{(e.timeMs / 1000).toFixed(1)}s</time>
                  <span>{e.message}</span>
                </div>
              ))}
              {!state && (
                <p className="muted">Waiting for the local runtime.</p>
              )}
            </div>
          </section>
        </div>
        <footer>
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
