import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { environment } from '../../environments/environment';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface CampusRouteResponse {
  path: LatLngPoint[];
  lengthM: number;
}

export interface CampusRouteParams {
  fromLat: number;
  fromLng: number;
  destinationName?: string;
  destLat?: number;
  destLng?: number;
  wheelchair?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = Capacitor.isNativePlatform()
    ? environment.apiUrl
    : 'http://localhost:3000';

  constructor(private http: HttpClient) {}

  getCampusRoute(params: CampusRouteParams): Promise<CampusRouteResponse> {
    if (Capacitor.isNativePlatform()) {
      return CapacitorHttp.post({
        url: `${this.baseUrl}/api/route/campus`,
        headers: { 'Content-Type': 'application/json' },
        data: params,
      }).then(r => r.data as CampusRouteResponse);
    }
    return firstValueFrom(
      this.http.post<CampusRouteResponse>(`${this.baseUrl}/api/route/campus`, params)
    );
  }
}
