#!/usr/bin/env bash
# OpenHSP の hspcmp / hsp3cnv を Linux(64bit) 用にビルドする。
# 使い方: ./build_hsp_tools.sh [出力先ディレクトリ(既定 ./hsptools)]
#   出力: <out>/hspcmp  <out>/hsp3cnv  <out>/common/ (hspcmp の --compath 用)
# 備考: hsp3cnv は Windows 専用コードなので、最小限の置換でLinux化している。
set -euo pipefail
OUT="$(realpath -m "${1:-./hsptools}")"; mkdir -p "$OUT"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
git clone --depth 1 https://github.com/onitama/OpenHSP "$W/openhsp"
cd "$W/openhsp"

# 1) hspcmp (公式makefileがLinux対応済み)
make hspcmp -j"$(nproc)" >/dev/null
cp hspcmp "$OUT/hspcmp"; cp -r common "$OUT/common"

# 2) hsp3cnv (Windows依存を置換)
mkdir -p "$W/b/hsp3cnv" && cp -r src/hsp3 "$W/b/hsp3" && cp -r src/hspcmp "$W/b/hspcmp"
cp src/hsp3cnv/*.cpp src/hsp3cnv/*.h "$W/b/hsp3cnv/"
cd "$W/b/hsp3cnv"
cat > winshim.h <<'SH'
#pragma once
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <limits.h>
#include <unistd.h>
#include <stdint.h>
#define _MAX_PATH 4096
#define MAX_PATH 4096
#define _MAX_DIR 4096
#define _MAX_FNAME 4096
#define _MAX_EXT 4096
#define _stricmp strcasecmp
#define stricmp strcasecmp
static inline void _splitpath(const char*p,char*drv,char*dir,char*fn,char*ext){
  drv[0]=0; const char*s,*sl=NULL,*dot=NULL;
  for(s=p;*s;s++) if(*s=='/'||*s=='\\') sl=s;
  const char*base= sl? sl+1 : p;
  size_t dl= sl? (size_t)(sl+1-p):0; memcpy(dir,p,dl); dir[dl]=0;
  for(s=base;*s;s++) if(*s=='.') dot=s;
  if(dot){ size_t n=dot-base; memcpy(fn,base,n); fn[n]=0; strcpy(ext,dot);} else {strcpy(fn,base); ext[0]=0;}
}
SH
sed -i 's/#include <windows.h>/#include "winshim.h"/; s/#include <direct.h>//' *.cpp *.h
sed -i -E 's/MessageBox\( NULL, ([a-z]+), "error",MB_ICONINFORMATION \| MB_OK \);/fprintf(stderr,"%s\\n",\1);/' supio.cpp
# 64bit対応: axファイル内のSTRUCTDATは32bit配置(HED_STRUCTDAT)で読む。出力するC++側の型名は STRUCTDAT のまま。
sed -i -E 's/\bSTRUCTDAT\b/HED_STRUCTDAT/g' chsp3.cpp chsp3.h chsp3cpp.cpp chsp3cpp.h
sed -i 's/"HED_STRUCTDAT __HspFuncInfo/"STRUCTDAT __HspFuncInfo/' chsp3cpp.cpp
g++ -O1 -std=c++11 -fpermissive -w -DHSPLINUX -DHSP64 -I.. \
  chsp3.cpp chsp3cpp.cpp chsp3rev.cpp csstack.cpp main.cpp supio.cpp membuf.cpp \
  ../hspcmp/label.cpp ../hspcmp/localinfo.cpp -o "$OUT/hsp3cnv"
echo "OK: $OUT"
echo "  変換: $OUT/hspcmp -i -u -d --compath=$OUT/common/ main.hsp && $OUT/hsp3cnv main   # -> main.cpp"
