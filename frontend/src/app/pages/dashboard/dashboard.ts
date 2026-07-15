import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RenewalService } from '../../services/renewal.service';
import { DashboardFilters, DashboardResponse, FilterOptions, RankRow } from '../../models/renewal';
import { KpiCardComponent } from '../../components/kpi-card';
import { TrendChartComponent } from '../../components/trend-chart';
import { RankingListCardComponent, RankPick } from '../../components/ranking-list-card';
import { SplitCardComponent } from '../../components/split-card';
import { FilterBarComponent } from '../../components/filter-bar';
import { CalendarWidgetComponent } from '../../components/calendar-widget';
import { IconComponent } from '../../components/icon';
import { DashboardSkeletonComponent } from '../../components/dashboard-skeleton';
import { inr, inrFull, num } from '../../util/format';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    KpiCardComponent, TrendChartComponent, RankingListCardComponent,
    SplitCardComponent, FilterBarComponent, CalendarWidgetComponent, IconComponent,
    DashboardSkeletonComponent,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
  svc = inject(RenewalService);
  private router = inject(Router);

  options = signal<FilterOptions | null>(null);
  data = signal<DashboardResponse | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  inr = inr; inrFull = inrFull; num = num;

  // NOP = policy counts, Premium = rupee amounts. Only the top row of KPI cards
  // reacts to this; the bottom row stays fixed. Pure presentation — all values
  // are already in the KPI payload, so no reload is needed.
  viewBy = signal<'nop' | 'premium'>('nop');
  setViewBy(v: 'nop' | 'premium') { this.viewBy.set(v); }

  kpis = computed(() => this.data()?.kpis);
  kpisPrev = computed(() => this.data()?.kpisPrev);

  // The four top cards, rebuilt when the NOP/Premium toggle flips.
  topCards = computed(() => {
    const k = this.kpis();
    const p = this.kpisPrev();
    if (!k) return [];
    if (this.viewBy() === 'premium') {
      const pendingPrem = k.expectedPremiumGross - k.collectedPremiumGross;
      const prevPendingPrem = p ? p.expectedPremiumGross - p.collectedPremiumGross : null;
      const collPct = k.expectedPremiumGross
        ? Math.round((k.collectedPremiumGross / k.expectedPremiumGross) * 1000) / 10 : 0;
      const prevCollPct = p && p.expectedPremiumGross
        ? (p.collectedPremiumGross / p.expectedPremiumGross) * 100 : null;
      return [
        { label: 'Premium Due', value: this.inr(k.expectedPremiumGross), icon: 'clipboard-list', tone: 'indigo', sub: 'Net ' + this.inr(k.expectedPremiumNet) + ' (excl. tax)', delta: this.delta(k.expectedPremiumGross, p?.expectedPremiumGross), deltaUnit: '%' as const },
        { label: 'Premium Renewed', value: this.inr(k.collectedPremiumGross), icon: 'circle-check', tone: 'green', sub: 'Net ' + this.inr(k.collectedPremiumNet), delta: this.delta(k.collectedPremiumGross, p?.collectedPremiumGross), deltaUnit: '%' as const },
        { label: 'Premium Pending', value: this.inr(pendingPrem), icon: 'hourglass', tone: 'amber', sub: 'Not yet collected', delta: this.delta(pendingPrem, prevPendingPrem), deltaUnit: '%' as const },
        { label: 'Collection %', value: collPct + '%', icon: 'trending-up', tone: 'violet', sub: 'Collected ÷ Expected', delta: this.ptsDelta(collPct, prevCollPct), deltaUnit: 'pts' as const },
      ];
    }
    return [
      { label: 'Renewals Due', value: this.num(k.due), icon: 'clipboard-list', tone: 'indigo', sub: 'In selected range', delta: this.delta(k.due, p?.due), deltaUnit: '%' as const },
      { label: 'Renewed', value: this.num(k.renewed), icon: 'circle-check', tone: 'green', sub: k.renewalPct + '% renewal rate', delta: this.delta(k.renewed, p?.renewed), deltaUnit: '%' as const },
      { label: 'Pending ', value: this.num(k.pending), icon: 'hourglass', tone: 'amber', sub: 'Not yet renewed', delta: this.delta(k.pending, p?.pending), deltaUnit: '%' as const },
      { label: 'Renewal %', value: k.renewalPct + '%', icon: 'trending-up', tone: 'violet', sub: 'Renewed ÷ Due', delta: this.ptsDelta(k.renewalPct, p?.renewalPct), deltaUnit: 'pts' as const },
    ];
  });

  // % change vs the previous equal-length period (null hides the badge — e.g.
  // when the previous window had nothing, so a ratio would be meaningless).
  delta(cur: number, prev: number | undefined | null): number | null {
    if (prev === undefined || prev === null || prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  }

  // Percentage-POINT diff for values that are already percentages (Renewal %).
  ptsDelta(cur: number, prev: number | undefined | null): number | null {
    if (prev === undefined || prev === null) return null;
    return Math.round((cur - prev) * 10) / 10;
  }

  ngOnInit() {
    // Landing on the dashboard always starts fresh — clear any filters carried in
    // from a calendar-day click or the policy list.
    // NOTE: we deliberately DON'T fire a load here. The filter-bar emits its initial
    // state (with Product locked to Health) on init, which calls onFilterChange and
    // fires the first options + dashboard load already scoped to Health. Firing a
    // premature load here (without product) races that Health-scoped load and can
    // win, leaking non-health segments/rankings onto the dashboard.
    this.svc.filters.set({});
  }

  // Monotonic request ids so a slow response from an OLD filter can never overwrite
  // a newer one. A narrow window (e.g. Yesterday) returns before the slow default
  // Monthly scan, and without this guard the late Monthly response would "revert"
  // the dashboard back to the original.
  private loadSeq = 0;
  private optSeq = 0;

  // Refresh the dropdown option lists for the current filters (dependent filters).
  private refreshOptions(f: DashboardFilters) {
    const seq = ++this.optSeq;
    this.svc.getFilterOptions(f).subscribe({
      next: (o) => { if (seq === this.optSeq) this.options.set(o); },
      error: () => {},
    });
  }

  load(f: DashboardFilters) {
    this.loading.set(true);
    this.error.set(null);
    const filters = { ...f };
    this.svc.filters.set(filters);
    const seq = ++this.loadSeq;
    this.svc.getDashboard(filters).subscribe({
      next: (d) => { if (seq !== this.loadSeq) return; this.data.set(d); this.loading.set(false); },
      error: () => {
        if (seq !== this.loadSeq) return;
        this.error.set('Could not reach the API at localhost:3000. Is the backend running?');
        this.loading.set(false);
      },
    });
  }

  onFilterChange(f: DashboardFilters) { this.refreshOptions(f); this.load(f); }

  // Click a ranking row -> set that entity's filter and open its detail page
  // (KPIs + trend + policy table), scoped to exactly that entity (kept alongside
  // any filters already active on the dashboard).
  onRankSelect(p: RankPick) {
    this.openRanking(p.kind as 'company' | 'rm' | 'posp' | 'region' | 'branch', p.row);
  }

  openRanking(kind: 'company' | 'rm' | 'posp' | 'region' | 'branch', r: RankRow) {
    const f: DashboardFilters = { ...this.svc.filters() };
    if (kind === 'company') f.company = r.label;
    else if (kind === 'rm') f.rm = r.label;
    else if (kind === 'posp') f.posp = r.label;
    else if (kind === 'region') f.region = r.label;
    else if (kind === 'branch') {
      f.branch = r.label;
      // branch filter also needs its region so the Policy List's Branch dropdown shows it
      f.region = this.options()?.branches.find((b) => b.name === r.label)?.region ?? f.region;
    }
    this.svc.filters.set(f);
    // Context travels via in-memory service state — nothing readable/craftable in the URL.
    this.svc.entity.set({ kind, label: r.label });
    this.router.navigate(['/entity']);
  }
}
