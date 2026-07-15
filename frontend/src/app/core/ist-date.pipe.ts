import { Pipe, PipeTransform } from '@angular/core';
import { formatDate } from '@angular/common';

/**
 * Render a backend timestamp in India Standard Time (IST, +05:30).
 *
 * Backend timestamps are stored/emitted as UTC but WITHOUT an offset (e.g.
 * "2026-07-13T06:35:00"). Angular's plain `date` pipe would treat that as the
 * viewer's local time and show the raw UTC wall-clock. This pipe marks the value
 * as UTC and formats it in IST, so 06:35 UTC correctly shows as 12:05 PM.
 *
 * Usage:  {{ user.lastLoginAt | istDate }}                       -> 13 Jul 2026, 12:05 PM
 *         {{ row.created_at   | istDate:'d MMM y' }}             -> 13 Jul 2026
 */
@Pipe({ name: 'istDate', standalone: true })
export class IstDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined, format = 'd MMM y, h:mm a'): string {
    if (!value) return '—';
    let s = typeof value === 'string' ? value : value.toISOString();
    // No timezone offset present -> it's naive UTC; append 'Z' so it converts correctly.
    if (typeof value === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
    try {
      return formatDate(s, format, 'en-IN', '+0530');
    } catch {
      return '—';
    }
  }
}
