import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="brand"><span class="dot"></span> ReNova <small>Renewal Dashboard</small></div>

      @if (mode() === 'login') {
        <h1>Sign in</h1>
        <p class="sub">Use your company login ID and password.</p>
        <label>Username <input [(ngModel)]="username" autocomplete="username" placeholder="e.g. P625131" /></label>
        <label>Password <input [(ngModel)]="password" type="password" autocomplete="current-password" (keyup.enter)="submit()" /></label>
        @if (error()) { <div class="err">{{ error() }}</div> }
        <button [disabled]="busy()" (click)="submit()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      } @else {
        <h1>Set a new password</h1>
        <p class="sub">You must change your password before continuing.</p>
        <label>New password <input [(ngModel)]="newPassword" type="password" autocomplete="new-password" placeholder="min 8 characters" /></label>
        <label>Confirm <input [(ngModel)]="confirm" type="password" autocomplete="new-password" (keyup.enter)="changePw()" /></label>
        @if (error()) { <div class="err">{{ error() }}</div> }
        <button [disabled]="busy()" (click)="changePw()">{{ busy() ? 'Saving…' : 'Save & continue' }}</button>
      }
    </div>
  </div>
  `,
  styles: [`
    .auth-wrap { min-height:100vh; display:grid; place-items:center; background:#0b1020;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
    .auth-card { width:360px; background:#141b31; color:#e7ecf5; padding:34px 30px; border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,.45); border:1px solid #232c46; }
    .brand { font-weight:700; font-size:18px; display:flex; align-items:center; gap:8px; margin-bottom:22px; }
    .brand small { color:#8a93ad; font-weight:500; font-size:12px; }
    .dot { width:12px; height:12px; border-radius:50%; background:linear-gradient(135deg,#4f8cff,#8a5bff); }
    h1 { font-size:20px; margin:0 0 4px; }
    .sub { color:#8a93ad; font-size:13px; margin:0 0 18px; }
    label { display:block; font-size:12px; color:#a9b2ca; margin-bottom:14px; }
    input { width:100%; margin-top:6px; padding:11px 12px; border-radius:9px; border:1px solid #2c3654;
      background:#0f1526; color:#e7ecf5; font-size:14px; box-sizing:border-box; }
    input:focus { outline:none; border-color:#4f8cff; }
    button { width:100%; margin-top:6px; padding:12px; border:0; border-radius:9px; cursor:pointer;
      background:linear-gradient(135deg,#4f8cff,#8a5bff); color:#fff; font-weight:600; font-size:14px; }
    button:disabled { opacity:.6; cursor:default; }
    .err { background:#3a1620; color:#ff9db0; padding:9px 11px; border-radius:8px; font-size:12.5px; margin-bottom:12px; }
  `],
})
export class LoginComponent {
  username = ''; password = '';
  newPassword = ''; confirm = '';
  readonly mode = signal<'login' | 'change'>('login');
  readonly busy = signal(false);
  readonly error = signal('');

  constructor(private auth: AuthService, private router: Router) {
    if (new URLSearchParams(location.search).get('change') && auth.isAuthenticated()) this.mode.set('change');
  }

  submit(): void {
    this.error.set(''); this.busy.set(true);
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.user.mustChangePassword) this.mode.set('change');
        else this.goHome();
      },
      error: (e) => { this.busy.set(false); this.error.set(e?.error?.detail || 'Sign in failed'); },
    });
  }

  changePw(): void {
    this.error.set('');
    if (this.newPassword.length < 8) { this.error.set('Password must be at least 8 characters'); return; }
    if (this.newPassword !== this.confirm) { this.error.set('Passwords do not match'); return; }
    this.busy.set(true);
    this.auth.changePassword(this.newPassword).subscribe({
      next: () => { this.busy.set(false); this.goHome(); },
      error: (e) => { this.busy.set(false); this.error.set(e?.error?.detail || 'Could not change password'); },
    });
  }

  private goHome(): void {
    const first = this.auth.views()[0];
    this.router.navigateByUrl(first?.route || '/');
  }
}
