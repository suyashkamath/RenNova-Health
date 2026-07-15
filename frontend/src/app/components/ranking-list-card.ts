import { Component, computed, input, output, signal } from '@angular/core';
import { RankRow } from '../models/renewal';
import { inr, num } from '../util/format';

/** One selectable dataset. A card with two tabs renders the Region/Branch pill switch. */
export interface RankTab { key: string; label: string; rows: RankRow[]; }
/** Which dataset the toggle is on, plus the clicked row. */
export interface RankPick { kind: string; row: RankRow; }

/**
 * List-style performance ranking card (badge + name + premium + full-width bar + %).
 * One tab = a plain ranking (Company / RM / POSP); two tabs = a pill switch (Region / Branch).
 * A Top/Worst toggle flips the order; hovering a row reveals a dark details tooltip.
 */
@Component({
  selector: 'app-ranking-list-card',
  standalone: true,
  template: `
    <div class="rank">
      <div class="rank__head">
        <h3>{{ heading() }}</h3>
        <div class="seg">
          <button [class.on]="mode()==='top'" (click)="mode.set('top')">Top</button>
          <button [class.on]="mode()==='worst'" (click)="mode.set('worst')">Worst</button>
        </div>
      </div>

      @if (tabs().length > 1) {
        <div class="seg seg--entity">
          @for (t of tabs(); track t.key; let ti = $index) {
            <button [class.on]="active()===ti" (click)="active.set(ti)">{{ t.label }}</button>
          }
        </div>
      }

      @if (view().length === 0) {
        <div class="empty">No data.</div>
      } @else {
        <ul class="list">
          @for (r of view(); track r.label; let i = $index) {
            <li class="row" (click)="select.emit({ kind: activeTab().key, row: r })">
              <div class="row__top">
                <div class="row__id">
                  <span class="badge" [class]="badgeClass(i)">{{ i + 1 }}</span>
                  <div class="row__name">
                    <p class="nm" [title]="r.label">{{ r.label }}</p>
                    @if (viewBy() === 'premium') {
                      <p class="sub sub--coll"><span class="lbl">Collected</span> {{ inr(r.collectedPremiumGross) }}</p>
                    } @else {
                      <p class="sub sub--rnw"><span class="lbl">Renewed</span> {{ num(r.renewed) }}</p>
                    }
                  </div>
                </div>
                <b class="pct" [class]="'t--' + tone(r.renewalPct)">{{ r.renewalPct }}%</b>
              </div>
              <span class="bar">
                <span class="bar__fill" [class]="'f--' + tone(r.renewalPct)" [style.width.%]="r.renewalPct"></span>
              </span>

              <div class="tip" [class.tip--up]="i >= 3 && i >= view().length - 3">
                <div class="tip__head">
                  <span class="tip__avatar">{{ r.label.charAt(0) }}</span>
                  <div>
                    <p class="tip__name" [title]="r.label">{{ r.label }}</p>
                    <p class="tip__role">{{ activeTab().label }}</p>
                  </div>
                </div>
                <div class="tip__body">
                  <div class="tip__line"><span>Due (policies)</span><span>{{ num(r.due) }}</span></div>
                  <div class="tip__line"><span>Renewed (policies)</span><span>{{ num(r.renewed) }}</span></div>
                  <div class="tip__line"><span>Renewal %</span><span>{{ r.renewalPct }}%</span></div>
                  <div class="tip__line"><span>Collected (renewed)</span><span class="tip__accent">{{ inr(r.collectedPremiumGross) }}</span></div>
                  <div class="tip__line"><span>Total premium (due)</span><span>{{ inr(r.expectedPremiumGross) }}</span></div>
                </div>
                <span class="tip__arrow"></span>
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .rank { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px; box-shadow:var(--shadow); }
    .rank__head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:12px; }
    h3 { margin:0; font-size:15px; font-weight:800; color:var(--text); }

    .seg { display:flex; gap:0; border:1px solid var(--border-strong); border-radius:8px; overflow:hidden; background:#f9fafb; padding:2px; }
    .seg button { border:0; background:transparent; padding:5px 12px; border-radius:6px; font-size:12px; cursor:pointer; color:var(--muted); font-weight:700; }
    .seg button.on { background:#fff; color:var(--accent); box-shadow:var(--shadow); }
    .seg--entity { display:inline-flex; align-self:flex-start; margin-bottom:14px; background:#eef2ff; border-color:transparent; }

    .list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }

    .row { position:relative; cursor:pointer; padding:8px 10px; border-radius:10px; border:1px solid transparent; transition:background .14s ease, border-color .14s ease; display:flex; flex-direction:column; gap:7px; }
    .row:hover { background:#f8fafc; border-color:var(--border); }
    .row__top { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .row__id { display:flex; align-items:center; gap:10px; min-width:0; }
    .badge { width:22px; height:22px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; border-radius:6px; }
    .b--gold { background:#fef9c3; color:#a16207; }
    .b--silver { background:#e5e7eb; color:#374151; }
    .b--bronze { background:#ffedd5; color:#c2410c; }
    .b--plain { background:#f3f4f6; color:#6b7280; }
    .b--worst { background:#fef2f2; color:#ef4444; }
    .row__name { min-width:0; }
    .nm { margin:0; font-size:14px; font-weight:700; color:var(--text); line-height:1.15; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
    .sub { margin:2px 0 0; font-size:11px; color:var(--muted-soft,#9ca3af); line-height:1.25; }
    .sub .lbl { font-weight:700; text-transform:uppercase; letter-spacing:.03em; font-size:9px; }
    .sub--coll { color:#059669; }
    .sub--rnw { color:#4f46e5; }
    .pct { font-size:14px; font-weight:800; font-variant-numeric:tabular-nums; flex-shrink:0; }
    .t--good { color:#059669; } .t--mid { color:#d97706; } .t--bad { color:#e11d48; }

    .bar { display:block; width:100%; height:6px; background:#f1f5f9; border-radius:999px; overflow:hidden; }
    .bar__fill { display:block; height:100%; border-radius:999px; transition:width .4s ease; }
    .f--good { background:#10b981; } .f--mid { background:#f59e0b; } .f--bad { background:#ef4444; }

    /* Dark hover tooltip — opens right & down so it isn't clipped by the scroll box. */
    .tip { display:none; position:absolute; left:44px; top:0; width:210px; z-index:30; background:#111827; color:#fff; border-radius:12px; padding:12px; box-shadow:0 16px 34px rgba(15,23,42,.32); pointer-events:none; }
    .tip--up { top:auto; bottom:0; }
    .row:hover .tip { display:block; }
    .tip__head { display:flex; align-items:center; gap:9px; padding-bottom:9px; margin-bottom:8px; border-bottom:1px solid #374151; }
    .tip__avatar { width:30px; height:30px; flex-shrink:0; border-radius:50%; background:var(--accent); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; text-transform:uppercase; }
    .tip__name { margin:0; font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px; }
    .tip__role { margin:2px 0 0; font-size:10px; color:#9ca3af; }
    .tip__body { display:flex; flex-direction:column; gap:6px; }
    .tip__line { display:flex; justify-content:space-between; font-size:11px; }
    .tip__line span:first-child { color:#9ca3af; }
    .tip__line span:last-child { font-weight:600; font-variant-numeric:tabular-nums; }
    .tip__accent { color:#a5b4fc !important; }
    .tip__arrow { position:absolute; left:-4px; top:18px; width:8px; height:8px; background:#111827; transform:rotate(45deg); }
    .tip--up .tip__arrow { top:auto; bottom:18px; }

    .empty { color:var(--muted); font-size:13px; padding:24px; text-align:center; }
  `],
})
export class RankingListCardComponent {
  tabs = input.required<RankTab[]>();
  /** Heading for single-tab cards (multi-tab cards derive it from the active tab). */
  title = input<string>('');
  limit = input<number>(10);
  /** NOP = show Renewed (count) subtitle; Premium = show Collected (₹) subtitle. */
  viewBy = input<'nop' | 'premium'>('nop');
  select = output<RankPick>();

  active = signal(0);
  mode = signal<'top' | 'worst'>('top');

  inr = inr; num = num;

  activeTab = computed(() => this.tabs()[this.active()] ?? this.tabs()[0]);
  heading = computed(() =>
    this.tabs().length > 1 ? `${this.activeTab().label} Performance` : (this.title() || `${this.activeTab().label} Performance`));

  view = computed(() => {
    const src = this.activeTab()?.rows ?? [];
    const sorted = [...src].sort((a, b) => b.renewalPct - a.renewalPct);
    const list = this.mode() === 'top' ? sorted : [...sorted].reverse();
    return list.slice(0, this.limit());
  });

  tone(pct: number): 'good' | 'mid' | 'bad' {
    if (pct >= 80) return 'good';
    if (pct >= 50) return 'mid';
    return 'bad';
  }

  badgeClass(i: number): string {
    if (this.mode() === 'worst') return 'b--worst';
    return i === 0 ? 'b--gold' : i === 1 ? 'b--silver' : i === 2 ? 'b--bronze' : 'b--plain';
  }
}
