import type { WorkspaceState, HospitalEntry } from '../types/workspace';
import type { TornadoScenario } from '../types/scenario';
import type { HourlySnapshot } from './hourlyEngine';
import type { UnitState } from './emsState';

// ── Hospital capacity status ────────────────────────────────────────────

export type CapacityStatus = 'available' | 'nearing-capacity' | 'overloaded';

export const CAPACITY_STATUS_LABEL: Record<CapacityStatus, string> = {
  'available': 'Available',
  'nearing-capacity': 'Nearing Capacity',
  'overloaded': 'Overloaded',
};

export const CAPACITY_STATUS_COLOR: Record<CapacityStatus, { text: string; bg: string; border: string; dot: string }> = {
  'available':         { text: 'text-green-700', bg: 'bg-green-50',  border: 'border-green-200', dot: '#16a34a' },
  'nearing-capacity':  { text: 'text-amber-700', bg: 'bg-amber-50',  border: 'border-amber-200', dot: '#d97706' },
  'overloaded':        { text: 'text-red-700',   bg: 'bg-red-50',    border: 'border-red-200',   dot: '#dc2626' },
};

// ── Per-hospital state for a given simulation hour ──────────────────────

export interface HospitalState {
  hospitalId: string;
  name: string;
  traumaLevel: number | null;
  traumaCapability: string;
  edCapacity: number;
  edLoadPct: number;
  availableBeds: number;
  remainingBeds: number;
  incomingPatientsThisHour: number;
  cumulativeArrivals: number;
  incomingEmsUnits: number;
  capacityStatus: CapacityStatus;
  recommendation: string | null;
  mapStatus: 'green' | 'yellow' | 'red';
}

// ── Compute per-hospital state ──────────────────────────────────────────

export function computeHospitalStates(
  ws: WorkspaceState,
  scenario: TornadoScenario,
  snapshot: HourlySnapshot,
  hour: number,
  unitStates: UnitState[],
): HospitalState[] {
  const totalERCapacity = ws.hospitals.reduce((sum, h) => sum + h.edCapacity, 0);
  const states: HospitalState[] = [];

  // Count EMS units heading to each hospital
  const incomingUnitsByHospital = new Map<string, number>();
  for (const us of unitStates) {
    if (
      (us.status === 'transporting' || us.status === 'en-route') &&
      us.assignedHospital
    ) {
      const count = incomingUnitsByHospital.get(us.assignedHospital) ?? 0;
      incomingUnitsByHospital.set(us.assignedHospital, count + 1);
    }
  }

  const hospitalEntries = ws.hospitals;
  const scenarioHospitals = scenario.hospitals;

  for (let i = 0; i < hospitalEntries.length; i++) {
    const h = hospitalEntries[i];
    const sh = scenarioHospitals[i];

    // Proportional share of arrivals based on ED capacity
    const arrivalShare = totalERCapacity > 0
      ? (h.edCapacity / totalERCapacity) * snapshot.cumulativeHospitalArrivals
      : 0;
    const arrivalsThisHour = totalERCapacity > 0
      ? (h.edCapacity / totalERCapacity) * snapshot.hospitalArrivals
      : 0;

    // ED load: baseline occupancy + surge arrivals
    const baselineLoad = h.edCapacity * 0.6;
    const totalLoad = baselineLoad + (hour >= 1 ? arrivalShare : 0);
    const edLoadPct = h.edCapacity > 0
      ? Math.min(100, Math.round((totalLoad / h.edCapacity) * 100))
      : 100;

    // Remaining beds: original beds minus arrivals that need admission
    const admittedEstimate = Math.round(arrivalShare * 0.6);
    const remainingBeds = Math.max(0, h.availableBeds - admittedEstimate);

    // Incoming EMS units
    const incomingEmsUnits = incomingUnitsByHospital.get(h.name) ?? 0;

    // Capacity status
    const overloaded = edLoadPct >= 90 || (remainingBeds === 0 && arrivalShare > 0);
    const nearingCapacity = edLoadPct >= 70 || remainingBeds < 10;
    const capacityStatus: CapacityStatus = overloaded
      ? 'overloaded'
      : nearingCapacity
        ? 'nearing-capacity'
        : 'available';

    // Map color
    const mapStatus: 'green' | 'yellow' | 'red' = overloaded ? 'red' : nearingCapacity ? 'yellow' : 'green';

    // Diversion recommendation
    const recommendation = computeRecommendation(
      h, edLoadPct, remainingBeds, incomingEmsUnits, arrivalShare, capacityStatus,
    );

    states.push({
      hospitalId: h.id,
      name: h.name,
      traumaLevel: sh?.traumaLevel ?? null,
      traumaCapability: h.traumaCapability,
      edCapacity: h.edCapacity,
      edLoadPct,
      availableBeds: h.availableBeds,
      remainingBeds,
      incomingPatientsThisHour: Math.round(arrivalsThisHour),
      cumulativeArrivals: Math.round(arrivalShare),
      incomingEmsUnits,
      capacityStatus,
      recommendation,
      mapStatus,
    });
  }

  // Cross-hospital diversion: if multiple overloaded, upgrade recommendations
  const overloadedCount = states.filter((s) => s.capacityStatus === 'overloaded').length;
  if (overloadedCount >= 2) {
    for (const s of states) {
      if (s.capacityStatus === 'overloaded') {
        s.recommendation = 'Multiple hospitals overloaded — activate alternate care site or request regional mutual aid.';
      }
    }
  }

  // For overloaded hospitals, suggest the best diversion target
  const availableTargets = states
    .filter((s) => s.capacityStatus === 'available')
    .sort((a, b) => a.edLoadPct - b.edLoadPct);

  if (availableTargets.length > 0 && overloadedCount < 2) {
    for (const s of states) {
      if (s.capacityStatus === 'overloaded' && s.recommendation) {
        const target = availableTargets[0];
        s.recommendation = `Divert non-critical patients to ${target.name} (ED ${target.edLoadPct}%, ${target.remainingBeds} beds).`;
      }
    }
  }

  return states;
}

// ── Per-hospital recommendation logic ───────────────────────────────────

function computeRecommendation(
  _h: HospitalEntry,
  edLoadPct: number,
  remainingBeds: number,
  incomingEmsUnits: number,
  _arrivalShare: number,
  status: CapacityStatus,
): string | null {
  if (status === 'available') return null;

  if (status === 'overloaded') {
    if (remainingBeds === 0) {
      return 'No beds remaining — activate surge capacity and divert incoming patients.';
    }
    if (edLoadPct >= 95) {
      return 'ED critically overloaded — divert all non-critical patients immediately.';
    }
    return 'ED load exceeds 90% — divert yellow/green patients to lower-load facilities.';
  }

  // Nearing capacity
  if (edLoadPct >= 80 && incomingEmsUnits >= 2) {
    return `${incomingEmsUnits} EMS units incoming — prepare for surge, consider early diversion of yellow patients.`;
  }
  if (remainingBeds < 5) {
    return `Only ${remainingBeds} beds remaining — limit new admissions to critical patients.`;
  }
  if (edLoadPct >= 80) {
    return 'ED approaching capacity — monitor closely and prepare diversion plan.';
  }

  return 'Approaching capacity — continue monitoring.';
}
