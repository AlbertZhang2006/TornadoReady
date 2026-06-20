export interface HospitalEntry {
  id: string;
  name: string;
  edCapacity: number;
  currentEdLoad: number;
  availableBeds: number;
  traumaCapability: string;
  surgeCapacity: number;
}

export interface WorkspaceState {
  region: string;
  efScale: number;
  areaType: string;
  timeOfDay: string;
  purpose: string[];
  pathMethod: 'auto' | 'manual' | 'historical';
  pathLength: number;
  pathWidth: number;
  direction: string;
  populationExposure: number;
  schoolsAffected: number;
  nursingHomesAffected: number;
  mobileHomeParks: number;
  largeVenues: number;
  vulnerablePopLevel: 'low' | 'moderate' | 'high';
  alsAmbulances: number;
  blsAmbulances: number;
  supervisorUnits: number;
  avgSceneTimeMin: number;
  avgTransportTimeMin: number;
  avgOffloadTimeMin: number;
  mutualAidDelayMin: number;
  hospitals: HospitalEntry[];
  pctNeedingTransport: number;
  pctSelfPresenting: number;
  roadDelayMultiplier: number;
  powerDisruption: 'low' | 'moderate' | 'high';
  commsDisruption: 'low' | 'moderate' | 'high';
}

const EF_CASUALTY_RATE: Record<number, number> = {
  0: 0.001, 1: 0.003, 2: 0.005, 3: 0.007, 4: 0.015, 5: 0.025,
};

export function deriveSummary(s: WorkspaceState) {
  const rate = EF_CASUALTY_RATE[s.efScale] ?? 0.007;
  const vulnMultiplier = s.vulnerablePopLevel === 'high' ? 1.4 : s.vulnerablePopLevel === 'moderate' ? 1.15 : 1.0;
  const estCasualties = Math.round(s.populationExposure * rate * vulnMultiplier);
  const needTransport = Math.round(estCasualties * (s.pctNeedingTransport / 100));
  const selfPresenting = Math.round(estCasualties * (s.pctSelfPresenting / 100));
  const totalAmbulances = s.alsAmbulances + s.blsAmbulances;
  const cycleMin = (s.avgSceneTimeMin + s.avgTransportTimeMin + s.avgOffloadTimeMin) * s.roadDelayMultiplier;
  const transportsPerHour = cycleMin > 0 ? Math.floor(totalAmbulances * (60 / cycleMin)) : 0;
  const totalBeds = s.hospitals.reduce((sum, h) => sum + h.availableBeds, 0);
  const edRemaining = s.hospitals.reduce((sum, h) => sum + Math.max(0, h.edCapacity - h.currentEdLoad), 0);
  const surgeTotal = s.hospitals.reduce((sum, h) => sum + h.surgeCapacity, 0);
  const totalReceiving = totalBeds + edRemaining + surgeTotal;
  const totalDemand = needTransport + selfPresenting;
  const hospitalRisk = s.hospitals.length === 0 ? null : totalDemand > totalReceiving;
  const mutualAidLikely = needTransport > transportsPerHour * 2 || totalDemand > totalReceiving;

  return {
    estCasualties,
    needTransport,
    selfPresenting,
    totalAmbulances,
    transportsPerHour,
    totalBeds,
    edRemaining,
    surgeTotal,
    hospitalRisk,
    mutualAidLikely,
  };
}
