export interface Destination {
  name: string;
  lat: number;
  lng: number;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}
