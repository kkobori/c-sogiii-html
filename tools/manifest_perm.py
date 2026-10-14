#!/usr/bin/env python3
"""AndroidManifest.xml に MANAGE_EXTERNAL_STORAGE を足す/外す(CIでapkだけに付けるため)。
使い方: manifest_perm.py add|remove <AndroidManifest.xml>"""
import sys
PERM = '    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />\n'
mode, path = sys.argv[1], sys.argv[2]
s = open(path, encoding='utf-8', newline='').read()
lines = [l for l in s.splitlines(True) if 'MANAGE_EXTERNAL_STORAGE' not in l]
s = ''.join(lines)
if mode == 'add':
    assert '</manifest>' in s, 'no </manifest>'
    s = s.replace('</manifest>', PERM + '</manifest>', 1)
elif mode != 'remove':
    sys.exit('usage: add|remove')
open(path, 'w', encoding='utf-8', newline='').write(s)
print(mode, 'MANAGE_EXTERNAL_STORAGE:', path)
