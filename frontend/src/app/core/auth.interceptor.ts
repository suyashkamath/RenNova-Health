import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Attach the access token; on a 401 try ONE refresh + retry, else bounce to /login. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/refresh');
  const token = auth.accessToken;
  const authed = token && !isAuthCall
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !isAuthCall && auth.refreshToken) {
        return auth.refresh().pipe(
          switchMap(() => next(req.clone({ setHeaders: { Authorization: `Bearer ${auth.accessToken}` } }))),
          catchError((refreshErr) => {
            auth.clear();
            router.navigate(['/login']);
            return throwError(() => refreshErr);
          }),
        );
      }
      if (err.status === 401 && !isAuthCall) {
        auth.clear();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
