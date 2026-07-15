import { Component, OnInit, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { IstDatePipe } from '../../core/ist-date.pipe';
import { AuthService } from '../../services/auth.service';

const API = 'http://localhost:3000/api';

interface Staff { id: number; username: string; full_name: string | null; role_code: string; is_active: boolean; }
interface Account {
  org: string;
  profile: { username: string; fullName: string | null; email: string | null; role: string; isActive: boolean; lastLoginAt: string | null; };
  demographics: { gender: string | null; age: string | null; branch: string | null; division: string | null; region: string | null; zone: string | null; states: string | null; jobRole: string | null; };
}

@Component({
  selector: 'app-my-account',
  imports: [FormsModule, IstDatePipe],
  template: `
  <div class="page">
    <div class="crumb">USER MANAGEMENT <span>›</span> MY ACCOUNT</div>
    <header class="head">
      <div><h1>My Account</h1><p>Your profile, demographics and team — {{ account()?.org }}</p></div>
      <button class="btn ghost" (click)="refresh()">Refresh</button>
    </header>

    <div class="cards">
      <section class="card profile">
        <div class="profile__top">
          <div class="avatar lg" [style.background]="color(account()?.profile?.fullName || account()?.profile?.username || '?')">{{ initial(account()?.profile?.fullName || account()?.profile?.username) }}</div>
          <div><div class="profile__org">{{ account()?.org }}</div><div class="profile__sub">{{ account()?.profile?.username }} · {{ account()?.profile?.role }}</div></div>
        </div>
        <div class="kv"><span>Role</span><b class="badge">{{ account()?.profile?.role }}</b></div>
        <div class="kv"><span>Status</span><b class="pill" [class.ok]="account()?.profile?.isActive">{{ account()?.profile?.isActive ? 'Active' : 'Disabled' }}</b></div>
        <div class="kv"><span>Last Login</span><b>{{ account()?.profile?.lastLoginAt | istDate }}</b></div>
        <div class="kv"><span>Password</span><a class="link" (click)="showPw.set(true)">Change Password</a></div>
      </section>

      <section class="card">
        <div class="card__head"><h2>Demographics</h2><button class="btn ghost sm" disabled title="From the company directory (read-only)">Edit</button></div>
        @for (d of demoRows(); track d.label) { <div class="kv"><span>{{ d.label }}</span><b>{{ d.value || '—' }}</b></div> }
      </section>
    </div>

    <section class="staff">
      <div class="staff__head"><h2>All Staff</h2><p>Managers and agents in the system.</p></div>
      <div class="grid">
        @for (u of staff(); track u.id) {
          <div class="staffcard" [class.dim]="!u.is_active">
            <div class="avatar" [style.background]="color(u.full_name || u.username)">{{ initial(u.full_name || u.username) }}</div>
            <div><div class="staffcard__name">{{ u.full_name || u.username }}</div><div class="staffcard__code">{{ u.username }}</div><span class="badge sm">{{ u.role_code }}</span></div>
          </div>
        }
      </div>
    </section>
  </div>

  @if (showPw()) {
    <div class="modal" (click)="showPw.set(false)"><div class="sheet" (click)="$event.stopPropagation()">
      <h2>Change Password</h2>
      <input type="password" [(ngModel)]="pw.current" placeholder="Current password" />
      <input type="password" [(ngModel)]="pw.next" placeholder="New password (min 8)" />
      @if (pwErr()) { <div class="err">{{ pwErr() }}</div> }
      <div class="row-end"><button class="btn ghost" (click)="showPw.set(false)">Cancel</button><button class="btn" (click)="changePw()">Save</button></div>
    </div></div>
  }
  `,
  styles: [`
    :host { --navy:#0f1e3d; --ink:#1e2a44; --muted:#6b7a99; --line:#e5eaf3; --accent:#6366f1; --accentbg:#eef0fe; }
    .page { padding:24px 30px; background:#f4f7fd; min-height:100vh; font-family:system-ui,sans-serif; color:var(--ink); }
    .crumb { font-size:12px; font-weight:800; letter-spacing:.05em; color:var(--accent); margin-bottom:6px; } .crumb span{color:var(--muted);margin:0 4px}
    .head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
    h1 { margin:0; font-size:30px; color:var(--navy); } .head p { margin:4px 0 0; color:var(--muted); font-size:14px; }
    .cards { display:grid; grid-template-columns:minmax(280px,1fr) minmax(280px,1.1fr); gap:18px; margin-bottom:22px; }
    .card { background:#fff; border:1px solid var(--line); border-radius:16px; padding:20px 22px; box-shadow:0 1px 3px rgba(16,30,61,.04); }
    .card__head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
    h2 { font-size:17px; color:var(--navy); margin:0 0 2px; }
    .profile__top { display:flex; gap:14px; align-items:center; margin-bottom:16px; }
    .profile__org { font-weight:800; font-size:17px; color:var(--navy); } .profile__sub { color:var(--muted); font-size:13px; margin-top:2px; }
    .avatar { width:42px; height:42px; border-radius:50%; display:grid; place-items:center; color:#fff; font-weight:800; text-transform:uppercase; }
    .avatar.lg { width:52px; height:52px; border-radius:14px; font-size:20px; }
    .kv { display:flex; justify-content:space-between; align-items:center; padding:11px 0; border-bottom:1px solid var(--line); font-size:14px; }
    .kv:last-child { border-bottom:0; } .kv span { color:var(--muted); } .kv b { color:var(--ink); font-weight:600; }
    .badge { background:var(--accentbg); color:var(--accent); padding:3px 12px; border-radius:8px; font-size:12px; font-weight:800; } .badge.sm { padding:2px 8px; font-size:10.5px; border-radius:6px; }
    .pill { padding:3px 12px; border-radius:20px; font-size:12px; font-weight:700; background:#f1f2f6; color:#8792a8; } .pill.ok{background:#e5f6ec;color:#1f9d55}
    .link { color:var(--navy); font-weight:700; text-decoration:underline; cursor:pointer; }
    .staff { background:#fff; border:1px solid var(--line); border-radius:16px; padding:20px 22px; box-shadow:0 1px 3px rgba(16,30,61,.04); }
    .staff__head p{margin:2px 0 0;color:var(--muted);font-size:13px}
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-top:16px; }
    .staffcard { display:flex; gap:12px; align-items:flex-start; border:1px solid var(--line); border-radius:12px; padding:14px; } .staffcard.dim{opacity:.5}
    .staffcard__name { font-weight:800; color:var(--navy); font-size:13.5px; } .staffcard__code { color:var(--muted); font-size:12px; margin:1px 0 6px; }
    .btn { border:0; border-radius:9px; padding:9px 16px; font-weight:700; font-size:13px; cursor:pointer; background:var(--accent); color:#fff; }
    .btn.ghost { background:#fff; border:1px solid var(--line); color:var(--ink); } .btn.sm{padding:7px 12px;font-size:12px} .btn:disabled{opacity:.5}
    .modal { position:fixed; inset:0; background:rgba(15,30,61,.4); display:grid; place-items:center; z-index:50; }
    .sheet { background:#fff; border-radius:16px; padding:24px; width:420px; max-width:92vw; box-shadow:0 24px 70px rgba(0,0,0,.3); }
    .sheet input { width:100%; box-sizing:border-box; margin-top:10px; padding:11px 13px; border:1px solid var(--line); border-radius:10px; font-size:14px; }
    .row-end { display:flex; justify-content:flex-end; gap:10px; margin-top:16px; }
    .err { background:#fdecef; color:#d6335c; padding:9px 11px; border-radius:9px; margin-top:10px; font-size:12.5px; }
    @media (max-width:760px){ .cards{grid-template-columns:1fr} }
  `],
})
export class AdminUsersComponent implements OnInit {
  readonly account = signal<Account | null>(null);
  readonly staff = signal<Staff[]>([]);
  readonly showPw = signal(false); readonly pwErr = signal('');
  pw = { current: '', next: '' };

  readonly demoRows = computed(() => {
    const d = this.account()?.demographics;
    return [
      { label: 'Gender', value: d?.gender }, { label: 'Age', value: d?.age },
      { label: 'Branch', value: d?.branch }, { label: 'Division', value: d?.division },
      { label: 'Region', value: d?.region }, { label: 'States', value: d?.states },
      { label: 'Job Role', value: d?.jobRole },
    ];
  });

  constructor(private http: HttpClient, private auth: AuthService) {}
  ngOnInit(): void { this.refresh(); }
  refresh(): void {
    this.http.get<Account>(`${API}/me/account`).subscribe((a) => this.account.set(a));
    this.http.get<Staff[]>(`${API}/users`).subscribe((s) => this.staff.set(s), () => this.staff.set([]));
  }
  initial(s?: string | null): string { return (s || '?').trim().charAt(0); }
  color(s: string): string { const p = ['#6366f1','#e08d2f','#1f9d55','#8b5cf6','#0ea5e9','#e0567a']; let h = 0; for (const c of s) h = (h*31 + c.charCodeAt(0)) >>> 0; return p[h % p.length]; }
  changePw(): void {
    this.pwErr.set('');
    if (this.pw.next.length < 8) { this.pwErr.set('New password must be at least 8 characters'); return; }
    this.auth.changePassword(this.pw.next, this.pw.current).subscribe({
      next: () => { this.showPw.set(false); this.pw = { current: '', next: '' }; },
      error: (e) => this.pwErr.set(e?.error?.detail || 'Could not change password'),
    });
  }
}
