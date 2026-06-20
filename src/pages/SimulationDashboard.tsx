import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { SimulationMap } from '../components/map/SimulationMap';
import { runHourlySimulation, generateEventLog } from '../simulation/hourlyEngine';
import type { HourlySimulationResult } from '../simulation/hourlyEngine';
import { formatNumber } from '../utils/format';
import { generateRecommendations } from '../simulation/recommendations';
import type { Recommendation, RecommendationPriority } from '../simulation/recommendations';
import { computeUnitStates } from '../simulation/emsState';
import { computeHospitalStates, CAPACITY_STATUS_LABEL, CAPACITY_STATUS_COLOR } from '../simulation/hospitalState';
import type { WorkspaceState } from '../types/workspace';
import type { TornadoScenario } from '../types/scenario';
import { TornadoIcon } from '../components/TornadoIcon';

const TICK_MS = 50;
const TICKS_PER_HOUR = 60;
const INCREMENT = 1 / TICKS_PER_HOUR;

// ── Priority styling ────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<RecommendationPriority, { bg: string; text: string; badge: string; border: string }> = {
  high: { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700', border: 'border-red-100' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', border: 'border-amber-100' },
  low: { bg: 'bg-slate-50', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-600', border: 'border-slate-100' },
};

const AREA_LABEL: Record<string, string> = {
  EMS: 'EMS',
  hospital: 'Hospital',
  infrastructure: 'Infra',
  communications: 'Comms',
};

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const style = PRIORITY_STYLE[rec.priority];
  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} px-3 py-2.5`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs font-semibold leading-snug ${style.text}`}>{rec.title}</p>
        <div className="flex shrink-0 gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${style.badge}`}>
            {rec.priority}
          </span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
            {AREA_LABEL[rec.area] ?? rec.area}
          </span>
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{rec.reason}</p>
    </div>
  );
}

// ── Chart styling constants ─────────────────────────────────────────────

const CHART_COLORS = {
  slate600: '#475569',
  slate400: '#94a3b8',
  slate300: '#cbd5e1',
  amber500: '#f59e0b',
  red500: '#ef4444',
  green500: '#22c55e',
};

const AXIS_STYLE = {
  fontSize: 11,
  fill: '#94a3b8',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
};

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    fontSize: 12,
    padding: '8px 12px',
  },
  labelStyle: { color: '#64748b', fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: '1px 0' },
};

function AnalysisCharts({ result, currentHour }: { result: HourlySimulationResult; currentHour: number }) {
  const chartData = useMemo(
    () =>
      result.snapshots.map((s) => ({
        hour: `Hr ${s.hour}`,
        newPatients: s.patientsGeneratedThisHour,
        cumulativePatients: s.cumulativePatients,
        transportDemand: s.patientsNeedingTransport,
        transportCapacity: s.cumulativeTransported,
        ambulanceGap: s.ambulanceGap,
        hospitalLoad: s.hospitalLoadPct,
      })),
    [result],
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Patient Demand Over Time
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="gradPatients" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.slate600} stopOpacity={0.2} />
                <stop offset="100%" stopColor={CHART_COLORS.slate600} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="hour" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [
                value,
                name === 'cumulativePatients' ? 'Cumulative' : 'New This Hour',
              ]}
            />
            <Area
              type="monotone"
              dataKey="cumulativePatients"
              stroke={CHART_COLORS.slate600}
              strokeWidth={2}
              fill="url(#gradPatients)"
              dot={false}
              activeDot={{ r: 3, fill: CHART_COLORS.slate600, strokeWidth: 0 }}
            />
            <Bar dataKey="newPatients" fill={CHART_COLORS.slate300} radius={[2, 2, 0, 0]} barSize={12} />
            {currentHour < 6 && (
              <ReferenceLine x={`Hr ${currentHour}`} stroke={CHART_COLORS.slate400} strokeDasharray="4 3" strokeWidth={1} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Transport Capacity vs. Demand
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="hour" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  transportDemand: 'Demand',
                  transportCapacity: 'Transported',
                  ambulanceGap: 'Gap',
                };
                return [value, labels[name] ?? name];
              }}
            />
            <Legend
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: '#94a3b8', paddingTop: 4 }}
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  transportDemand: 'Demand',
                  transportCapacity: 'Transported',
                  ambulanceGap: 'Gap',
                };
                return labels[value] ?? value;
              }}
            />
            <Bar dataKey="transportDemand" fill={CHART_COLORS.slate400} radius={[2, 2, 0, 0]} barSize={10} />
            <Bar dataKey="transportCapacity" fill={CHART_COLORS.green500} radius={[2, 2, 0, 0]} barSize={10} opacity={0.7} />
            <Bar dataKey="ambulanceGap" fill={CHART_COLORS.amber500} radius={[2, 2, 0, 0]} barSize={10} opacity={0.8} />
            {currentHour < 6 && (
              <ReferenceLine x={`Hr ${currentHour}`} stroke={CHART_COLORS.slate400} strokeDasharray="4 3" strokeWidth={1} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Hospital Load Over Time
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="hour" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip {...TOOLTIP_STYLE} formatter={(value: number) => [`${value}%`, 'Hospital Load']} />
            <ReferenceLine y={70} stroke={CHART_COLORS.amber500} strokeDasharray="6 3" strokeWidth={1} label={{ value: '70%', position: 'right', fill: CHART_COLORS.amber500, fontSize: 10 }} />
            <ReferenceLine y={90} stroke={CHART_COLORS.red500} strokeDasharray="6 3" strokeWidth={1} label={{ value: '90%', position: 'right', fill: CHART_COLORS.red500, fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="hospitalLoad"
              stroke={CHART_COLORS.red500}
              strokeWidth={2}
              dot={{ r: 3, fill: '#fff', stroke: CHART_COLORS.red500, strokeWidth: 2 }}
              activeDot={{ r: 4, fill: CHART_COLORS.red500, strokeWidth: 0 }}
            />
            {currentHour < 6 && (
              <ReferenceLine x={`Hr ${currentHour}`} stroke={CHART_COLORS.slate400} strokeDasharray="4 3" strokeWidth={1} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Status indicator dot ────────────────────────────────────────────────

function StatusDot({ status }: { status: 'green' | 'amber' | 'red' }) {
  const color = status === 'green' ? 'bg-green-500' : status === 'amber' ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

// ── Capacity bar ────────────────────────────────────────────────────────

function CapacityBar({ pct, size = 'normal' }: { pct: number; size?: 'normal' | 'small' }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = clamped >= 90 ? 'bg-red-500' : clamped >= 70 ? 'bg-amber-500' : 'bg-green-500';
  const h = size === 'small' ? 'h-1' : 'h-1.5';
  return (
    <div className={`${h} w-full rounded-full bg-gray-100`}>
      <div className={`${h} rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

// ── Section header ──────────────────────────────────────────────────────

function SectionHeader({
  title,
  status,
  children,
}: {
  title: string;
  status?: 'green' | 'amber' | 'red';
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
      <div className="flex items-center gap-2">
        {status && <StatusDot status={status} />}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
      </div>
      {children}
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────

export function SimulationDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as {
    ws: WorkspaceState;
    scenarioName: string;
    scenario: TornadoScenario;
  } | null;

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-sm text-slate-500">No simulation data available.</p>
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

  return (
    <DashboardInner ws={ws} scenarioName={scenarioName} scenario={scenario} navigate={navigate} />
  );
}

function DashboardInner({
  ws,
  scenarioName,
  scenario,
  navigate,
}: {
  ws: WorkspaceState;
  scenarioName: string;
  scenario: TornadoScenario;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [playbackPos, setPlaybackPos] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayHint, setShowPlayHint] = useState(true);
  const [showExportHint, setShowExportHint] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentHour = Math.min(6, Math.floor(playbackPos));

  const result = useMemo(() => runHourlySimulation(ws, scenarioName), [ws, scenarioName]);
  const eventLog = useMemo(() => generateEventLog(result), [result]);
  const snap = result.snapshots[currentHour];

  // ── Playback interval ───────────────────────────────────────────────

  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setPlaybackPos((prev) => {
        const next = prev + INCREMENT;
        if (next >= 6) {
          setIsPlaying(false);
          setShowExportHint(true);
          if (exportHintTimerRef.current) clearTimeout(exportHintTimerRef.current);
          exportHintTimerRef.current = setTimeout(() => setShowExportHint(false), 6000);
          return 6;
        }
        return next;
      });
    }, TICK_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    playHintTimerRef.current = setTimeout(() => setShowPlayHint(false), 8000);
    return () => { if (playHintTimerRef.current) clearTimeout(playHintTimerRef.current); };
  }, []);

  const handlePlay = useCallback(() => {
    if (playbackPos >= 6) setPlaybackPos(0);
    setIsPlaying(true);
    setShowPlayHint(false);
  }, [playbackPos]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setPlaybackPos(0);
  }, []);

  // ── Derived display values ──────────────────────────────────────────

  const recommendations = useMemo(
    () => generateRecommendations(ws, result, currentHour),
    [ws, result, currentHour],
  );
  const highPriority = recommendations.filter((r) => r.priority === 'high');
  const otherPriority = recommendations.filter((r) => r.priority !== 'high');

  const readinessLabel =
    snap.readinessScore >= 70 ? 'Prepared' : snap.readinessScore >= 40 ? 'At Risk' : 'Critical';
  const readinessColor =
    snap.readinessScore >= 70 ? 'green' as const : snap.readinessScore >= 40 ? 'amber' as const : 'red' as const;
  const readinessText =
    snap.readinessScore >= 70 ? 'text-green-600' : snap.readinessScore >= 40 ? 'text-amber-600' : 'text-red-600';
  const readinessBg =
    snap.readinessScore >= 70 ? 'bg-green-50' : snap.readinessScore >= 40 ? 'bg-amber-50' : 'bg-red-50';

  const emsStatus: 'green' | 'amber' | 'red' =
    snap.ambulanceGap > 10 ? 'red' : snap.ambulanceGap > 0 ? 'amber' : 'green';
  const hospitalStatus: 'green' | 'amber' | 'red' =
    snap.hospitalLoadPct >= 90 ? 'red' : snap.hospitalLoadPct >= 70 ? 'amber' : 'green';
  const transportStatus: 'green' | 'amber' | 'red' =
    snap.patientsAwaitingTransport > 15 ? 'red' : snap.patientsAwaitingTransport > 0 ? 'amber' : 'green';

  const totalUnits = scenario.emsResources.units.length;
  const activeUnits = scenario.emsResources.units.filter((u) => u.available).length;
  const transportUnits = ws.alsAmbulances + ws.blsAmbulances;

  // Per-hospital state via centralized model
  const unitStates = useMemo(
    () => computeUnitStates(scenario, snap, currentHour),
    [scenario, snap, currentHour],
  );
  const hospStates = useMemo(
    () => computeHospitalStates(ws, scenario, snap, currentHour, unitStates),
    [ws, scenario, snap, currentHour, unitStates],
  );

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-slate-800">
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <TornadoIcon size={18} />
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">TornadoReady</h1>
            <span className="h-4 w-px bg-gray-200" />
            <span className="text-sm text-slate-500">{scenarioName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/workspace?scenario=${scenario.id}`)}
            className="rounded px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-gray-100 hover:text-slate-700 transition-colors"
          >
            Back to Planning
          </button>
          <div className="relative">
            {showExportHint && (
              <style>{`
                @keyframes export-pulse {
                  0% { box-shadow: 0 0 0 0 rgba(30,41,59,0.4); }
                  70% { box-shadow: 0 0 0 8px rgba(30,41,59,0); }
                  100% { box-shadow: 0 0 0 0 rgba(30,41,59,0); }
                }
              `}</style>
            )}
            <button
              onClick={() => { setShowExportHint(false); navigate('/report', { state: { ws, scenarioName, scenario, simulationResult: result } }); }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                showExportHint
                  ? 'bg-slate-800 text-white hover:bg-slate-700'
                  : 'border border-gray-200 text-slate-600 hover:bg-gray-50'
              }`}
              style={showExportHint ? { animation: 'export-pulse 1.5s ease-out infinite' } : undefined}
            >
              Export Report
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content: Map + Situation Dashboard ────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="relative flex-1">
          <SimulationMap
            scenario={scenario}
            ws={ws}
            snapshot={snap}
            hour={currentHour}
            pctNeedingTransport={ws.pctNeedingTransport}
          />
        </div>

        {/* Right panel: Situation Dashboard */}
        <div className="w-[340px] shrink-0 border-l border-gray-200 bg-white overflow-y-auto">

          {/* ── Situation Overview ─────────────────────────────────── */}
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Situation Overview</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  EF{ws.efScale} &middot; {ws.pathLength} mi corridor &middot; {ws.areaType}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Hour</p>
                <p className="text-lg font-bold tabular-nums text-slate-800">{currentHour}<span className="text-slate-300">/6</span></p>
              </div>
            </div>
          </div>

          {/* ── Readiness Score ────────────────────────────────────── */}
          <div className={`mx-3 mt-3 rounded-lg ${readinessBg} px-3 py-2.5`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Readiness</p>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-2xl font-bold tabular-nums ${readinessText}`}>{snap.readinessScore}</span>
                  <span className={`text-xs font-semibold ${readinessText}`}>{readinessLabel}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">{formatNumber(snap.cumulativePatients)} patients</p>
                <p className="text-xs text-slate-500">{formatNumber(snap.patientsNeedingTransport)} need transport</p>
              </div>
            </div>
          </div>

          {/* ── EMS Resources ─────────────────────────────────────── */}
          <SectionHeader title="EMS Resources" status={emsStatus}>
            <span className="text-xs tabular-nums text-slate-400">{activeUnits}/{totalUnits} active</span>
          </SectionHeader>
          <div className="px-4 py-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Transport units (ALS+BLS)</span>
              <span className="font-medium text-slate-700 tabular-nums">{transportUnits}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Transports this hour</span>
              <span className="font-medium text-slate-700 tabular-nums">{snap.ambulanceTransportsThisHour}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Ambulance gap</span>
              <span className={`font-semibold tabular-nums ${snap.ambulanceGap > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {snap.ambulanceGap > 0 ? `${snap.ambulanceGap} patients` : 'None'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Mutual aid</span>
              <span className={`font-medium ${snap.mutualAidNeeded ? 'text-amber-600' : 'text-slate-700'}`}>
                {snap.mutualAidNeeded
                  ? result.mutualAidTriggeredAtHour !== null
                    ? `Triggered at Hr ${result.mutualAidTriggeredAtHour}`
                    : 'Needed'
                  : 'Not needed'}
              </span>
            </div>
          </div>

          {/* ── Hospital Capacity ──────────────────────────────────── */}
          <SectionHeader title="Hospital Capacity" status={hospitalStatus}>
            <span className="text-xs tabular-nums text-slate-400">{snap.hospitalLoadPct}% load</span>
          </SectionHeader>
          <div className="px-4 py-2.5 space-y-3">
            {hospStates.map((hs) => {
              const statusStyle = CAPACITY_STATUS_COLOR[hs.capacityStatus];
              return (
                <div key={hs.hospitalId} className={`rounded-lg border ${statusStyle.border} ${statusStyle.bg} px-3 py-2`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusStyle.dot }} />
                      <span className="text-xs font-semibold text-slate-800 truncate">{hs.name}</span>
                    </div>
                    <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: statusStyle.dot }}>
                      {hs.edLoadPct}%
                    </span>
                  </div>
                  <CapacityBar pct={hs.edLoadPct} size="small" />
                  <div className="mt-1.5 grid grid-cols-3 gap-x-2 text-[10px]">
                    <div>
                      <span className="text-slate-400">Beds</span>
                      <span className={`ml-1 font-semibold ${hs.remainingBeds < 5 ? 'text-red-600' : 'text-slate-700'}`}>{hs.remainingBeds}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Incoming</span>
                      <span className="ml-1 font-semibold text-slate-700">{hs.incomingPatientsThisHour}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">EMS</span>
                      <span className={`ml-1 font-semibold ${hs.incomingEmsUnits >= 3 ? 'text-amber-600' : 'text-slate-700'}`}>{hs.incomingEmsUnits}</span>
                    </div>
                  </div>
                  {hs.recommendation && (
                    <p className="mt-1.5 text-[10px] leading-snug font-medium" style={{ color: statusStyle.dot }}>
                      {hs.recommendation}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-50">
              <span className="text-slate-500">Total arrivals</span>
              <span className="font-medium text-slate-700 tabular-nums">{formatNumber(snap.cumulativeHospitalArrivals)}</span>
            </div>
            {result.peakHospitalLoadPct > snap.hospitalLoadPct && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Peak load (projected)</span>
                <span className={`font-medium tabular-nums ${result.peakHospitalLoadPct >= 90 ? 'text-red-600' : 'text-amber-600'}`}>
                  {result.peakHospitalLoadPct}%
                </span>
              </div>
            )}
          </div>

          {/* ── Transport ─────────────────────────────────────────── */}
          <SectionHeader title="Transport" status={transportStatus}>
            <span className="text-xs tabular-nums text-slate-400">{snap.cumulativeTransported} moved</span>
          </SectionHeader>
          <div className="px-4 py-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Transported total</span>
              <span className="font-medium text-slate-700 tabular-nums">{formatNumber(snap.cumulativeTransported)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Awaiting transport</span>
              <span className={`font-semibold tabular-nums ${snap.patientsAwaitingTransport > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {snap.patientsAwaitingTransport}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Self-presenting</span>
              <span className="font-medium text-slate-700 tabular-nums">{formatNumber(snap.patientsSelfPresenting)}</span>
            </div>
          </div>

          {/* ── Event Log ─────────────────────────────────────────── */}
          <SectionHeader title="Event Log" />
          <div className="px-4 py-2.5">
            <div className="space-y-1.5">
              {eventLog.slice(0, currentHour + 1).reverse().map((entry, idx) => {
                const hourIdx = currentHour - idx;
                const isCurrent = hourIdx === currentHour;
                return (
                  <div key={hourIdx} className={`text-[11px] leading-relaxed ${isCurrent ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                    {entry}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Actions / Recommendations ─────────────────────────── */}
          {recommendations.length > 0 && (
            <>
              <SectionHeader
                title="Actions"
                status={highPriority.length > 0 ? 'red' : 'amber'}
              >
                <span className="text-xs tabular-nums text-slate-400">{recommendations.length}</span>
              </SectionHeader>
              <div className="px-3 py-2.5 space-y-2">
                {highPriority.map((rec) => (
                  <RecommendationCard key={rec.id} rec={rec} />
                ))}
                {otherPriority.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-600 select-none py-1">
                      {otherPriority.length} more recommendation{otherPriority.length !== 1 ? 's' : ''}
                    </summary>
                    <div className="space-y-2 mt-1.5">
                      {otherPriority.map((rec) => (
                        <RecommendationCard key={rec.id} rec={rec} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </>
          )}

          {/* ── Analysis Charts (collapsible) ─────────────────────── */}
          <details className="border-t border-gray-100">
            <summary className="cursor-pointer px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 select-none">
              Analysis Charts
            </summary>
            <div className="px-3 pb-4">
              <AnalysisCharts result={result} currentHour={currentHour} />
            </div>
          </details>
        </div>
      </div>

      {/* ── Bottom timeline ────────────────────────────────────────── */}
      <div className="border-t border-gray-200 bg-white">
        {/* Controls row */}
        <div className="flex items-center gap-3 px-4 py-2">
          {/* Play / Pause / Reset */}
          <div className="flex items-center gap-0.5">
            {showPlayHint && (
              <style>{`
                @keyframes play-ring {
                  0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.45); }
                  70% { box-shadow: 0 0 0 10px rgba(59,130,246,0); }
                  100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
                }
              `}</style>
            )}
            <div className="relative">
              {showPlayHint && (
                <span
                  className="pointer-events-none absolute inset-0 rounded"
                  style={{ animation: 'play-ring 1.5s ease-out infinite' }}
                />
              )}
              <button
                onClick={isPlaying ? handlePause : handlePlay}
                className={`relative rounded p-1.5 transition-colors ${
                  showPlayHint && !isPlaying
                    ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    : 'text-slate-500 hover:bg-gray-100 hover:text-slate-700'
                }`}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <rect x="2" y="1.5" width="3.5" height="11" rx="0.5" />
                    <rect x="8.5" y="1.5" width="3.5" height="11" rx="0.5" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <path d="M3 1.5v11l9-5.5z" />
                  </svg>
                )}
              </button>
            </div>
            <button
              onClick={handleReset}
              className="rounded p-1.5 text-slate-400 hover:bg-gray-100 hover:text-slate-600 transition-colors"
              title="Reset"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M1.5 7a5.5 5.5 0 1 1 .97 3.1l1.3-1.3A3.5 3.5 0 1 0 3.5 7h1.5L2.5 9.5 0 7h1.5z" />
              </svg>
            </button>
            {showPlayHint && !isPlaying && (
              <span className="ml-1 text-xs font-medium text-blue-600">
                Press play to start simulation
              </span>
            )}
          </div>

          <span className="h-4 w-px bg-gray-200" />

          {/* Hour buttons with status color */}
          <div className="flex items-center gap-1">
            {result.snapshots.map((s) => {
              const active = s.hour === currentHour;
              const hourColor = s.readinessScore >= 70 ? 'bg-green-500' : s.readinessScore >= 40 ? 'bg-amber-500' : 'bg-red-500';
              return (
                <button
                  key={s.hour}
                  onClick={() => { setIsPlaying(false); setPlaybackPos(s.hour); }}
                  className={`relative flex h-8 w-11 flex-col items-center justify-center rounded text-xs transition-colors ${
                    active
                      ? 'bg-slate-800 text-white'
                      : 'bg-gray-50 text-slate-500 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  <span className="font-medium tabular-nums">Hr {s.hour}</span>
                  <span className={`mt-0.5 h-1 w-5 rounded-full ${active ? 'bg-white/30' : ''}`}>
                    <span className={`block h-full rounded-full ${active ? 'bg-white' : hourColor}`} style={{ width: `${Math.max(10, s.readinessScore)}%` }} />
                  </span>
                </button>
              );
            })}
          </div>

          <span className="h-4 w-px bg-gray-200" />

          {/* Scrubber */}
          <input
            type="range"
            min="0"
            max="6"
            step="any"
            value={playbackPos}
            onChange={(e) => { setIsPlaying(false); setPlaybackPos(Number(e.target.value)); }}
            className="sim-scrubber w-28"
          />

          <span className="h-4 w-px bg-gray-200" />

          <span className={`text-xs font-medium ${readinessText}`}>
            Readiness: {snap.readinessScore}/100
          </span>

          <span className="ml-auto text-[11px] text-slate-400">
            Planning simulation — not live tracking.
          </span>
        </div>

        {/* Event narrative */}
        <div className="border-t border-gray-100 px-4 py-1.5">
          <p className="text-[11px] text-slate-500">{eventLog[currentHour]}</p>
        </div>
      </div>
    </div>
  );
}
