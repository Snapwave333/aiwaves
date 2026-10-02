import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCard } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { Animator } from '../core/animator.service';
import { formatRounded } from '../core/apply';
import { Param } from '../core/model';
import { PanelLayout } from '../core/panel-layout';
import { WorkspaceStore } from '../core/workspace.store';
import { PanelStepsComponent } from '../ui/panel-steps.component';
import { PanelTicker } from './panel-ticker';
import { KnobComponent } from '../ui/knob.component';

/** Badge text and Material Symbol per device type (CONTRACT section 3: icon by type). */
const TYPES: Record<string, [badge: string, icon: string]> = {
  eq: ['EQ', 'equalizer'],
  compressor: ['CMP', 'compress'],
  delay: ['DLY', 'repeat'],
  reverb: ['REV', 'blur_on'],
  filter: ['FLT', 'filter_alt'],
  sampler: ['SMP', 'piano'],
  synth: ['SYN', 'graphic_eq'],
  shimmer: ['SHM', 'stars'],
  freeze: ['FRZ', 'ac_unit'],
  chorus: ['CHO', 'waves'],
  utility: ['UTL', 'tune'],
  limiter: ['LIM', 'vertical_align_top'],
  glitch: ['GLT', 'grain'],
  reverse: ['RVS', 'fast_rewind'],
  tape: ['TPE', 'album'],
  pitch: ['PIT', 'height'],
  drumrack: ['DRM', 'grid_view'],
  saturator: ['SAT', 'local_fire_department'],
};
const GENERIC_ICON = 'memory';

export function typeBadge(type: string): string {
  return TYPES[type.toLowerCase()]?.[0] ?? (type.slice(0, 3).toUpperCase() || 'DEV');
}

export function typeIcon(type: string): string {
  return TYPES[type.toLowerCase()]?.[1] ?? GENERIC_ICON;
}

@Component({
  selector: 'aw-device-chain',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KnobComponent, MatCard, MatIcon, PanelStepsComponent],
  host: {
    class: 'panel devices',
    role: 'region',
    'aria-label': 'Device chain',
    '[class.compact]': 'compact()',
    '[class.collapsed]': 'collapsed()',
    '[class.peeking]': 'layout.peeking("devices")',
  },
  template: `
    @let t = store.selectedTrack();
    <div class="panel-bar">
      <mat-icon aria-hidden="true">settings_input_component</mat-icon>
      <h2 class="panel-title">Devices</h2>
      @if (t) {
        <span class="panel-sub"
          ><span class="swatch" [style.background]="t.color"></span>{{ t.name }}</span
        >
      }
      @if (collapsed()) {
        <span
          class="panel-ticker"
          [class.fresh]="ticker.event('devices')?.seq === animator.highlightSeq()"
          [title]="ticker.text('devices')"
          >{{ ticker.text('devices') }}</span
        >
      }
      <span class="panel-tools"><aw-panel-steps panel="devices" name="device chain" /></span>
    </div>
    @if (!collapsed()) {
      <div class="chain" [class.mini-chain]="compact()">
        @if (t) {
          @for (d of t.devices; track d.id; let last = $last) {
            @let dp = 'tracks.' + t.id + '.devices.' + d.id;
            @if (compact()) {
              <div
                class="chip"
                role="group"
                [style.--dev]="t.color"
                [attr.data-path]="dp"
                [class.off]="!d.enabled"
                [class.glow]="animator.glow(dp)"
                [class.touched]="animator.glowUnder(dp)"
                [class.ghost]="store.ghosts().has(dp) || store.ghosts().has('tracks.' + t.id)"
                [attr.aria-label]="d.name + ' (' + d.type + ')' + (d.enabled ? '' : ', off')"
              >
                <span
                  class="light light-on"
                  [class.on]="d.enabled"
                  role="img"
                  [attr.aria-label]="d.enabled ? 'On' : 'Off'"
                ></span>
                <mat-icon class="chip-icon" aria-hidden="true">{{ icon(d.type) }}</mat-icon>
                <span class="chip-name" [title]="d.name + ' (' + d.type + ')'">{{ d.name }}</span>
                @for (prm of d.params; track prm.id) {
                  <aw-knob
                    [path]="dp + '.params.' + prm.id"
                    [label]="prm.name"
                    [value]="prm.value"
                    [min]="prm.min"
                    [max]="prm.max"
                    [display]="prm.display"
                    [format]="formatter(prm)"
                    [size]="18"
                    [mini]="true"
                    [color]="t.color"
                  />
                }
              </div>
            } @else {
              <mat-card
                appearance="outlined"
                class="device"
                role="group"
                [style.--dev]="t.color"
                [attr.data-path]="dp"
                [class.off]="!d.enabled"
                [class.glow]="animator.glow(dp)"
                [class.touched]="animator.glowUnder(dp)"
                [class.ghost]="store.ghosts().has(dp) || store.ghosts().has('tracks.' + t.id)"
                [attr.aria-label]="d.name + ' (' + d.type + ')' + (d.enabled ? '' : ', off')"
              >
                <header class="device-head">
                  <span
                    class="light light-on"
                    [class.on]="d.enabled"
                    role="img"
                    [attr.aria-label]="d.enabled ? 'On' : 'Off'"
                  ></span>
                  <span class="badge" [title]="d.type"
                    ><mat-icon aria-hidden="true">{{ icon(d.type) }}</mat-icon
                    >{{ badge(d.type) }}</span
                  >
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
                    <span class="device-empty">No parameters</span>
                  }
                </div>
              </mat-card>
            }
            @if (!last) {
              <mat-icon class="chain-arrow" aria-hidden="true">chevron_right</mat-icon>
            }
          } @empty {
            <p class="empty">
              <mat-icon aria-hidden="true">power_off</mat-icon>No devices on this track yet.
            </p>
          }
        } @else {
          <p class="empty">
            <mat-icon aria-hidden="true">touch_app</mat-icon>Select a track to see its devices.
          </p>
        }
      </div>
    }
  `,
})
export class DeviceChainComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly animator = inject(Animator);
  protected readonly layout = inject(PanelLayout);
  protected readonly compact = computed(() => this.layout.compact('devices'));
  protected readonly collapsed = computed(() => this.layout.collapsed('devices'));
  protected readonly ticker = inject(PanelTicker);
  protected readonly badge = typeBadge;
  protected readonly icon = typeIcon;
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
