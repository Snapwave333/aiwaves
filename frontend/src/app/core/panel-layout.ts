import { Injectable, computed, signal } from '@angular/core';
import { AiEvent } from './model';

/**
 * The workspace layout (local view state, like a Resolume / Ableton workstation): every module
 * sits in a dock (main column, right side, bottom row), in an order, at a size, shown or hidden.
 * Modules are dragged between docks, sized collapsed → compact → expanded → full screen, opened and
 * closed from the top bar. A few preset views, saved custom layouts, reset to default; the current
 * layout is saved on every change and comes back on the next launch.
 */

export type ModuleId =
  | 'player'
  | 'arrangement'
  | 'timeline'
  | 'mixer'
  | 'devices'
  | 'activity'
  | 'history'
  | 'handoff';
/** The older name, used by the panels. */
export type PanelId = ModuleId;
/** collapsed: one row; compact; expanded; full: the whole workspace. */
export type PanelState = 'collapsed' | 'compact' | 'expanded' | 'full';
export type Dock = 'main' | 'side' | 'bottom';

export interface ModulePlace {
  size: PanelState;
  visible: boolean;
}

export interface Layout {
  order: Record<Dock, ModuleId[]>;
  modules: Record<ModuleId, ModulePlace>;
}

export interface SavedLayout {
  name: string;
  layout: Layout;
}

export const MODULES: readonly { id: ModuleId; name: string; icon: string }[] = [
  { id: 'player', name: 'Player', icon: 'play_circle' },
  { id: 'arrangement', name: 'Arrangement', icon: 'view_timeline' },
  { id: 'timeline', name: 'Version timeline', icon: 'timeline' },
  { id: 'mixer', name: 'Mixer', icon: 'tune' },
  { id: 'devices', name: 'Devices', icon: 'settings_input_component' },
  { id: 'activity', name: 'Activity', icon: 'bolt' },
  { id: 'history', name: 'History', icon: 'history' },
  { id: 'handoff', name: 'aiwave411', icon: 'menu_book' },
];
export const DOCKS: readonly Dock[] = ['main', 'side', 'bottom'];
const SIZES: readonly PanelState[] = ['collapsed', 'compact', 'expanded', 'full'];
const IDS = MODULES.map((m) => m.id);

const KEY = 'aiwaves.layout.v1';
const CUSTOM_KEY = 'aiwaves.layouts.v1';
/** How long a collapsed panel stays open after the last change shown in it. */
export const PEEK_MS = 4000;

type Spec = Partial<Record<Dock, [ModuleId, PanelState, boolean?][]>>;

/** A layout from a compact description; modules it doesn't mention are added hidden. */
function build(spec: Spec): Layout {
  const order: Record<Dock, ModuleId[]> = { main: [], side: [], bottom: [] };
  const modules = {} as Record<ModuleId, ModulePlace>;
  for (const dock of DOCKS) {
    for (const [id, size, visible = true] of spec[dock] ?? []) {
      order[dock].push(id);
      modules[id] = { size, visible };
    }
  }
  for (const id of IDS) {
    if (!modules[id]) {
      order.side.push(id);
      modules[id] = { size: 'collapsed', visible: false };
    }
  }
  return { order, modules };
}

/** The preset views. "default" is Eli's: everything but the player and arrangement folded at the
 * top right. */
export const PRESETS: readonly { key: string; name: string; layout: Layout }[] = [
  {
    key: 'default',
    name: 'Default',
    layout: build({
      main: [
        ['player', 'expanded'],
        ['arrangement', 'expanded'],
      ],
      side: [
        ['activity', 'collapsed'],
        ['history', 'collapsed'],
        ['handoff', 'collapsed'],
        ['timeline', 'collapsed'],
        ['mixer', 'collapsed'],
        ['devices', 'collapsed'],
      ],
    }),
  },
  {
    key: 'studio',
    name: 'Studio',
    layout: build({
      main: [
        ['player', 'compact'],
        ['arrangement', 'expanded'],
        ['timeline', 'compact'],
      ],
      side: [
        ['activity', 'compact'],
        ['history', 'collapsed'],
        ['handoff', 'collapsed'],
      ],
      bottom: [
        ['mixer', 'compact'],
        ['devices', 'compact'],
      ],
    }),
  },
  {
    key: 'watch',
    name: 'Watch the agent',
    layout: build({
      main: [
        ['player', 'compact'],
        ['arrangement', 'expanded'],
      ],
      side: [
        ['activity', 'expanded'],
        ['devices', 'compact'],
        ['timeline', 'compact'],
        ['history', 'collapsed'],
        ['handoff', 'collapsed'],
      ],
      bottom: [['mixer', 'compact']],
    }),
  },
  {
    key: 'mixing',
    name: 'Mixing',
    layout: build({
      main: [
        ['player', 'collapsed'],
        ['arrangement', 'compact'],
      ],
      side: [
        ['activity', 'compact'],
        ['timeline', 'collapsed'],
        ['history', 'collapsed'],
        ['handoff', 'collapsed'],
      ],
      bottom: [
        ['mixer', 'expanded'],
        ['devices', 'expanded'],
      ],
    }),
  },
  {
    key: 'listening',
    name: 'Listening',
    layout: build({
      main: [
        ['player', 'expanded'],
        ['timeline', 'compact'],
        ['arrangement', 'collapsed'],
      ],
      side: [
        ['history', 'compact'],
        ['handoff', 'compact'],
        ['activity', 'collapsed'],
      ],
      bottom: [
        ['mixer', 'compact', false],
        ['devices', 'compact', false],
      ],
    }),
  },
];
export const DEFAULT_LAYOUT = PRESETS[0].layout;

/** A stored layout made safe: every module exactly once, known docks and sizes; else null. */
export function sanitizeLayout(raw: unknown): Layout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Layout>;
  if (!r.order || typeof r.order !== 'object' || !r.modules || typeof r.modules !== 'object')
    return null;
  const order: Record<Dock, ModuleId[]> = { main: [], side: [], bottom: [] };
  const seen = new Set<ModuleId>();
  for (const dock of DOCKS) {
    const list = (r.order as Record<string, unknown>)[dock];
    if (!Array.isArray(list)) continue;
    for (const id of list)
      if (IDS.includes(id as ModuleId) && !seen.has(id as ModuleId)) {
        seen.add(id as ModuleId);
        order[dock].push(id as ModuleId);
      }
  }
  const modules = {} as Record<ModuleId, ModulePlace>;
  for (const id of IDS) {
    const m = (r.modules as Record<string, Partial<ModulePlace> | undefined>)[id];
    const size = SIZES.includes(m?.size as PanelState) ? (m!.size as PanelState) : 'collapsed';
    // a relaunch never opens in full screen
    modules[id] = { size: size === 'full' ? 'expanded' : size, visible: m?.visible !== false };
    if (!seen.has(id)) order.side.push(id);
  }
  return { order, modules };
}

function load(): Layout {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    return sanitizeLayout(raw) ?? structuredClone(DEFAULT_LAYOUT);
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}

function loadCustom(): SavedLayout[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(CUSTOM_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map((s) => ({
        name: String((s as SavedLayout)?.name ?? '').slice(0, 40),
        layout: sanitizeLayout((s as SavedLayout)?.layout),
      }))
      .filter((s): s is SavedLayout => !!s.name && !!s.layout);
  } catch {
    return [];
  }
}

/** The panel that shows the control an event changes (it opens while the change plays). */
export function panelOf(e: Pick<AiEvent, 'verb' | 'target'>): ModuleId | null {
  const t = e.target ?? '';
  if (e.verb === 'mixer.set' || /^tracks\.[^.]+\.mixer\./.test(t)) return 'mixer';
  if (e.verb.startsWith('device.') || /^tracks\.[^.]+\.devices\./.test(t)) return 'devices';
  return null;
}

@Injectable({ providedIn: 'root' })
export class PanelLayout {
  readonly layout = signal<Layout>(load());
  readonly custom = signal<SavedLayout[]>(loadCustom());
  private readonly peeks = signal<ReadonlySet<ModuleId>>(new Set());
  private readonly timers = new Map<ModuleId, ReturnType<typeof setTimeout>>();

  /** The module shown full screen, if any (one at a time). */
  readonly fullId = computed(() => {
    const l = this.layout();
    return IDS.find((id) => l.modules[id].size === 'full' && l.modules[id].visible) ?? null;
  });

  /** The visible modules of a dock, in order. */
  dockModules(dock: Dock): ModuleId[] {
    const l = this.layout();
    return l.order[dock].filter((id) => l.modules[id].visible);
  }

  dockOf(id: ModuleId): Dock {
    const l = this.layout();
    return DOCKS.find((d) => l.order[d].includes(id)) ?? 'side';
  }

  // --- sizes ------------------------------------------------------------------------------------

  /** The chosen size. */
  state(id: ModuleId): PanelState {
    return this.layout().modules[id].size;
  }

  /** What the module shows right now: a peeking collapsed panel shows its compact view. */
  view(id: ModuleId): PanelState {
    const s = this.state(id);
    return s === 'collapsed' && this.peeks().has(id) ? 'compact' : s;
  }

  collapsed(id: ModuleId): boolean {
    return this.view(id) === 'collapsed';
  }

  /** Compact or collapsed (it renders its compact contents). */
  compact(id: ModuleId): boolean {
    const v = this.view(id);
    return v === 'collapsed' || v === 'compact';
  }

  full(id: ModuleId): boolean {
    return this.view(id) === 'full';
  }

  peeking(id: ModuleId): boolean {
    return this.peeks().has(id) && this.state(id) === 'collapsed';
  }

  canFold(_id: ModuleId): boolean {
    return true;
  }

  /** One size bigger: collapsed → compact → expanded → full screen. */
  more(id: ModuleId): void {
    const i = SIZES.indexOf(this.state(id));
    if (i < SIZES.length - 1) this.setSize(id, SIZES[i + 1]);
  }

  /** One size smaller: full screen → expanded → compact → collapsed. */
  less(id: ModuleId): void {
    const i = SIZES.indexOf(this.state(id));
    if (i > 0) this.setSize(id, SIZES[i - 1]);
  }

  /** Compact <-> expanded. */
  toggle(id: ModuleId): void {
    this.setSize(id, this.state(id) === 'expanded' ? 'compact' : 'expanded');
  }

  setSize(id: ModuleId, size: PanelState): void {
    this.endPeek(id);
    this.commit((l) => {
      // one module full screen at a time: the one that was goes back to expanded
      if (size === 'full')
        for (const other of IDS)
          if (other !== id && l.modules[other].size === 'full') l.modules[other].size = 'expanded';
      l.modules[id] = { size, visible: true };
    });
  }

  // --- show, hide, move -------------------------------------------------------------------------

  visible(id: ModuleId): boolean {
    return this.layout().modules[id].visible;
  }

  hide(id: ModuleId): void {
    this.endPeek(id);
    this.commit((l) => {
      const size = l.modules[id].size === 'full' ? 'expanded' : l.modules[id].size;
      l.modules[id] = { size, visible: false };
    });
  }

  show(id: ModuleId): void {
    this.commit((l) => (l.modules[id] = { ...l.modules[id], visible: true }));
  }

  toggleVisible(id: ModuleId): void {
    if (this.visible(id)) this.hide(id);
    else this.show(id);
  }

  /** Puts a module into a dock at `index` among that dock's visible modules. */
  move(id: ModuleId, dock: Dock, index: number): void {
    this.commit((l) => {
      for (const d of DOCKS) l.order[d] = l.order[d].filter((m) => m !== id);
      const shown = l.order[dock].filter((m) => l.modules[m].visible);
      const before = shown[Math.max(0, index)];
      const at = before === undefined ? l.order[dock].length : l.order[dock].indexOf(before);
      l.order[dock].splice(at, 0, id);
      l.modules[id] = { ...l.modules[id], visible: true };
    });
  }

  // --- presets and saved layouts ----------------------------------------------------------------

  applyPreset(key: string): void {
    const p = PRESETS.find((x) => x.key === key);
    if (p) this.replace(p.layout);
  }

  reset(): void {
    this.replace(DEFAULT_LAYOUT);
  }

  /** Saves the current layout under `name` (replacing one with the same name). */
  saveAs(name: string): void {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const list = this.custom().filter((s) => s.name !== clean);
    list.push({ name: clean, layout: structuredClone(this.layout()) });
    this.custom.set(list);
    globalThis.localStorage?.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  applyCustom(name: string): void {
    const s = this.custom().find((x) => x.name === name);
    if (s) this.replace(s.layout);
  }

  deleteCustom(name: string): void {
    const list = this.custom().filter((s) => s.name !== name);
    this.custom.set(list);
    globalThis.localStorage?.setItem(CUSTOM_KEY, JSON.stringify(list));
  }

  // --- peeks ------------------------------------------------------------------------------------

  /** Open a collapsed panel while a change plays in it; a burst keeps it open until it is quiet. */
  peek(id: ModuleId): void {
    if (this.state(id) !== 'collapsed' || !this.visible(id)) return;
    if (!this.peeks().has(id)) this.peeks.set(new Set([...this.peeks(), id]));
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        const next = new Set(this.peeks());
        next.delete(id);
        this.peeks.set(next);
      }, PEEK_MS),
    );
  }

  private endPeek(id: ModuleId): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.peeks().has(id)) {
      const next = new Set(this.peeks());
      next.delete(id);
      this.peeks.set(next);
    }
  }

  private replace(layout: Layout): void {
    for (const id of IDS) this.endPeek(id);
    this.commit((l) => Object.assign(l, structuredClone(layout)));
  }

  /** Every change goes through here and is saved at once (so a relaunch restores it). */
  private commit(change: (l: Layout) => void): void {
    const next = structuredClone(this.layout());
    change(next);
    this.layout.set(next);
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  }
}
