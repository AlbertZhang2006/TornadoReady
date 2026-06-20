import { useLocation, useNavigate } from 'react-router-dom';
import { efScaleLabel, formatNumber } from '../utils/format';
import { generateRecommendations } from '../simulation/recommendations';
import { deriveSummary } from '../types/workspace';
import type { WorkspaceState } from '../types/workspace';
import type { TornadoScenario } from '../types/scenario';
import type { HourlySimulationResult } from '../simulation/hourlyEngine';
import { TornadoIcon } from '../components/TornadoIcon';

interface ReportState {
  ws: WorkspaceState;
  scenarioName: string;
  scenario: TornadoScenario;
  simulationResult: HourlySimulationResult;
}

const DISCLAIMER =
  'TornadoReady simulations are for tornado preparedness planning and training support only. ' +
  'They are not live warnings, live tracking, or real-time incident command systems.';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{children}</span>
    </div>
  );
}

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

function PriorityPill({ priority }: { priority: string }) {
  const style =
    priority === 'high'
      ? 'bg-red-50 text-red-700'
      : priority === 'medium'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase ${style}`}>
      {priority}
    </span>
  );
}

function AreaPill({ area }: { area: string }) {
  return (
    <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-500">
      {area}
    </span>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white print:border-gray-300 print:shadow-none">
      <div className="border-b border-gray-100 px-6 py-3">
        <h3 className="text-sm font-semibold text-slate-800">
          <span className="mr-2 text-slate-400">{number}.</span>
          {title}
        </h3>
      </div>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

function buildJsonExport(state: ReportState) {
  const { ws, scenarioName, scenario, simulationResult } = state;
  const summary = deriveSummary(ws);
  const recommendations = generateRecommendations(ws, simulationResult);
  return {
    reportTitle: 'TornadoReady Preparedness Report',
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    scenario: {
      name: scenarioName,
      region: scenario.region,
      efScale: ws.efScale,
      areaType: ws.areaType,
      timeOfDay: ws.timeOfDay,
    },
    tornadoProfile: {
      pathLength: ws.pathLength,
      pathWidth: ws.pathWidth,
      direction: ws.direction,
    },
    communityExposure: {
      populationExposure: ws.populationExposure,
      estimatedCasualties: summary.estCasualties,
      patientsNeedingTransport: summary.needTransport,
      patientsSelfPresenting: summary.selfPresenting,
      vulnerablePopulationLevel: ws.vulnerablePopLevel,
    },
    emsResources: {
      alsAmbulances: ws.alsAmbulances,
      blsAmbulances: ws.blsAmbulances,
      supervisorUnits: ws.supervisorUnits,
      totalTransportUnits: summary.totalAmbulances,
      transportsPerHour: summary.transportsPerHour,
      avgSceneTimeMin: ws.avgSceneTimeMin,
      avgTransportTimeMin: ws.avgTransportTimeMin,
      avgOffloadTimeMin: ws.avgOffloadTimeMin,
      mutualAidDelayMin: ws.mutualAidDelayMin,
    },
    hospitals: ws.hospitals.map((h) => ({
      name: h.name,
      traumaCapability: h.traumaCapability,
      edCapacity: h.edCapacity,
      currentEdLoad: h.currentEdLoad,
      availableBeds: h.availableBeds,
      surgeCapacity: h.surgeCapacity,
    })),
    hospitalCapacitySummary: {
      totalBeds: summary.totalBeds,
      edRemainingSlots: summary.edRemaining,
      surgeCapacity: summary.surgeTotal,
      totalReceivingCapacity: summary.totalBeds + summary.edRemaining + summary.surgeTotal,
    },
    infrastructureDisruption: {
      road: ws.roadDelayMultiplier >= 2 ? 'high' : ws.roadDelayMultiplier >= 1.5 ? 'moderate' : 'low',
      roadDelayMultiplier: ws.roadDelayMultiplier,
      power: ws.powerDisruption,
      communications: ws.commsDisruption,
    },
    simulation: {
      snapshots: simulationResult.snapshots,
      peakAmbulanceGap: simulationResult.peakAmbulanceGap,
      peakHospitalLoadPct: simulationResult.peakHospitalLoadPct,
      finalReadinessScore: simulationResult.finalReadinessScore,
      mutualAidTriggeredAtHour: simulationResult.mutualAidTriggeredAtHour,
    },
    recommendations: recommendations.map((r) => ({
      title: r.title,
      priority: r.priority,
      area: r.area,
      reason: r.reason,
    })),
  };
}

export function PreparednessReport() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ReportState | null;

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-sm text-slate-500">
            No report data available. Run a simulation first.
          </p>
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

  const { ws, scenarioName, scenario, simulationResult } = state;
  const summary = deriveSummary(ws);
  const recommendations = generateRecommendations(ws, simulationResult);
  const snapshots = simulationResult.snapshots;
  const finalSnap = snapshots[snapshots.length - 1];

  const readinessLabel =
    finalSnap.readinessScore >= 70
      ? 'Prepared'
      : finalSnap.readinessScore >= 40
        ? 'At Risk'
        : 'Critical';
  const readinessColor =
    finalSnap.readinessScore >= 70
      ? 'text-green-600'
      : finalSnap.readinessScore >= 40
        ? 'text-amber-600'
        : 'text-red-600';
  const readinessBg =
    finalSnap.readinessScore >= 70
      ? 'bg-green-50 border-green-200'
      : finalSnap.readinessScore >= 40
        ? 'bg-amber-50 border-amber-200'
        : 'bg-red-50 border-red-200';

  const roadLevel =
    ws.roadDelayMultiplier >= 2 ? 'high' : ws.roadDelayMultiplier >= 1.5 ? 'moderate' : 'low';

  const totalReceiving = summary.totalBeds + summary.edRemaining + summary.surgeTotal;

  function handlePrint() {
    window.print();
  }

  function handleDownloadJSON() {
    const data = buildJsonExport(state!);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TornadoReady-Report-${scenarioName.replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800 print:bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white print:border-gray-300">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <TornadoIcon size={22} className="print:text-slate-700" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                Preparedness Report
              </h1>
              <p className="text-xs text-slate-400">{scenarioName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button
              onClick={() => navigate('/')}
              className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-gray-100 transition-colors"
            >
              Scenario Library
            </button>
            <button
              onClick={() => navigate(-1)}
              className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-gray-100 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handlePrint}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-gray-50 transition-colors"
            >
              Print
            </button>
            <button
              onClick={handleDownloadJSON}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              Download JSON
            </button>
          </div>
        </div>
      </header>

      {/* Report body */}
      <main className="mx-auto max-w-4xl px-6 py-8 print:py-4">
        {/* Readiness banner */}
        <div className={`mb-8 rounded-lg border ${readinessBg} px-6 py-4 print:mb-6`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Final Readiness Assessment
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-4xl font-bold ${readinessColor}`}>
                  {finalSnap.readinessScore}
                </span>
                <span className="text-sm text-slate-500">/ 100</span>
                <span className={`ml-1 text-sm font-semibold ${readinessColor}`}>
                  {readinessLabel}
                </span>
              </div>
            </div>
            <div className="text-right text-xs text-slate-400">
              <p>Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p className="mt-0.5">Hours 0–6 simulation</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 print:space-y-4">
          {/* 1 ── Scenario Summary */}
          <Section number={1} title="Scenario Summary">
            <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
              <Row label="Scenario Name">{scenarioName}</Row>
              <Row label="Region">{scenario.region}</Row>
              <Row label="EF Rating">{efScaleLabel(ws.efScale)}</Row>
              <Row label="Area Type"><span className="capitalize">{ws.areaType}</span></Row>
              <Row label="Time of Day">{ws.timeOfDay}</Row>
              <Row label="Readiness Score">
                <span className={readinessColor}>{finalSnap.readinessScore}/100</span>
              </Row>
            </div>
          </Section>

          {/* 2 ── Tornado Profile */}
          <Section number={2} title="Tornado Profile">
            <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
              <Row label="EF Scale">{efScaleLabel(ws.efScale)}</Row>
              <Row label="Area Type"><span className="capitalize">{ws.areaType}</span></Row>
              <Row label="Time of Day">{ws.timeOfDay}</Row>
              <Row label="Vulnerable Population"><span className="capitalize">{ws.vulnerablePopLevel}</span></Row>
            </div>
          </Section>

          {/* 3 ── Impact Path */}
          <Section number={3} title="Impact Path Assumptions">
            <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
              <Row label="Path Length">{ws.pathLength} mi</Row>
              <Row label="Path Width">{ws.pathWidth} mi</Row>
              <Row label="Direction">{ws.direction}</Row>
              <Row label="Path Method"><span className="capitalize">{ws.pathMethod}</span></Row>
            </div>
          </Section>

          {/* 4 ── Community Exposure */}
          <Section number={4} title="Community Exposure">
            <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
              <Row label="Population Exposure">{formatNumber(ws.populationExposure)}</Row>
              <Row label="Estimated Casualties">{formatNumber(summary.estCasualties)}</Row>
              <Row label="Needing Transport">{formatNumber(summary.needTransport)}</Row>
              <Row label="Self-Presenting">{formatNumber(summary.selfPresenting)}</Row>
              <Row label="Schools Affected">{ws.schoolsAffected}</Row>
              <Row label="Nursing Homes">{ws.nursingHomesAffected}</Row>
              <Row label="Mobile Home Parks">{ws.mobileHomeParks}</Row>
              <Row label="Large Venues">{ws.largeVenues}</Row>
            </div>
            <div className="mt-3 flex items-center gap-4 border-t border-gray-100 pt-3">
              <span className="text-xs text-slate-500">Infrastructure Disruption:</span>
              <div className="flex gap-2">
                <span className="text-xs text-slate-400">Road</span>
                <DisruptionPill level={roadLevel} />
                <span className="ml-2 text-xs text-slate-400">Power</span>
                <DisruptionPill level={ws.powerDisruption} />
                <span className="ml-2 text-xs text-slate-400">Comms</span>
                <DisruptionPill level={ws.commsDisruption} />
              </div>
            </div>
          </Section>

          {/* 5 ── EMS Resources */}
          <Section number={5} title="EMS Resource Assumptions">
            <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
              <Row label="ALS Ambulances">{ws.alsAmbulances}</Row>
              <Row label="BLS Ambulances">{ws.blsAmbulances}</Row>
              <Row label="Supervisor Units">{ws.supervisorUnits}</Row>
              <Row label="Total Transport Units">{summary.totalAmbulances}</Row>
              <Row label="Transports / Hour">{summary.transportsPerHour}</Row>
              <Row label="Avg Scene Time">{ws.avgSceneTimeMin} min</Row>
              <Row label="Avg Transport Time">{ws.avgTransportTimeMin} min</Row>
              <Row label="Avg Offload Time">{ws.avgOffloadTimeMin} min</Row>
              <Row label="Road Delay Multiplier">{ws.roadDelayMultiplier}×</Row>
              <Row label="Mutual Aid Delay">{ws.mutualAidDelayMin} min</Row>
            </div>
          </Section>

          {/* 6 ── Hospital Capacity */}
          <Section number={6} title="Hospital Capacity Assumptions">
            {ws.hospitals.length > 0 ? (
              <>
                <div className="overflow-hidden rounded border border-gray-200 print:border-gray-300">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Hospital</th>
                        <th className="px-4 py-2 font-medium">Trauma</th>
                        <th className="px-4 py-2 text-right font-medium">ED Cap</th>
                        <th className="px-4 py-2 text-right font-medium">ED Load</th>
                        <th className="px-4 py-2 text-right font-medium">Beds</th>
                        <th className="px-4 py-2 text-right font-medium">Surge</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ws.hospitals.map((h) => (
                        <tr key={h.id}>
                          <td className="px-4 py-2 text-slate-800">{h.name || 'Unnamed'}</td>
                          <td className="px-4 py-2 text-slate-600">{h.traumaCapability}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{h.edCapacity}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{h.currentEdLoad}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{h.availableBeds}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{h.surgeCapacity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 grid gap-x-12 gap-y-0 sm:grid-cols-2">
                  <Row label="Total Available Beds">{summary.totalBeds}</Row>
                  <Row label="ED Remaining Slots">{summary.edRemaining}</Row>
                  <Row label="Surge Capacity">{summary.surgeTotal}</Row>
                  <Row label="Total Receiving Capacity">{totalReceiving}</Row>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">No hospitals configured.</p>
            )}
          </Section>

          {/* 7 ── Simulation Timeline Summary */}
          <Section number={7} title="Simulation Timeline Summary">
            <div className="overflow-hidden rounded border border-gray-200 print:border-gray-300">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Hour</th>
                    <th className="px-4 py-2 text-right font-medium">New Pts</th>
                    <th className="px-4 py-2 text-right font-medium">Cumulative</th>
                    <th className="px-4 py-2 text-right font-medium">Transported</th>
                    <th className="px-4 py-2 text-right font-medium">Gap</th>
                    <th className="px-4 py-2 text-right font-medium">Hosp Load</th>
                    <th className="px-4 py-2 text-right font-medium">Readiness</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {snapshots.map((s) => (
                    <tr key={s.hour}>
                      <td className="px-4 py-2 font-medium text-slate-700">{s.hour}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{s.patientsGeneratedThisHour}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{s.cumulativePatients}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{s.cumulativeTransported}</td>
                      <td className={`px-4 py-2 text-right ${s.ambulanceGap > 0 ? 'font-medium text-amber-600' : 'text-slate-600'}`}>
                        {s.ambulanceGap > 0 ? s.ambulanceGap : '—'}
                      </td>
                      <td className={`px-4 py-2 text-right ${s.hospitalLoadPct > 80 ? 'font-medium text-amber-600' : 'text-slate-600'}`}>
                        {s.hospitalLoadPct}%
                      </td>
                      <td className={`px-4 py-2 text-right ${
                        s.readinessScore >= 70
                          ? 'text-green-600'
                          : s.readinessScore >= 40
                            ? 'text-amber-600'
                            : 'text-red-600'
                      } font-medium`}>
                        {s.readinessScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid gap-x-12 gap-y-0 sm:grid-cols-2">
              <Row label="Peak Ambulance Gap">{simulationResult.peakAmbulanceGap} patients</Row>
              <Row label="Peak Hospital Load">{simulationResult.peakHospitalLoadPct}%</Row>
              <Row label="Mutual Aid Triggered">
                {simulationResult.mutualAidTriggeredAtHour !== null
                  ? `Hour ${simulationResult.mutualAidTriggeredAtHour}`
                  : 'Not triggered'}
              </Row>
              <Row label="Final Readiness">
                <span className={readinessColor}>{finalSnap.readinessScore}/100</span>
              </Row>
            </div>
          </Section>

          {/* 8 ── Resource Gaps */}
          <Section number={8} title="Resource Gaps">
            <div className="space-y-3">
              <div className="grid gap-x-12 gap-y-0 sm:grid-cols-2">
                <Row label="Transport Demand">{formatNumber(summary.needTransport)} patients</Row>
                <Row label="Transport Capacity / Hour">{summary.transportsPerHour}</Row>
                <Row label="Peak Ambulance Gap">{simulationResult.peakAmbulanceGap} patients</Row>
                <Row label="Peak Hospital Load">{simulationResult.peakHospitalLoadPct}%</Row>
              </div>
              {(simulationResult.peakAmbulanceGap > 0 || simulationResult.peakHospitalLoadPct > 80) && (
                <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {simulationResult.peakAmbulanceGap > 0 && (
                    <p>
                      Transport gap of {simulationResult.peakAmbulanceGap} patients indicates local
                      ambulance capacity is insufficient at peak demand. Mutual aid or alternate
                      transport resources are needed.
                    </p>
                  )}
                  {simulationResult.peakHospitalLoadPct > 80 && (
                    <p className={simulationResult.peakAmbulanceGap > 0 ? 'mt-1' : ''}>
                      Hospital load reaches {simulationResult.peakHospitalLoadPct}%, exceeding the
                      80% strain threshold. Patient distribution and alternate destination planning
                      should be considered.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* 9 ── Recommendations */}
          <Section number={9} title="Recommendations">
            {recommendations.length > 0 ? (
              <div className="space-y-3">
                {recommendations.map((rec, i) => (
                  <div
                    key={rec.id}
                    className="rounded-lg border border-gray-100 px-4 py-3 print:border-gray-300"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 print:bg-gray-200">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{rec.title}</span>
                          <PriorityPill priority={rec.priority} />
                          <AreaPill area={rec.area} />
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{rec.reason}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No specific recommendations generated. Current planning assumptions appear adequate for this scenario.
              </p>
            )}
          </Section>

          {/* 10 ── Planning Limitations */}
          <Section number={10} title="Planning Limitations">
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                Casualty estimates use statistical models based on EF rating, population exposure, and vulnerability. Actual numbers will vary.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                Transport times assume average cycle durations and uniform road conditions. Actual debris fields and route-specific closures are not modeled.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                Hospital capacity is based on pre-event baseline data. Surge activation, staff availability, and supply chain factors are not dynamically modeled.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                Mutual aid response times are estimated. Actual availability depends on concurrent regional demand and pre-existing agreements.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                Ambulance movement in the simulation uses straight-line interpolation between waypoints. No real road routing, GPS, or live dispatch data is used.
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                Demand zone patient distributions are proportional estimates. On-scene triage results will differ from modeled triage breakdowns.
              </li>
            </ul>
          </Section>

          {/* Disclaimer */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-4 print:border-slate-300 print:bg-gray-50">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Disclaimer</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{DISCLAIMER}</p>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 border-t border-gray-200 py-4 text-center text-xs text-slate-400 print:mt-4">
          TornadoReady &middot; Preparedness Planning &amp; Training Support
        </footer>
      </main>
    </div>
  );
}
