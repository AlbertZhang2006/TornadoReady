import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { mockScenarios, sampleEF3Scenario, createBlankScenario } from '../data/mockScenarios';
import { formatNumber, efScaleLabel } from '../utils/format';
import { ScenarioMap } from '../components/map/ScenarioMap';
import type { WorkspaceState, HospitalEntry } from '../types/workspace';
import { deriveSummary } from '../types/workspace';
import type { TornadoScenario, GeoPoint } from '../types/scenario';
import { getSavedScenario, saveScenario } from '../utils/savedScenarios';
import type { SavedScenarioEntry } from '../utils/savedScenarios';
import { TornadoIcon } from '../components/TornadoIcon';

type StepId = 'tornado' | 'path' | 'exposure' | 'ems' | 'hospitals' | 'assumptions';

const STEPS: { id: StepId; label: string; num: number }[] = [
  { id: 'tornado', label: 'Tornado Profile', num: 1 },
  { id: 'path', label: 'Impact Path Builder', num: 2 },
  { id: 'exposure', label: 'Community Exposure', num: 3 },
  { id: 'ems', label: 'EMS Resources', num: 4 },
  { id: 'hospitals', label: 'Hospitals', num: 5 },
  { id: 'assumptions', label: 'Planning Assumptions', num: 6 },
];

const PURPOSE_OPTIONS = [
  'EMS surge planning',
  'Hospital surge planning',
  'Mutual aid planning',
  'Tabletop exercise',
];

const ALL_SCENARIOS: TornadoScenario[] = [sampleEF3Scenario, ...mockScenarios];

// ---------------------------------------------------------------------------
// Location search data — derived from mock scenarios
// ---------------------------------------------------------------------------

interface LocationOption {
  id: string;
  label: string;
  region: string;
  scenario: TornadoScenario;
}

const LOCATION_OPTIONS: LocationOption[] = ALL_SCENARIOS.map((s) => ({
  id: s.id,
  label: s.region,
  region: s.region,
  scenario: s,
}));

// ---------------------------------------------------------------------------
// Bearing utilities — auto-compute direction from path geometry
// ---------------------------------------------------------------------------

function computeBearing(from: GeoPoint, to: GeoPoint): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function bearingToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function pathDirection(centerLine: GeoPoint[]): string {
  if (centerLine.length < 2) return '';
  const start = centerLine[0];
  const end = centerLine[centerLine.length - 1];
  const deg = computeBearing(start, end);
  return `${bearingToCompass((deg + 180) % 360)} → ${bearingToCompass(deg)}`;
}

// ---------------------------------------------------------------------------
// Onboarding animation overlay
// ---------------------------------------------------------------------------

function OnboardingOverlay({ onFinish }: { onFinish: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onFinish();
    }, 3000);
    return () => clearTimeout(timerRef.current);
  }, [onFinish]);

  return (
    <>
      <style>{`
        @keyframes panel-glow {
          0% { box-shadow: inset 0 0 0 2px transparent; }
          15% { box-shadow: inset 0 0 0 2px rgba(15,23,42,0.15); }
          40% { box-shadow: inset 0 0 0 2px rgba(15,23,42,0.08); }
          55% { box-shadow: inset 0 0 0 2px rgba(15,23,42,0.15); }
          80% { box-shadow: inset 0 0 0 2px transparent; }
          100% { box-shadow: inset 0 0 0 2px transparent; }
        }
        @keyframes step-cascade {
          0% { background: transparent; }
          20% { background: rgba(15,23,42,0.06); }
          60% { background: rgba(15,23,42,0.06); }
          100% { background: transparent; }
        }
        .onboard-panel-glow {
          animation: panel-glow 3s ease-in-out forwards;
        }
        .onboard-step {
          animation: step-cascade 1.2s ease-in-out forwards;
        }
      `}</style>
      <div className="onboard-panel-glow pointer-events-none absolute inset-0 z-30 rounded-sm" />
    </>
  );
}

function AutoFillOverlay() {
  return (
    <>
      <style>{`
        @keyframes autofill-glow {
          0% { box-shadow: inset 0 0 0 2px transparent; }
          12% { box-shadow: inset 0 0 0 2px rgba(59,130,246,0.35); }
          35% { box-shadow: inset 0 0 0 2px rgba(59,130,246,0.18); }
          55% { box-shadow: inset 0 0 0 2px rgba(59,130,246,0.30); }
          80% { box-shadow: inset 0 0 0 2px rgba(59,130,246,0.08); }
          100% { box-shadow: inset 0 0 0 2px transparent; }
        }
        @keyframes autofill-step {
          0% { background: transparent; }
          20% { background: rgba(59,130,246,0.08); }
          60% { background: rgba(59,130,246,0.08); }
          100% { background: transparent; }
        }
        @keyframes autofill-banner {
          0% { opacity: 0; transform: translateY(-4px); }
          10% { opacity: 1; transform: translateY(0); }
          75% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        .autofill-panel-glow {
          animation: autofill-glow 3s ease-in-out forwards;
        }
        .autofill-step {
          animation: autofill-step 1.2s ease-in-out forwards;
        }
        .autofill-banner {
          animation: autofill-banner 3s ease-in-out forwards;
        }
      `}</style>
      <div className="autofill-panel-glow pointer-events-none absolute inset-0 z-30 rounded-sm" />
      <div className="pointer-events-none absolute left-3 right-3 bottom-3 z-40">
        <div className="autofill-banner rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 shadow-sm">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-blue-500">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5.5 8.5L7 10l3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-xs font-medium text-blue-700">
              Fields updated automatically based on your location selection.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Location search combobox
// ---------------------------------------------------------------------------

function LocationSearch({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (opt: LocationOption) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    if (!query) return LOCATION_OPTIONS;
    const q = query.toLowerCase();
    return LOCATION_OPTIONS.filter(
      (o) =>
        o.region.toLowerCase().includes(q) ||
        o.scenario.name.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  function select(opt: LocationOption) {
    setQuery(opt.region);
    setOpen(false);
    setFocusIndex(-1);
    onSelect(opt);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && focusIndex >= 0 && filtered[focusIndex]) {
      e.preventDefault();
      select(filtered[focusIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-slate-500 mb-1">Location</label>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          width="14" height="14" viewBox="0 0 16 16" fill="none"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="w-full rounded border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          placeholder="Search city, county, or region..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setFocusIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {filtered.map((opt, i) => (
            <li key={opt.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(opt)}
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                  i === focusIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <span className="font-medium text-slate-900">{opt.region}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-3 shadow-lg">
          <p className="text-xs text-slate-400">No matching locations found.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared form primitives
// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none';
const selectClass = inputClass;
const labelClass = 'block text-xs font-medium text-slate-500 mb-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={inputClass}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="shrink-0 text-xs text-slate-400">{suffix}</span>}
      </div>
    </Field>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Field label={label}>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ThreeLevelField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: 'low' | 'moderate' | 'high') => void;
}) {
  const levels: { v: 'low' | 'moderate' | 'high'; color: string }[] = [
    { v: 'low', color: 'bg-green-500' },
    { v: 'moderate', color: 'bg-amber-500' },
    { v: 'high', color: 'bg-red-500' },
  ];
  return (
    <Field label={label}>
      <div className="flex gap-1">
        {levels.map((l) => (
          <button
            key={l.v}
            type="button"
            onClick={() => onChange(l.v)}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
              value === l.v
                ? `${l.color} text-white`
                : 'bg-gray-100 text-slate-500 hover:bg-gray-200'
            }`}
          >
            {l.v}
          </button>
        ))}
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Tornado Profile (with location search)
// ---------------------------------------------------------------------------

function TornadoProfileStep({
  s,
  set,
  onLocationSelect,
}: {
  s: WorkspaceState;
  set: (patch: Partial<WorkspaceState>) => void;
  onLocationSelect: (opt: LocationOption) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Define the tornado's strength, setting, and timing. These parameters drive casualty estimates
        and resource demand calculations.
      </p>

      <LocationSearch
        value={s.region}
        onSelect={onLocationSelect}
      />

      <SelectField
        label="EF Rating"
        value={String(s.efScale)}
        onChange={(v) => set({ efScale: Number(v) })}
        options={[
          { value: '-1', label: 'Select EF rating...' },
          ...[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `EF${n}` })),
        ]}
      />

      <SelectField
        label="Area Type"
        value={s.areaType}
        onChange={(v) => set({ areaType: v })}
        options={[
          { value: '', label: 'Select area type...' },
          { value: 'rural', label: 'Rural' },
          { value: 'suburban', label: 'Suburban' },
          { value: 'urban', label: 'Urban' },
          { value: 'mixed', label: 'Mixed' },
        ]}
      />

      <SelectField
        label="Time of Day"
        value={s.timeOfDay}
        onChange={(v) => set({ timeOfDay: v })}
        options={[
          { value: '', label: 'Select time of day...' },
          { value: 'Early morning', label: 'Early morning (midnight–6 AM)' },
          { value: 'Morning', label: 'Morning (6 AM–noon)' },
          { value: 'Afternoon', label: 'Afternoon (noon–4 PM)' },
          { value: 'Evening commute', label: 'Evening commute (4–7 PM)' },
          { value: 'Night', label: 'Night (7 PM–midnight)' },
        ]}
      />

      <Field label="Scenario Purpose">
        <div className="space-y-1.5">
          {PURPOSE_OPTIONS.map((opt) => {
            const checked = s.purpose.includes(opt);
            return (
              <label key={opt} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  className="rounded border-gray-300"
                  onChange={() =>
                    set({
                      purpose: checked ? s.purpose.filter((p) => p !== opt) : [...s.purpose, opt],
                    })
                  }
                />
                {opt}
              </label>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Impact Path Builder
// ---------------------------------------------------------------------------

function ImpactPathStep({
  s,
  set,
  computedDirection,
}: {
  s: WorkspaceState;
  set: (patch: Partial<WorkspaceState>) => void;
  computedDirection: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Define the tornado's damage corridor — the ground area where casualties and structural
        damage are concentrated. Length and width set the planning footprint shown on the map.
      </p>

      <Field label="Path Creation Method">
        <div className="space-y-1.5">
          {([
            { v: 'auto', label: 'Auto-generate sample path' },
            { v: 'manual', label: 'Draw path manually (coming soon)' },
            { v: 'historical', label: 'Use historical path (coming soon)' },
          ] as const).map((opt) => (
            <label key={opt.v} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="radio"
                name="pathMethod"
                checked={s.pathMethod === opt.v}
                onChange={() => set({ pathMethod: opt.v })}
                className="border-gray-300"
              />
              <span className={opt.v !== 'auto' ? 'text-slate-400' : ''}>{opt.label}</span>
            </label>
          ))}
        </div>
      </Field>

      <div>
        <NumberField
          label="Path Length"
          value={s.pathLength}
          onChange={(v) => set({ pathLength: v })}
          min={0.1}
          max={50}
          step={0.1}
          suffix="miles"
        />
        <p className="mt-1 text-[11px] text-slate-400">Typical range: 1–25 mi. Longer paths affect more population.</p>
      </div>

      <div>
        <NumberField
          label="Path Width"
          value={s.pathWidth}
          onChange={(v) => set({ pathWidth: v })}
          min={0.05}
          max={3}
          step={0.05}
          suffix="miles"
        />
        <p className="mt-1 text-[11px] text-slate-400">Typical range: 0.1–0.5 mi for EF2–EF3, up to 1+ mi for EF4–EF5.</p>
      </div>

      <Field label="General Bearing">
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-slate-600">
          {computedDirection || '—'}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Auto-computed from the path shape. Updates as the path is adjusted.
        </p>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Community Exposure
// ---------------------------------------------------------------------------

function CommunityExposureStep({
  s,
  set,
}: {
  s: WorkspaceState;
  set: (patch: Partial<WorkspaceState>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Population and facilities within the impact corridor. Higher-vulnerability facilities
        (nursing homes, mobile home parks) increase estimated casualty rates.
      </p>

      <NumberField
        label="Population Exposure"
        value={s.populationExposure}
        onChange={(v) => set({ populationExposure: v })}
        min={0}
        step={100}
      />
      <NumberField
        label="Schools Affected"
        value={s.schoolsAffected}
        onChange={(v) => set({ schoolsAffected: v })}
        min={0}
      />
      <NumberField
        label="Nursing Homes Affected"
        value={s.nursingHomesAffected}
        onChange={(v) => set({ nursingHomesAffected: v })}
        min={0}
      />
      <NumberField
        label="Mobile Home Parks Affected"
        value={s.mobileHomeParks}
        onChange={(v) => set({ mobileHomeParks: v })}
        min={0}
      />
      <NumberField
        label="Large Employers / Public Venues"
        value={s.largeVenues}
        onChange={(v) => set({ largeVenues: v })}
        min={0}
      />

      <ThreeLevelField
        label="Vulnerable Population Level"
        value={s.vulnerablePopLevel}
        onChange={(v) => set({ vulnerablePopLevel: v })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — EMS Resources
// ---------------------------------------------------------------------------

function EMSResourcesStep({
  s,
  set,
}: {
  s: WorkspaceState;
  set: (patch: Partial<WorkspaceState>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Available transport units and cycle time assumptions. ALS and BLS units provide patient transport;
        supervisor units coordinate but do not transport.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <NumberField label="ALS Ambulances" value={s.alsAmbulances} onChange={(v) => set({ alsAmbulances: v })} min={0} />
        <NumberField label="BLS Ambulances" value={s.blsAmbulances} onChange={(v) => set({ blsAmbulances: v })} min={0} />
        <NumberField label="Supervisors" value={s.supervisorUnits} onChange={(v) => set({ supervisorUnits: v })} min={0} />
      </div>

      <div className="border-t border-gray-100 pt-3">
        <p className="mb-3 text-xs font-medium text-slate-500">Operational Timing</p>
        <div className="space-y-3">
          <NumberField
            label="Avg. Scene Time"
            value={s.avgSceneTimeMin}
            onChange={(v) => set({ avgSceneTimeMin: v })}
            min={1}
            suffix="min"
          />
          <NumberField
            label="Avg. Transport Time"
            value={s.avgTransportTimeMin}
            onChange={(v) => set({ avgTransportTimeMin: v })}
            min={1}
            suffix="min"
          />
          <NumberField
            label="Avg. Hospital Offload Time"
            value={s.avgOffloadTimeMin}
            onChange={(v) => set({ avgOffloadTimeMin: v })}
            min={1}
            suffix="min"
          />
          <NumberField
            label="Mutual Aid Delay"
            value={s.mutualAidDelayMin}
            onChange={(v) => set({ mutualAidDelayMin: v })}
            min={0}
            suffix="min"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Hospitals (editable list)
// ---------------------------------------------------------------------------

function HospitalsStep({
  s,
  set,
}: {
  s: WorkspaceState;
  set: (patch: Partial<WorkspaceState>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  function updateHospital(id: string, patch: Partial<HospitalEntry>) {
    set({
      hospitals: s.hospitals.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    });
  }

  function addHospital() {
    const newH: HospitalEntry = {
      id: `hosp-${Date.now()}`,
      name: '',
      edCapacity: 30,
      currentEdLoad: 15,
      availableBeds: 20,
      traumaCapability: 'Level 3',
      surgeCapacity: 10,
    };
    set({ hospitals: [...s.hospitals, newH] });
    setEditingId(newH.id);
  }

  function removeHospital(id: string) {
    set({ hospitals: s.hospitals.filter((h) => h.id !== id) });
    if (editingId === id) setEditingId(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Receiving hospitals and their current capacity. Click a hospital to expand its details.
      </p>

      {s.hospitals.map((h) => {
        const isEditing = editingId === h.id;
        return (
          <div key={h.id} className="rounded border border-gray-200 bg-gray-50">
            {/* Header row — always visible */}
            <button
              type="button"
              onClick={() => setEditingId(isEditing ? null : h.id)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left"
            >
              <span className="text-sm font-medium text-slate-800">
                {h.name || 'Unnamed Hospital'}
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                {h.availableBeds} beds · ED {h.currentEdLoad}/{h.edCapacity}
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  className={`shrink-0 transition-transform ${isEditing ? 'rotate-180' : ''}`}
                >
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>

            {/* Expanded edit form */}
            {isEditing && (
              <div className="space-y-3 border-t border-gray-200 px-3 py-3">
                <Field label="Hospital Name">
                  <input
                    className={inputClass}
                    value={h.name}
                    onChange={(e) => updateHospital(h.id, { name: e.target.value })}
                    placeholder="e.g. Grant Medical Center"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="ED Capacity"
                    value={h.edCapacity}
                    onChange={(v) => updateHospital(h.id, { edCapacity: v })}
                    min={0}
                  />
                  <NumberField
                    label="Current ED Load"
                    value={h.currentEdLoad}
                    onChange={(v) => updateHospital(h.id, { currentEdLoad: v })}
                    min={0}
                  />
                </div>
                <NumberField
                  label="Available Beds"
                  value={h.availableBeds}
                  onChange={(v) => updateHospital(h.id, { availableBeds: v })}
                  min={0}
                />
                <SelectField
                  label="Trauma Capability"
                  value={h.traumaCapability}
                  onChange={(v) => updateHospital(h.id, { traumaCapability: v })}
                  options={[
                    { value: 'Level 1', label: 'Level 1 Trauma Center' },
                    { value: 'Level 2', label: 'Level 2 Trauma Center' },
                    { value: 'Level 3', label: 'Level 3 Trauma Center' },
                    { value: 'Level 4', label: 'Level 4 Trauma Center' },
                    { value: 'None', label: 'Non-trauma facility' },
                  ]}
                />
                <NumberField
                  label="Surge Capacity"
                  value={h.surgeCapacity}
                  onChange={(v) => updateHospital(h.id, { surgeCapacity: v })}
                  min={0}
                />
                <button
                  type="button"
                  onClick={() => removeHospital(h.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove hospital
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addHospital}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-300 py-2 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors"
      >
        <span>+</span> Add Hospital
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Planning Assumptions
// ---------------------------------------------------------------------------

function AssumptionsStep({
  s,
  set,
}: {
  s: WorkspaceState;
  set: (patch: Partial<WorkspaceState>) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Transport demand splits and infrastructure disruption levels. These assumptions affect
        ambulance cycle times, hospital load, and readiness scoring.
      </p>

      <NumberField
        label="Patients Needing Ambulance Transport"
        value={s.pctNeedingTransport}
        onChange={(v) => set({ pctNeedingTransport: v })}
        min={0}
        max={100}
        suffix="%"
      />
      <NumberField
        label="Patients Self-Presenting to Hospitals"
        value={s.pctSelfPresenting}
        onChange={(v) => set({ pctSelfPresenting: v })}
        min={0}
        max={100}
        suffix="%"
      />
      <NumberField
        label="Road Delay Multiplier"
        value={s.roadDelayMultiplier}
        onChange={(v) => set({ roadDelayMultiplier: v })}
        min={1.0}
        max={5.0}
        step={0.1}
        suffix="×"
      />

      <ThreeLevelField
        label="Power Disruption Level"
        value={s.powerDisruption}
        onChange={(v) => set({ powerDisruption: v })}
      />
      <ThreeLevelField
        label="Communications Disruption Level"
        value={s.commsDisruption}
        onChange={(v) => set({ commsDisruption: v })}
      />
    </div>
  );
}

function SummaryRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-medium ${warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

function initState(scenario: ReturnType<typeof createBlankScenario>, isNew: boolean): WorkspaceState {
  const { profile, impactPath, communityExposure, emsResources, assumptions } = scenario;
  return {
    region: scenario.region,
    efScale: isNew ? -1 : profile.efScale,
    areaType: isNew ? '' : profile.areaType,
    timeOfDay: isNew ? '' : profile.timeOfDay,
    purpose: [],
    pathMethod: impactPath.centerLine.length > 0 ? 'auto' : 'auto',
    pathLength: impactPath.lengthMiles || 6.2,
    pathWidth: impactPath.widthMiles || 0.4,
    direction: isNew ? '' : profile.direction,
    populationExposure: communityExposure.populationInPath,
    schoolsAffected: communityExposure.schoolsInPath,
    nursingHomesAffected: 0,
    mobileHomeParks: 0,
    largeVenues: 0,
    vulnerablePopLevel: assumptions.populationDensity === 'high' ? 'high' : assumptions.populationDensity === 'moderate' ? 'moderate' : 'low',
    alsAmbulances: emsResources.totalALS,
    blsAmbulances: emsResources.totalBLS,
    supervisorUnits: emsResources.totalSupervisors,
    avgSceneTimeMin: 15,
    avgTransportTimeMin: 12,
    avgOffloadTimeMin: 20,
    mutualAidDelayMin: 30,
    hospitals: scenario.hospitals.map((h) => ({
      id: h.id,
      name: h.name,
      edCapacity: h.erCapacity,
      currentEdLoad: Math.round(h.erCapacity * 0.6),
      availableBeds: h.availableBeds,
      traumaCapability: h.traumaLevel ? `Level ${h.traumaLevel}` : 'None',
      surgeCapacity: Math.round(h.totalBeds * 0.1),
    })),
    pctNeedingTransport: 40,
    pctSelfPresenting: 25,
    roadDelayMultiplier: communityExposure.disruption.road === 'high' ? 2.0 : communityExposure.disruption.road === 'moderate' ? 1.5 : 1.0,
    powerDisruption: communityExposure.disruption.power,
    commsDisruption: communityExposure.disruption.communications,
  };
}

function stateFromScenario(scenario: TornadoScenario): Partial<WorkspaceState> {
  const { profile, communityExposure, emsResources, assumptions } = scenario;
  return {
    region: scenario.region,
    areaType: profile.areaType,
    pathLength: scenario.impactPath.lengthMiles,
    pathWidth: scenario.impactPath.widthMiles,
    populationExposure: communityExposure.populationInPath,
    schoolsAffected: communityExposure.schoolsInPath,
    vulnerablePopLevel: assumptions.populationDensity === 'high' ? 'high' : assumptions.populationDensity === 'moderate' ? 'moderate' : 'low',
    alsAmbulances: emsResources.totalALS,
    blsAmbulances: emsResources.totalBLS,
    supervisorUnits: emsResources.totalSupervisors,
    hospitals: scenario.hospitals.map((h) => ({
      id: h.id,
      name: h.name,
      edCapacity: h.erCapacity,
      currentEdLoad: Math.round(h.erCapacity * 0.6),
      availableBeds: h.availableBeds,
      traumaCapability: h.traumaLevel ? `Level ${h.traumaLevel}` : 'None',
      surgeCapacity: Math.round(h.totalBeds * 0.1),
    })),
    roadDelayMultiplier: communityExposure.disruption.road === 'high' ? 2.0 : communityExposure.disruption.road === 'moderate' ? 1.5 : 1.0,
    powerDisruption: communityExposure.disruption.power,
    commsDisruption: communityExposure.disruption.communications,
  };
}

export function PlanningWorkspace() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = searchParams.get('mode');
  const scenarioId = searchParams.get('scenario');
  const savedId = searchParams.get('saved');

  const isNewMode = mode === 'new';

  const savedEntry = useMemo(
    () => (savedId ? getSavedScenario(savedId) : null),
    [savedId],
  );

  const initialScenario = useMemo(() => {
    if (savedEntry) return savedEntry.scenario;
    if (isNewMode) return createBlankScenario();
    if (scenarioId === 'sample-ef3') return sampleEF3Scenario;
    return mockScenarios.find((s) => s.id === scenarioId) ?? mockScenarios[0];
  }, [isNewMode, scenarioId, savedEntry]);

  const [ws, setWs] = useState<WorkspaceState>(() =>
    savedEntry ? savedEntry.ws : initState(initialScenario, isNewMode),
  );
  const [activeStep, setActiveStep] = useState<StepId>('tornado');
  const [showOnboarding, setShowOnboarding] = useState(isNewMode && !savedEntry);
  const [showAutoFill, setShowAutoFill] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<TornadoScenario>(initialScenario);
  const autoFillTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [saveId] = useState(() => savedEntry?.id ?? `saved-${Date.now()}`);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function patch(partial: Partial<WorkspaceState>) {
    setWs((prev) => ({ ...prev, ...partial }));
  }

  function handleLocationSelect(opt: LocationOption) {
    const scenarioData = stateFromScenario(opt.scenario);
    setWs((prev) => ({ ...prev, ...scenarioData }));
    setSelectedScenario(opt.scenario);
    setShowAutoFill(true);
    clearTimeout(autoFillTimerRef.current);
    autoFillTimerRef.current = setTimeout(() => setShowAutoFill(false), 3000);
  }

  const mapScenario = useMemo((): TornadoScenario => {
    const base = selectedScenario;
    const originalLength = base.impactPath.lengthMiles;
    const centerLine = base.impactPath.centerLine;

    let adjustedCenterLine = centerLine;

    if (centerLine.length >= 2 && originalLength > 0) {
      const midIdx = Math.floor(centerLine.length / 2);
      const mid = centerLine[midIdx];
      const ratio = ws.pathLength / originalLength;
      adjustedCenterLine = centerLine.map((p) => ({
        lat: mid.lat + (p.lat - mid.lat) * ratio,
        lng: mid.lng + (p.lng - mid.lng) * ratio,
      }));
    }

    return {
      ...base,
      impactPath: {
        ...base.impactPath,
        centerLine: adjustedCenterLine,
        lengthMiles: ws.pathLength,
        widthMiles: ws.pathWidth,
      },
    };
  }, [selectedScenario, ws.pathLength, ws.pathWidth]);

  const computedDirection = useMemo(
    () => pathDirection(mapScenario.impactPath.centerLine),
    [mapScenario],
  );

  useEffect(() => {
    if (computedDirection) {
      setWs((prev) => prev.direction !== computedDirection ? { ...prev, direction: computedDirection } : prev);
    }
  }, [computedDirection]);

  const summary = deriveSummary(ws);

  function renderStep() {
    switch (activeStep) {
      case 'tornado':
        return <TornadoProfileStep s={ws} set={patch} onLocationSelect={handleLocationSelect} />;
      case 'path':
        return <ImpactPathStep s={ws} set={patch} computedDirection={computedDirection} />;
      case 'exposure':
        return <CommunityExposureStep s={ws} set={patch} />;
      case 'ems':
        return <EMSResourcesStep s={ws} set={patch} />;
      case 'hospitals':
        return <HospitalsStep s={ws} set={patch} />;
      case 'assumptions':
        return <AssumptionsStep s={ws} set={patch} />;
    }
  }

  const displayName = ws.region
    ? `${ws.region} Scenario`
    : isNewMode
      ? 'New Scenario'
      : initialScenario.name;

  function handleSave() {
    const entry: SavedScenarioEntry = {
      id: saveId,
      name: displayName,
      region: ws.region,
      efScale: ws.efScale,
      pathLengthMiles: ws.pathLength,
      updatedAt: new Date().toISOString(),
      ws,
      scenario: mapScenario,
    };
    saveScenario(entry);
    setSaveStatus('saved');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 text-slate-800">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <TornadoIcon size={18} />
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <span className="text-sm font-medium text-slate-800">{displayName}</span>
          {!isNewMode && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">
              {initialScenario.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              saveStatus === 'saved'
                ? 'text-green-600'
                : 'text-slate-500 hover:bg-gray-100'
            }`}
          >
            {saveStatus === 'saved' ? 'Saved' : 'Save'}
          </button>
          <button
            onClick={() => navigate('/review', { state: { ws, scenarioName: displayName, scenario: mapScenario } })}
            className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
          >
            Run Simulation
          </button>
        </div>
      </header>

      {/* Three-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="relative flex w-80 shrink-0 flex-col border-r border-gray-200 bg-white">
          {showOnboarding && (
            <OnboardingOverlay onFinish={() => setShowOnboarding(false)} />
          )}
          {showAutoFill && <AutoFillOverlay />}
          <nav className="border-b border-gray-100 px-3 py-3">
            <ul className="space-y-0.5">
              {STEPS.map((step, idx) => (
                <li key={step.id}>
                  <button
                    onClick={() => setActiveStep(step.id)}
                    className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors ${
                      activeStep === step.id
                        ? 'bg-slate-50 font-medium text-slate-900'
                        : 'text-slate-500 hover:bg-gray-50 hover:text-slate-700'
                    } ${showOnboarding ? 'onboard-step' : ''} ${showAutoFill ? 'autofill-step' : ''}`}
                    style={showOnboarding ? { animationDelay: `${idx * 0.3}s` } : showAutoFill ? { animationDelay: `${idx * 0.3}s` } : undefined}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                        activeStep === step.id
                          ? 'bg-slate-800 text-white'
                          : 'bg-gray-100 text-slate-400'
                      }`}
                    >
                      {step.num}
                    </span>
                    {step.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {renderStep()}
            {(() => {
              const curIdx = STEPS.findIndex((s) => s.id === activeStep);
              if (curIdx < STEPS.length - 1) {
                const next = STEPS[curIdx + 1];
                return (
                  <button
                    onClick={() => setActiveStep(next.id)}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white py-2 text-xs font-medium text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
                  >
                    <span>Continue to {next.label}</span>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M6.5 5.5L9.5 8L6.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                );
              }
              return null;
            })()}
          </div>
        </div>

        {/* Center — live map */}
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1">
            {ws.region ? (
              <ScenarioMap scenario={mapScenario} pctNeedingTransport={ws.pctNeedingTransport} />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gray-100">
                <div className="text-center">
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mx-auto mb-3 text-slate-300">
                    <path d="M24 4C15.16 4 8 11.16 8 20c0 11 16 24 16 24s16-13 16-24c0-8.84-7.16-16-16-16zm0 22a6 6 0 110-12 6 6 0 010 12z" fill="currentColor"/>
                  </svg>
                  <p className="text-sm font-medium text-slate-400">No location selected</p>
                  <p className="mt-1 text-xs text-slate-300">Search for a city, county, or region to display the map.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right — planning summary */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Planning Summary
            </h3>
          </div>
          <div className="px-4 py-3">
            <div className="divide-y divide-gray-100">
              <SummaryRow label="Tornado Intensity" value={efScaleLabel(ws.efScale)} />
              <SummaryRow label="Area Type" value={ws.areaType.charAt(0).toUpperCase() + ws.areaType.slice(1)} />
              <SummaryRow label="Path" value={`${ws.pathLength} mi × ${ws.pathWidth} mi`} />
              <SummaryRow label="Population Exposed" value={ws.populationExposure > 0 ? formatNumber(ws.populationExposure) : '—'} />
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">Casualty Estimates</p>
            <div className="divide-y divide-gray-100">
              <SummaryRow
                label="Est. Casualties"
                value={summary.estCasualties > 0 ? formatNumber(summary.estCasualties) : '—'}
                warn={summary.estCasualties > 100}
              />
              <SummaryRow
                label="Need Transport"
                value={summary.needTransport > 0 ? formatNumber(summary.needTransport) : '—'}
                warn={summary.needTransport > summary.totalAmbulances * 4}
              />
              <SummaryRow
                label="Self-Presenting"
                value={summary.selfPresenting > 0 ? formatNumber(summary.selfPresenting) : '—'}
              />
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">EMS Capacity</p>
            <div className="divide-y divide-gray-100">
              <SummaryRow label="Ambulances" value={summary.totalAmbulances > 0 ? String(summary.totalAmbulances) : '—'} />
              <SummaryRow
                label="Transports / Hr"
                value={summary.transportsPerHour > 0 ? String(summary.transportsPerHour) : '—'}
                warn={summary.needTransport > 0 && summary.transportsPerHour < summary.needTransport}
              />
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">Hospital Capacity</p>
            <div className="divide-y divide-gray-100">
              <SummaryRow label="Beds Available" value={summary.totalBeds > 0 ? String(summary.totalBeds) : '—'} />
              <SummaryRow label="ED Remaining" value={summary.edRemaining > 0 ? String(summary.edRemaining) : '—'} />
              <SummaryRow label="Surge Capacity" value={summary.surgeTotal > 0 ? String(summary.surgeTotal) : '—'} />
              <SummaryRow
                label="Hospital Risk"
                value={summary.hospitalRisk === null ? '—' : summary.hospitalRisk ? 'Over capacity' : 'Within capacity'}
                warn={summary.hospitalRisk === true}
              />
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-400">Assessment</p>
            <div className="divide-y divide-gray-100">
              <SummaryRow
                label="Mutual Aid Likely"
                value={summary.mutualAidLikely ? 'Yes' : 'No'}
                warn={summary.mutualAidLikely}
              />
              <SummaryRow label="Road Delay" value={`${ws.roadDelayMultiplier}×`} warn={ws.roadDelayMultiplier > 1.5} />
              <SummaryRow label="Power" value={ws.powerDisruption.charAt(0).toUpperCase() + ws.powerDisruption.slice(1)} warn={ws.powerDisruption === 'high'} />
              <SummaryRow label="Comms" value={ws.commsDisruption.charAt(0).toUpperCase() + ws.commsDisruption.slice(1)} warn={ws.commsDisruption === 'high'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
