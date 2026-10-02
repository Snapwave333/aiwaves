// Copies the demo project (../fixtures/longing) into public/demo/longing for mock mode.
// The audio (~35 MB, not in git) is copied only when present; pass --no-audio to skip it.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, '..', 'fixtures', 'longing');
const dst = join(root, 'public', 'demo', 'longing');
const withAudio = !process.argv.includes('--no-audio');

if (!existsSync(src)) {
  console.warn(`[fixtures] ${src} not found; mock mode will have no data`);
  process.exit(0);
}

mkdirSync(join(dst, 'audio'), { recursive: true });
for (const f of ['project.json', 'events.jsonl', 'history.json', 'aiwave411.md']) {
  if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dst, f));
}

const wav = join(src, 'audio', 'master.wav');
const out = join(dst, 'audio', 'master.wav');
if (withAudio && existsSync(wav)) {
  const fresh =
    existsSync(out) &&
    statSync(out).size === statSync(wav).size &&
    statSync(out).mtimeMs >= statSync(wav).mtimeMs;
  if (!fresh) copyFileSync(wav, out);
  console.log('[fixtures] copied Longing project, events, history and audio');
} else {
  console.log('[fixtures] copied Longing project, events and history (no audio)');
}
