import { Component, input, signal } from '@angular/core';
import { SplitRow } from '../models/renewal';
import { inr, num } from '../util/format';

const PALETTE = ['#6366f1', '#16a34a', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444'];

@Component({
  selector: 'app-split-card',
  standalone: true,
  template: `
    <div class="split">
      <h3>{{ title() }}</h3>
      @if (rows().length === 0) {
        <div class="empty">No data.</div>
      } @else {
        <div class="list">
        @for (r of rows(); track r.label; let i = $index) {
          <div class="row"
            (mouseenter)="showTip($event, r, i)" (mousemove)="moveTip($event)" (mouseleave)="tip.set(null)">
            <div class="row__top">
              <span class="dot" [style.background]="color(i)"></span>
              <span class="lbl">{{ r.label }}</span>
              <span class="cnt">{{ share(r) }}%</span>
            </div>
            <div class="track"><div class="fill" [style.width.%]="share(r)" [style.background]="color(i)"></div></div>
            @if (viewBy() === 'premium') {
              <div class="meta"><span class="coll">Collected {{ fmt(r.collectedPremiumGross) }}</span></div>
            } @else {
              <div class="meta"><span class="rnw">Renewed {{ num(r.renewed) }}</span></div>
            }
          </div>
        }
        </div>
      }

      @if (tip(); as t) {
        <div class="tooltip" [style.left.px]="t.x" [style.top.px]="t.y">
          <div class="tt-head">
            <span class="tt-avatar" [style.background]="t.color">{{ t.row.label.charAt(0) }}</span>
            <span class="tt-name">{{ t.row.label }}</span>
          </div>
          <div class="tt-row"><span>Due (policies)</span><b>{{ num(t.row.due) }}</b></div>
          <div class="tt-row"><span>Renewed (policies)</span><b>{{ num(t.row.renewed) }}</b></div>
          <div class="tt-row"><span>Renewal %</span><b>{{ t.row.renewalPct }}%</b></div>
          <div class="tt-row"><span>Collected (renewed)</span><b class="g">{{ fmt(t.row.collectedPremiumGross) }}</b></div>
          <div class="tt-row"><span>Total premium (due)</span><b>{{ fmt(t.row.premiumGross) }}</b></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .split { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px; height:100%; box-shadow:var(--shadow); display:flex; flex-direction:column; }
    h3 { margin:0 0 14px; font-size:15px; font-weight:800; color:var(--text); }
    .list { flex:1; overflow-y:auto; max-height:340px; padding-right:6px; }
    .list::-webkit-scrollbar { width:7px; }
    .list::-webkit-scrollbar-thumb { background:#d8dde6; border-radius:999px; }
    .list::-webkit-scrollbar-thumb:hover { background:#c3cad6; }
    .list::-webkit-scrollbar-track { background:transparent; }
    .list { scrollbar-width:thin; scrollbar-color:#d8dde6 transparent; }
    .row { margin-bottom:14px; border-radius:8px; padding:2px; cursor:default; transition:background .12s ease; }
    .row:hover { background:#f8fafc; }
    .row:last-child { margin-bottom:0; }
    .row__top { display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:6px; }
    .dot { width:10px; height:10px; border-radius:999px; box-shadow:0 0 0 3px rgba(99,102,241,.08); }
    .lbl { font-weight:700; color:var(--text); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cnt { font-variant-numeric:tabular-nums; color:var(--text); font-weight:700; }
    .cnt small { color:var(--muted-soft,#9ca3af); font-weight:500; }
    .track { height:8px; background:#f1f5f9; border-radius:999px; overflow:hidden; }
    .fill { height:100%; border-radius:999px; }
    .meta { font-size:11px; color:var(--muted); margin-top:5px; }
    .meta .coll { color:#059669; font-weight:600; }
    .meta .rnw { color:#4f46e5; font-weight:600; }
    .empty { color:var(--muted); font-size:13px; padding:24px; text-align:center; }

    /* Viewport-anchored tooltip (position:fixed) — never clipped by the scroll box. */
    .tooltip { position:fixed; z-index:9999; pointer-events:none; width:212px; background:#111827; color:#fff; padding:12px; border-radius:12px; box-shadow:0 16px 34px rgba(15,23,42,.32); }
    .tt-head { display:flex; align-items:center; gap:9px; padding-bottom:9px; margin-bottom:8px; border-bottom:1px solid #374151; }
    .tt-avatar { width:28px; height:28px; flex-shrink:0; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; color:#fff; text-transform:uppercase; }
    .tt-name { font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tt-row { display:flex; justify-content:space-between; gap:14px; font-size:11px; margin-top:6px; white-space:nowrap; }
    .tt-row span { color:#9ca3af; }
    .tt-row b { color:#fff; font-weight:600; font-variant-numeric:tabular-nums; }
    .tt-row b.g { color:#a5b4fc; }
  `],
})
export class SplitCardComponent {
  title = input.required<string>();
  rows = input.required<SplitRow[]>();
  /** NOP = share by policy count; Premium = share by premium (total gross). */
  viewBy = input<'nop' | 'premium'>('nop');

  fmt = inr; num = num;
  color = (i: number) => PALETTE[i % PALETTE.length];

  // Share of the whole — by policy count (NOP) or by premium (Premium).
  share(r: SplitRow): number {
    const byPremium = this.viewBy() === 'premium';
    const total = this.rows().reduce((a, x) => a + (byPremium ? x.premiumGross : x.due), 0);
    const val = byPremium ? r.premiumGross : r.due;
    return total > 0 ? Math.round((val / total) * 100) : 0;
  }

  tip = signal<{ x: number; y: number; row: SplitRow; color: string } | null>(null);

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

  showTip(e: MouseEvent, r: SplitRow, i: number) {
    const { x, y } = this.place(e.clientX, e.clientY);
    this.tip.set({ x, y, row: r, color: this.color(i) });
  }
  moveTip(e: MouseEvent) {
    const t = this.tip();
    if (t) { const { x, y } = this.place(e.clientX, e.clientY); this.tip.set({ ...t, x, y }); }
  }
}
