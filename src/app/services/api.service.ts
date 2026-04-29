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

  warmup(): void {
    if (!Capacitor.isNativePlatform()) return;
    CapacitorHttp.get({ url: this.baseUrl, headers: {} }).catch(() => {});
  }

  getCampusRoute(params: CampusRouteParams): Promise<CampusRouteResponse> {
    const TIMEOUT_MS = 10000;

    const req: Promise<CampusRouteResponse> = Capacitor.isNativePlatform()
      ? CapacitorHttp.post({
          url: `${this.baseUrl}/api/route/campus`,
          headers: { 'Content-Type': 'application/json' },
          data: params,
        }).then(r => {
          if (r.status < 200 || r.status >= 300) {
            throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
          }
          return r.data as CampusRouteResponse;
        })
      : firstValueFrom(
          this.http.post<CampusRouteResponse>(`${this.baseUrl}/api/route/campus`, params)
        );

    const timeoutP = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Route request timed out')), TIMEOUT_MS)
    );

    return Promise.race([req, timeoutP]);
  }
}
