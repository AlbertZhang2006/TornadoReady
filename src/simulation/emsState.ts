import type { TornadoScenario, EMSUnit, PatientDemandZone } from '../types/scenario';
import type { HourlySnapshot } from './hourlyEngine';

// ── EMS unit operational statuses ───────────────────────────────────────

export type UnitStatus =
  | 'available'
  | 'dispatched'
  | 'en-route'
  | 'on-scene'
  | 'transporting'
  | 'at-hospital'
  | 'returning'
  | 'unavailable';

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  'available': 'Available',
  'dispatched': 'Dispatched',
  'en-route': 'En Route',
  'on-scene': 'On Scene',
  'transporting': 'Transporting',
  'at-hospital': 'At Hospital',
  'returning': 'Returning',
  'unavailable': 'Unavailable',
};

export const UNIT_STATUS_COLOR: Record<UnitStatus, string> = {
  'available': '#22c55e',
  'dispatched': '#6366f1',
  'en-route': '#3b82f6',
  'on-scene': '#8b5cf6',
  'transporting': '#f59e0b',
  'at-hospital': '#ec4899',
  'returning': '#06b6d4',
  'unavailable': '#9ca3af',
};

// ── Rich unit state for a given simulation hour ─────────────────────────

export interface UnitState {
  unitId: string;
  unit: EMSUnit;
  status: UnitStatus;
  destination: string | null;
  etaMin: number | null;
  patientLoad: { red: number; yellow: number } | null;
  assignedZone: PatientDemandZone | null;
  assignedHospital: string | null;
  position: 'staging' | 'zone' | 'hospital';
}

// ── Deterministic unit state computation ────────────────────────────────
// Each unit follows a predictable lifecycle per hour based on simulation
// data. No random movement — positions correspond to simulation events.
//
// Hour 0: All available units → dispatched (heading to staging)
// Hour 1: Transport units → en-route to nearest demand zone
//          Supervisors → on-scene at staging
// Hour 2: Transport units begin cycling:
//          - First batch: on-scene (triaging at demand zone)
//          - Units with completed pickups: transporting to hospital
// Hour 3+: Full transport cycle based on snapshot data:
//          - Units actively transporting this hour → transporting
//          - Units that transported last hour → at-hospital or returning
//          - Remaining transport units → on-scene at assigned zone

export function computeUnitStates(
  scenario: TornadoScenario,
  snapshot: HourlySnapshot,
  hour: number,
): UnitState[] {
  const { emsResources, demandZones, hospitals, stagingAreas } = scenario;
  const states: UnitState[] = [];

  const transportUnits = emsResources.units.filter(
    (u) => u.available && (u.type === 'ALS' || u.type === 'BLS'),
  );
  const supervisorUnits = emsResources.units.filter(
    (u) => u.available && u.type === 'Supervisor',
  );
  const unavailableUnits = emsResources.units.filter((u) => !u.available);
  const otherUnits = emsResources.units.filter(
    (u) => u.available && u.type !== 'ALS' && u.type !== 'BLS' && u.type !== 'Supervisor',
  );

  // Assign transport units round-robin to demand zones
  const zoneAssignments = new Map<string, PatientDemandZone>();
  if (demandZones.length > 0) {
    transportUnits.forEach((u, i) => {
      zoneAssignments.set(u.id, demandZones[i % demandZones.length]);
    });
  }

  // Find nearest hospital for each demand zone
  const zoneHospital = new Map<string, string>();
  for (const z of demandZones) {
    let best = hospitals[0];
    let bestDist = Infinity;
    for (const h of hospitals) {
      const d = (h.location.lat - z.center.lat) ** 2 + (h.location.lng - z.center.lng) ** 2;
      if (d < bestDist) { bestDist = d; best = h; }
    }
    if (best) zoneHospital.set(z.id, best.name);
  }

  // Find staging area for each unit
  const unitStaging = new Map<string, string>();
  for (const sa of stagingAreas) {
    for (const uid of sa.assignedUnits) {
      unitStaging.set(uid, sa.id);
    }
  }

  // Transport units that are actively transporting this hour
  const transportsThisHour = snapshot.ambulanceTransportsThisHour;

  for (const unit of transportUnits) {
    const zone = zoneAssignments.get(unit.id) ?? null;
    const hospName = zone ? (zoneHospital.get(zone.id) ?? null) : (hospitals[0]?.name ?? null);
    const unitIdx = transportUnits.indexOf(unit);

    // Patient load: distribute triage proportionally among transporting units
    const assignedPatientLoad = zone && transportsThisHour > 0 && unitIdx < transportsThisHour
      ? computePatientLoad(zone, transportUnits.length)
      : null;

    if (hour === 0) {
      states.push({
        unitId: unit.id, unit, status: 'dispatched',
        destination: findStagingName(unit.id, stagingAreas) ?? 'Staging area',
        etaMin: unit.responseTimeMin,
        patientLoad: null, assignedZone: zone, assignedHospital: hospName,
        position: 'staging',
      });
    } else if (hour === 1) {
      states.push({
        unitId: unit.id, unit, status: 'en-route',
        destination: zone?.name ?? 'Impact zone',
        etaMin: Math.max(1, unit.responseTimeMin - 6),
        patientLoad: null, assignedZone: zone, assignedHospital: hospName,
        position: 'staging',
      });
    } else if (hour === 2) {
      if (unitIdx < transportsThisHour) {
        states.push({
          unitId: unit.id, unit, status: 'on-scene',
          destination: zone?.name ?? 'Impact zone',
          etaMin: null,
          patientLoad: assignedPatientLoad, assignedZone: zone, assignedHospital: hospName,
          position: 'zone',
        });
      } else {
        states.push({
          unitId: unit.id, unit, status: 'on-scene',
          destination: zone?.name ?? 'Impact zone',
          etaMin: null,
          patientLoad: null, assignedZone: zone, assignedHospital: hospName,
          position: 'zone',
        });
      }
    } else {
      // Hour 3+: deterministic cycle based on unit index and transports
      // Split into phases: transporting, at-hospital, returning, on-scene
      const cyclePhase = getCyclePhase(unitIdx, transportsThisHour, transportUnits.length, hour);

      if (cyclePhase === 'transporting') {
        states.push({
          unitId: unit.id, unit, status: 'transporting',
          destination: hospName,
          etaMin: estimateTransportEta(hour, unit.responseTimeMin),
          patientLoad: assignedPatientLoad, assignedZone: zone, assignedHospital: hospName,
          position: 'zone',
        });
      } else if (cyclePhase === 'at-hospital') {
        states.push({
          unitId: unit.id, unit, status: 'at-hospital',
          destination: hospName,
          etaMin: null,
          patientLoad: null, assignedZone: zone, assignedHospital: hospName,
          position: 'hospital',
        });
      } else if (cyclePhase === 'returning') {
        states.push({
          unitId: unit.id, unit, status: 'returning',
          destination: zone?.name ?? 'Staging area',
          etaMin: estimateTransportEta(hour, unit.responseTimeMin),
          patientLoad: null, assignedZone: zone, assignedHospital: hospName,
          position: 'staging',
        });
      } else {
        states.push({
          unitId: unit.id, unit, status: 'on-scene',
          destination: zone?.name ?? 'Impact zone',
          etaMin: null,
          patientLoad: null, assignedZone: zone, assignedHospital: hospName,
          position: 'zone',
        });
      }
    }
  }

  // Supervisors: on-scene at staging from hour 1+
  for (const unit of supervisorUnits) {
    states.push({
      unitId: unit.id, unit,
      status: hour === 0 ? 'dispatched' : 'on-scene',
      destination: findStagingName(unit.id, stagingAreas) ?? 'Command post',
      etaMin: hour === 0 ? unit.responseTimeMin : null,
      patientLoad: null, assignedZone: null, assignedHospital: null,
      position: 'staging',
    });
  }

  // Other unit types (Rescue, HazMat): on-scene from hour 2+
  for (const unit of otherUnits) {
    states.push({
      unitId: unit.id, unit,
      status: hour < 1 ? 'available' : hour < 2 ? 'en-route' : 'on-scene',
      destination: hour < 1 ? null : (demandZones[0]?.name ?? 'Impact zone'),
      etaMin: hour < 2 ? unit.responseTimeMin : null,
      patientLoad: null, assignedZone: demandZones[0] ?? null, assignedHospital: null,
      position: hour < 2 ? 'staging' : 'zone',
    });
  }

  // Unavailable units
  for (const unit of unavailableUnits) {
    states.push({
      unitId: unit.id, unit, status: 'unavailable',
      destination: null, etaMin: null, patientLoad: null,
      assignedZone: null, assignedHospital: null,
      position: 'staging',
    });
  }

  return states;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findStagingName(
  unitId: string,
  stagingAreas: TornadoScenario['stagingAreas'],
): string | null {
  for (const sa of stagingAreas) {
    if (sa.assignedUnits.includes(unitId)) return sa.name;
  }
  return null;
}

function getCyclePhase(
  unitIdx: number,
  transportsThisHour: number,
  totalTransportUnits: number,
  hour: number,
): 'transporting' | 'at-hospital' | 'returning' | 'on-scene' {
  if (totalTransportUnits === 0) return 'on-scene';

  // Deterministic phase: distribute units across the transport cycle
  // based on their index and how many transports are happening
  const phaseOffset = (unitIdx + hour) % 4;

  if (unitIdx < transportsThisHour) {
    // These units are actively involved in transport this hour
    if (phaseOffset === 0) return 'transporting';
    if (phaseOffset === 1) return 'at-hospital';
    if (phaseOffset === 2) return 'returning';
    return 'on-scene';
  }

  // Remaining units are on-scene or returning
  return phaseOffset % 2 === 0 ? 'on-scene' : 'returning';
}

function estimateTransportEta(hour: number, responseTimeMin: number): number {
  return Math.max(3, Math.round(responseTimeMin * (hour <= 3 ? 1.2 : 0.9)));
}

function computePatientLoad(
  zone: PatientDemandZone,
  totalUnits: number,
): { red: number; yellow: number } {
  const share = Math.max(1, totalUnits);
  return {
    red: Math.max(0, Math.round(zone.triageBreakdown.red / share)),
    yellow: Math.max(0, Math.round(zone.triageBreakdown.yellow / share)),
  };
}
