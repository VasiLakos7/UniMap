export interface LatLng {
  lat: number;
  lng: number;
}

export type Adjacency = Record<string, Record<string, number>>;

export type EdgeTag = 'ALL' | 'STAIRS' | 'RAMP';

export interface RouteResult {
  path: LatLng[];
  lengthM: number;
}

export interface CampusRouteRequest {
  fromLat: number;
  fromLng: number;
  destinationName?: string; 
  destLat?: number;         // fallback αν δεν βρεθεί με όνομα
  destLng?: number;
  wheelchair?: boolean;
}
