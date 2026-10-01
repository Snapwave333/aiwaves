#!/usr/bin/env python
"""Send a step script to the running Blender (blender-mcp add-on, 127.0.0.1:9876) and print the
reply. Usage: python blend.py STEP.py [--shot out.png]   (--shot: screenshot the Blender window after)"""

import json
import socket
import sys
from pathlib import Path


def send(msg, timeout=300):
    s = socket.create_connection(("127.0.0.1", 9876), timeout=timeout)
    s.sendall(json.dumps(msg).encode())
    buf = b""
    while True:
        chunk = s.recv(1 << 20)
        if not chunk:
            break
        buf += chunk
        try:
            reply = json.loads(buf.decode())
            break
        except json.JSONDecodeError:
            continue
    s.close()
    return reply


SHOT = '''
import bpy
win = bpy.context.window_manager.windows[0]
area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
with bpy.context.temp_override(window=win, screen=win.screen, area=area):
    bpy.ops.screen.screenshot(filepath=r"{path}")
print("shot")
'''

if __name__ == "__main__":
    code = Path(sys.argv[1]).read_text(encoding="utf-8")
    r = send({"type": "execute_code", "params": {"code": code}})
    print(json.dumps(r, indent=1)[:4000])
    if "--shot" in sys.argv:
        out = str(Path(sys.argv[sys.argv.index("--shot") + 1]).resolve())
        print(json.dumps(send({"type": "execute_code", "params": {"code": SHOT.format(path=out)}}))[:300])
