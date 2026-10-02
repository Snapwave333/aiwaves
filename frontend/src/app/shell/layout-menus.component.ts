import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { MODULES, PRESETS, PanelLayout } from '../core/panel-layout';
import { SaveLayoutDialog } from './save-layout.dialog';

/**
 * The top bar's Modules menu (open and close modules) and Layouts menu (preset views, saved
 * layouts, save, delete, reset to default). Loaded after the first paint.
 */
@Component({
  selector: 'aw-layout-menus',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconButton, MatIcon, MatTooltip, MatMenu, MatMenuItem, MatMenuTrigger, MatDivider],
  host: { class: 'layout-menus' },
  template: `
<button
  mat-icon-button
  type="button"
  class="icon-btn-sm nav-modules"
  [matMenuTriggerFor]="modulesMenu"
  aria-label="Modules: open and close"
  matTooltip="Modules"
>
  <mat-icon>dashboard_customize</mat-icon>
</button>
<mat-menu #modulesMenu="matMenu" class="aw-menu">
  @for (m of modules; track m.id) {
    <button
      mat-menu-item
      type="button"
      role="menuitemcheckbox"
      [attr.aria-checked]="layout.visible(m.id)"
      (click)="layout.toggleVisible(m.id)"
    >
      <mat-icon>{{ layout.visible(m.id) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
      <span>{{ m.name }}</span>
    </button>
  }
</mat-menu>
<button
  mat-icon-button
  type="button"
  class="icon-btn-sm nav-layouts"
  [matMenuTriggerFor]="layoutsMenu"
  aria-label="Layouts"
  matTooltip="Layouts"
>
  <mat-icon>view_quilt</mat-icon>
</button>
<mat-menu #layoutsMenu="matMenu" class="aw-menu">
  @for (p of presets; track p.key) {
    <button mat-menu-item type="button" (click)="layout.applyPreset(p.key)">
      <mat-icon>view_quilt</mat-icon><span>{{ p.name }}</span>
    </button>
  }
  @if (layout.custom().length) {
    <mat-divider />
    @for (c of layout.custom(); track c.name) {
      <button mat-menu-item type="button" (click)="layout.applyCustom(c.name)">
        <mat-icon>bookmark</mat-icon><span>{{ c.name }}</span>
      </button>
    }
  }
  <mat-divider />
  <button mat-menu-item type="button" (click)="saveLayout()">
    <mat-icon>save</mat-icon><span>Save layout as…</span>
  </button>
  @if (layout.custom().length) {
    <button mat-menu-item type="button" [matMenuTriggerFor]="deleteMenu">
      <mat-icon>delete</mat-icon><span>Delete a saved layout</span>
    </button>
  }
  <button mat-menu-item type="button" (click)="layout.reset()">
    <mat-icon>restart_alt</mat-icon><span>Reset to default</span>
  </button>
</mat-menu>
<mat-menu #deleteMenu="matMenu" class="aw-menu">
  @for (c of layout.custom(); track c.name) {
    <button mat-menu-item type="button" (click)="layout.deleteCustom(c.name)">
      <mat-icon>delete</mat-icon><span>{{ c.name }}</span>
    </button>
  }
</mat-menu>
  `,
})
export class LayoutMenusComponent {
  protected readonly layout = inject(PanelLayout);
  private readonly dialog = inject(MatDialog);
  protected readonly modules = MODULES;
  protected readonly presets = PRESETS;

  /** "Save layout as…": a name, then the current layout is kept under it. */
  protected saveLayout(): void {
    this.dialog
      .open(SaveLayoutDialog, { data: this.layout.custom().map((c) => c.name), width: '360px' })
      .afterClosed()
      .subscribe((name?: string) => {
        if (name) this.layout.saveAs(name);
      });
  }
}
