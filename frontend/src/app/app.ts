import { Component, computed, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { IconComponent } from './components/icon';
import { AuthService, ViewEntry } from './services/auth.service';

interface NavGroup { category: string; items: ViewEntry[]; }

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly brand = 'ReNova';
  private readonly url = signal(location.pathname);

  /** Sidebar collapsed to an icon rail — persisted so the choice survives reloads. */
  readonly collapsed = signal(localStorage.getItem('renova.sidebar') === 'collapsed');
  toggleSidebar(): void {
    this.collapsed.update((c) => !c);
    localStorage.setItem('renova.sidebar', this.collapsed() ? 'collapsed' : 'open');
  }

  /** Show the app chrome (sidebar) only when authed and not on the login screen. */
  readonly showChrome = computed(() => this.auth.isAuthenticated() && !this.url().startsWith('/login'));

  /** Sidebar nav, grouped by view category, entirely driven by /me/views. */
  readonly navGroups = computed<NavGroup[]>(() => {
    const groups = new Map<string, ViewEntry[]>();
    for (const v of this.auth.views()) {
      const cat = v.category || 'General';
      (groups.get(cat) ?? groups.set(cat, []).get(cat)!).push(v);
    }
    return [...groups.entries()].map(([category, items]) => ({ category, items }));
  });

  get user() { return this.auth.user; }

  constructor(private auth: AuthService, private router: Router) {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.url.set(e.urlAfterRedirects));
  }

  iconFor(code: string): string {
    return ({ DASHBOARD: 'layout-dashboard', POLICIES: 'clipboard-list',
      CALENDAR: 'calendar', USER_PROFILES: 'users', USER_MGMT: 'user',
      AUDIT_LOG: 'shield-check' } as Record<string, string>)[code] || 'file-text';
  }

  logout(): void { this.auth.logout(); this.router.navigate(['/login']); }
}
