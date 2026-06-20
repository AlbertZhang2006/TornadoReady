export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface TornadoProfile {
  efScale: 0 | 1 | 2 | 3 | 4 | 5;
  areaType: 'rural' | 'suburban' | 'urban' | 'mixed';
  direction: string;
  forwardSpeedMph: number;
  timeOfDay: string;
  estimatedWindSpeedMph: string;
}

export interface TornadoImpactPath {
  centerLine: GeoPoint[];
  lengthMiles: number;
  widthMiles: number;
}

export interface CommunityExposure {
  populationInPath: number;
  householdsInPath: number;
  criticalFacilities: number;
  schoolsInPath: number;
  estimatedCasualties: {
    minor: number;
    major: number;
    fatal: number;
    total: number;
  };
  disruption: {
    road: 'low' | 'moderate' | 'high';
    power: 'low' | 'moderate' | 'high';
    communications: 'low' | 'moderate' | 'high';
  };
}

export interface EMSUnit {
  id: string;
  name: string;
  type: 'ALS' | 'BLS' | 'Rescue' | 'HazMat' | 'Supervisor';
  available: boolean;
  responseTimeMin: number;
}

export interface EMSResources {
  units: EMSUnit[];
  totalALS: number;
  totalBLS: number;
  totalSupervisors: number;
}

export interface Hospital {
  id: string;
  name: string;
  location: GeoPoint;
  totalBeds: number;
  availableBeds: number;
  surgicalCapacity: number;
  traumaLevel: 1 | 2 | 3 | 4 | 5 | null;
  erCapacity: number;
  distanceMiles: number;
}

export interface PlanningAssumptions {
  timeOfDay: string;
  season: 'spring' | 'summer' | 'fall' | 'winter';
  warningLeadTimeMin: number;
  shelterInPlaceRate: number;
  roadAccessible: boolean;
  mutualAidAvailable: boolean;
  populationDensity: 'low' | 'moderate' | 'high';
  specialPopulations: string[];
}

export interface PatientDemandZone {
  id: string;
  name: string;
  center: GeoPoint;
  radiusMiles: number;
  estimatedPatients: number;
  triageBreakdown: {
    red: number;
    yellow: number;
    green: number;
    black: number;
  };
}

export interface StagingArea {
  id: string;
  name: string;
  location: GeoPoint;
  type: 'treatment' | 'transport' | 'command';
  capacityPatients: number;
  assignedUnits: string[];
}

export interface TornadoScenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'ready' | 'simulated';
  region: string;
  profile: TornadoProfile;
  impactPath: TornadoImpactPath;
  communityExposure: CommunityExposure;
  emsResources: EMSResources;
  hospitals: Hospital[];
  assumptions: PlanningAssumptions;
  demandZones: PatientDemandZone[];
  stagingAreas: StagingArea[];
}

