// Indian currency formatting in lakh / crore.
export function inr(value: number): string {
  if (value == null || isNaN(value)) return '₹0';
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(1)}K`;
  return `₹${Math.round(value)}`;
}

export function inrFull(value: number): string {
  return '₹' + (value ?? 0).toLocaleString('en-IN');
}

export function num(value: number): string {
  return (value ?? 0).toLocaleString('en-IN');
}

// Compact count: up to 4 digits shown in full (1060 -> "1060"); 5+ digits use K/M.
// 10000 -> "10K", 12345 -> "12K", 1200000 -> "1.2M".
export function kfmt(value: number): string {
  const n = value ?? 0;
  if (Math.abs(n) >= 1e6) {
    const v = n / 1e6;
    return (v >= 10 ? Math.round(v) : +v.toFixed(1)) + 'M';
  }
  if (Math.abs(n) >= 10000) {
    return Math.round(n / 1000) + 'K';
  }
  return String(n);   // 0–9999 shown in full
}

// Compact Indian count: 1.1K / 2.34L / 1.20Cr (no ₹). Values under 1000 shown in full.
export function compact(value: number): string {
  const n = value ?? 0;
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y.slice(2)}`;
}
