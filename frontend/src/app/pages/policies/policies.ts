import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RenewalService } from '../../services/renewal.service';
import { DashboardFilters, FilterOptions, PolicyRow } from '../../models/renewal';
import { FilterBarComponent } from '../../components/filter-bar';
import { IconComponent } from '../../components/icon';
import { inrFull, fmtDate } from '../../util/format';

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [FilterBarComponent, IconComponent, RouterLink],
  templateUrl: './policies.html',
  styleUrl: './policies.css',
})
export class PoliciesComponent {
  svc = inject(RenewalService);

  options = signal<FilterOptions | null>(null);
  rows = signal<PolicyRow[]>([]);
  total = signal<number>(0);
  page = signal<number>(1);
  pageSize = 50;
  loading = signal<boolean>(true);
  error = signal<string | null>(null);
  sortBy = signal<string>('policyExpDate');
  sortDir = signal<'asc' | 'desc'>('asc');

  // Search is LOCAL to this page (not in svc.filters) so it never leaks into the
  // dashboard KPIs. It's merged into the filter set only when we query/export.
  search = signal<string>('');
  searchField = signal<string>('all');
  searchFields = [
    { value: 'all', label: 'All', placeholder: 'Search name, policy, vehicle…' },
    { value: 'name', label: 'Name', placeholder: 'Search insured name…' },
    { value: 'policyNo', label: 'Policy No', placeholder: 'Search policy number…' },
    { value: 'vehicle', label: 'Vehicle', placeholder: 'Search vehicle number…' },
    { value: 'mobile', label: 'Mobile', placeholder: 'Search mobile number…' },
  ];
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  inrFull = inrFull; fmtDate = fmtDate;

  searchPlaceholder(): string {
    return this.searchFields.find((f) => f.value === this.searchField())?.placeholder ?? 'Search…';
  }

  // Current filters + local search state, for querying/exporting.
  private effectiveFilters(): DashboardFilters {
    const f = { ...this.svc.filters() };
    const q = this.search().trim();
    if (q) { f.search = q; f.searchField = this.searchField(); }
    return f;
  }

  ngOnInit() {
    this.refreshOptions(this.svc.filters());
    this.load();
  }

  // Monotonic request ids so a slow response from an old filter/page/sort can't
  // overwrite a newer one (out-of-order response race).
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

  load() {
    this.loading.set(true);
    this.error.set(null);
    const seq = ++this.loadSeq;
    this.svc.getPolicies(this.effectiveFilters(), this.page(), this.pageSize, this.sortBy(), this.sortDir()).subscribe({
      next: (r) => { if (seq !== this.loadSeq) return; this.rows.set(r.rows); this.total.set(r.total); this.loading.set(false); },
      error: () => { if (seq !== this.loadSeq) return; this.error.set('Could not reach the API at localhost:3000. Is the backend running?'); this.loading.set(false); },
    });
  }

  onFilterChange(f: DashboardFilters) { this.svc.filters.set(f); this.refreshOptions(f); this.page.set(1); this.load(); }

  // Debounced: search runs on lakhs of live rows, so don't fire on every keystroke.
  onSearchInput(value: string) {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.load(); }, 400);
  }

  // Switching the field only matters if there's a query already typed.
  onSearchFieldChange(field: string) {
    this.searchField.set(field);
    if (this.search().trim()) { this.page.set(1); this.load(); }
  }

  submitSearch() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.page.set(1); this.load();
  }

  clearSearch() {
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.search.set('');
    this.page.set(1); this.load();
  }

  // Per-row mobile reveal: masked by default; click fetches the full number once
  // (server audit-logs each reveal), click again hides it.
  revealed = signal<Record<string, string>>({});
  private revealing = new Set<string>();

  copiedId = signal<string>('');

  // Re-mask as soon as the cursor leaves the number — the reveal is a "peek".
  hideMobile(r: PolicyRow) {
    const id = r.id;
    if (this.revealed()[id]) this.revealed.update((m) => { const { [id]: _, ...rest } = m; return rest; });
    if (this.copiedId() === id) this.copiedId.set('');
  }

  // Click = peek AND copy the full number to the clipboard.
  toggleMobile(r: PolicyRow) {
    const id = r.id;
    const shown = this.revealed()[id];
    if (shown) { this.copy(id, shown); return; }
    if (this.revealing.has(id)) return;
    this.revealing.add(id);
    this.svc.revealMobile(id).subscribe({
      next: (res) => {
        this.revealing.delete(id);
        if (res.mobile) {
          this.revealed.update((m) => ({ ...m, [id]: res.mobile! }));
          this.copy(id, res.mobile);
        }
      },
      error: () => this.revealing.delete(id),
    });
  }

  private copy(id: string, value: string) {
    navigator.clipboard?.writeText(value).then(() => this.copiedId.set(id), () => {});
  }

  sort(col: string) {
    if (this.sortBy() === col) this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    else { this.sortBy.set(col); this.sortDir.set('asc'); }
    this.load();
  }

  totalPages(): number { return Math.max(1, Math.ceil(this.total() / this.pageSize)); }
  prev() { if (this.page() > 1) { this.page.update((p) => p - 1); this.load(); } }
  next() { if (this.page() < this.totalPages()) { this.page.update((p) => p + 1); this.load(); } }

  exportCsv() {
    // Full filtered set (no 500-row cap), fetched with auth and saved as a file.
    this.svc.downloadCsv(this.effectiveFilters(), this.sortBy(), this.sortDir());
  }
}
