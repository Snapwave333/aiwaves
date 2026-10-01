import { Json } from '../core/model';

/** Text for an event's from / to value in the feed and the captions. */
export function formatJson(v: Json): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Number(v.toFixed(3)));
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v;
  const s = JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 47) + '…' : s;
}

/** "tracks.zither.devices.echo.params.feedback" -> "zither › echo › feedback". */
export function shortTarget(target: string | null): string {
  if (!target) return '';
  return target
    .replace(/^tracks\./, '')
    .replace(/\.(devices|params|clips|mixer)\./g, ' › ')
    .replace(/\.mixer$/, ' › mixer');
}
