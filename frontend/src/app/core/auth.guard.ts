import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Guard: require an authenticated session and (optionally) entitlement to the
 * view named in route.data.view. Hydrates from a surviving token on cold loads.
 * NOTE: the backend re-checks entitlement + scope on every data call — this guard
 * is only for UX (don't route to a screen the user can't use).
 */
export const authGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const required = route.data?.['view'] as string | undefined;

  const decide = () => {
    if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
    if (auth.user()?.mustChangePassword) return router.createUrlTree(['/login'], { queryParams: { change: 1 } });
    if (required && !auth.canView(required)) return router.createUrlTree(['/']);
    return true;
  };

  if (auth.isAuthenticated()) return decide();
  if (!auth.accessToken) return router.createUrlTree(['/login']);

  // Cold load with a stored token — hydrate first.
  return auth.hydrate().pipe(
    map(() => decide()),
    catchError(() => { auth.clear(); return of(router.createUrlTree(['/login'])); }),
  );
};
