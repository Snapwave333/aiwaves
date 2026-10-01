import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Inside the desktop shell (Electron, frameless with overlaid window controls) the app bar doubles
// as the title bar; see styles/_shell.scss.
if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'))
  document.documentElement.classList.add('is-electron');

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
