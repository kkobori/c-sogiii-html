#!/usr/bin/env python3
"""公式OpenHSP(Emscripten版)の音まわりへの最小パッチ(広告中の一時停止・再開用)。
 1) mp3/ogg(BGM): mmstop = 一時停止(位置を保存) / mmplay = 続きから。mmload し直すと先頭から。(MMLと同じ動き)
    - 公式は mmstop で曲を完全に止め、mmplay で毎回ファイルを読み直して先頭から再生する
 2) devcontrol "snd_adpause" / "snd_adresume": 広告表示中に、鳴っている音(mp3・wav)を全部一時停止→再開
使い方: web_patch_sound.py <OpenHSPのルート>
"""
import re, sys, os
root = sys.argv[1]
def rd(p): return open(os.path.join(root, p), encoding="utf-8").read()
def wr(p, s): open(os.path.join(root, p), "w", encoding="utf-8").write(s)
def rep(s, old, new, what, count=1):
    if s.count(old) < 1: sys.exit("sound patch: 見つかりません: " + what)
    return s.replace(old, new, count)

P = "src/hsp3dish/emscripten/mmman.cpp"
s = rd(P)
s = rep(s, "Mix_Music *m_music;\n", "Mix_Music *m_music;\nstatic bool music_paused = false;\t// [web patch] mmstop で一時停止中\n", "m_music 宣言")
s = rep(s, "void MusicTerm( void )\n{\n", "void MusicTerm( void )\n{\n\tmusic_paused = false;\n", "MusicTerm")
s = rep(s, "\tcurmusic = num;\n\tMix_HaltMusic();", "\tcurmusic = num;\n\tmusic_paused = false;\n\tMix_HaltMusic();", "MusicPlay")
s = rep(s, "\tcurmusic = -1;\n\tMix_HaltMusic();\n}", "\tcurmusic = -1;\n\tmusic_paused = false;\n\tMix_HaltMusic();\n}", "MusicStop")
# mmstop(全チャンネル)
s = rep(s, "\tMusicStop();\n\tMix_HaltChannel( -1 );", "\tMusicSoftStop();\n\tMix_HaltChannel( -1 );", "MMMan::Stop")
# mmstop <n>
s = rep(s, "\t\tif (num==curmusic) MusicStop();", "\t\tif (num==curmusic) MusicSoftStop();", "StopBank music")
# mmplay: 一時停止中の同じ曲なら続きから
s = rep(s, "\t\tif ( MusicLoad(m->fname)!=0 ) return -1;", "\t\tif ( music_paused && curmusic==num && m_music!=NULL ) {\n\t\t\tMix_ResumeMusic();\n\t\t\tmusic_paused = false;\n\t\t\tif (m->vol>=0) MusicVolume( m->vol );\n\t\t\treturn 0;\n\t\t}\n\t\tif ( MusicLoad(m->fname)!=0 ) return -1;", "Play music")
# mmload: 一時停止中の同じ番号を読み直すときは破棄
s = rep(s, "\tflag = MMDATA_INTWAVE;\n\tmmm = SetBank( num, flag, opt, NULL, fname, start, end );", "\tif ( music_paused && curmusic==num ) MusicTerm();\n\tflag = MMDATA_INTWAVE;\n\tmmm = SetBank( num, flag, opt, NULL, fname, start, end );", "MMMan::Load")
# MusicSoftStop と 広告用の関数
s = rep(s, "void MusicPause( void )\n", """void MusicSoftStop( void )
{
	//	[web patch] 再生中なら一時停止(位置保存)、そうでなければ従来どおり停止
	if (m_music==NULL) return;
	if ( Mix_PlayingMusic() && !Mix_PausedMusic() ) {
		Mix_PauseMusic();
		music_paused = true;
	} else if ( !music_paused ) {
		MusicStop();
	}
}

void MusicPause( void )
""", "MusicPause 手前")
s = s.rstrip("\n") + """

//---------------------------------------------------------------------------
//	[web patch] 広告表示中: 鳴っている音(mp3・wav)を全部一時停止し、終わったら続きから
static bool ad_music_paused = false;
static unsigned int ad_ch_mask = 0;

void HspMmAdPause( void )
{
	fprintf( stderr, "[snd] adpause music=%d playing=%d paused=%d\\n", m_music ? 1 : 0, m_music ? Mix_PlayingMusic() : 0, m_music ? Mix_PausedMusic() : 0 );
	ad_music_paused = false;
	if ( m_music && Mix_PlayingMusic() && !Mix_PausedMusic() ) {
		Mix_PauseMusic();
		ad_music_paused = true;
	}
	ad_ch_mask = 0;
	for ( int c = 0; c < MIX_MAX_CHANNEL; c++ ) {
		if ( Mix_Playing( c ) && !Mix_Paused( c ) ) {
			Mix_Pause( c );
			ad_ch_mask |= ( 1u << c );
		}
	}
}

void HspMmAdResume( void )
{
	fprintf( stderr, "[snd] adresume music_paused=%d ch_mask=%u\\n", ad_music_paused ? 1 : 0, ad_ch_mask );
	if ( ad_music_paused ) {
		Mix_ResumeMusic();
		ad_music_paused = false;
	}
	for ( int c = 0; c < MIX_MAX_CHANNEL; c++ ) {
		if ( ad_ch_mask & ( 1u << c ) ) Mix_Resume( c );
	}
	ad_ch_mask = 0;
}
"""
wr(P, s)

P = "src/hsp3dish/emscripten/hsp3dish.cpp"
s = rd(P)
m = re.search(r"static int hsp3dish_devcontrol\( char \*cmd, int p1, int p2, int p3 \)\n\{\n", s)
if not m: sys.exit("sound patch: hsp3dish_devcontrol が見つかりません")
inject = ('\tif ( strcmp( cmd, "snd_adpause" )==0 ) { HspMmAdPause(); return 0; }\n'
          '\tif ( strcmp( cmd, "snd_adresume" )==0 ) { HspMmAdResume(); return 0; }\n')
s = s[:m.end()] + inject + s[m.end():]
s = s[:m.start()] + "void HspMmAdPause( void );\nvoid HspMmAdResume( void );\n" + s[m.start():]
wr(P, s)
print("patched: mmman.cpp(mp3 一時停止/続きから, 広告用) / hsp3dish.cpp(snd_adpause/snd_adresume)")
