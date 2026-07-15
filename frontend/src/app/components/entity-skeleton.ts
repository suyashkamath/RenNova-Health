import { Component } from '@angular/core';

/**
 * Shimmer skeleton for the entity drill-down page, in the same visual language
 * as the dashboard skeleton (status pill, staggered rise-in, shimmer, equalizer
 * bars) but mirroring the ENTITY layout — 8 KPI cards, a tall trend chart and
 * the policies action card — so the page doesn't jump when real data arrives.
 */
@Component({
  selector: 'app-entity-skeleton',
  standalone: true,
  template: `
    <div class="skel" role="status" aria-label="Loading report">
      <div class="pill">
        <span class="ring"></span>
        <span>Crunching lakhs of live records</span>
        <span class="dots"><i>.</i><i>.</i><i>.</i></span>
      </div>

      <!-- KPI grid (4 × 2, like the entity page) -->
      <div class="kpis">
        @for (i of eight; track i) {
          <div class="card kpi" [style.animation-delay.ms]="i * 60">
            <div class="sk ic"></div>
            <div class="lines">
              <div class="sk l1"></div>
              <div class="sk l2"></div>
              <div class="sk l3"></div>
            </div>
          </div>
        }
      </div>

      <!-- trend chart -->
      <div class="card chart" style="animation-delay:480ms">
        <div class="head"><div class="sk t"></div><div class="sk chip"></div></div>
        <div class="bars">
          @for (b of bars; track $index) {
            <span class="bar" [style.height.%]="b" [style.animation-delay.ms]="$index * 90"></span>
          }
        </div>
        <div class="sk axis"></div>
      </div>

      <!-- policies action card -->
      <div class="card polrow" style="animation-delay:560ms">
        <div class="lines">
          <div class="sk t"></div>
          <div class="sk l3"></div>
        </div>
        <div class="btns">
          <div class="sk btn"></div>
          <div class="sk btn"></div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .skel { display:flex; flex-direction:column; gap:18px; position:relative; }

    /* ---- floating status pill ---- */
    /* centered via left/right + margin auto — NOT translateX(-50%), because the
       rise animation's final transform would override it and shove the pill right */
    .pill { position:absolute; top:-4px; left:0; right:0; margin:0 auto; width:fit-content; z-index:5;
      display:flex; align-items:center; gap:9px; background:var(--card,#fff); border:1px solid var(--border,#e5e7eb);
      border-radius:999px; padding:9px 16px; font-size:12.5px; font-weight:750; color:var(--muted,#64748b);
      box-shadow:var(--shadow-hover,0 12px 26px rgba(17,24,39,.12)); animation:rise .5s cubic-bezier(.22,1,.36,1) both; }
    .ring { width:10px; height:10px; border-radius:50%; background:var(--accent,#6366f1); position:relative; flex:none; }
    .ring::after { content:''; position:absolute; inset:-4px; border-radius:50%; border:2px solid var(--accent,#6366f1); animation:pulse 1.3s ease-out infinite; }
    @keyframes pulse { from { transform:scale(.55); opacity:.75; } to { transform:scale(1.7); opacity:0; } }
    .dots { margin-left:-6px; }
    .dots i { font-style:normal; animation:blink 1.2s ease-in-out infinite; }
    .dots i:nth-child(2) { animation-delay:.2s; }
    .dots i:nth-child(3) { animation-delay:.4s; }
    @keyframes blink { 0%, 100% { opacity:.15; } 45% { opacity:1; } }

    /* ---- shimmer primitive ---- */
    .sk { background:linear-gradient(90deg, #eef1f6 25%, #f8fafc 45%, #eef1f6 65%); background-size:400% 100%;
      animation:shimmer 1.5s ease-in-out infinite; border-radius:8px; }
    @keyframes shimmer { 0% { background-position:100% 0; } 100% { background-position:-100% 0; } }

    /* ---- cards rise in, staggered ---- */
    .card { background:var(--card,#fff); border:1px solid var(--border,#e5e7eb); border-radius:16px;
      box-shadow:var(--shadow,0 1px 2px rgba(17,24,39,.06)); padding:18px; animation:rise .55s cubic-bezier(.22,1,.36,1) both; }
    @keyframes rise { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }

    /* ---- KPI grid ---- */
    .kpis { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; }
    .kpi { display:flex; gap:12px; align-items:flex-start; }
    .ic { width:40px; height:40px; border-radius:12px; flex:none; }
    .lines { flex:1; display:flex; flex-direction:column; gap:8px; min-width:0; }
    .l1 { height:10px; width:62%; }
    .l2 { height:20px; width:80%; }
    .l3 { height:9px; width:48%; }

    /* ---- trend chart ---- */
    .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .t { height:14px; width:180px; }
    .chip { height:24px; width:96px; border-radius:999px; }
    .chart { display:flex; flex-direction:column; min-height:420px; }
    .bars { flex:1; display:flex; align-items:flex-end; gap:10px; padding:8px 6px 0; }
    .bar { flex:1; border-radius:8px 8px 3px 3px; transform-origin:bottom;
      background:linear-gradient(180deg, #c7d2fe, #eef2ff); animation:eq 1.15s ease-in-out infinite alternate; }
    @keyframes eq { from { transform:scaleY(.3); opacity:.55; } to { transform:scaleY(1); opacity:1; } }
    .axis { height:9px; width:100%; margin-top:12px; }

    /* ---- policies action card ---- */
    .polrow { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .polrow .t { width:140px; }
    .polrow .l3 { width:280px; max-width:60vw; }
    .btns { display:flex; gap:10px; flex:none; }
    .btn { height:38px; width:150px; border-radius:10px; }

    @media (max-width:1100px) { .kpis { grid-template-columns:repeat(2,1fr); } }
    @media (max-width:640px) {
      .kpis { grid-template-columns:1fr; }
      .chart { min-height:300px; }
      .polrow { flex-direction:column; align-items:stretch; }
      .btns .btn { flex:1; }
    }

    /* respect users who prefer no motion — keep layout, stop the dancing */
    @media (prefers-reduced-motion: reduce) {
      .sk, .bar, .ring::after, .dots i, .card, .pill { animation:none; }
    }
  `],
})
export class EntitySkeletonComponent {
  readonly eight = [0, 1, 2, 3, 4, 5, 6, 7];
  // pleasant, uneven "chart" heights for the equalizer bars
  readonly bars = [42, 68, 55, 82, 60, 90, 48, 74, 64, 86, 52, 70];
}
