"""Subsets Material Symbols (rounded) to the icons the app uses.

The full variable font is 5.4 MB and declared `font-display: block`, so every icon stays blank
until all of it has downloaded. This keeps only the ligatures used in src/app (pinned to
FILL 0, GRAD 0, opsz 24, wght 400) and writes src/styles/fonts/material-symbols-rounded-subset.woff2.

Run it after adding an icon:  python scripts/subset-icons.py   (needs fonttools and brotli)
"""

import glob
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'node_modules', 'material-symbols', 'material-symbols-rounded.woff2')
NAMES = os.path.join(ROOT, 'node_modules', 'material-symbols', 'index.d.ts')
OUT = os.path.join(ROOT, 'src', 'styles', 'fonts', 'material-symbols-rounded-subset.woff2')
AXES = {'FILL': 0, 'GRAD': 0, 'opsz': 24, 'wght': 400}


def used_icons(known):
    """Every quoted or bare snake_case word in src/app that is a Material Symbol name."""
    words = set()
    for path in glob.glob(os.path.join(ROOT, 'src', 'app', '**', '*.*'), recursive=True):
        if path.endswith('.spec.ts') or not path.endswith(('.ts', '.html')):
            continue
        text = open(path, encoding='utf-8').read()
        words.update(re.findall(r"'([a-z0-9_]+)'", text))
        words.update(re.findall(r'>\s*([a-z0-9_]+)\s*<', text))
    return sorted(w for w in words if w in known)


def ligatures(font):
    """Ligature text -> glyph name, from the font's GSUB ligature lookups."""
    rev = {g: chr(c) for c, g in font.getBestCmap().items()}
    out = {}
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if lookup.LookupType == 7:
                st = st.ExtSubTable
            for first, ligs in getattr(st, 'ligatures', {}).items():
                for lig in ligs:
                    text = rev.get(first, '') + ''.join(rev.get(c, '\0') for c in lig.Component)
                    out[text] = lig.LigGlyph
    return out


def main():
    known = set(re.findall(r'"([a-z0-9_]+)"', open(NAMES, encoding='utf-8').read()))
    icons = used_icons(known)
    font = TTFont(SRC)
    ligs = ligatures(font)
    missing = [i for i in icons if i not in ligs]
    if missing:
        sys.exit(f'no ligature in the font for: {missing}')

    chars = 'abcdefghijklmnopqrstuvwxyz0123456789_'
    opts = subset.Options()
    opts.layout_features = ['liga', 'rlig', 'calt']
    opts.layout_closure = False
    opts.flavor = None
    opts.name_IDs = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(text=chars, glyphs=[ligs[i] for i in icons])
    sub.subset(font)

    font = instancer.instantiateVariableFont(font, AXES)
    font.flavor = 'woff2'
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    font.save(OUT)
    print(f'{len(icons)} icons -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)} bytes)')
    print(' '.join(icons))


if __name__ == '__main__':
    main()
