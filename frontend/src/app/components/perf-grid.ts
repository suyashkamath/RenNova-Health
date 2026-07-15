import { Component, computed, input, output, signal } from '@angular/core';
import { RankRow } from '../models/renewal';
import { inr, num } from '../util/format';
import { IconComponent } from './icon';

/**
 * Reusable performance grid of entity cards (avatar, name, premium, renewal %, bar,
 * Target/Renewed/Status). Search + Top Performers / Needs Attention toggle, capped at 12.
 * Used for PoSPs under an RM, RMs under a Region, etc. — title/subtitle/placeholder are inputs.
 */
@Component({
  selector: 'app-perf-grid',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="card">
      <div class="head">
        <div class="head__title">
          <div class="ic"><app-icon name="users" [size]="18" /></div>
          <div>
            <h3>{{ title() }}</h3>
            <p class="sub">{{ subtitle() }}</p>
          </div>
        </div>
        <div class="controls">
          <div class="search">
            <app-icon name="search" [size]="15" />
            <input type="text" [placeholder]="searchPlaceholder()" [value]="q()"
              (input)="q.set($any($event.target).value)" />
          </div>
          <div class="seg">
            <button [class.on]="mode()==='top'" (click)="mode.set('top')">Top Performers ↑</button>
            <button [class.on]="mode()==='attention'" (click)="mode.set('attention')">Needs Attention ↓</button>
          </div>
        </div>
      </div>

      @if (view().length === 0) {
        <div class="empty">No matches.</div>
      } @else {
        <div class="grid">
          @for (r of view(); track r.label) {
            <button class="pcard" (click)="select.emit(r)"
              (mouseenter)="showTip($event, r)" (mousemove)="moveTip($event)" (mouseleave)="tip.set(null)">
              <div class="pcard__top">
                <div class="pcard__id">
                  <span class="avatar">{{ r.label.charAt(0) }}</span>
                  <div class="who">
                    <p class="nm" [title]="r.label">{{ r.label }}</p>
                    <p class="psub"><span class="lbl">Collected</span> {{ inr(r.collectedPremiumGross) }}</p>
                  </div>
                </div>
                <b class="pct" [class.good]="good(r)" [class.bad]="!good(r)">{{ r.renewalPct }}%</b>
              </div>
              <span class="bar"><span class="bar__fill" [class.good]="good(r)" [class.bad]="!good(r)" [style.width.%]="r.renewalPct"></span></span>
              <div class="foot">
                <div><span>Target</span><b>{{ num(r.due) }}</b></div>
                <div><span>Renewed</span><b>{{ num(r.renewed) }}</b></div>
                <div class="r"><span>Status</span><b [class.good]="good(r)" [class.bad]="!good(r)">{{ good(r) ? 'Good' : 'Poor' }}</b></div>
              </div>
            </button>
          }
        </div>
      }

      @if (tip(); as t) {
        <div class="tooltip" [style.left.px]="t.x" [style.top.px]="t.y">
          <div class="tt-head">
            <span class="tt-avatar">{{ t.row.label.charAt(0) }}</span>
            <span class="tt-name">{{ t.row.label }}</span>
          </div>
          <div class="tt-row"><span>Due (policies)</span><b>{{ num(t.row.due) }}</b></div>
          <div class="tt-row"><span>Renewed (policies)</span><b>{{ num(t.row.renewed) }}</b></div>
          <div class="tt-row"><span>Renewal %</span><b>{{ t.row.renewalPct }}%</b></div>
          <div class="tt-row"><span>Collected (renewed)</span><b class="g">{{ inr(t.row.collectedPremiumGross) }}</b></div>
          <div class="tt-row"><span>Total premium (due)</span><b>{{ inr(t.row.expectedPremiumGross) }}</b></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); }
    .head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
    .head__title { display:flex; align-items:flex-start; gap:11px; }
    .ic { width:34px; height:34px; border-radius:9px; background:var(--accent-soft); color:var(--accent); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    h3 { margin:0; font-size:17px; font-weight:800; color:var(--text); }
    .sub { margin:3px 0 0; font-size:13px; color:var(--muted); }

    .controls { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .search { display:flex; align-items:center; gap:7px; background:#f9fafb; border:1px solid var(--border-strong); border-radius:9px; padding:0 11px; height:36px; color:var(--muted); }
    .search input { border:0; background:transparent; outline:0; font-size:13px; font-weight:600; color:#374151; width:150px; }
    .search:focus-within { border-color:var(--accent); background:#fff; box-shadow:0 0 0 3px rgba(99,102,241,.12); }
    .seg { display:flex; gap:0; border:1px solid var(--border-strong); border-radius:9px; overflow:hidden; background:#f9fafb; padding:2px; }
    .seg button { border:0; background:transparent; padding:7px 12px; border-radius:7px; font-size:12px; cursor:pointer; color:var(--muted); font-weight:700; white-space:nowrap; }
    .seg button.on { background:#fff; color:var(--accent); box-shadow:var(--shadow); }
    .seg button.on:last-child { color:#e11d48; }

    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(255px, 1fr)); gap:14px; max-height:560px; overflow-y:auto; padding:2px 8px 2px 2px; }
    .grid::-webkit-scrollbar { width:8px; }
    .grid::-webkit-scrollbar-thumb { background:#d8dde6; border-radius:999px; }
    .grid::-webkit-scrollbar-thumb:hover { background:#c3cad6; }
    .grid::-webkit-scrollbar-track { background:transparent; }
    .grid { scrollbar-width:thin; scrollbar-color:#d8dde6 transparent; }

    .pcard { text-align:left; cursor:pointer; background:#fbfcfe; border:1px solid var(--border); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:12px; transition:transform .14s ease, box-shadow .14s ease, border-color .14s ease; font:inherit; }
    .pcard:hover { transform:translateY(-2px); box-shadow:var(--shadow-hover); border-color:var(--border-strong); }
    .pcard__top { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; }
    .pcard__id { display:flex; align-items:center; gap:10px; min-width:0; }
    .avatar { width:34px; height:34px; flex-shrink:0; border-radius:50%; background:#eef2ff; color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; text-transform:uppercase; }
    .who { min-width:0; }
    .nm { margin:0; font-size:14px; font-weight:700; color:var(--text); line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:150px; }
    .psub { margin:2px 0 0; font-size:11px; color:#059669; font-weight:600; }
    .psub .lbl { font-weight:700; text-transform:uppercase; letter-spacing:.03em; font-size:9px; }
    .pct { font-size:20px; font-weight:800; font-variant-numeric:tabular-nums; flex-shrink:0; }
    .pct.good, b.good { color:#059669; } .pct.bad, b.bad { color:#e11d48; }

    .bar { display:block; width:100%; height:6px; background:#eef2f6; border-radius:999px; overflow:hidden; }
    .bar__fill { display:block; height:100%; border-radius:999px; }
    .bar__fill.good { background:#10b981; } .bar__fill.bad { background:#ef4444; }

    .foot { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding-top:12px; border-top:1px solid var(--border-soft, #f1f5f9); }
    .foot > div { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .foot .r { text-align:right; }
    .foot span { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--muted-soft,#9ca3af); }
    .foot b { font-size:13px; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; }

    .empty { color:var(--muted); font-size:13px; padding:28px; text-align:center; }

    /* Viewport-anchored hover tooltip (position:fixed) — never clipped by the grid scroll. */
    .tooltip { position:fixed; z-index:9999; pointer-events:none; width:212px; background:#111827; color:#fff; padding:12px; border-radius:12px; box-shadow:0 16px 34px rgba(15,23,42,.32); }
    .tt-head { display:flex; align-items:center; gap:9px; padding-bottom:9px; margin-bottom:8px; border-bottom:1px solid #374151; }
    .tt-avatar { width:28px; height:28px; flex-shrink:0; border-radius:50%; background:var(--accent); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#fff; text-transform:uppercase; }
    .tt-name { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tt-row { display:flex; justify-content:space-between; gap:14px; font-size:11px; margin-top:6px; white-space:nowrap; }
    .tt-row span { color:#9ca3af; }
    .tt-row b { color:#fff; font-weight:600; font-variant-numeric:tabular-nums; }
    .tt-row b.g { color:#a5b4fc; }
  `],
})
export class PerfGridComponent {
  rows = input.required<RankRow[]>();
  title = input<string>('Performance');
  subtitle = input<string>('');
  searchPlaceholder = input<string>('Search…');
  select = output<RankRow>();

  inr = inr; num = num;

  q = signal('');
  mode = signal<'top' | 'attention'>('top');
  tip = signal<{ x: number; y: number; row: RankRow } | null>(null);

  // "Good" at/above 50% renewal, otherwise "Poor" (two-tone card design).
  good(r: RankRow): boolean { return r.renewalPct >= 50; }

  // Place near the cursor but flip/clamp so it never runs off the viewport edge.
  private place(cx: number, cy: number): { x: number; y: number } {
    const TW = 212, TH = 180, pad = 8;
    let x = cx + 16;
    if (x + TW > window.innerWidth - pad) x = cx - TW - 16;
    if (x < pad) x = pad;
    let y = cy + 16;
    if (y + TH > window.innerHeight - pad) y = cy - TH - 16;
    if (y < pad) y = pad;
    return { x, y };
  }

  showTip(e: MouseEvent, r: RankRow) {
    const { x, y } = this.place(e.clientX, e.clientY);
    this.tip.set({ x, y, row: r });
  }
  moveTip(e: MouseEvent) {
    const t = this.tip();
    if (t) { const { x, y } = this.place(e.clientX, e.clientY); this.tip.set({ ...t, x, y }); }
  }

  view = computed(() => {
    const term = this.q().trim().toLowerCase();
    const filtered = term ? this.rows().filter((r) => r.label.toLowerCase().includes(term)) : this.rows();
    const sorted = [...filtered].sort((a, b) => b.renewalPct - a.renewalPct);
    // Top 12 performers, or the 12 that most need attention (worst first).
    const ordered = this.mode() === 'top' ? sorted : sorted.reverse();
    return ordered.slice(0, 12);
  });
}
