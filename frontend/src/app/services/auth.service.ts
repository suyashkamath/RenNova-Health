import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, map, tap } from 'rxjs';

const API = 'http://localhost:3000/api';
const ACCESS_KEY = 'rd_access';
const REFRESH_KEY = 'rd_refresh';

export interface AuthUser {
  id: number; username: string; email: string | null; fullName: string | null;
  role: string; level: number; mustChangePassword: boolean;
  scopes?: { regions: string[]; branches: string[]; ams: number[] };
}
export interface ViewEntry {
  view_code: string; view_name: string; route: string; icon: string | null;
  category: string | null; can_export: boolean; can_edit: boolean;
}
interface LoginResponse { accessToken: string; refreshToken: string; user: AuthUser; views: ViewEntry[]; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(null);
  readonly views = signal<ViewEntry[]>([]);
  readonly isAuthenticated = computed(() => !!this.user());
  // Management-capable roles: Super Admin(1), Product Head(2), Renewal Head(3).
  readonly isAdmin = computed(() => (this.user()?.level ?? 99) <= 3);

  constructor(private http: HttpClient) {}

  get accessToken(): string | null { return localStorage.getItem(ACCESS_KEY); }
  get refreshToken(): string | null { return localStorage.getItem(REFRESH_KEY); }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API}/auth/login`, { username, password })
      .pipe(tap((r) => this.applySession(r)));
  }

  refresh(): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API}/auth/refresh`, { refreshToken: this.refreshToken })
      .pipe(tap((r) => this.applySession(r)));
  }

  changePassword(newPassword: string, currentPassword?: string): Observable<LoginResponse> {
    // The server rotates tokens on a password change (old refresh tokens are revoked),
    // so it returns a FRESH session — store it, otherwise the next call 401s → /login.
    return this.http.post<LoginResponse>(`${API}/auth/change-password`, { newPassword, currentPassword })
      .pipe(tap((r) => this.applySession(r)));
  }

  logout(): void {
    const rt = this.refreshToken;
    if (rt) this.http.post(`${API}/auth/logout`, { refreshToken: rt }).subscribe({ error: () => {} });
    this.clear();
  }

  /** Re-fetch profile + views from a surviving token (page reload / cold guard). */
  hydrate(): Observable<AuthUser> {
    return forkJoin({
      user: this.http.get<AuthUser>(`${API}/me`),
      views: this.http.get<{ views: ViewEntry[] }>(`${API}/me/views`),
    }).pipe(
      tap(({ user, views }) => { this.user.set(user); this.views.set(views.views ?? []); }),
      map(({ user }) => user),
    );
  }

  canView(code: string): boolean { return this.views().some((v) => v.view_code === code); }

  private applySession(r: LoginResponse): void {
    localStorage.setItem(ACCESS_KEY, r.accessToken);
    localStorage.setItem(REFRESH_KEY, r.refreshToken);
    this.user.set(r.user);
    this.views.set(r.views ?? []);
  }
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.user.set(null);
    this.views.set([]);
  }
}
