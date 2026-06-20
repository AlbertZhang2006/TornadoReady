import type { WorkspaceState } from '../types/workspace';
import type { HourlySimulationResult } from './hourlyEngine';

export type RecommendationPriority = 'high' | 'medium' | 'low';
export type RecommendationArea = 'EMS' | 'hospital' | 'infrastructure' | 'communications';

export interface Recommendation {
  id: string;
  title: string;
  priority: RecommendationPriority;
  reason: string;
  area: RecommendationArea;
}

export function generateRecommendations(
  ws: WorkspaceState,
  result: HourlySimulationResult,
  currentHour?: number,
): Recommendation[] {
  const hour = currentHour ?? result.snapshots.length - 1;
  const snap = result.snapshots[Math.min(hour, result.snapshots.length - 1)];
  const recs: Recommendation[] = [];

  // ── EMS / Ambulance gap (hour-aware) ────────────────────────────────

  if (hour <= 1 && snap.patientsGeneratedThisHour > 0) {
    recs.push({
      id: 'ems-mobilize',
      title: 'Mobilize all available EMS units',
      priority: 'high',
      reason: `${snap.cumulativePatients} patients discovered. EMS operating at ${hour === 0 ? '25%' : '75%'} capacity — prioritize ALS deployment to highest-acuity zones.`,
      area: 'EMS',
    });
  }

  if (snap.ambulanceGap > 0) {
    const gapSevere = snap.ambulanceGap > 10;
    recs.push({
      id: 'mutual-aid-ems',
      title: gapSevere ? 'Request regional mutual aid immediately' : 'Pre-stage mutual aid resources',
      priority: gapSevere ? 'high' : 'medium',
      reason: `Ambulance gap: ${snap.ambulanceGap} patients awaiting transport at Hour ${hour}. ${
        gapSevere
          ? 'Local transport capacity significantly exceeded — request additional ALS/BLS units from neighboring jurisdictions now.'
          : 'Transport demand may exceed local capacity. Pre-arrange mutual aid to reduce activation delay.'
      }`,
      area: 'EMS',
    });
  } else if (hour >= 2 && hour <= 4) {
    const futureSnaps = result.snapshots.slice(hour + 1);
    const futureGap = futureSnaps.some((s) => s.ambulanceGap > 0);
    if (futureGap) {
      recs.push({
        id: 'mutual-aid-preemptive',
        title: 'Prepare for transport shortfall',
        priority: 'medium',
        reason: `No ambulance gap at Hour ${hour}, but transport demand will exceed capacity in later hours. Begin mutual aid coordination now.`,
        area: 'EMS',
      });
    }
  }

  if (ws.mutualAidDelayMin > 60 && snap.ambulanceGap > 0) {
    recs.push({
      id: 'mutual-aid-delay',
      title: 'Reduce mutual aid response time',
      priority: 'medium',
      reason: `Mutual aid delay is ${ws.mutualAidDelayMin} minutes. With ${snap.ambulanceGap} patients waiting, consider pre-positioning mutual aid units closer to the impact area.`,
      area: 'EMS',
    });
  }

  if (snap.patientsAwaitingTransport > 5 && hour >= 2) {
    recs.push({
      id: 'transport-backlog',
      title: 'Address transport backlog',
      priority: snap.patientsAwaitingTransport > 15 ? 'high' : 'medium',
      reason: `${snap.patientsAwaitingTransport} patients awaiting transport. Consider reassigning BLS units to shorter transport routes or activating secondary staging areas.`,
      area: 'EMS',
    });
  }

  // ── Hospital load (hour-aware) ──────────────────────────────────────

  if (snap.hospitalLoadPct > 90) {
    recs.push({
      id: 'hospital-saturated',
      title: 'Activate alternate destination plans',
      priority: 'high',
      reason: `Hospital load at ${snap.hospitalLoadPct}% at Hour ${hour}. Receiving facilities are saturated — activate alternate care sites and divert lower-acuity patients to regional hospitals outside the impact zone.`,
      area: 'hospital',
    });
  } else if (snap.hospitalLoadPct > 70) {
    recs.push({
      id: 'hospital-strained',
      title: snap.hospitalLoadPct > 80 ? 'Rebalance patient distribution' : 'Prepare patient distribution plan',
      priority: snap.hospitalLoadPct > 80 ? 'high' : 'medium',
      reason: `Hospital load at ${snap.hospitalLoadPct}% at Hour ${hour}. Distribute patients across facilities to prevent any single hospital from becoming overwhelmed.`,
      area: 'hospital',
    });
  } else if (hour >= 3 && snap.hospitalLoadPct > 50) {
    const peakLoad = Math.max(...result.snapshots.slice(hour).map((s) => s.hospitalLoadPct));
    if (peakLoad > 80) {
      recs.push({
        id: 'hospital-prepare',
        title: 'Prepare for hospital surge',
        priority: 'medium',
        reason: `Hospital load currently ${snap.hospitalLoadPct}% but projected to reach ${peakLoad}%. Alert receiving hospitals to activate surge protocols.`,
        area: 'hospital',
      });
    }
  }

  if (ws.hospitals.some((h) => h.currentEdLoad / h.edCapacity > 0.8)) {
    recs.push({
      id: 'ed-pre-load',
      title: 'Address pre-existing ED congestion',
      priority: 'medium',
      reason: 'One or more hospitals already have ED utilization above 80% before the event. Consider early surge activation or diverting initial patients to less-loaded facilities.',
      area: 'hospital',
    });
  }

  // ── Infrastructure: Roads ──────────────────────────────────────────

  if (ws.roadDelayMultiplier >= 2) {
    recs.push({
      id: 'road-disruption-high',
      title: hour <= 1 ? 'Identify alternate access routes' : 'Establish alternate staging locations',
      priority: 'high',
      reason: `Road delay multiplier is ${ws.roadDelayMultiplier}x, indicating severe route disruption. ${
        hour <= 1
          ? 'Coordinate with public works immediately to identify passable routes for EMS access.'
          : 'Relocate staging areas to reduce transport cycle times on available routes.'
      }`,
      area: 'infrastructure',
    });
  } else if (ws.roadDelayMultiplier >= 1.5) {
    recs.push({
      id: 'road-disruption-mod',
      title: 'Plan for road clearance and detours',
      priority: 'medium',
      reason: `Road delay multiplier is ${ws.roadDelayMultiplier}x. Coordinate with public works for debris clearance priorities and pre-identify detour routes for EMS transport corridors.`,
      area: 'infrastructure',
    });
  }

  // ── Infrastructure: Power ──────────────────────────────────────────

  if (ws.powerDisruption === 'high') {
    recs.push({
      id: 'power-disruption-high',
      title: 'Verify generator and fuel readiness',
      priority: hour <= 2 ? 'high' : 'medium',
      reason: 'High power disruption expected. Confirm backup generator status at all hospitals and staging areas. Verify fuel supply contracts and pre-position portable generators.',
      area: 'infrastructure',
    });
  } else if (ws.powerDisruption === 'moderate') {
    recs.push({
      id: 'power-disruption-mod',
      title: 'Check backup power availability',
      priority: 'low',
      reason: 'Moderate power disruption possible. Verify that hospital and command post backup power systems are tested and fueled.',
      area: 'infrastructure',
    });
  }

  // ── Communications ────────────────────────────────────────────────

  if (ws.commsDisruption === 'high') {
    recs.push({
      id: 'comms-disruption-high',
      title: 'Activate backup communications plan',
      priority: hour <= 1 ? 'high' : 'medium',
      reason: 'High communications disruption expected. Cell networks and landlines may be unavailable. Activate amateur radio networks and deploy satellite phones to command positions.',
      area: 'communications',
    });
  } else if (ws.commsDisruption === 'moderate') {
    recs.push({
      id: 'comms-disruption-mod',
      title: 'Pre-position backup communications',
      priority: 'medium',
      reason: 'Moderate communications disruption possible. Pre-position portable radios and satellite phones at staging areas.',
      area: 'communications',
    });
  }

  // ── Overall readiness ────────────────────────────────────────────

  if (snap.readinessScore < 40) {
    recs.push({
      id: 'readiness-critical',
      title: 'Multiple planning gaps identified',
      priority: 'high',
      reason: `Readiness score is ${snap.readinessScore}/100 (Critical) at Hour ${hour}. This scenario exposes significant resource shortfalls requiring immediate planning attention.`,
      area: 'EMS',
    });
  } else if (snap.readinessScore < 70) {
    recs.push({
      id: 'readiness-atrisk',
      title: 'Review and strengthen preparedness plan',
      priority: 'medium',
      reason: `Readiness score is ${snap.readinessScore}/100 (At Risk) at Hour ${hour}. Address the highest-impact gaps to improve overall preparedness.`,
      area: 'EMS',
    });
  }

  // ── Sort: high first, then medium, then low ───────────────────────

  const priorityOrder: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs;
}
