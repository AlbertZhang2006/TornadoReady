import { MapContainer, TileLayer, Polygon, Polyline, Circle, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useState, useEffect, useMemo } from 'react';
import type { TornadoScenario, GeoPoint } from '../../types/scenario';
import type { WorkspaceState } from '../../types/workspace';
import type { HourlySnapshot } from '../../simulation/hourlyEngine';
import { computeUnitStates, UNIT_STATUS_LABEL, UNIT_STATUS_COLOR } from '../../simulation/emsState';
import type { UnitState, UnitStatus } from '../../simulation/emsState';
import { computeHospitalStates, CAPACITY_STATUS_LABEL, CAPACITY_STATUS_COLOR } from '../../simulation/hospitalState';
import type { HospitalState } from '../../simulation/hospitalState';

// ── Fix Leaflet default icon path ───────────────────────────────────────

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Hospital labeled icon (name + capacity bar + status) ────────────────

function hospitalLabelIcon(hs: HospitalState): L.DivIcon {
  const barColor = hs.mapStatus === 'green' ? '#16a34a' : hs.mapStatus === 'yellow' ? '#d97706' : '#dc2626';
  const borderColor = hs.mapStatus === 'green' ? '#bbf7d0' : hs.mapStatus === 'yellow' ? '#fde68a' : '#fecaca';
  const barWidth = Math.min(100, Math.max(0, hs.edLoadPct));
  const statusLabel = CAPACITY_STATUS_LABEL[hs.capacityStatus];

  const html = `
    <div style="display:flex;align-items:center;gap:6px;pointer-events:auto;">
      <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="22" height="22" rx="3" fill="white" stroke="${barColor}" stroke-width="2"/>
        <path d="M12 6v12M6 12h12" stroke="${barColor}" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div style="background:white;border:1px solid ${borderColor};border-radius:4px;padding:2px 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:11px;font-weight:700;color:#1e293b;line-height:1.3;">${hs.name}</div>
        <div style="display:flex;align-items:center;gap:4px;margin-top:1px;">
          <div style="width:48px;height:4px;background:#f1f5f9;border-radius:2px;overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:2px;"></div>
          </div>
          <span style="font-size:10px;font-weight:600;color:${barColor};">${hs.edLoadPct}%</span>
        </div>
        <div style="font-size:9px;font-weight:600;color:${barColor};margin-top:1px;">${statusLabel}</div>
      </div>
    </div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize: [170, 46],
    iconAnchor: [12, 23],
    popupAnchor: [60, -23],
  });
}

// ── Demand zone label icon ──────────────────────────────────────────────

type ZoneSeverity = 'critical' | 'serious' | 'moderate';

const ZONE_STYLES: Record<ZoneSeverity, { color: string; bg: string; border: string; label: string; stroke: string; fill: string }> = {
  critical: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Critical', stroke: '#dc2626', fill: '#fca5a5' },
  serious:  { color: '#ea580c', bg: '#fff7ed', border: '#fed7aa', label: 'Serious',  stroke: '#ea580c', fill: '#fdba74' },
  moderate: { color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'Moderate', stroke: '#d97706', fill: '#fde68a' },
};

function zoneLabelIcon(
  name: string,
  patients: number,
  immediateCount: number,
  severity: ZoneSeverity,
): L.DivIcon {
  const s = ZONE_STYLES[severity];

  const html = `
    <div style="background:${s.bg};border:1px solid ${s.border};border-radius:5px;padding:3px 7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
      <div style="font-size:11px;font-weight:700;color:#1e293b;line-height:1.2;">${name}</div>
      <div style="font-size:10px;color:${s.color};font-weight:600;margin-top:1px;">${patients} pts &middot; ${immediateCount} immediate</div>
      <div style="font-size:9px;color:${s.color};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">${s.label}</div>
    </div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize: [150, 44],
    iconAnchor: [75, 22],
    popupAnchor: [0, -22],
  });
}

// ── Staging area icon ───────────────────────────────────────────────────

function stagingLabelIcon(name: string, unitCount: number): L.DivIcon {
  const html = `
    <div style="display:flex;align-items:center;gap:5px;pointer-events:auto;">
      <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="20" height="20" rx="3" fill="#7c3aed" opacity="0.9"/>
        <path d="M11 6v10M7 10l4-4 4 4" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div style="background:white;border:1px solid #e9d5ff;border-radius:4px;padding:2px 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:10px;font-weight:600;color:#1e293b;">${name}</div>
        <div style="font-size:10px;color:#7c3aed;font-weight:500;">${unitCount} units</div>
      </div>
    </div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize: [130, 30],
    iconAnchor: [11, 15],
    popupAnchor: [50, -15],
  });
}

// ── EMS unit icon with name and status ──────────────────────────────────

function emsUnitIcon(name: string, status: UnitStatus): L.DivIcon {
  const color = UNIT_STATUS_COLOR[status];
  const statusText = UNIT_STATUS_LABEL[status];
  const html = `
    <div style="display:flex;align-items:center;gap:4px;pointer-events:auto;">
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="8" fill="${color}" stroke="white" stroke-width="2"/>
        <path d="M10 6v8M6 10h8" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <div style="background:white;border:1px solid #e2e8f0;border-radius:3px;padding:1px 5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.08);line-height:1.2;">
        <div style="font-size:10px;font-weight:700;color:#1e293b;">${name}</div>
        <div style="font-size:9px;font-weight:600;color:${color};">${statusText}</div>
      </div>
    </div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize: [110, 28],
    iconAnchor: [10, 14],
    popupAnchor: [45, -14],
  });
}

// ── Direction arrow icon at end of tornado path ─────────────────────────

function bearing(from: GeoPoint, to: GeoPoint): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function arrowIcon(bearingDeg: number): L.DivIcon {
  return L.divIcon({
    html: `<svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(${bearingDeg}deg);transform-origin:center;" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2l7 18-7-5-7 5z" fill="#991b1b" opacity="0.85"/>
    </svg>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// ── Corridor polygon from center line ───────────────────────────────────

function milesToDegrees(miles: number): number {
  return miles / 69.0;
}

function buildCorridorPolygon(
  centerLine: GeoPoint[],
  widthMiles: number,
): [number, number][] {
  if (centerLine.length < 2) return [];
  const halfW = milesToDegrees(widthMiles / 2);
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < centerLine.length; i++) {
    const prev = centerLine[Math.max(0, i - 1)];
    const next = centerLine[Math.min(centerLine.length - 1, i + 1)];
    const dx = next.lng - prev.lng;
    const dy = next.lat - prev.lat;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push([centerLine[i].lat + nx * halfW, centerLine[i].lng + ny * halfW]);
    right.push([centerLine[i].lat - nx * halfW, centerLine[i].lng - ny * halfW]);
  }

  return [...left, ...right.reverse()];
}


// ── Build unit positions based on operational state ──────────────────────
// Units are positioned at their staging area, assigned demand zone, or
// nearest hospital depending on their current operational phase.
// No random movement — position corresponds to a simulation event.

function resolveUnitPosition(
  state: UnitState,
  scenario: TornadoScenario,
  unitIndex: number,
  totalAtLocation: number,
): { lat: number; lng: number } {
  const offset = 0.002;
  const angle = (2 * Math.PI * unitIndex) / Math.max(totalAtLocation, 1);

  if (state.position === 'zone' && state.assignedZone) {
    return {
      lat: state.assignedZone.center.lat + Math.cos(angle) * offset,
      lng: state.assignedZone.center.lng + Math.sin(angle) * offset,
    };
  }

  if (state.position === 'hospital') {
    const hosp = scenario.hospitals.find((h) => h.name === state.assignedHospital);
    if (hosp) {
      return {
        lat: hosp.location.lat + Math.cos(angle) * offset * 0.8,
        lng: hosp.location.lng + Math.sin(angle) * offset * 0.8,
      };
    }
  }

  // Default: staging area
  for (const sa of scenario.stagingAreas) {
    if (sa.assignedUnits.includes(state.unitId)) {
      const saIdx = sa.assignedUnits.indexOf(state.unitId);
      const saAngle = (2 * Math.PI * saIdx) / Math.max(sa.assignedUnits.length, 1);
      return {
        lat: sa.location.lat + Math.cos(saAngle) * offset,
        lng: sa.location.lng + Math.sin(saAngle) * offset,
      };
    }
  }

  // Fallback: first staging area or map center
  if (scenario.stagingAreas.length > 0) {
    const sa = scenario.stagingAreas[0];
    return { lat: sa.location.lat + Math.cos(angle) * offset, lng: sa.location.lng + Math.sin(angle) * offset };
  }
  return { lat: 39.95, lng: -83.0 };
}

// ── Demand zone severity ────────────────────────────────────────────────

function zoneSeverity(redCount: number, totalCount: number, blackCount: number): ZoneSeverity {
  const immediateRatio = totalCount > 0 ? redCount / totalCount : 0;
  if (immediateRatio >= 0.3 || blackCount >= 2) return 'critical';
  if (immediateRatio >= 0.15) return 'serious';
  return 'moderate';
}

// ── Auto-fit bounds: tight focus on operational area ─────────────────────

function FitBounds({ scenario }: { scenario: TornadoScenario }) {
  const map = useMap();
  useEffect(() => {
    const { impactPath, demandZones, stagingAreas, hospitals } = scenario;

    const corePoints: [number, number][] = [
      ...impactPath.centerLine.map((p): [number, number] => [p.lat, p.lng]),
      ...demandZones.map((z): [number, number] => [z.center.lat, z.center.lng]),
      ...stagingAreas.map((s): [number, number] => [s.location.lat, s.location.lng]),
    ];

    if (corePoints.length === 0) return;

    const coreBounds = L.latLngBounds(corePoints);
    const center = coreBounds.getCenter();
    const latSpan = coreBounds.getNorth() - coreBounds.getSouth();
    const lngSpan = coreBounds.getEast() - coreBounds.getWest();
    const maxSpan = Math.max(latSpan, lngSpan);

    const fitPoints = [...corePoints];
    for (const h of hospitals) {
      const latDist = Math.abs(h.location.lat - center.lat);
      const lngDist = Math.abs(h.location.lng - center.lng);
      if (latDist <= maxSpan && lngDist <= maxSpan) {
        fitPoints.push([h.location.lat, h.location.lng]);
      }
    }

    const bounds = L.latLngBounds(fitPoints);
    map.fitBounds(bounds.pad(0.12), { maxZoom: 14 });
  }, [map, scenario]);
  return null;
}

// ── Legend ───────────────────────────────────────────────────────────────

function SimulationLegend() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="absolute bottom-4 left-4 z-[1000] rounded-lg bg-white/95 border border-gray-200"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Map Legend</span>
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-3 pb-2.5 space-y-1.5">
          <div className="pt-1.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tornado Impact</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-5 bg-red-900" />
                <span className="text-[11px] text-slate-600">Tornado path (direction of travel)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded-sm bg-red-500/30 border border-red-500" />
                <span className="text-[11px] text-slate-600">Severe impact zone</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded-sm bg-orange-400/20 border border-orange-400" />
                <span className="text-[11px] text-slate-600">Moderate impact zone</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-5 rounded-sm bg-yellow-400/15 border border-yellow-400" />
                <span className="text-[11px] text-slate-600">Light impact zone</span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-1.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Affected Areas</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-red-600 bg-red-100" />
                <span className="text-[11px] text-slate-600">Critical — high immediate-care demand</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-orange-500 bg-orange-100" />
                <span className="text-[11px] text-slate-600">Serious — significant patient load</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-amber-500 bg-amber-100" />
                <span className="text-[11px] text-slate-600">Moderate — manageable volume</span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-1.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hospital Load</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-green-600 bg-white" />
                <span className="text-[11px] text-slate-600">&lt; 70% — Available</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-amber-500 bg-white" />
                <span className="text-[11px] text-slate-600">70–90% — Strained</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-red-600 bg-white" />
                <span className="text-[11px] text-slate-600">&gt; 90% — Saturated</span>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-1.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">EMS Units</p>
            <div className="space-y-1">
              {(['available', 'dispatched', 'en-route', 'on-scene', 'transporting', 'at-hospital', 'returning', 'unavailable'] as UnitStatus[]).map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: UNIT_STATUS_COLOR[s] }} />
                  <span className="text-[11px] text-slate-600">{UNIT_STATUS_LABEL[s]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────

interface SimulationMapProps {
  scenario: TornadoScenario;
  ws: WorkspaceState;
  snapshot: HourlySnapshot;
  hour: number;
  pctNeedingTransport: number;
}

export function SimulationMap({ scenario, ws, snapshot, hour, pctNeedingTransport }: SimulationMapProps) {
  const { impactPath, demandZones, hospitals, stagingAreas } = scenario;
  const hasAnyGeo = impactPath.centerLine.length >= 2 || demandZones.length > 0;

  // Build three severity corridors from the same center line
  const corridorSevere = buildCorridorPolygon(impactPath.centerLine, impactPath.widthMiles);
  const corridorModerate = buildCorridorPolygon(impactPath.centerLine, impactPath.widthMiles * 2);
  const corridorLight = buildCorridorPolygon(impactPath.centerLine, impactPath.widthMiles * 3);

  // Tornado path as polyline coordinates
  const pathLine: [number, number][] = impactPath.centerLine.map((p) => [p.lat, p.lng]);

  // Direction arrow at end of path
  const pathEnd = impactPath.centerLine.length >= 2
    ? impactPath.centerLine[impactPath.centerLine.length - 1]
    : null;
  const pathPenultimate = impactPath.centerLine.length >= 2
    ? impactPath.centerLine[impactPath.centerLine.length - 2]
    : null;
  const endBearing = pathEnd && pathPenultimate ? bearing(pathPenultimate, pathEnd) : 0;

  const defaultCenter: [number, number] = impactPath.centerLine.length >= 2
    ? [impactPath.centerLine[Math.floor(impactPath.centerLine.length / 2)].lat,
       impactPath.centerLine[Math.floor(impactPath.centerLine.length / 2)].lng]
    : [39.95, -83.0];

  const unitStates = useMemo(
    () => computeUnitStates(scenario, snapshot, hour),
    [scenario, snapshot, hour],
  );

  const hospStates = useMemo(
    () => computeHospitalStates(ws, scenario, snapshot, hour, unitStates),
    [ws, scenario, snapshot, hour, unitStates],
  );

  const totalZonePatients = demandZones.reduce((sum, z) => sum + z.estimatedPatients, 0);
  const patientScale = totalZonePatients > 0
    ? Math.min(1, snapshot.cumulativePatients / totalZonePatients)
    : 0;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={defaultCenter}
        zoom={12}
        className="h-full w-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {hasAnyGeo && <FitBounds scenario={scenario} />}

        {/* ── Layer 1: Impact swath — light (outermost) ────────────── */}
        {corridorLight.length > 0 && (
          <Polygon
            positions={corridorLight}
            pathOptions={{
              color: '#eab308',
              fillColor: '#fef08a',
              fillOpacity: 0.12,
              weight: 1,
              opacity: 0.4,
              dashArray: '6 4',
            }}
          />
        )}

        {/* ── Layer 2: Impact swath — moderate ─────────────────────── */}
        {corridorModerate.length > 0 && (
          <Polygon
            positions={corridorModerate}
            pathOptions={{
              color: '#ea580c',
              fillColor: '#fdba74',
              fillOpacity: 0.15,
              weight: 1.5,
              opacity: 0.5,
              dashArray: '4 3',
            }}
          />
        )}

        {/* ── Layer 3: Impact swath — severe (innermost) ───────────── */}
        {corridorSevere.length > 0 && (
          <Polygon
            positions={corridorSevere}
            pathOptions={{
              color: '#dc2626',
              fillColor: '#fca5a5',
              fillOpacity: 0.25,
              weight: 2,
              opacity: 0.7,
            }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold text-slate-800">Tornado Impact Swath</p>
                <p className="mt-1 text-slate-600">
                  EF{scenario.profile.efScale} &middot;{' '}
                  {impactPath.lengthMiles} mi &times; {impactPath.widthMiles} mi<br />
                  Direction: {scenario.profile.direction}
                </p>
                <p className="mt-1.5 text-xs text-slate-500">
                  Inner zone (red): severe structural damage, highest casualty density.<br />
                  Middle zone (orange): moderate damage, secondary casualties.<br />
                  Outer zone (yellow): light damage, debris field, disrupted access.
                </p>
              </div>
            </Popup>
          </Polygon>
        )}

        {/* ── Layer 4: Tornado path center line ────────────────────── */}
        {pathLine.length >= 2 && (
          <Polyline
            positions={pathLine}
            pathOptions={{
              color: '#991b1b',
              weight: 3,
              opacity: 0.85,
            }}
          />
        )}

        {/* ── Direction arrow at path end ──────────────────────────── */}
        {pathEnd && (
          <Marker
            position={[pathEnd.lat, pathEnd.lng]}
            icon={arrowIcon(endBearing)}
            interactive={false}
          />
        )}

        {/* ── Affected areas (demand zones) ────────────────────────── */}
        {demandZones.map((zone) => {
          const scaledPatients = Math.max(1, Math.round(zone.estimatedPatients * Math.max(patientScale, hour === 0 ? 0.4 : patientScale)));
          const scaledRed = Math.round(zone.triageBreakdown.red * Math.max(patientScale, hour === 0 ? 0.4 : patientScale));
          const scaledYellow = Math.round(zone.triageBreakdown.yellow * patientScale);
          const scaledGreen = Math.round(zone.triageBreakdown.green * patientScale);
          const scaledBlack = Math.round(zone.triageBreakdown.black * patientScale);
          const sev = zoneSeverity(scaledRed, scaledPatients, scaledBlack);
          const style = ZONE_STYLES[sev];
          const patientsTransport = Math.round(scaledPatients * (pctNeedingTransport / 100));

          return (
            <span key={zone.id}>
              <Circle
                center={[zone.center.lat, zone.center.lng]}
                radius={zone.radiusMiles * 1609.34}
                pathOptions={{
                  color: style.stroke,
                  fillColor: style.fill,
                  fillOpacity: 0.2,
                  weight: 2,
                  opacity: 0.6,
                }}
              >
                <Popup>
                  <div className="text-sm min-w-[220px]">
                    <p className="font-semibold text-slate-800">{zone.name}</p>
                    <p className="text-xs font-medium" style={{ color: style.color }}>
                      {style.label} affected area &middot; {zone.radiusMiles} mi radius
                    </p>
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        <tr><td className="py-0.5 text-slate-500">Est. patients (Hr {hour})</td><td className="py-0.5 text-right font-semibold">{scaledPatients}</td></tr>
                        <tr><td className="py-0.5 text-slate-500">Needing transport</td><td className="py-0.5 text-right font-medium">{patientsTransport}</td></tr>
                        <tr className="border-t border-gray-100">
                          <td className="py-0.5 text-red-600">Immediate (red)</td>
                          <td className="py-0.5 text-right font-semibold">{scaledRed}</td>
                        </tr>
                        <tr><td className="py-0.5 text-amber-600">Delayed (yellow)</td><td className="py-0.5 text-right font-medium">{scaledYellow}</td></tr>
                        <tr><td className="py-0.5 text-green-600">Minor (green)</td><td className="py-0.5 text-right font-medium">{scaledGreen}</td></tr>
                        <tr><td className="py-0.5 text-slate-500">Deceased (black)</td><td className="py-0.5 text-right font-medium">{scaledBlack}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </Popup>
              </Circle>
              <Marker
                position={[zone.center.lat, zone.center.lng]}
                icon={zoneLabelIcon(zone.name, scaledPatients, scaledRed, sev)}
                interactive={false}
              />
            </span>
          );
        })}

        {/* ── Hospital markers with capacity detail ─────────────────── */}
        {hospitals.map((h) => {
          const hs = hospStates.find((s) => s.name === h.name);
          if (!hs) return null;
          const statusStyle = CAPACITY_STATUS_COLOR[hs.capacityStatus];

          return (
            <Marker
              key={h.id}
              position={[h.location.lat, h.location.lng]}
              icon={hospitalLabelIcon(hs)}
            >
              <Popup>
                <div className="text-sm min-w-[230px]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
                  <p className="font-bold text-slate-900 text-[13px]">{hs.name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusStyle.dot }} />
                    <span className="text-xs font-semibold" style={{ color: statusStyle.dot }}>
                      {CAPACITY_STATUS_LABEL[hs.capacityStatus]}
                    </span>
                    {hs.traumaLevel && (
                      <span className="text-[10px] text-slate-400 ml-1">Level {hs.traumaLevel} Trauma</span>
                    )}
                  </div>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      <tr>
                        <td className="py-0.5 text-slate-500">ED Load</td>
                        <td className="py-0.5 text-right font-semibold" style={{ color: statusStyle.dot }}>{hs.edLoadPct}%</td>
                      </tr>
                      <tr>
                        <td className="py-0.5 text-slate-500">Available beds</td>
                        <td className={`py-0.5 text-right font-semibold ${hs.remainingBeds < 5 ? 'text-red-600' : 'text-slate-800'}`}>{hs.remainingBeds}</td>
                      </tr>
                      <tr>
                        <td className="py-0.5 text-slate-500">Incoming patients</td>
                        <td className="py-0.5 text-right font-medium text-slate-800">{hs.incomingPatientsThisHour}</td>
                      </tr>
                      <tr>
                        <td className="py-0.5 text-slate-500">Incoming EMS units</td>
                        <td className={`py-0.5 text-right font-medium ${hs.incomingEmsUnits >= 3 ? 'text-amber-600' : 'text-slate-800'}`}>{hs.incomingEmsUnits}</td>
                      </tr>
                      <tr>
                        <td className="py-0.5 text-slate-500">Total arrivals</td>
                        <td className="py-0.5 text-right font-medium text-slate-700">{hs.cumulativeArrivals}</td>
                      </tr>
                    </tbody>
                  </table>
                  {hs.recommendation && (
                    <div className="mt-2 rounded px-2 py-1.5 text-[11px] leading-snug font-medium"
                      style={{ backgroundColor: statusStyle.dot + '10', color: statusStyle.dot }}>
                      {hs.recommendation}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ── Staging area markers with labels ─────────────────────── */}
        {stagingAreas.map((sa) => (
          <Marker
            key={sa.id}
            position={[sa.location.lat, sa.location.lng]}
            icon={stagingLabelIcon(sa.name, sa.assignedUnits.length)}
          >
            <Popup>
              <div className="text-sm min-w-[180px]">
                <p className="font-semibold text-slate-800">{sa.name}</p>
                <p className="text-xs font-medium text-purple-600 capitalize">{sa.type} staging area</p>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    <tr><td className="py-0.5 text-slate-500">Patient capacity</td><td className="py-0.5 text-right font-medium">{sa.capacityPatients}</td></tr>
                    <tr><td className="py-0.5 text-slate-500">Assigned units</td><td className="py-0.5 text-right font-medium">{sa.assignedUnits.length}</td></tr>
                  </tbody>
                </table>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* ── EMS unit markers with operational detail ─────────────── */}
        {unitStates.map((us, idx) => {
          const pos = resolveUnitPosition(us, scenario, idx, unitStates.length);
          const statusColor = UNIT_STATUS_COLOR[us.status];

          return (
            <Marker
              key={us.unitId}
              position={[pos.lat, pos.lng]}
              icon={emsUnitIcon(us.unit.name, us.status)}
            >
              <Popup>
                <div className="text-sm min-w-[200px]" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
                  <p className="font-bold text-slate-900 text-[13px]">{us.unit.name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColor }} />
                    <span className="text-xs font-semibold" style={{ color: statusColor }}>{UNIT_STATUS_LABEL[us.status]}</span>
                    <span className="text-[10px] text-slate-400 ml-1">{us.unit.type}</span>
                  </div>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {us.destination && (
                        <tr>
                          <td className="py-0.5 text-slate-500">Destination</td>
                          <td className="py-0.5 text-right font-medium text-slate-800">{us.destination}</td>
                        </tr>
                      )}
                      {us.etaMin !== null && (
                        <tr>
                          <td className="py-0.5 text-slate-500">ETA</td>
                          <td className="py-0.5 text-right font-medium text-slate-800">{us.etaMin} min</td>
                        </tr>
                      )}
                      {us.patientLoad && (
                        <tr>
                          <td className="py-0.5 text-slate-500">Patient load</td>
                          <td className="py-0.5 text-right font-medium">
                            <span className="text-red-600">{us.patientLoad.red} red</span>
                            {us.patientLoad.yellow > 0 && (
                              <span className="text-amber-600">, {us.patientLoad.yellow} yellow</span>
                            )}
                          </td>
                        </tr>
                      )}
                      {us.assignedZone && (
                        <tr>
                          <td className="py-0.5 text-slate-500">Assigned zone</td>
                          <td className="py-0.5 text-right font-medium text-slate-700">{us.assignedZone.name}</td>
                        </tr>
                      )}
                      {us.assignedHospital && (
                        <tr>
                          <td className="py-0.5 text-slate-500">Hospital</td>
                          <td className="py-0.5 text-right font-medium text-slate-700">{us.assignedHospital}</td>
                        </tr>
                      )}
                      <tr>
                        <td className="py-0.5 text-slate-500">Response time</td>
                        <td className="py-0.5 text-right font-medium text-slate-700">{us.unit.responseTimeMin} min</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <SimulationLegend />
    </div>
  );
}
