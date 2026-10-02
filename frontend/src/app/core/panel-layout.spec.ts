import { DEFAULT_LAYOUT, PRESETS, PanelLayout, sanitizeLayout } from './panel-layout';

describe('the workspace layout (docks, sizes, presets, saved layouts)', () => {
  afterEach(() => localStorage.clear());

  it('starts with the player and arrangement in the main dock and everything else folded at the top right', () => {
    const l = new PanelLayout();
    expect(l.dockModules('main')).toEqual(['player', 'arrangement']);
    expect(l.dockModules('side')).toEqual(['activity', 'history', 'handoff', 'timeline', 'mixer', 'devices']);
    expect(l.dockModules('bottom')).toEqual([]);
    expect(l.view('player')).toBe('expanded');
    for (const id of l.dockModules('side')) expect(l.view(id)).toBe('collapsed');
  });

  it('moves modules between docks and reorders them; the layout survives a relaunch', () => {
    const l = new PanelLayout();
    l.move('mixer', 'bottom', 0);
    l.move('devices', 'bottom', 1);
    l.move('timeline', 'main', 1); // between the player and the arrangement
    l.move('handoff', 'side', 0);
    expect(l.dockModules('bottom')).toEqual(['mixer', 'devices']);
    expect(l.dockModules('main')).toEqual(['player', 'timeline', 'arrangement']);
    expect(l.dockModules('side')).toEqual(['handoff', 'activity', 'history']);
    expect(l.dockOf('mixer')).toBe('bottom');
    const again = new PanelLayout();
    expect(again.dockModules('main')).toEqual(['player', 'timeline', 'arrangement']);
    expect(again.dockModules('bottom')).toEqual(['mixer', 'devices']);
  });

  it('opens and closes modules; a closed module keeps its place and a change into it does not open it', () => {
    const l = new PanelLayout();
    l.hide('history');
    expect(l.visible('history')).toBe(false);
    expect(l.dockModules('side')).not.toContain('history');
    l.peek('history');
    expect(l.peeking('history')).toBe(false);
    l.toggleVisible('history');
    expect(l.dockModules('side')).toEqual(['activity', 'history', 'handoff', 'timeline', 'mixer', 'devices']);
  });

  it('shows one module full screen at a time, and never comes back in full screen', () => {
    const l = new PanelLayout();
    l.setSize('arrangement', 'full');
    expect(l.fullId()).toBe('arrangement');
    l.setSize('mixer', 'full');
    expect(l.fullId()).toBe('mixer');
    expect(l.view('arrangement')).toBe('expanded');
    expect(new PanelLayout().view('mixer')).toBe('expanded'); // a relaunch opens normally
    l.less('mixer');
    expect(l.fullId()).toBeNull();
  });

  it('applies the preset views; reset goes back to the default', () => {
    const l = new PanelLayout();
    expect(PRESETS.map((p) => p.key)).toEqual(['default', 'studio', 'watch', 'mixing', 'listening']);
    l.applyPreset('mixing');
    expect(l.dockModules('bottom')).toEqual(['mixer', 'devices']);
    expect(l.view('mixer')).toBe('expanded');
    l.applyPreset('listening');
    expect(l.visible('mixer')).toBe(false);
    l.reset();
    expect(l.layout()).toEqual(DEFAULT_LAYOUT);
  });

  it('saves custom layouts by name (same name replaces), applies and deletes them, across relaunches', () => {
    const l = new PanelLayout();
    l.applyPreset('studio');
    l.saveAs('  My studio  ');
    l.reset();
    l.saveAs('My studio'); // replaces it with the default
    l.applyPreset('mixing');
    l.saveAs('Mix');
    expect(l.custom().map((c) => c.name)).toEqual(['My studio', 'Mix']);
    l.reset();
    const again = new PanelLayout();
    again.applyCustom('Mix');
    expect(again.dockModules('bottom')).toEqual(['mixer', 'devices']);
    again.applyCustom('My studio');
    expect(again.layout()).toEqual(DEFAULT_LAYOUT);
    again.deleteCustom('Mix');
    expect(new PanelLayout().custom().map((c) => c.name)).toEqual(['My studio']);
    l.saveAs('   ');
    expect(l.custom().length).toBe(2); // the in-memory copy of the first instance; blank names are ignored
  });

  it('refuses a corrupt stored layout: every module exactly once, known docks and sizes', () => {
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout({ order: 3 })).toBeNull();
    const fixed = sanitizeLayout({
      order: { main: ['player', 'player', 'nope'], side: ['mixer'], bottom: 'x' },
      modules: { player: { size: 'gigantic', visible: true }, mixer: { size: 'full', visible: false } },
    })!;
    expect(fixed.order.main).toEqual(['player']);
    expect(fixed.order.side[0]).toBe('mixer');
    expect(fixed.order.side).toContain('arrangement'); // missing modules are added
    expect(fixed.modules.player.size).toBe('collapsed');
    expect(fixed.modules.mixer).toEqual({ size: 'expanded', visible: false });
    localStorage.setItem('aiwaves.layout.v1', '{not json');
    expect(new PanelLayout().layout()).toEqual(DEFAULT_LAYOUT);
  });
});
