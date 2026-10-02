import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';

/** "Save layout as…": asks for a name (Electron has no window.prompt). Closes with the name. */
@Component({
  selector: 'aw-save-layout-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton],
  template: `
    <h2 mat-dialog-title>Save layout</h2>
    <mat-dialog-content>
      <label class="dialog-field">
        <span>Name</span>
        <input
          #field
          type="text"
          maxlength="40"
          [value]="name()"
          (input)="name.set(field.value)"
          (keydown.enter)="save()"
          placeholder="e.g. Mixing on the TV"
          autofocus
        />
      </label>
      @if (taken()) {
        <p class="dialog-note">A layout with this name exists: saving replaces it.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button mat-flat-button type="button" class="cut-btn" [disabled]="!name().trim()" (click)="save()">
        Save
      </button>
    </mat-dialog-actions>
  `,
})
export class SaveLayoutDialog {
  protected readonly ref = inject(MatDialogRef<SaveLayoutDialog, string>);
  private readonly existing = inject<string[]>(MAT_DIALOG_DATA);
  protected readonly name = signal('');

  protected taken(): boolean {
    return this.existing.includes(this.name().trim());
  }

  protected save(): void {
    const n = this.name().trim();
    if (n) this.ref.close(n);
  }
}
