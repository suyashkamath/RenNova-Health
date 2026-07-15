import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DashboardFilters, FilterOptions } from '../models/renewal';
import { IconComponent } from './icon';
import { DateRangePickerComponent } from './date-range-picker';
import { AutocompleteComponent } from './autocomplete';

/** product_id for Health (adapter master map). The dashboard is scoped to Health only. */
const HEALTH_PRODUCT_ID = '1';

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [FormsModule, IconComponent, DateRangePickerComponent, AutocompleteComponent],
  template: `
    <div class="bar">
      <div class="bar__head">
        <div class="bar__title">
          <app-icon name="filter" [size]="22" />
          <span>Dashboard Filters</span>
        </div>
        <label class="viewby">
          <select class="viewby__select" [value]="viewBy()" (change)="viewByChange.emit($any($event.target).value)">
            <option value="nop">View by: NOP</option>
            <option value="premium">View by: Premium</option>
          </select>
          <app-icon class="viewby__chev" name="chevron-down" [size]="16" />
        </label>
      </div>

      <div class="f">
        <label>Time Period</label>
        <select [(ngModel)]="preset" (change)="onPreset()">
          <option value="yesterday">Yesterday</option>
          <option value="weekly">Weekly</option>
          <option value="prevMonth">Previous Month</option>
          <option value="monthly">Current Month</option>
          <option value="nextMonth">Next Month</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      @if (preset === 'custom') {
        <div class="f f--range">
          <label>Date Range</label>
          <app-date-range-picker
            [from]="model.from || ''" [to]="model.to || ''"
            (rangeChange)="onRange($event)" />
        </div>
      }
      <div class="f">
        <label>Company</label>
        <app-autocomplete [options]="options()?.companies || []" [value]="model.company || ''"
          placeholder="All" (valueChange)="model.company = $event; emit()" />
      </div>
      <div class="f">
        <label>Product <span class="lock"> locked</span></label>
        <select [(ngModel)]="model.product" class="is-locked" disabled title="This dashboard is scoped to Health only">
          <option value="1">Health</option>
        </select>
      </div>
      <div class="f">
        <label>Sub Product</label>
        <select [(ngModel)]="model.subProduct" (change)="emit()">
          <option value="">All</option>
          @for (s of visibleSubProducts(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }
        </select>
      </div>
      <div class="f">
        <label>Region</label>
        <app-autocomplete [options]="options()?.regions || []" [value]="model.region || ''"
          placeholder="All" (valueChange)="model.region = $event; onRegionChange()" />
      </div>
      <div class="f">
        <label>Branch</label>
        <app-autocomplete [options]="visibleBranchNames()" [value]="model.branch || ''"
          [disabled]="!model.region" [placeholder]="model.region ? 'All' : 'Select a region first'"
          (valueChange)="model.branch = $event; emit()" />
      </div>
      <div class="f">
        <label>RM</label>
        <app-autocomplete [options]="options()?.rms || []" [value]="model.rm || ''"
          placeholder="All" (valueChange)="model.rm = $event; emit()" />
      </div>
      <div class="f">
        <label>Platform</label>
        <select [(ngModel)]="model.platform" (change)="emit()">
          <option value="">All</option>
          @for (p of options()?.platforms || []; track p) { <option [value]="p">{{ p }}</option> }
        </select>
      </div>
      <div class="f">
        <label>Source by</label>
        <select [(ngModel)]="model.channel" (change)="emit()">
          <option value="">All</option>
          <option value="RM">RM Assisted</option>
          <option value="CUSTOMER">Customer Direct</option>
        </select>
      </div>
      <div class="f">
        <label>Status</label>
        <select [(ngModel)]="model.isRenewed" (change)="emit()">
          <option value="">All</option>
          <option value="1">Renewed</option>
          <option value="0">Pending</option>
        </select>
      </div>
      <div class="foot">
        <span class="note">ⓘ After changing a filter, give it a few seconds — it runs on lakhs of live records.</span>
        <button class="reset" (click)="reset()">Reset</button>
      </div>
    </div>
  `,
  styles: [`
    .bar { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:14px 16px; align-items:end; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:22px 24px 20px; box-shadow:var(--shadow); }
    .bar__head { grid-column:1 / -1; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding-bottom:16px; margin-bottom:0; border-bottom:1px solid var(--border); }
    .bar__title { display:flex; align-items:center; gap:10px; color:var(--accent); font-size:17px; font-weight:800; }

    .viewby { position:relative; display:inline-flex; align-items:center; }
    .viewby__select { appearance:none; -webkit-appearance:none; background:var(--card); color:var(--accent); border:1px solid var(--accent); border-radius:10px; height:39px; padding:0 38px 0 14px; font-size:13px; font-weight:750; cursor:pointer; box-shadow:var(--shadow); width:auto; transition:border-color .16s ease, box-shadow .16s ease, background .16s ease; }
    .viewby__select:hover { background:#f5f3ff; }
    .viewby__select:focus-visible { outline:none; box-shadow:0 0 0 3px rgba(99,102,241,.22); }
    .viewby__chev { position:absolute; right:12px; color:var(--accent); pointer-events:none; }
    .f { display:flex; flex-direction:column; gap:7px; min-width:0; }
    .f--range { grid-column:span 2; }
    @media (max-width:980px) { .f--range { grid-column:span 2; } }
    @media (max-width:720px) { .f--range { grid-column:1; } }
    label { font-size:10px; font-weight:850; text-transform:uppercase; letter-spacing:.05em; color:var(--muted-soft,#9ca3af); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    input, select { width:100%; box-sizing:border-box; height:39px; border:1px solid var(--border-strong); border-radius:9px; padding:0 12px; font-size:13px; font-weight:650; background:#f9fafb; color:#374151; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease; }
    select { text-overflow:ellipsis; cursor:pointer; }
    select.is-locked, select:disabled { cursor:not-allowed; background:#eef2ff; border-color:#c7d2fe; color:var(--accent); font-weight:750; opacity:1; }
    select.is-locked:hover { background:#eef2ff; border-color:#c7d2fe; }
    .lock { font-size:9px; font-weight:800; color:var(--accent); letter-spacing:.02em; margin-left:4px; text-transform:none; }
    input:hover, select:hover { background:#fff; border-color:#d1d5db; }
    input:focus, select:focus { outline:0; background:#fff; border-color:var(--accent); box-shadow:0 0 0 3px rgba(99,102,241,.12); }
    .foot { grid-column:1 / -1; display:flex; align-items:center; justify-content:space-between; gap:14px; padding-top:14px; }
    .reset { height:40px; flex:none; border:1px solid var(--border-strong); background:#f9fafb; color:var(--muted); border-radius:9px; padding:0 18px; font-size:13px; font-weight:750; cursor:pointer; transition:background .15s ease, color .15s ease, border-color .15s ease; }
    .reset:hover { color:var(--accent); border-color:#c7d2fe; background:var(--accent-soft); }
    .note { margin:0; font-size:12px; color:var(--muted); line-height:1.4; }
    @media (max-width:1400px) {
      .bar { grid-template-columns:repeat(4, minmax(0, 1fr)); }
    }
    @media (max-width:980px) {
      .bar { grid-template-columns:repeat(2, minmax(0, 1fr)); padding:26px; }
    }
    @media (max-width:720px) {
      .bar { padding:16px; grid-template-columns:1fr; }
      .bar__head { padding-bottom:16px; }
      .bar__title { font-size:18px; }
      .foot { flex-direction:column; align-items:stretch; }
    }
  `],
})
export class FilterBarComponent {
  options = input<FilterOptions | null>(null);
  initial = input<DashboardFilters>({});
  filtersChange = output<DashboardFilters>();

  // NOP (counts) vs Premium (₹) — presentation toggle owned by the dashboard.
  viewBy = input<'nop' | 'premium'>('nop');
  viewByChange = output<'nop' | 'premium'>();

  model: DashboardFilters = {};

  // Time-period preset driving from/to. 'custom' = hand-picked in the range picker.
  // Financial year = April–March (see onPreset). The preset is also emitted so the
  // backend can compute the period-aligned "previous" window + the trend chart split.
  preset: 'yesterday' | 'weekly' | 'prevMonth' | 'monthly' | 'nextMonth' | 'quarterly' | 'yearly' | 'custom' = 'monthly';

  ngOnInit() {
    // Start every dropdown on its "All" option (empty string) — an undefined model
    // value matches no <option> and would render the box blank. Any incoming filters
    // (e.g. a bucket click carrying isRenewed) override these defaults.
    this.model = { ...this.baseModel(), ...this.initial() };
    this.model.product = HEALTH_PRODUCT_ID;  // dashboard is Health-only; always locked on
    // Carried-in dates (calendar-day click etc.) that differ from the default
    // monthly cycle mean the window was hand-set -> show the preset as Custom.
    const w = this.monthlyWindow();
    if (this.model.from !== w.from || this.model.to !== w.to) this.preset = 'custom';
    this.emit();
  }

  // The blank/default filter state: current monthly window + every dropdown = All ('').
  private baseModel(): DashboardFilters {
    const w = this.monthlyWindow();
    return {
      from: w.from, to: w.to,
      company: '', product: HEALTH_PRODUCT_ID, subProduct: '', region: '', branch: '',
      rm: '', posp: '', platform: '', channel: '', isRenewed: '',
    };
  }

  // Sub-products shown depend on the chosen Product (cascade); All = every sub-product (deduped).
  visibleSubProducts() {
    const subs = this.options()?.subProducts || [];
    const pid = this.model.product;
    const list = pid ? subs.filter((s) => s.productId === pid) : subs;
    const seen = new Set<string>();
    return list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  }

  // Preset -> CURRENT-period expiry window (financial year = April–March). All are
  // date-BOUNDED, so each choice fires ONE bounded query. The backend derives the
  // matching "previous" window + trend split from the emitted preset:
  //   yesterday  -> just yesterday
  //   weekly     -> calendar block of the month (1-7 / 8-14 / 15-21 / 22-end)
  //   prevMonth  -> the previous calendar month (1st .. last day)
  //   monthly    -> the current calendar month (1st .. last day)
  //   nextMonth  -> the next calendar month (the upcoming renewal book)
  //   quarterly  -> the current FISCAL quarter (Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar)
  //   yearly     -> the current financial year (1 Apr .. 31 Mar)
  //   custom     -> use the range picker (dates kept as-is)
  onPreset() {
    if (this.preset === 'custom') return;  // keep current dates; user picks in the calendar
    const t = new Date();
    const y = t.getFullYear(), m = t.getMonth(), day = t.getDate();
    const monthEnd = (yy: number, mm: number) => new Date(yy, mm + 1, 0);  // last day of month mm
    let from: Date, to: Date;
    if (this.preset === 'yesterday') {
      from = to = new Date(y, m, day - 1);
    } else if (this.preset === 'prevMonth') {
      from = new Date(y, m - 1, 1);
      to = monthEnd(y, m - 1);
    } else if (this.preset === 'nextMonth') {
      from = new Date(y, m + 1, 1);
      to = monthEnd(y, m + 1);
    } else if (this.preset === 'weekly') {
      const starts = [1, 8, 15, 22];
      const bs = Math.max(...starts.filter((s) => s <= day));
      from = new Date(y, m, bs);
      to = bs === 22 ? monthEnd(y, m) : new Date(y, m, bs + 6);
    } else if (this.preset === 'quarterly') {
      const fyYear = m >= 3 ? y : y - 1;                 // financial year starts in April (m=3)
      const qStart = Math.floor(((y - fyYear) * 12 + (m - 3)) / 3) * 3;  // months since 1 Apr
      from = new Date(fyYear, 3 + qStart, 1);
      to = monthEnd(fyYear, 3 + qStart + 2);
    } else if (this.preset === 'yearly') {
      const fyYear = m >= 3 ? y : y - 1;
      from = new Date(fyYear, 3, 1);        // 1 April
      to = monthEnd(fyYear + 1, 2);         // 31 March next year
    } else {
      const w = this.monthlyWindow();
      this.model.from = w.from; this.model.to = w.to; this.emit(); return;
    }
    this.model.from = this.iso(from); this.model.to = this.iso(to);
    this.emit();
  }

  // Range picker emits its final selection on Apply/Clear only (never mid-drag),
  // so this fires exactly one query — no server hit while sliding across days.
  onRange(r: { from: string; to: string }) {
    this.model.from = r.from;
    this.model.to = r.to;
    this.preset = 'custom';  // hand-picked dates override the preset
    this.emit();
  }

  onProductChange() {
    this.model.subProduct = '';  // reset sub-product when product changes
    this.emit();
  }

  // Branch cascades from Region: only that region's branches, and disabled until a region is picked.
  visibleBranches() {
    const reg = this.model.region;
    return reg ? (this.options()?.branches || []).filter((b) => b.region === reg) : [];
  }

  visibleBranchNames(): string[] {
    return this.visibleBranches().map((b) => b.name);
  }

  onRegionChange() {
    this.model.branch = '';  // clear branch when region changes
    this.emit();
  }

  // Default window = the current CALENDAR month [1st .. last day]. Computed from the
  // current month, so it auto-advances on the 1st. e.g. any day in July -> 1 .. 31 July.
  // (Kept in sync with backend queries.monthly_window.)
  private monthlyWindow(): { from: string; to: string } {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1);      // 1st of the current month
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);    // last day of the current month
    return { from: this.iso(from), to: this.iso(to) };
  }

  // Local yyyy-mm-dd (avoids the UTC shift toISOString would cause).
  private iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  emit() { this.filtersChange.emit({ ...this.model, preset: this.preset }); }

  reset() {
    this.model = this.baseModel();
    this.preset = 'monthly';
    this.emit();
  }
}
