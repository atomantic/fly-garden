import { deriveVisitorPreview, projectVisitorPose, VISITOR_PREVIEW_DISCLOSURE } from './visitor-preview.js';

const actionLabel = action => action === 'interact' ? 'settled patch interaction' : 'bounded movement';

export default function VisitorPatchPreview({ visitor }) {
  const preview = deriveVisitorPreview(visitor);
  if (!preview.available) return <section className="visitor-patch-preview visitor-preview-empty" data-visitor-preview-status="unavailable" aria-label="Render-only visitor projection">
    <span className="eyebrow">OBSERVER VIEW / RENDER-ONLY PROJECTION</span>
    <h2>No acknowledged visitor frame.</h2>
    <p role="status">{preview.reason}</p>
    <p>{VISITOR_PREVIEW_DISCLOSURE}</p>
  </section>;
  const point = projectVisitorPose(preview.pose), heading = preview.pose.yaw * 180 / Math.PI;
  const interaction = preview.interaction;
  return <section className="visitor-patch-preview" data-visitor-preview-status="available" data-visitor-preview-individual={preview.individualId} data-visitor-preview-epoch={preview.visitEpoch} data-visitor-preview-frame={preview.frameId} data-visitor-preview-action={preview.action} data-visitor-preview-source={preview.sensorySource} aria-label="Render-only visitor projection">
    <div className="visitor-preview-heading">
      <div>
        <span className="eyebrow">OBSERVER VIEW / RENDER-ONLY PROJECTION</span>
        <h2>Visitor <code>{preview.individualId}</code></h2>
      </div>
      <span className={`visitor-preview-status ${preview.running ? 'running' : 'paused'}`} role="status">
        {preview.running ? 'RUNNING' : 'PAUSED'} · LAST CONFIRMED FRAME
      </span>
    </div>
    <svg className="visitor-preview-stage" viewBox="0 0 640 360" role="img" aria-label={`Render-only projection of visitor ${preview.individualId} at the last confirmed host pose; not a camera feed`} data-visitor-preview-canvas="true">
      <rect width="640" height="360" rx="12" fill="#10251f" />
      <path d="M40 300H600M40 240H600M40 180H600M40 120H600M40 60H600M120 40V320M200 40V320M280 40V320M360 40V320M440 40V320M520 40V320" stroke="#284a3b" strokeWidth="1" />
      <path d="M68 286C168 222 230 256 318 192S476 112 574 78" fill="none" stroke="#52795b" strokeDasharray="7 10" strokeWidth="3" />
      <g fill="#d5bd7d" stroke="#7e7049" strokeWidth="2">
        <circle cx="104" cy="92" r="13" /><circle cx="536" cy="238" r="13" /><circle cx="318" cy="286" r="13" />
      </g>
      <g fill="#b5c98d">
        <circle cx="94" cy="82" r="7" /><circle cx="114" cy="82" r="7" /><circle cx="104" cy="72" r="7" />
        <circle cx="526" cy="228" r="7" /><circle cx="546" cy="228" r="7" /><circle cx="536" cy="218" r="7" />
        <circle cx="308" cy="276" r="7" /><circle cx="328" cy="276" r="7" /><circle cx="318" cy="266" r="7" />
      </g>
      <g transform={`translate(${point.x} ${point.y}) rotate(${heading})`} data-visitor-preview-fly="true">
        <ellipse cx="0" cy="0" rx="20" ry="12" fill="#c6a967" stroke="#263b2e" strokeWidth="3" />
        <ellipse cx="0" cy="-13" rx="25" ry="6" fill="#d9edda" fillOpacity="0.72" stroke="#7cae8d" strokeWidth="2" />
        <ellipse cx="0" cy="13" rx="25" ry="6" fill="#d9edda" fillOpacity="0.72" stroke="#7cae8d" strokeWidth="2" />
        <circle cx="-11" cy="-4" r="5" fill="#b75538" /><circle cx="11" cy="-4" r="5" fill="#b75538" />
        <path d="M-18 8L-31 22M18 8L31 22M-15-9L-29-20M15-9L29-20" stroke="#d5bd7d" strokeWidth="3" strokeLinecap="round" />
      </g>
      {interaction && <g data-visitor-preview-interaction="true">
        <circle cx={point.x} cy={point.y} r="34" fill="none" stroke="#d9c477" strokeWidth="4" strokeDasharray="8 7" />
        <text x={point.x} y={point.y - 43} textAnchor="middle" fill="#eadb9c" fontSize="15" fontFamily="monospace">SETTLED · {interaction.objectId}</text>
      </g>}
      <text x="28" y="332" fill="#9ab39a" fontSize="13" fontFamily="monospace">RESTRICTED SCENE PROJECTION · NO TARGET COORDINATES OR CONTROL AUTHORITY</text>
    </svg>
    <div className="visitor-preview-facts">
      <span>Frame <strong>{preview.frameId}</strong></span>
      <span>Action <strong>{actionLabel(preview.action)}</strong></span>
      <span>Epoch <strong>{preview.visitEpoch}</strong></span>
      <span>Motor <strong>{preview.motor.forward.toFixed(3)} forward · {preview.motor.yaw.toFixed(3)} yaw</strong></span>
      <span>Source <strong>{preview.sensorySource}</strong></span>
    </div>
    <p>Last confirmed action at {preview.inputSimTimeMs} → {preview.outputSimTimeMs} ms simulation time. This local marker visualizes the bounded host acknowledgment; it is not a live camera, a biological perception claim, or evidence of intent.</p>
    <p>{VISITOR_PREVIEW_DISCLOSURE}</p>
  </section>;
}
