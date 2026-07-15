import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CalendarResponse, DashboardFilters, DashboardResponse, FilterOptions, PolicyListResponse, TrendPoint,
} from '../models/renewal';

const API = 'http://localhost:3000/api';

@Injectable({ providedIn: 'root' })
export class RenewalService {
  // Shared filter state across pages.
  readonly filters = signal<DashboardFilters>({});

  // Which entity the /entity page is showing. Held IN MEMORY (not in the URL) so
  // the drill-down context can't be crafted or tampered with via a query string.
  // Lost on hard refresh — the entity page then falls back to the dashboard.
  readonly entity = signal<{ kind: string; label: string } | null>(null);

  constructor(private http: HttpClient) {}

  private toParams(f: DashboardFilters): HttpParams {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(f)) {
      if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    }
    return p;
  }

  // Pass current filters so the dropdown lists depend on each other (faceted):
  // e.g. Product = Health => only Health's RMs/POSPs/companies come back.
  getFilterOptions(f?: DashboardFilters): Observable<FilterOptions> {
    return this.http.get<FilterOptions>(`${API}/filters`, f ? { params: this.toParams(f) } : {});
  }

  getDashboard(f: DashboardFilters): Observable<DashboardResponse> {
    return this.http.get<DashboardResponse>(`${API}/dashboard`, { params: this.toParams(f) });
  }

  // Period-aware trend: the backend returns ONE continuous window spanning the previous
  // comparable period + the current period (from `preset`), plus `curFrom` (the divider
  // between "last period" and "this period") and the `bucket` granularity it used.
  getTrend(f: DashboardFilters): Observable<{ from: string; to: string; curFrom: string; bucket: 'day' | 'month'; trend: TrendPoint[] }> {
    return this.http.get<{ from: string; to: string; curFrom: string; bucket: 'day' | 'month'; trend: TrendPoint[] }>(`${API}/trend`, { params: this.toParams(f) });
  }

  getCalendar(f: DashboardFilters, month: string): Observable<CalendarResponse> {
    const p = this.toParams(f).set('month', month);
    return this.http.get<CalendarResponse>(`${API}/calendar`, { params: p });
  }

  getPolicies(f: DashboardFilters, page: number, pageSize: number, sortBy?: string, sortDir?: 'asc' | 'desc'): Observable<PolicyListResponse> {
    let p = this.toParams(f).set('page', String(page)).set('pageSize', String(pageSize));
    if (sortBy) p = p.set('sortBy', sortBy);
    if (sortDir) p = p.set('sortDir', sortDir);
    return this.http.get<PolicyListResponse>(`${API}/policies`, { params: p });
  }

  // Full mobile for ONE policy — the list only carries the masked value.
  revealMobile(policyId: string): Observable<{ mobile: string | null }> {
    return this.http.get<{ mobile: string | null }>(`${API}/policies/${encodeURIComponent(policyId)}/mobile`);
  }

  // Full filtered set as CSV. Fetched via HttpClient so the auth interceptor
  // attaches the bearer token (a plain <a href> can't send headers — it 401s)
  // and the API URL/query string never appears in the address bar.
  downloadCsv(f: DashboardFilters, sortBy?: string, sortDir?: 'asc' | 'desc'): void {
    let p = this.toParams(f);
    if (sortBy) p = p.set('sortBy', sortBy);
    if (sortDir) p = p.set('sortDir', sortDir);
    this.http.get(`${API}/policies/export`, { params: p, responseType: 'blob' }).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Renewal_Policies_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}
