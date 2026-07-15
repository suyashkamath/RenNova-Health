import { Component, OnInit, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { IstDatePipe } from '../../core/ist-date.pipe';
import { AuthService } from '../../services/auth.service';

const API = 'http://localhost:3000/api';

interface Profile {
  id: number; username: string; full_name: string | null; email: string | null;
  role_code: string; level: number; is_active: boolean; must_change_password: boolean;
  locked_until: string | null; last_login_at: string | null; manager_username: string | null;
  mobile: string | null; branch: string | null; company_user_id: number | null;
}
interface Role { id: number; role_code: string; role_name: string; level: number; }
interface Manager { id: number; username: string; full_name: string | null; role_code: string; }
interface DirHit { companyUserId: number; loginId: string; fullName: string; mobile: string; email: string; branch: string; region: string; userType: string; amId: number | null; }
interface Scope { scope_type: string; scope_value: string; }

@Component({
  selector: 'app-user-profiles',
  imports: [FormsModule, IstDatePipe],
  template: `
  <div class="page">
    <div class="crumb">USER MANAGEMENT <span>›</span> USER PROFILES</div>
    <header class="head">
      <div><h1>User Profiles</h1><p>Manage user roles, access types, and activation status.</p></div>
      <button class="btn add" (click)="openAdd()">+ Add Profile</button>
    </header>

    <div class="tiles">
      <div class="tile"><div class="tile__bar"></div><div class="tile__label">TOTAL PROFILES</div><div class="tile__num">{{ profiles().length }}</div></div>
      <div class="tile"><div class="tile__label">ACTIVE</div><div class="tile__num green">{{ activeCount() }}</div></div>
      <div class="tile"><div class="tile__label">INACTIVE</div><div class="tile__num">{{ profiles().length - activeCount() }}</div></div>
    </div>

    <div class="search"><span>🔍</span><input [(ngModel)]="query" placeholder="Search by username, mobile, branch, role…" /></div>

    <div class="tablewrap">
      <table>
        <thead><tr>
          <th>ID</th><th>USERNAME</th><th>FULL NAME</th><th>MOBILE</th><th>BRANCH</th>
          <th>ROLE</th><th>MANAGER</th><th>LAST LOGIN</th><th>STATUS</th><th>ACTIONS</th>
        </tr></thead>
        <tbody>
          @for (p of filtered(); track p.id) {
            <tr>
              <td>{{ p.id }}</td><td>{{ p.username }}</td><td>{{ p.full_name || '—' }}</td>
              <td>{{ p.mobile || '—' }}</td><td>{{ p.branch || '—' }}</td>
              <td><span class="rolebadge">{{ p.role_code }}</span></td>
              <td>{{ p.manager_username || '—' }}</td>
              <td>{{ p.last_login_at | istDate }}</td>
              <td>@if (p.is_active) { <span class="pill ok">Active</span> } @else { <span class="pill off">Inactive</span> }</td>
              <td class="act">
                <button class="icon" title="Edit / scopes" (click)="openEdit(p)">✎</button>
                @if (canReset(p)) { <button class="icon" title="Reset password" (click)="openReset(p)">🔑</button> }
                <button class="icon danger" [title]="p.is_active ? 'Disable' : 'Disabled'" [disabled]="!p.is_active" (click)="disable(p)">⊘</button>
              </td>
            </tr>
          }
          @if (!filtered().length) { <tr><td colspan="10" class="empty">No profiles match.</td></tr> }
        </tbody>
      </table>
    </div>
  </div>

  <!-- Add Profile modal -->
  @if (showAdd()) {
    <div class="modal" (click)="showAdd.set(false)"><div class="sheet" (click)="$event.stopPropagation()">
      <h2>Add User Profile</h2><div class="rule"></div>

      <label class="lbl">SEARCH USER (FROM PROBUS LIVE DB) <b>*</b></label>
      <div class="searchbox">
        <input [(ngModel)]="dirQuery" (ngModelChange)="onSearch($event)" placeholder="Type username or mobile no…" />
        @if (dirHits().length) {
          <div class="dropdown">
            @for (h of dirHits(); track h.companyUserId) {
              <div class="hit" (click)="pick(h)">
                <b>{{ h.fullName }}</b> <span>{{ h.loginId }} · {{ h.mobile }} · {{ h.branch }}</span>
              </div>
            }
          </div>
        }
      </div>

      <label class="lbl">USERNAME <b>*</b></label>
      <input [(ngModel)]="form.username" placeholder="Login handle" />

      <label class="lbl">ROLE <b>*</b></label>
      <select [(ngModel)]="form.roleCode">@for (r of assignableRoles(); track r.role_code) { <option [value]="r.role_code">{{ r.role_name }}</option> }</select>

      <label class="lbl">MANAGER <b>*</b></label>
      <select [(ngModel)]="form.managerId">
        <option [ngValue]="null">— select a manager —</option>
        @for (m of managers(); track m.id) { <option [ngValue]="m.id">{{ m.full_name || m.username }} ({{ m.role_code }})</option> }
      </select>

      <label class="check"><input type="checkbox" [(ngModel)]="form.generateTempPassword" /> Generate temporary password</label>
      <label class="lbl">PASSWORD <b>*</b></label>
      <input type="text" [(ngModel)]="form.password" [disabled]="form.generateTempPassword" placeholder="Set a password" />
      <p class="hint">A temp password (if generated) will be shown after saving — share it with the user.</p>

      @if (addErr()) { <div class="err">{{ addErr() }}</div> }
      <div class="row-end"><button class="btn ghost" (click)="showAdd.set(false)">Cancel</button><button class="btn add" (click)="save()">Save</button></div>
    </div></div>
  }

  @if (tempPassword()) {
    <div class="modal" (click)="tempPassword.set('')"><div class="sheet" (click)="$event.stopPropagation()">
      <h2>Temporary password</h2>
      <p>Share this once with <b>{{ tempFor() }}</b>. They must change it on first login.</p>
      <div class="tempbox">{{ tempPassword() }}</div>
      <div class="row-end"><button class="btn add" (click)="tempPassword.set('')">Done</button></div>
    </div></div>
  }

  <!-- Reset subordinate password modal -->
  @if (resetting(); as r) {
    <div class="modal" (click)="resetting.set(null)"><div class="sheet" (click)="$event.stopPropagation()">
      <h2>Reset password</h2>
      <p>Set a new password for <b>{{ r.full_name || r.username }}</b> <span class="rolebadge">{{ r.role_code }}</span></p>
      <div class="rule"></div>

      <label class="check"><input type="checkbox" [(ngModel)]="resetForm.generateTemp" /> Generate a temporary password instead</label>
      <label class="lbl">NEW PASSWORD <b>*</b></label>
      <input type="text" [(ngModel)]="resetForm.password" [disabled]="resetForm.generateTemp" placeholder="Min 8 characters" />
      <label class="check"><input type="checkbox" [(ngModel)]="resetForm.mustChange" /> Force user to change it on next login</label>
      <p class="hint">The user is signed out everywhere on reset. A generated temp password is shown once after saving.</p>

      @if (resetErr()) { <div class="err">{{ resetErr() }}</div> }
      <div class="row-end"><button class="btn ghost" (click)="resetting.set(null)">Cancel</button><button class="btn add" (click)="saveReset()">Reset</button></div>
    </div></div>
  }

  @if (resetOkFor()) {
    <div class="modal" (click)="resetOkFor.set('')"><div class="sheet" (click)="$event.stopPropagation()">
      <h2>Password updated</h2>
      <p>The password for <b>{{ resetOkFor() }}</b> has been set. They have been signed out and must sign in with the new password.</p>
      <div class="row-end"><button class="btn add" (click)="resetOkFor.set('')">Done</button></div>
    </div></div>
  }

  <!-- Edit / scopes modal -->
  @if (editing(); as e) {
    <div class="modal" (click)="editing.set(null)"><div class="sheet" (click)="$event.stopPropagation()">
      <h2>{{ e.full_name || e.username }} <span class="rolebadge">{{ e.role_code }}</span></h2>
      <label class="lbl">ROLE</label>
      <select [(ngModel)]="editRole">@for (r of assignableRoles(); track r.role_code) { <option [value]="r.role_code">{{ r.role_name }}</option> }</select>
      <h3>Data scopes</h3>
      <div class="row">
        <select [(ngModel)]="newScope.type"><option value="REGION">Region</option><option value="BRANCH">Branch</option><option value="AM">AM Id</option></select>
        @if (newScope.type === 'REGION') { <select [(ngModel)]="newScope.value"><option value="">— region —</option>@for (r of regions(); track r) { <option [value]="r">{{ r }}</option> }</select> }
        @else if (newScope.type === 'BRANCH') { <select [(ngModel)]="newScope.value"><option value="">— branch —</option>@for (b of branches(); track b.name) { <option [value]="b.name">{{ b.name }}</option> }</select> }
        @else { <input [(ngModel)]="newScope.value" placeholder="AM Id" /> }
        <button class="btn sm" (click)="addScope()" [disabled]="!newScope.value">Add</button>
      </div>
      <div class="chips">
        @for (s of draftScopes(); track s.scope_type + s.scope_value) { <span class="chip">{{ s.scope_type }}:{{ s.scope_value }} <a (click)="removeScope(s)">×</a></span> }
        @if (!draftScopes().length) { <span class="muted">No scopes = sees nothing (fail-closed).</span> }
      </div>
      @if (editErr()) { <div class="err">{{ editErr() }}</div> }
      <div class="row-end"><button class="btn ghost" (click)="editing.set(null)">Cancel</button><button class="btn add" (click)="saveEdit()">Save</button></div>
    </div></div>
  }
  `,
  styles: [`
    :host { --navy:#0f2440; --ink:#2a3855; --muted:#6b7a99; --line:#e6ecf5; --teal:#0ea5b7; --accentbg:#eef0fe; --indigo:#6366f1; }
    .page { padding:22px 28px; background:#eef3fb; min-height:100vh; font-family:system-ui,sans-serif; color:var(--ink); }
    .crumb { font-size:12px; font-weight:800; letter-spacing:.05em; color:var(--teal); margin-bottom:4px; } .crumb span{color:var(--muted);margin:0 4px}
    .head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
    h1 { margin:0; font-size:30px; color:var(--navy); font-weight:800; } .head p { margin:4px 0 0; color:var(--muted); font-size:14px; }
    .btn { border:0; border-radius:10px; padding:11px 18px; font-weight:800; font-size:13px; cursor:pointer; background:var(--indigo); color:#fff; }
    .btn.add { background:var(--teal); box-shadow:0 4px 14px rgba(14,165,183,.35); } .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--ink)} .btn.sm{padding:8px 12px} .btn:disabled{opacity:.5}
    .tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:16px; }
    .tile { background:#fff; border-radius:14px; padding:18px 20px; position:relative; overflow:hidden; box-shadow:0 1px 3px rgba(16,30,61,.05); }
    .tile__bar { position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,var(--teal),var(--indigo)); }
    .tile__label { font-size:12px; font-weight:800; letter-spacing:.05em; color:var(--muted); } .tile__num { font-size:34px; font-weight:800; color:var(--navy); margin-top:4px; } .tile__num.green{color:#1f9d55}
    .search { display:flex; align-items:center; gap:8px; background:#fff; border:1px solid var(--line); border-radius:12px; padding:11px 14px; margin-bottom:14px; max-width:520px; }
    .search input { border:0; outline:0; width:100%; font-size:14px; background:transparent; color:var(--ink); }
    .tablewrap { background:#fff; border-radius:14px; overflow:hidden; box-shadow:0 1px 3px rgba(16,30,61,.05); overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:900px; }
    thead th { background:var(--navy); color:#fff; text-align:left; padding:14px 16px; font-size:11.5px; letter-spacing:.03em; font-weight:800; }
    tbody td { padding:16px; border-bottom:1px solid var(--line); color:var(--ink); }
    tbody tr:hover { background:#f7f9fd; } .empty { text-align:center; color:var(--muted); padding:28px; }
    .rolebadge { background:var(--accentbg); color:var(--indigo); padding:3px 10px; border-radius:7px; font-size:11px; font-weight:800; }
    .pill { padding:4px 14px; border-radius:20px; font-size:12px; font-weight:800; } .pill.ok{background:#e3f6ea;color:#1f9d55} .pill.off{background:#f1f2f6;color:#8792a8}
    .act { white-space:nowrap; } .icon { border:1px solid var(--line); background:#fff; border-radius:8px; width:32px; height:32px; cursor:pointer; margin-right:6px; color:var(--muted); }
    .icon.danger { color:#d6335c; } .icon:disabled{opacity:.4;cursor:default}
    .modal { position:fixed; inset:0; background:rgba(15,30,61,.45); display:grid; place-items:center; z-index:50; padding:20px; }
    .sheet { background:#fff; border-radius:18px; padding:26px 28px; width:520px; max-width:94vw; max-height:90vh; overflow:auto; box-shadow:0 24px 70px rgba(0,0,0,.3); }
    .sheet h2 { color:var(--navy); font-size:22px; margin:0 0 8px; } .rule{height:2px;background:linear-gradient(90deg,var(--teal),transparent);margin-bottom:14px}
    .lbl { display:block; font-size:12px; font-weight:800; letter-spacing:.04em; color:var(--navy); margin:14px 0 6px; } .lbl b{color:#d6335c}
    .sheet input, .sheet select { width:100%; box-sizing:border-box; padding:12px 14px; border:1px solid var(--line); border-radius:12px; font-size:14px; background:#f8fafd; color:var(--ink); }
    .sheet input:disabled { opacity:.55; }
    .searchbox { position:relative; } .dropdown { position:absolute; z-index:5; left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:12px; margin-top:4px; max-height:230px; overflow:auto; box-shadow:0 12px 30px rgba(0,0,0,.12); }
    .hit { padding:10px 14px; cursor:pointer; font-size:13px; } .hit:hover{background:#f2f6fd} .hit b{color:var(--navy)} .hit span{color:var(--muted);display:block;font-size:12px}
    .check { display:flex; align-items:center; gap:8px; margin:16px 0 4px; font-size:14px; color:var(--ink); } .check input{width:auto}
    .hint { color:var(--muted); font-size:12.5px; margin:6px 0 0; }
    .row { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; } .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .chip { background:#eef2fb; padding:3px 10px; border-radius:7px; font-size:11px; } .chip a{cursor:pointer;color:#d6335c;margin-left:4px} .muted{color:var(--muted);font-size:12px}
    .row-end { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
    .err { background:#fdecef; color:#d6335c; padding:9px 12px; border-radius:9px; margin-top:12px; font-size:12.5px; }
    .tempbox { background:#e3f6ea; color:#1f7a44; font-weight:800; font-size:18px; padding:14px; border-radius:10px; text-align:center; letter-spacing:.03em; margin:8px 0; }
    h3 { color:var(--navy); font-size:13px; margin:16px 0 6px; }
  `],
})
export class UserProfilesComponent implements OnInit {
  readonly profiles = signal<Profile[]>([]);
  readonly roles = signal<Role[]>([]);
  readonly managers = signal<Manager[]>([]);
  readonly regions = signal<string[]>([]);
  readonly branches = signal<{ name: string; region: string }[]>([]);
  readonly dirHits = signal<DirHit[]>([]);
  readonly showAdd = signal(false); readonly addErr = signal('');
  readonly tempPassword = signal(''); readonly tempFor = signal('');
  readonly editing = signal<Profile | null>(null); readonly draftScopes = signal<Scope[]>([]);
  readonly editErr = signal('');
  readonly resetting = signal<Profile | null>(null); readonly resetErr = signal(''); readonly resetOkFor = signal('');

  query = ''; dirQuery = ''; editRole = '';
  form = { username: '', fullName: '', email: '', roleCode: '', managerId: null as number | null, companyUserId: null as number | null, generateTempPassword: true, password: '' };
  resetForm = { password: '', generateTemp: false, mustChange: false };
  newScope = { type: 'REGION', value: '' };
  private searchTimer: any;

  readonly activeCount = computed(() => this.profiles().filter((p) => p.is_active).length);
  readonly filtered = computed(() => {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.profiles();
    return this.profiles().filter((p) =>
      [p.username, p.full_name, p.mobile, p.branch, p.role_code, p.manager_username]
        .some((v) => (v || '').toLowerCase().includes(q)));
  });

  constructor(private http: HttpClient, private auth: AuthService) {}

  ngOnInit(): void {
    this.load();
    this.http.get<Role[]>(`${API}/roles`).subscribe((r) => { this.roles.set(r); this.form.roleCode = this.assignableRoles()[0]?.role_code || ''; }, () => {});
    this.http.get<Manager[]>(`${API}/managers`).subscribe((m) => this.managers.set(m), () => {});
    this.http.get<{ regions: string[]; branches: { name: string; region: string }[] }>(`${API}/regions`).subscribe((r) => { this.regions.set(r.regions); this.branches.set(r.branches); }, () => {});
  }
  load(): void { this.http.get<Profile[]>(`${API}/users`).subscribe((p) => this.profiles.set(p)); }
  assignableRoles(): Role[] { const l = this.auth.user()?.level ?? 99; return this.roles().filter((r) => r.level > l); }

  openAdd(): void {
    this.addErr.set(''); this.dirQuery = ''; this.dirHits.set([]);
    this.form = { username: '', fullName: '', email: '', roleCode: this.assignableRoles()[0]?.role_code || '', managerId: this.auth.user()?.id ?? null, companyUserId: null, generateTempPassword: true, password: '' };
    this.showAdd.set(true);
  }
  onSearch(term: string): void {
    clearTimeout(this.searchTimer);
    if ((term || '').trim().length < 2) { this.dirHits.set([]); return; }
    this.searchTimer = setTimeout(() => {
      this.http.get<DirHit[]>(`${API}/directory/search`, { params: { q_: term.trim() } }).subscribe((h) => this.dirHits.set(h), () => this.dirHits.set([]));
    }, 250);
  }
  pick(h: DirHit): void {
    this.form.username = h.loginId; this.form.fullName = h.fullName; this.form.email = h.email; this.form.companyUserId = h.companyUserId;
    this.dirQuery = `${h.fullName} (${h.loginId})`; this.dirHits.set([]);
  }
  save(): void {
    this.addErr.set('');
    if (!this.form.username || !this.form.roleCode) { this.addErr.set('Username and role are required'); return; }
    this.http.post<{ id: number; tempPassword: string | null }>(`${API}/users`, this.form).subscribe({
      next: (r) => { this.showAdd.set(false); if (r.tempPassword) { this.tempPassword.set(r.tempPassword); this.tempFor.set(this.form.username); } this.load(); },
      error: (e) => this.addErr.set(e?.error?.detail || 'Could not create profile'),
    });
  }

  openEdit(p: Profile): void {
    this.editing.set(p); this.editRole = p.role_code; this.editErr.set('');
    this.http.get<Scope[]>(`${API}/users/${p.id}/scopes`).subscribe((s) => this.draftScopes.set([...s]));
  }
  addScope(): void { const s = { scope_type: this.newScope.type, scope_value: this.newScope.value.trim() };
    if (s.scope_value && !this.draftScopes().some((x) => x.scope_type === s.scope_type && x.scope_value === s.scope_value)) this.draftScopes.update((d) => [...d, s]); this.newScope.value = ''; }
  removeScope(s: Scope): void { this.draftScopes.update((d) => d.filter((x) => x !== s)); }
  saveEdit(): void {
    const p = this.editing(); if (!p) return;
    this.editErr.set('');
    const scopes = this.draftScopes().map((s) => ({ scopeType: s.scope_type, scopeValue: s.scope_value }));
    const saveScopes = () =>
      this.http.put(`${API}/users/${p.id}/scopes`, { scopes }).subscribe({
        next: () => { this.editing.set(null); this.load(); },
        error: (e) => this.editErr.set(e?.error?.detail || 'Could not save scopes'),
      });
    // Role changed → persist it first (PUT /users/{id}), then the scopes.
    if (this.editRole && this.editRole !== p.role_code) {
      this.http.put(`${API}/users/${p.id}`, { roleCode: this.editRole }).subscribe({
        next: saveScopes,
        error: (e) => this.editErr.set(e?.error?.detail || 'Could not change role'),
      });
    } else {
      saveScopes();
    }
  }
  disable(p: Profile): void { if (confirm(`Disable ${p.username}?`)) this.http.post(`${API}/users/${p.id}/deactivate`, {}).subscribe(() => this.load()); }

  // Only Super Admin/Admin may reset, and only for users strictly below their own role
  // level (the server also enforces this, plus the subtree restriction).
  canReset(p: Profile): boolean { const l = this.auth.user()?.level ?? 99; return l <= 3 && p.level > l; }
  openReset(p: Profile): void { this.resetting.set(p); this.resetErr.set(''); this.resetForm = { password: '', generateTemp: false, mustChange: false }; }
  saveReset(): void {
    const p = this.resetting(); if (!p) return;
    this.resetErr.set('');
    const body: { password?: string; mustChangePassword: boolean } = { mustChangePassword: this.resetForm.mustChange };
    if (!this.resetForm.generateTemp) {
      if (this.resetForm.password.length < 8) { this.resetErr.set('Password must be at least 8 characters'); return; }
      body.password = this.resetForm.password;
    }
    this.http.post<{ tempPassword: string | null }>(`${API}/users/${p.id}/reset-password`, body).subscribe({
      next: (r) => {
        this.resetting.set(null);
        if (r.tempPassword) { this.tempPassword.set(r.tempPassword); this.tempFor.set(p.username); }
        else { this.resetOkFor.set(p.full_name || p.username); }
        this.load();
      },
      error: (e) => this.resetErr.set(e?.error?.detail || 'Could not reset password'),
    });
  }
}
