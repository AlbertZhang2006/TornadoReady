import { useLocation, useNavigate } from 'react-router-dom';
import { formatNumber, efScaleLabel } from '../utils/format';
import type { WorkspaceState } from '../types/workspace';
import { deriveSummary } from '../types/workspace';
import type { TornadoScenario } from '../types/scenario';
import { TornadoIcon } from '../components/TornadoIcon';

function DisruptionPill({ level }: { level: string }) {
  const style =
    level === 'high'
      ? 'bg-red-50 text-red-700'
      : level === 'moderate'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-green-50 text-green-700';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${style}`}>
      {level}
    </span>
  );
}

function Row({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-medium ${warn ? 'text-amber-600' : 'text-slate-800'}`}>
        {children}
      </span>
    </div>
  );
}

export function SimulationReview() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { ws: WorkspaceState; scenarioName: string; scenario: TornadoScenario } | null;

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-sm text-slate-500">No scenario data to review.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-3 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Return to Scenario Library
          </button>
        </div>
      </div>
    );
  }

  const { ws, scenarioName, scenario } = state;
  const summary = deriveSummary(ws);

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-slate-800">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <TornadoIcon size={20} />
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">TornadoReady</h1>
        </div>
        <span className="text-xs text-slate-400">Simulation Review</span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-slate-900">Review Simulation Parameters</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Confirm the scenario inputs below before running the simulation.
              These values drive all casualty estimates, resource gap analysis, and recommendations.
            </p>
          </div>

          {/* Scenario & Tornado */}
          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Scenario &amp; Tornado Profile
              </h3>
            </div>
            <div className="divide-y divide-gray-100 px-5">
              <Row label="Scenario Name">{scenarioName}</Row>
              <Row label="EF Rating">{efScaleLabel(ws.efScale)}</Row>
              <Row label="Area Type">
                <span className="capitalize">{ws.areaType}</span>
              </Row>
              <Row label="Time of Day">{ws.timeOfDay}</Row>
            </div>
          </section>

          {/* Impact Path */}
          <section className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Impact Path
              </h3>
            </div>
            <div className="divide-y divide-gray-100 px-5">
              <Row label="Path Length">{ws.pathLength} mi</Row>
              <Row label="Path Width">{ws.pathWidth} mi</Row>
              <Row label="Direction">{ws.direction}</Row>
            </div>
          </section>

          {/* Community & Casualties */}
          <section className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Community Exposure &amp; Casualties
              </h3>
            </div>
            <div className="divide-y divide-gray-100 px-5">
              <Row label="Population Exposure">{formatNumber(ws.populationExposure)}</Row>
              <Row label="Estimated Casualties" warn={summary.estCasualties > 100}>
                {formatNumber(summary.estCasualties)}
              </Row>
              <Row label="Patients Needing Transport" warn={summary.needTransport > summary.totalAmbulances * 4}>
                {formatNumber(summary.needTransport)}
              </Row>
              <Row label="Self-Presenting to Hospitals">{formatNumber(summary.selfPresenting)}</Row>
            </div>
          </section>

          {/* Transport Resources */}
          <section className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Transport Resources
              </h3>
            </div>
            <div className="divide-y divide-gray-100 px-5">
              <Row label="ALS Ambulances">{ws.alsAmbulances}</Row>
              <Row label="BLS Ambulances">{ws.blsAmbulances}</Row>
              <Row label="Supervisor Units">{ws.supervisorUnits}</Row>
              <Row label="Total Transport Units">{summary.totalAmbulances}</Row>
              <Row label="Est. Transports / Hour"
                warn={summary.needTransport > 0 && summary.transportsPerHour < summary.needTransport}
              >
                {summary.transportsPerHour}
              </Row>
            </div>
          </section>

          {/* Hospitals */}
          <section className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Hospitals ({ws.hospitals.length})
              </h3>
            </div>
            {ws.hospitals.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {ws.hospitals.map((h) => (
                  <div key={h.id} className="flex items-center justify-between px-5 py-2.5">
                    <div>
                      <span className="text-sm text-slate-800">{h.name || 'Unnamed'}</span>
                      <span className="ml-2 text-xs text-slate-400">{h.traumaCapability}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {h.availableBeds} beds · ED {h.currentEdLoad}/{h.edCapacity} · surge {h.surgeCapacity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-4 text-sm text-slate-400">No hospitals configured.</div>
            )}
          </section>

          {/* Infrastructure Disruption */}
          <section className="mt-4 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Infrastructure Disruption
              </h3>
            </div>
            <div className="divide-y divide-gray-100 px-5">
              <Row label="Road Disruption">
                <DisruptionPill level={ws.roadDelayMultiplier >= 2 ? 'high' : ws.roadDelayMultiplier >= 1.5 ? 'moderate' : 'low'} />
              </Row>
              <Row label="Power Disruption"><DisruptionPill level={ws.powerDisruption} /></Row>
              <Row label="Communications Disruption"><DisruptionPill level={ws.commsDisruption} /></Row>
            </div>
          </section>

          {/* Action buttons */}
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => navigate(-1)}
              className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-gray-100 transition-colors"
            >
              Back to Planning Workspace
            </button>
            <button
              onClick={() => navigate('/simulation', { state: { ws, scenarioName, scenario } })}
              className="rounded bg-slate-800 px-6 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              Run Simulation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
