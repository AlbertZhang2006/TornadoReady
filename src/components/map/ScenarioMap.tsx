import { MapContainer, TileLayer, Polygon, Polyline, Circle, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect } from 'react';
import type { TornadoScenario, GeoPoint, PatientDemandZone } from '../../types/scenario';

// ── Fix Leaflet default icon path ───────────────────────────────────────

delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Icons ───────────────────────────────────────────────────────────────

function svgIcon(svg: string, size: [number, number] = [28, 28]): L.DivIcon {
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2],
    popupAnchor: [0, -size[1] / 2],
  });
}

function hospitalIcon(status: 'green' | 'yellow' | 'red'): L.DivIcon {
  const fill = status === 'green' ? '#16a34a' : status === 'yellow' ? '#d97706' : '#dc2626';
  return svgIcon(
    `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="24" height="24" rx="4" fill="white" stroke="${fill}" stroke-width="2"/>
      <path d="M14 7v14M7 14h14" stroke="${fill}" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,
  );
}

const stagingIcon = svgIcon(
  `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="24" height="24" rx="4" fill="#7c3aed" opacity="0.9"/>
    <path d="M14 8v12M9 13l5-5 5 5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
);

// ── Direction arrow ─────────────────────────────────────────────────────

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

// ── Demand zone severity ────────────────────────────────────────────────

type ZoneSeverity = 'critical' | 'serious' | 'moderate';

const ZONE_STYLES: Record<ZoneSeverity, { color: string; label: string; stroke: string; fill: string }> = {
  critical: { color: '#dc2626', label: 'Critical — high immediate-care demand',  stroke: '#dc2626', fill: '#fca5a5' },
  serious:  { color: '#ea580c', label: 'Serious — significant patient load',     stroke: '#ea580c', fill: '#fdba74' },
  moderate: { color: '#d97706', label: 'Moderate — manageable patient volume',    stroke: '#d97706', fill: '#fde68a' },
};

function zoneSeverity(zone: PatientDemandZone): ZoneSeverity {
  const immediateRatio = zone.triageBreakdown.red / zone.estimatedPatients;
  if (immediateRatio >= 0.3 || zone.triageBreakdown.black >= 2) return 'critical';
  if (immediateRatio >= 0.15) return 'serious';
  return 'moderate';
}

// ── Hospital capacity status ────────────────────────────────────────────

function hospitalStatus(
  edCapacity: number,
  edLoad: number,
  availBeds: number,
): 'green' | 'yellow' | 'red' {
  const edRatio = edCapacity > 0 ? edLoad / edCapacity : 1;
  if (edRatio >= 0.9 || availBeds < 10) return 'red';
  if (edRatio >= 0.7 || availBeds < 30) return 'yellow';
  return 'green';
}

// ── Auto-fit bounds ─────────────────────────────────────────────────────

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

function MapLegend() {
  return (
    <div
      className="absolute bottom-4 left-4 z-[1000] rounded-lg bg-white/95 px-3 py-2.5 border border-gray-200"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Map Legend</p>
      <div className="space-y-1.5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tornado Impact</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-5 bg-red-900" />
              <span className="text-[11px] text-slate-600">Tornado path (direction)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 rounded-sm bg-red-500/30 border border-red-500" />
              <span className="text-[11px] text-slate-600">Severe impact</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 rounded-sm bg-orange-400/20 border border-orange-400" />
              <span className="text-[11px] text-slate-600">Moderate impact</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 rounded-sm bg-yellow-400/15 border border-yellow-400" />
              <span className="text-[11px] text-slate-600">Light impact</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-1.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Affected Areas</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-red-600 bg-red-100" />
              <span className="text-[11px] text-slate-600">Critical demand</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-orange-500 bg-orange-100" />
              <span className="text-[11px] text-slate-600">Serious demand</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-amber-500 bg-amber-100" />
              <span className="text-[11px] text-slate-600">Moderate demand</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-1.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Facilities</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-green-600 bg-white" />
              <span className="text-[11px] text-slate-600">Hospital — available</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-amber-500 bg-white" />
              <span className="text-[11px] text-slate-600">Hospital — elevated load</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-red-600 bg-white" />
              <span className="text-[11px] text-slate-600">Hospital — at capacity</span>
            </div>
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 28 28" className="shrink-0">
                <rect x="2" y="2" width="24" height="24" rx="4" fill="#7c3aed" opacity="0.9"/>
                <path d="M14 8v12M9 13l5-5 5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[11px] text-slate-600">Staging area</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main map component ──────────────────────────────────────────────────

interface ScenarioMapProps {
  scenario: TornadoScenario;
  pctNeedingTransport: number;
}

export function ScenarioMap({ scenario, pctNeedingTransport }: ScenarioMapProps) {
  const { impactPath, demandZones, hospitals, stagingAreas } = scenario;
  const hasAnyGeo = impactPath.centerLine.length >= 2 || demandZones.length > 0;

  const corridorSevere = buildCorridorPolygon(impactPath.centerLine, impactPath.widthMiles);
  const corridorModerate = buildCorridorPolygon(impactPath.centerLine, impactPath.widthMiles * 2);
  const corridorLight = buildCorridorPolygon(impactPath.centerLine, impactPath.widthMiles * 3);

  const pathLine: [number, number][] = impactPath.centerLine.map((p) => [p.lat, p.lng]);

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

        {/* Impact swath — light (outermost) */}
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

        {/* Impact swath — moderate */}
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

        {/* Impact swath — severe (innermost) */}
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
                  Direction: {scenario.profile.direction}<br />
                  Est. wind speed: {scenario.profile.estimatedWindSpeedMph} mph
                </p>
                <p className="mt-1.5 text-xs text-slate-500">
                  Inner zone (red): severe structural damage.<br />
                  Middle zone (orange): moderate damage.<br />
                  Outer zone (yellow): light damage, debris field.
                </p>
              </div>
            </Popup>
          </Polygon>
        )}

        {/* Tornado path center line */}
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

        {/* Direction arrow */}
        {pathEnd && (
          <Marker
            position={[pathEnd.lat, pathEnd.lng]}
            icon={arrowIcon(endBearing)}
            interactive={false}
          />
        )}

        {/* Affected areas (demand zones) — severity-colored */}
        {demandZones.map((zone) => {
          const sev = zoneSeverity(zone);
          const style = ZONE_STYLES[sev];
          const patientsTransport = Math.round(zone.estimatedPatients * (pctNeedingTransport / 100));
          return (
            <Circle
              key={zone.id}
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
                    {style.label}
                  </p>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5 text-slate-500">Estimated patients</td><td className="py-0.5 text-right font-semibold">{zone.estimatedPatients}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">Needing transport</td><td className="py-0.5 text-right font-medium">{patientsTransport}</td></tr>
                      <tr className="border-t border-gray-100"><td className="py-0.5 text-red-600">Immediate (red)</td><td className="py-0.5 text-right font-semibold">{zone.triageBreakdown.red}</td></tr>
                      <tr><td className="py-0.5 text-amber-600">Delayed (yellow)</td><td className="py-0.5 text-right font-medium">{zone.triageBreakdown.yellow}</td></tr>
                      <tr><td className="py-0.5 text-green-600">Minor (green)</td><td className="py-0.5 text-right font-medium">{zone.triageBreakdown.green}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">Deceased (black)</td><td className="py-0.5 text-right font-medium">{zone.triageBreakdown.black}</td></tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Affected area: {zone.radiusMiles} mi radius. Patient count
                    derived from population exposure and EF-scale casualty model.
                  </p>
                </div>
              </Popup>
            </Circle>
          );
        })}

        {/* Hospital markers */}
        {hospitals.map((h) => {
          const edLoad = Math.round(h.erCapacity * 0.6);
          const status = hospitalStatus(h.erCapacity, edLoad, h.availableBeds);
          const statusLabel = status === 'green' ? 'Available — capacity within range'
            : status === 'yellow' ? 'Elevated — limited remaining capacity'
            : 'Critical — at or near capacity';
          return (
            <Marker key={h.id} position={[h.location.lat, h.location.lng]} icon={hospitalIcon(status)}>
              <Popup>
                <div className="text-sm min-w-[200px]">
                  <p className="font-semibold text-slate-800">{h.name}</p>
                  <p className={`text-xs font-medium ${status === 'green' ? 'text-green-600' : status === 'yellow' ? 'text-amber-600' : 'text-red-600'}`}>
                    {statusLabel}
                  </p>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5 text-slate-500">Trauma level</td><td className="py-0.5 text-right font-medium">{h.traumaLevel ? `Level ${h.traumaLevel}` : 'Non-trauma'}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">ED capacity</td><td className="py-0.5 text-right font-medium">{h.erCapacity}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">Est. ED load</td><td className="py-0.5 text-right font-medium">{edLoad}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">Available beds</td><td className="py-0.5 text-right font-medium">{h.availableBeds}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">Surgical capacity</td><td className="py-0.5 text-right font-medium">{h.surgicalCapacity}</td></tr>
                      <tr><td className="py-0.5 text-slate-500">Distance from path</td><td className="py-0.5 text-right font-medium">{h.distanceMiles} mi</td></tr>
                    </tbody>
                  </table>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Staging area markers */}
        {stagingAreas.map((sa) => (
          <Marker key={sa.id} position={[sa.location.lat, sa.location.lng]} icon={stagingIcon}>
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
      </MapContainer>

      <MapLegend />
    </div>
  );
}
