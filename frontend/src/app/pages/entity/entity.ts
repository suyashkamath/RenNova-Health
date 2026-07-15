import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RenewalService } from '../../services/renewal.service';
import { DashboardFilters, DashboardResponse, RankRow } from '../../models/renewal';
import { KpiCardComponent } from '../../components/kpi-card';
import { TrendChartComponent } from '../../components/trend-chart';
import { IconComponent } from '../../components/icon';
import { PerfGridComponent } from '../../components/perf-grid';
import { EntitySkeletonComponent } from '../../components/entity-skeleton';
import { inr, inrFull, num, fmtDate } from '../../util/format';

type Kind = 'company' | 'rm' | 'posp' | 'region' | 'branch';

const KIND_LABELS: Record<string, string> = {
  company: 'Insurer', rm: 'RM', posp: 'POSP', region: 'Region', branch: 'Branch',
};

@Component({
  selector: 'app-entity',
  standalone: true,
  imports: [KpiCardComponent, TrendChartComponent, IconComponent, PerfGridComponent, EntitySkeletonComponent],
  templateUrl: './entity.html',
  styleUrl: './entity.css',
})
export class EntityComponent {
  private svc = inject(RenewalService);
  private router = inject(Router);

  kind = signal<string>('');
  label = signal<string>('');
  data = signal<DashboardResponse | null>(null);
  error = signal<string | null>(null);
  loading = signal<boolean>(true);

  inr = inr; inrFull = inrFull; num = num; fmtDate = fmtDate;

  kpis = computed(() => this.data()?.kpis);
  // Policy total equals "Renewals Due" (same filter window) — reuse it instead of
  // fetching the paginated policy list, which is heavy on the server.
  policyCount = computed(() => this.kpis()?.due ?? 0);
  kindLabel = computed(() => KIND_LABELS[this.kind()] || this.kind());
  period = computed(() => {
    const f = this.svc.filters();
    return f.from && f.to ? `${fmtDate(f.from)} – ${fmtDate(f.to)}` : '';
  });
  // Entity-scoped filters for the standalone trend chart (it applies its own
  // 12-month lookback and ignores the date range).
  trendFilters = computed(() => this.svc.filters());

  ngOnInit() { this.enter(); }

  /** Read the drill-down context from IN-MEMORY service state (never the URL —
   * nothing about the report is craftable via a query string). No context (hard
   * refresh, hand-typed /entity) → back to the dashboard. */
  private enter() {
    const ctx = this.svc.entity();
    if (!ctx) { this.router.navigate(['/']); return; }
    const kind = ctx.kind as Kind;
    const label = ctx.label;
    this.kind.set(kind);
    this.label.set(label);

    // Enforce the selected ranking dimension on top of the active filters.
    const f: DashboardFilters = { ...this.svc.filters() };
    if (kind === 'company') f.company = label;
    else if (kind === 'rm') f.rm = label;
    else if (kind === 'posp') f.posp = label;
    else if (kind === 'region') f.region = label;
    else if (kind === 'branch') f.branch = label;
    this.svc.filters.set(f);
    this.loadDashboard();
  }

  private filters(): DashboardFilters { return { ...this.svc.filters() }; }

  // Drop stale responses so a slower earlier request can't overwrite a newer one.
  private loadSeq = 0;

  loadDashboard() {
    const seq = ++this.loadSeq;
    // Each navigation is a different entity — drop stale data and show the
    // skeleton instead of flashing the previous entity's numbers.
    this.data.set(null);
    this.error.set(null);
    this.loading.set(true);
    this.svc.getDashboard(this.filters()).subscribe({
      next: (d) => { if (seq === this.loadSeq) { this.data.set(d); this.loading.set(false); } },
      error: () => {
        if (seq === this.loadSeq) {
          this.error.set('Could not reach the API at localhost:3000. Is the backend running?');
          this.loading.set(false);
        }
      },
    });
  }

  // Drill chain: Region → Branch → RM → POSP.
  openBranch(r: RankRow) { this.drill('branch', r); }
  openRm(r: RankRow) { this.drill('rm', r); }
  openPosp(r: RankRow) { this.drill('posp', r); }

  private drill(kind: 'posp' | 'rm' | 'branch', r: RankRow) {
    const f: DashboardFilters = { ...this.svc.filters() };
    if (kind === 'posp') f.posp = r.label;
    else if (kind === 'rm') f.rm = r.label;
    else f.branch = r.label;
    this.svc.filters.set(f);
    this.svc.entity.set({ kind, label: r.label });
    // Same route, new in-memory context — re-enter directly (no URL change).
    this.enter();
  }

  goBack() { this.router.navigate(['/']); }
  openFullList() { this.router.navigate(['/policies']); }

  exportCsv() { this.svc.downloadCsv(this.svc.filters()); }
}
