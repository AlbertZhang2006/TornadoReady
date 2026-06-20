import type { WorkspaceState } from '../types/workspace';

// ── Output types ────────────────────────────────────────────────────────

export interface HourlySnapshot {
  hour: number;
  patientsGeneratedThisHour: number;
  cumulativePatients: number;
  patientsNeedingTransport: number;
  patientsSelfPresenting: number;
  ambulanceTransportsThisHour: number;
  cumulativeTransported: number;
  ambulanceGap: number;
  patientsAwaitingTransport: number;
  hospitalArrivals: number;
  cumulativeHospitalArrivals: number;
  hospitalLoadPct: number;
  mutualAidNeeded: boolean;
  readinessScore: number;
}

export interface HourlySimulationResult {
  scenarioName: string;
  snapshots: HourlySnapshot[];
  peakAmbulanceGap: number;
  peakHospitalLoadPct: number;
  finalReadinessScore: number;
  mutualAidTriggeredAtHour: number | null;
}

// ── Patient generation curve ────────────────────────────────────────────
// Most casualties are discovered immediately after impact.
// Discovery tapers off over subsequent hours as search-and-rescue continues.
const PATIENT_CURVE = [0.40, 0.25, 0.15, 0.10, 0.05, 0.03, 0.02];

// ── EMS ramp-up factor per hour ─────────────────────────────────────────
// Hour 0: units mobilizing, only 25% effective capacity.
// Hour 1: most units on scene, 75% effective.
// Hour 2+: full operational capacity.
const EMS_RAMP = [0.25, 0.75, 1.0, 1.0, 1.0, 1.0, 1.0];

// ── Casualty rate by EF scale ───────────────────────────────────────────
const EF_CASUALTY_RATE: Record<number, number> = {
  0: 0.001, 1: 0.003, 2: 0.005, 3: 0.007, 4: 0.015, 5: 0.025,
};

// ── Vulnerability multiplier ────────────────────────────────────────────
const VULN_MULT: Record<string, number> = {
  high: 1.4, moderate: 1.15, low: 1.0,
};

// ── Disruption penalty for readiness scoring ────────────────────────────
const DISRUPTION_PENALTY: Record<string, number> = {
  high: 10, moderate: 5, low: 0,
};

// ── Core simulation ─────────────────────────────────────────────────────

export function runHourlySimulation(
  ws: WorkspaceState,
  scenarioName: string,
): HourlySimulationResult {
  // Total estimated casualties from population exposure
  const rate = EF_CASUALTY_RATE[ws.efScale] ?? 0.007;
  const vulnMult = VULN_MULT[ws.vulnerablePopLevel] ?? 1.0;
  const totalCasualties = Math.round(ws.populationExposure * rate * vulnMult);

  // Transport-capable ambulance units (supervisors coordinate, don't transport)
  const transportUnits = ws.alsAmbulances + ws.blsAmbulances;

  // Ambulance cycle time: scene + transport + offload, stretched by road conditions
  // cycleMins = (avgSceneTime + avgTransportTime + avgOffloadTime) × roadDelayMultiplier
  const cycleMins =
    (ws.avgSceneTimeMin + ws.avgTransportTimeMin + ws.avgOffloadTimeMin) *
    ws.roadDelayMultiplier;

  // Transports one unit can complete per hour at full capacity
  // transportsPerUnitPerHour = 60 / cycleMins
  const transportsPerUnitPerHour = cycleMins > 0 ? 60 / cycleMins : 0;

  // Total hospital receiving capacity
  // totalCapacity = available beds + remaining ED slots + surge capacity
  const totalHospitalCapacity = ws.hospitals.reduce(
    (sum, h) =>
      sum + h.availableBeds + Math.max(0, h.edCapacity - h.currentEdLoad) + h.surgeCapacity,
    0,
  );

  // Mutual aid arrival: extra units arrive after the configured delay
  // mutualAidHour = ceil(mutualAidDelayMin / 60) — the hour mutual aid units become available
  const mutualAidHour = Math.ceil(ws.mutualAidDelayMin / 60);

  // ── Hour-by-hour simulation loop ──────────────────────────────────────

  const snapshots: HourlySnapshot[] = [];
  let cumulativePatients = 0;
  let cumulativeTransported = 0;
  let cumulativeHospitalArrivals = 0;
  let mutualAidTriggeredAtHour: number | null = null;

  for (let hour = 0; hour <= 6; hour++) {
    // Patients discovered this hour follow the generation curve
    // patientsThisHour = totalCasualties × curveWeight
    const curveWeight = PATIENT_CURVE[hour] ?? 0;
    const patientsThisHour = Math.round(totalCasualties * curveWeight);
    cumulativePatients += patientsThisHour;

    // Split into transport vs. self-presenting
    // patientsNeedingTransport = cumulative × transportRate
    const patientsNeedingTransport = Math.round(
      cumulativePatients * (ws.pctNeedingTransport / 100),
    );
    const patientsSelfPresenting = Math.round(
      cumulativePatients * (ws.pctSelfPresenting / 100),
    );

    // Ambulance transport capacity this hour
    // effectiveUnits = transportUnits × rampFactor
    // ambulanceCapacityThisHour = effectiveUnits × transportsPerUnitPerHour
    const ramp = EMS_RAMP[hour] ?? 1.0;
    const effectiveUnits = transportUnits * ramp;
    const ambulanceTransportsThisHour = Math.floor(
      effectiveUnits * transportsPerUnitPerHour,
    );

    // Cumulative transport capacity vs. cumulative demand
    cumulativeTransported += ambulanceTransportsThisHour;

    // Ambulance gap: patients still needing transport minus what's been transported
    // ambulanceGap = max(0, patientsNeedingTransport − cumulativeTransported)
    const ambulanceGap = Math.max(0, patientsNeedingTransport - cumulativeTransported);

    // Patients currently awaiting transport (same as gap but named for clarity)
    const patientsAwaitingTransport = ambulanceGap;

    // Hospital arrivals this hour = transported this hour + self-presenting this hour
    const selfPresentingThisHour = Math.round(
      patientsThisHour * (ws.pctSelfPresenting / 100),
    );
    const hospitalArrivals = Math.min(ambulanceTransportsThisHour, patientsNeedingTransport - (cumulativeTransported - ambulanceTransportsThisHour)) + selfPresentingThisHour;
    const actualHospitalArrivals = Math.max(0, hospitalArrivals);
    cumulativeHospitalArrivals += actualHospitalArrivals;

    // Hospital load as percentage of total capacity
    // hospitalLoadPct = (cumulativeArrivals / totalCapacity) × 100
    const hospitalLoadPct =
      totalHospitalCapacity > 0
        ? Math.round((cumulativeHospitalArrivals / totalHospitalCapacity) * 100)
        : cumulativeHospitalArrivals > 0
        ? 100
        : 0;

    // Mutual aid is needed when ambulance gap exists or hospital load exceeds 80%
    const mutualAidNeeded = ambulanceGap > 0 || hospitalLoadPct > 80;
    if (mutualAidNeeded && mutualAidTriggeredAtHour === null) {
      mutualAidTriggeredAtHour = hour;
    }

    // ── Readiness score (0–100) ───────────────────────────────────────
    // Start at 100 and deduct for each risk factor.
    let readiness = 100;

    // Ambulance gap penalty: −3 per patient awaiting transport, capped at −30
    readiness -= Math.min(30, ambulanceGap * 3);

    // Hospital load penalty
    if (hospitalLoadPct > 90) readiness -= 20;
    else if (hospitalLoadPct > 80) readiness -= 15;
    else if (hospitalLoadPct > 60) readiness -= 10;

    // Infrastructure disruption penalties (constant across hours)
    readiness -= DISRUPTION_PENALTY[ws.roadDelayMultiplier >= 2 ? 'high' : ws.roadDelayMultiplier >= 1.5 ? 'moderate' : 'low'];
    readiness -= DISRUPTION_PENALTY[ws.powerDisruption];
    readiness -= DISRUPTION_PENALTY[ws.commsDisruption];

    // Mutual aid not yet arrived penalty
    if (mutualAidNeeded && hour < mutualAidHour) {
      readiness -= 10;
    }

    readiness = Math.max(0, Math.min(100, readiness));

    snapshots.push({
      hour,
      patientsGeneratedThisHour: patientsThisHour,
      cumulativePatients,
      patientsNeedingTransport,
      patientsSelfPresenting,
      ambulanceTransportsThisHour,
      cumulativeTransported: Math.min(cumulativeTransported, patientsNeedingTransport),
      ambulanceGap,
      patientsAwaitingTransport,
      hospitalArrivals: actualHospitalArrivals,
      cumulativeHospitalArrivals,
      hospitalLoadPct,
      mutualAidNeeded,
      readinessScore: readiness,
    });
  }

  return {
    scenarioName,
    snapshots,
    peakAmbulanceGap: Math.max(...snapshots.map((s) => s.ambulanceGap)),
    peakHospitalLoadPct: Math.max(...snapshots.map((s) => s.hospitalLoadPct)),
    finalReadinessScore: snapshots[snapshots.length - 1].readinessScore,
    mutualAidTriggeredAtHour,
  };
}

// ── Event log: data-driven narrative for each hour ─────────────────────

export function generateEventLog(result: HourlySimulationResult): string[] {
  return result.snapshots.map((s) => {
    const parts: string[] = [];

    if (s.hour === 0) {
      parts.push('Tornado impact');
      parts.push(`${s.patientsGeneratedThisHour} patients discovered`);
      parts.push('EMS mobilizing (25% capacity)');
    } else if (s.hour === 1) {
      parts.push(`${s.patientsGeneratedThisHour} additional patients found`);
      parts.push('EMS at 75% capacity');
      if (s.patientsNeedingTransport > 0) parts.push(`${s.patientsNeedingTransport} need transport`);
    } else {
      if (s.patientsGeneratedThisHour > 0) parts.push(`${s.patientsGeneratedThisHour} new patients`);
      parts.push(`${s.cumulativeTransported} transported total`);
      parts.push(`hospital load ${s.hospitalLoadPct}%`);
      if (s.ambulanceGap > 0) parts.push(`${s.ambulanceGap} awaiting transport`);
      if (s.mutualAidNeeded && result.mutualAidTriggeredAtHour === s.hour) parts.push('mutual aid triggered');
    }

    if (s.hour === 6) {
      parts.length = 0;
      parts.push(`Final: ${s.cumulativePatients} patients`);
      parts.push(`${s.cumulativeTransported} transported`);
      parts.push(`hospital load ${s.hospitalLoadPct}%`);
      parts.push(`readiness ${s.readinessScore}/100`);
    }

    return `Hr ${s.hour}: ${parts.join('. ')}.`;
  });
}
