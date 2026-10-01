import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Animator } from '../core/animator.service';
import { formatRounded } from '../core/apply';
import { Param } from '../core/model';
import { WorkspaceStore } from '../core/workspace.store';
import { KnobComponent } from '../ui/knob.component';

const TYPE_BADGES: Record<string, string> = {
  eq: 'EQ',
  compressor: 'CMP',
  delay: 'DLY',
  reverb: 'REV',
  filter: 'FLT',
  sampler: 'SMP',
  synth: 'SYN',
  shimmer: 'SHM',
  freeze: 'FRZ',
  chorus: 'CHO',
  utility: 'UTL',
  limiter: 'LIM',
  glitch: 'GLT',
  reverse: 'RVS',
  tape: 'TPE',
  pitch: 'PIT',
  drumrack: 'DRM',
  saturator: 'SAT',
};

export function typeBadge(type: string): string {
  return TYPE_BADGES[type.toLowerCase()] ?? (type.slice(0, 3).toUpperCase() || 'DEV');
}

@Component({
  selector: 'aw-device-chain',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KnobComponent],
  host: { class: 'panel devices', role: 'region', 'aria-label': 'Device chain' },
  template: `
    @let t = store.selectedTrack();
    <div class="panel-bar">
      <h2 class="panel-title">Devices</h2>
      @if (t) {
        <span class="panel-sub"
          ><span class="swatch" [style.background]="t.color"></span>{{ t.name }}</span
        >
      }
    </div>
    <div class="chain">
      @if (t) {
        @for (d of t.devices; track d.id; let last = $last) {
          @let dp = 'tracks.' + t.id + '.devices.' + d.id;
          <section
            class="device"
            [attr.data-path]="dp"
            [class.off]="!d.enabled"
            [class.glow]="animator.glow(dp)"
            [class.touched]="animator.glowUnder(dp)"
            [class.ghost]="store.ghosts().has(dp) || store.ghosts().has('tracks.' + t.id)"
            [attr.aria-label]="d.name + ' (' + d.type + ')' + (d.enabled ? '' : ', off')"
          >
            <header class="device-head" [style.border-top-color]="t.color">
              <span
                class="light light-on"
                [class.on]="d.enabled"
                role="img"
                [attr.aria-label]="d.enabled ? 'On' : 'Off'"
              ></span>
              <span class="badge" [title]="d.type">{{ badge(d.type) }}</span>
              <span class="device-name" [title]="d.name">{{ d.name }}</span>
            </header>
            <div class="device-params">
              @for (prm of d.params; track prm.id) {
                <aw-knob
                  [path]="dp + '.params.' + prm.id"
                  [label]="prm.name"
                  [value]="prm.value"
                  [min]="prm.min"
                  [max]="prm.max"
                  [display]="prm.display"
                  [format]="formatter(prm)"
                  [color]="t.color"
                />
              } @empty {
                <span class="device-empty">no parameters</span>
              }
            </div>
          </section>
          @if (!last) {
            <span class="chain-arrow" aria-hidden="true">›</span>
          }
        } @empty {
          <p class="empty">No devices on this track.</p>
        }
      }
    </div>
  `,
})
export class DeviceChainComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);
  protected readonly badge = typeBadge;
  private readonly formatters = new Map<string, (v: number) => string>();

  protected formatter(p: Param): (v: number) => string {
    let f = this.formatters.get(p.unit);
    if (!f) {
      f = (v: number) => formatRounded(v, p.unit);
      this.formatters.set(p.unit, f);
    }
    return f;
  }
}
