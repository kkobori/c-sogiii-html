#!/usr/bin/env python3
"""hsp3cnv が出力した C++ の各命令コメント(// 元スクリプト)の直後に、実行位置の記録呼び出しを挿入する。
エラー時に「直前に実行していた命令」をログへ出すための仕組み。"""
import re, sys
p = sys.argv[1]
b = open(p, 'rb').read().decode('latin-1')
out = []
n = 0
decl = False
for line in b.split('\n'):
    out.append(line)
    if not decl and line.startswith('#include "hsp3r.h"'):
        out.append('void hsp3eb_trace(const char *s);')
        decl = True
    m = re.match(r'^([ \t]+)//[ \t]?(.*?)(\r?)$', line)
    if m and not m.group(2).startswith('Var initalize'):
        s = m.group(2).encode('latin-1')[:90].decode('latin-1')
        s = s.replace('\\', '\\\\').replace('"', '\\"').replace('?', '\\?')
        out.append('%shsp3eb_trace("%s");%s' % (m.group(1), s, m.group(3)))
        n += 1
open(p, 'wb').write('\n'.join(out).encode('latin-1'))
print('trace points:', n)
