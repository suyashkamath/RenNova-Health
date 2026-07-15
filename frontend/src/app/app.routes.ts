import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent) },

  { path: '', canActivate: [authGuard], data: { view: 'DASHBOARD' },
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent) },
  { path: 'dashboard', redirectTo: '', pathMatch: 'full' },
  { path: 'policies', canActivate: [authGuard], data: { view: 'POLICIES' },
    loadComponent: () => import('./pages/policies/policies').then((m) => m.PoliciesComponent) },
  // Drill-down target (Region/Branch → RM → POSP). Reached by clicking dashboard
  // rankings — NOT a sidebar item. Gated by the Dashboard entitlement.
  { path: 'entity', canActivate: [authGuard], data: { view: 'DASHBOARD' },
    loadComponent: () => import('./pages/entity/entity').then((m) => m.EntityComponent) },

  { path: 'admin/users', canActivate: [authGuard], data: { view: 'USER_MGMT' },
    loadComponent: () => import('./pages/admin/users').then((m) => m.AdminUsersComponent) },
  { path: 'admin/profiles', canActivate: [authGuard], data: { view: 'USER_PROFILES' },
    loadComponent: () => import('./pages/admin/profiles').then((m) => m.UserProfilesComponent) },

  { path: '**', redirectTo: '' },
];
