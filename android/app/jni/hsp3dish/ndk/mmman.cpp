
//
//		MMMAN : Multimedia manager source
//				for OpenSL/ES enviroment
//				onion software/onitama 2012/6
//
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <android/log.h>
#include "../../hsp3/hsp3config.h"
#include "../../hsp3/dpmread.h"
#include "../../hsp3/strbuf.h"
#include "../supio.h"
#include "../../javafunc.h"

#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>

#include "mmman.h"

#define sndbank(a) (char *)(mem_snd[a].mempt)

//---------------------------------------------------------------------------

//	MMDATA structure
//
typedef struct MMM
{
	//	Multimedia Data structure
	//
	int		flag;			//	bank mode (0=none/1=wav/2=mid/3=cd/4=avi)
	int		opt;			//	option (0=none/1=loop/2=wait/16=fullscr)
	int		num;			//	request number
	short	track;			//	CD track No.
	short	lasttrk;		//	CD last track No.
	void	*mempt;			//	pointer to sound data
	char	*fname;			//	sound filename (sbstr)
	int		vol;
	int		pan;

	//	OpenSL/ES Objects
	//
	SLObjectItf   playerObject;
	SLPlayItf     playerPlay;
	SLSeekItf     playerSeek;
	SLVolumeItf   playerVolume;
	SLPrefetchStatusItf    prefetchItf;

	//	FileDescriptor
	//
	int fd;

	//
	//
	int pause_flag;

	//	ループ開始位置(ms)  hsp-synthの'$'位置
	int loop_ms;

	//	スクリプトのmmstopで一時停止中(1=一時停止, mmplayで続きから再生)
	int script_pause;
	int ad_hold;			// paused automatically while an ad is shown
	int ad_resumed;			// resumed after an ad: a following mmplay of the same bank continues instead of restarting

} MMM;

//---------------------------------------------------------------------------
class FileDescriptor {
public:
	explicit FileDescriptor(int fd) : m_fd(fd) {}
	~FileDescriptor() {
		if (m_fd >= 0) close(m_fd);
	}

	// Prohibition of copying and moving
	FileDescriptor(const FileDescriptor&) = delete;
	FileDescriptor& operator=(const FileDescriptor&) = delete;

	// Relinquish ownership of file descriptors
	int release() {
		int fd = m_fd;
		m_fd = -1;  // renunciation of ownership
		return fd;
	}

	// Get file descriptor
	int get() const { return m_fd; }

private:
	int m_fd;
};
//---------------------------------------------------------------------------

MMMan::MMMan()
{
	//		initalize MM manager
	//
	mem_snd = NULL;
	mm_cur = 0;
	engine_flag = 0;

    SLresult result;

	// create engine
	const SLInterfaceID engine_ids[] = {SL_IID_ENGINE};
	const SLboolean engine_req[] = {SL_BOOLEAN_TRUE};
	result = slCreateEngine(&engineObject, 0, NULL, 1, engine_ids, engine_req);
	if (SL_RESULT_SUCCESS != result) {
		return;
	}
	// realize the engine
	result = (*this->engineObject)->Realize(this->engineObject, SL_BOOLEAN_FALSE);
	if (SL_RESULT_SUCCESS != result) {
		return;
	}
	// get the engine interface, which is needed in order to create other objects
	result = (*this->engineObject)->GetInterface(this->engineObject, SL_IID_ENGINE, &this->engineEngine);
	if (SL_RESULT_SUCCESS != result) {
		return;
	}
	// create output mix
	const SLInterfaceID mix_ids[1] = {SL_IID_VOLUME};
	const SLboolean mix_req[1] = {SL_BOOLEAN_TRUE};
	result = (*this->engineEngine)->CreateOutputMix(this->engineEngine, &this->outputMixObject, 0, mix_ids, mix_req);
	if (SL_RESULT_SUCCESS != result) {
		return;
	}
	// realize the output mix
	result = (*this->outputMixObject)->Realize(this->outputMixObject, SL_BOOLEAN_FALSE);
	if (SL_RESULT_SUCCESS != result) {
		return;
	}

	engine_flag = 1;
	//Alertf( "[MMMan Ready]" );
}


MMMan::~MMMan()
{
	//		terminate MM manager
	//
	ClearAllBank();

	if ( engine_flag ) {
		(*this->outputMixObject)->Destroy(this->outputMixObject);
		(*this->engineObject)->Destroy(this->engineObject);
	}
}

void MMMan::DeleteBank( int bank )
{
	MMM *m;
	char *lpSnd;

	m = &(mem_snd[bank]);
	if ( m->flag == MMDATA_INTWAVE ) {
			StopBank( m );
			(*m->playerObject)->Destroy(m->playerObject);

			// Close file descriptor
			if ( m->fd >= 0) {
				close(m->fd);
				m->fd = -1;
			}
	}
	lpSnd = sndbank( bank );
	if ( lpSnd != NULL ) {
		free( lpSnd );
	}
	mem_snd[bank].mempt=NULL;
}


SLuint32 MMMan::GetState( MMM *mmm )
{
	SLuint32 state = SL_PLAYSTATE_STOPPED;
	if ( mmm == NULL || mmm->playerPlay == NULL ) return state;
	(*mmm->playerPlay)->GetPlayState(mmm->playerPlay, &state);
	return state;
}


void MMMan::SetState( MMM *mmm, SLuint32 state )
{
	if ( mmm == NULL || mmm->playerPlay == NULL ) return;
	(*mmm->playerPlay)->SetPlayState(mmm->playerPlay, state);

	SLresult result;
	SLuint32 playState;

	do
	{
		// get current status
		result = (*mmm->playerPlay)->GetPlayState(mmm->playerPlay, &playState);
		if (result != SL_RESULT_SUCCESS)
		{
			break;
		}

		// wait
		usleep(100 * 10);  // 10ms
	} while (playState != state);

}


int MMMan::AllocBank( void )
{
	int ids,sz;

	if ( engine_flag == 0 ) return -1;

	ids = mm_cur++;
	sz = mm_cur * sizeof(MMM);
	if ( mem_snd == NULL ) {
		mem_snd = (MMM *)sbAlloc( sz );
	} else {
		mem_snd = (MMM *)sbExpand( (char *)mem_snd, sz );
	}
	mem_snd[ids].flag = MMDATA_NONE;
	mem_snd[ids].num = -1;
	return ids;
}


int MMMan::SearchBank( int num )
{
	int a;
	for(a=0;a<mm_cur;a++) {
		if ( mem_snd[a].num == num ) return a;
	}
	return -1;
}


MMM *MMMan::SetBank( int num, int flag, int opt, void *mempt, char *fname )
{
	int bank;
	MMM *m;

	bank = SearchBank( num );
	if ( bank < 0 ) {
		bank = AllocBank();
	} else {
		DeleteBank( bank );
	}

	if ( bank < 0 ) return NULL;

	m = &(mem_snd[bank]);
	m->flag = flag;
	m->opt = opt;
	m->num = num;
	m->mempt = mempt;
	m->fname = NULL;
	m->pause_flag = 0;
	m->vol = 0;
	m->pan = 0;
	m->fd = -1;
	m->loop_ms = 0;
	m->script_pause = 0;
	m->ad_hold = 0;
	m->ad_resumed = 0;
	m->playerObject = NULL;
	m->playerPlay = NULL;
	m->playerSeek = NULL;
	m->playerVolume = NULL;
	m->prefetchItf = NULL;
	return m;
}


void MMMan::ClearAllBank( void )
{
	int a;
	if ( mem_snd != NULL ) {
		Stop();
		for(a=0;a<mm_cur;a++) {
			DeleteBank( a );
		}
		sbFree( mem_snd );
		mem_snd = NULL;
		mm_cur = 0;
	}
}


void MMMan::Reset( void *hwnd )
{
	ClearAllBank();
	//hwm = hwnd;
	//avi_wnd = hwnd;
	//curmus=-1;
}


void MMMan::SetWindow( void *hwnd, int x, int y, int sx, int sy )
{
}


void MMMan::Pause( void )
{
	//		pause all playing sounds
	//
	MMM *m;
	int a;
	m = &(mem_snd[0]);
	for(a=0;a<mm_cur;a++) {
		PauseBank( m );
		m++;
	}
}


void MMMan::Resume( void )
{
	//		resume all playing sounds
	//
	MMM *m;
	int a;
	m = &(mem_snd[0]);
	for(a=0;a<mm_cur;a++) {
		ResumeBank( m );
		m++;
	}
}


void MMMan::PauseForAd( void )
{
	int npaused = 0;
	//		pause all playing sounds while an ad is shown
	for ( int a = 0; a < mm_cur; a++ ) {
		MMM *m = &(mem_snd[a]);
		if ( m->flag != MMDATA_INTWAVE ) continue;
		m->ad_resumed = 0;
		if ( GetState( m ) == SL_PLAYSTATE_PLAYING ) {
			SetState( m, SL_PLAYSTATE_PAUSED );
			m->pause_flag = 1;
			m->ad_hold = 1;
			npaused++;
		}
	}
	char nt[100];
	snprintf( nt, sizeof(nt), "snd pause banks=%d paused=%d", mm_cur, npaused );
	j_adNote( nt );
}


void MMMan::ResumeForAd( void )
{
	int nhold = 0, nres = 0, lastst = -1, lastsp = -1;
	//		resume the sounds paused for an ad
	for ( int a = 0; a < mm_cur; a++ ) {
		MMM *m = &(mem_snd[a]);
		if ( m->flag != MMDATA_INTWAVE || !m->ad_hold ) continue;
		m->ad_hold = 0;
		nhold++;
		lastst = (int)GetState( m );
		lastsp = m->script_pause;
		if ( GetState( m ) == SL_PLAYSTATE_PAUSED && m->script_pause == 0 ) {
			SetState( m, SL_PLAYSTATE_PLAYING );
			m->pause_flag = 0;
			m->ad_resumed = 1;
			nres++;
		}
	}
	char nt[120];
	snprintf( nt, sizeof(nt), "snd resume hold=%d resumed=%d state=%d spause=%d", nhold, nres, lastst, lastsp );
	j_adNote( nt );
}


void MMMan::Stop( void )
{
	//		stop all playing sounds
	//
	MMM *m;
	int a;
	m = &(mem_snd[0]);
	for(a=0;a<mm_cur;a++) {
		StopBank( m );
		m++;
	}
}


void MMMan::StopBank( MMM *mmm )
{
	if ( mmm == NULL ) return;
	SetState( mmm, SL_PLAYSTATE_STOPPED );
	mmm->pause_flag = 0;
	mmm->script_pause = 0;
	mmm->ad_hold = 0;
	mmm->ad_resumed = 0;
}


void MMMan::PauseBank( MMM *mmm )
{
	if ( mmm == NULL ) return;
	if ( GetState(mmm) == SL_PLAYSTATE_PLAYING ) {
		SetState( mmm, SL_PLAYSTATE_PAUSED );
		mmm->pause_flag = 1;
	}
}


void MMMan::ResumeBank( MMM *mmm )
{
	if ( mmm == NULL ) return;
	if ( mmm->pause_flag ) {
		SetState( mmm, SL_PLAYSTATE_PLAYING );
		mmm->pause_flag = 0;
	}
}


void MMMan::PlayBank( MMM *mmm )
{
	if ( mmm == NULL ) return;
	SetState( mmm, SL_PLAYSTATE_STOPPED );
	SeekBank( mmm,  0, SL_SEEKMODE_FAST );
	SetState( mmm, SL_PLAYSTATE_PLAYING );
	mmm->pause_flag = 0;
	mmm->script_pause = 0;
	mmm->ad_hold = 0;
	mmm->ad_resumed = 0;
}


void MMMan::SetLoopBank( MMM *mmm, int flag )
{
	if ( mmm == NULL ) return;
	if (flag) {
		SLresult lr = SL_RESULT_PARAMETER_INVALID;
		if ( mmm->loop_ms > 0 ) {
			//	途中からのループ(hsp-synthの'$')。非対応なら先頭ループにフォールバック
			lr = (*mmm->playerSeek)->SetLoop(mmm->playerSeek, SL_BOOLEAN_TRUE, (SLmillisecond)mmm->loop_ms, SL_TIME_UNKNOWN);
			__android_log_print( ANDROID_LOG_INFO, "HSPDIAG", "SetLoop start=%dms result=%d", mmm->loop_ms, (int)lr );
		}
		if ( lr != SL_RESULT_SUCCESS ) {
			(*mmm->playerSeek)->SetLoop(mmm->playerSeek, SL_BOOLEAN_TRUE, 0, SL_TIME_UNKNOWN);
		}
	} else {
		(*mmm->playerSeek)->SetLoop(mmm->playerSeek, SL_BOOLEAN_FALSE, 0, SL_TIME_UNKNOWN);
	}
}


void MMMan::SeekBank( MMM *mmm, int pos, SLuint32 seekMode )
{
	if ( mmm == NULL || mmm->playerSeek == NULL ) return;
	(*mmm->playerSeek)->SetPosition(mmm->playerSeek, pos, seekMode);
}


int MMMan::BankLoad( MMM *mmm, char *fname, const char *filepath )
{
	SLresult result;
	struct engine *en;

	if ( mmm == NULL ) return -9;

	en = javafunc_engine();
	//Alertf( "[MMMan] Start Loading %s [%x]",fname, en );

	off_t start, length;
	int fd;
	if ( filepath != NULL ) {
		//	通常ファイル(hsp-synthで合成したWAV)
		fd = open( filepath, O_RDONLY );
		if (fd < 0) return -3;
		start = 0;
		length = lseek( fd, 0, SEEK_END );
		lseek( fd, 0, SEEK_SET );
	} else {
		AAssetManager* mgr = en->app->activity->assetManager;
		if (mgr == NULL) return -1;

		AAsset* asset = AAssetManager_open(mgr, fname, AASSET_MODE_UNKNOWN);
		if (asset == NULL) return -2;

		// open asset as file descriptor
		fd = AAsset_openFileDescriptor(asset, &start, &length);
		AAsset_close(asset);
		if (fd < 0) return -3;
	}

	FileDescriptor fdWrapper(fd);

	// configure audio source
	SLDataLocator_AndroidFD loc_fd = {SL_DATALOCATOR_ANDROIDFD, fd, start, length};
	SLDataFormat_MIME format_mime = {SL_DATAFORMAT_MIME, NULL, SL_CONTAINERTYPE_UNSPECIFIED};
	SLDataSource audioSrc = {&loc_fd, &format_mime};

	// configure audio sink
	SLDataLocator_OutputMix loc_outmix = {SL_DATALOCATOR_OUTPUTMIX, this->outputMixObject};
	SLDataSink audioSnk = {&loc_outmix, NULL};

	// create audio player
	const SLInterfaceID player_ids[4] = {SL_IID_PLAY, SL_IID_VOLUME, SL_IID_SEEK, SL_IID_PREFETCHSTATUS};
	const SLboolean player_req[4] = {SL_BOOLEAN_TRUE, SL_BOOLEAN_TRUE, SL_BOOLEAN_TRUE, SL_BOOLEAN_TRUE};
	result = (*engineEngine)->CreateAudioPlayer(this->engineEngine, &mmm->playerObject, &audioSrc, &audioSnk,
	        4, player_ids, player_req);
	if (SL_RESULT_SUCCESS != result) return -4;

	// realize the player
	result = (*mmm->playerObject)->Realize(mmm->playerObject, SL_BOOLEAN_FALSE);
	if (SL_RESULT_SUCCESS != result) return -5;

	// get the play interface
	result = (*mmm->playerObject)->GetInterface(mmm->playerObject, SL_IID_PLAY, &mmm->playerPlay);
	if (SL_RESULT_SUCCESS != result) return -6;
	// get the seek interface
	result = (*mmm->playerObject)->GetInterface(mmm->playerObject, SL_IID_SEEK, &mmm->playerSeek);
	if (SL_RESULT_SUCCESS != result) return -7;
	// the volume interface
	result = (*mmm->playerObject)->GetInterface(mmm->playerObject, SL_IID_VOLUME, &mmm->playerVolume);
	if (SL_RESULT_SUCCESS != result) return -8;

	result = (*mmm->playerObject)->GetInterface(mmm->playerObject, SL_IID_PREFETCHSTATUS, &mmm->prefetchItf);
	if (SL_RESULT_SUCCESS != result) return -9;

	(*mmm->playerSeek)->SetPosition(mmm->playerSeek, 0, SL_SEEKMODE_FAST); 
	(*mmm->playerPlay)->SetPlayState(mmm->playerPlay, SL_PLAYSTATE_PAUSED);

	SLuint32 prefetchStatus = SL_PREFETCHSTATUS_UNDERFLOW;
	while (prefetchStatus != SL_PREFETCHSTATUS_SUFFICIENTDATA)
	{
		usleep(100 * 10);  // wait 10ms
		result = (*mmm->prefetchItf)->GetPrefetchStatus(mmm->prefetchItf, &prefetchStatus);
		if (SL_RESULT_SUCCESS != result) return -10;
	}

	(*mmm->playerPlay)->SetPlayState(mmm->playerPlay, SL_PLAYSTATE_STOPPED);

	mmm->fd = fdWrapper.release();
	return 0;
}


int MMMan::Load( char *fname, int num, int opt )
{
	//		Load sound to bank
	//			opt : 0=normal/1=loop/2=wait/3=continuous
	//
	int flag,res;
	MMM *mmm;

	flag = MMDATA_INTWAVE;
	mmm = SetBank( num, flag, opt, NULL, fname );

	if ( mmm != NULL ) {
		const char *fpath = NULL;
		char pathbuf[1024];
		int is_mml = ( strncmp( fname, "::mmlt::", 8 ) == 0 );
		if ( is_mml ) {
			//	MML: Java側のhsp-synth.jsで合成 -> "WAVのパス<TAB>ループ開始ms"
			char *r = j_mmlRender( fname + 8 );
			char *tab = strchr( r, '\t' );
			if ( r[0] == 0 || tab == NULL ) {
				__android_log_print( ANDROID_LOG_ERROR, "HSPERR", "MML render failed: %s", fname );
				mmm->flag = MMDATA_NONE;	//	鳴らないだけでスクリプトは止めない
				return 0;
			}
			size_t n = (size_t)( tab - r );
			if ( n >= sizeof(pathbuf) ) n = sizeof(pathbuf) - 1;
			memcpy( pathbuf, r, n ); pathbuf[n] = 0;
			mmm->loop_ms = atoi( tab + 1 );
			fpath = pathbuf;
		}
		res = BankLoad( mmm, fname, fpath );
		if ( res && is_mml ) {
			__android_log_print( ANDROID_LOG_ERROR, "HSPERR", "MML load failed(%d): %s", res, fname );
			mmm->flag = MMDATA_NONE;
			return 0;
		}
		if ( res ) {
			mmm->flag = MMDATA_NONE;
			Alertf( "[MMMan] Failed %s on bank #%d (%d)",fname,num,res );
			return -1;
		}
		if ( opt == 1 ) SetLoopBank( mmm, opt );
	}
	Alertf( "[MMMan] Loaded %s on bank #%d",fname,num );
	return 0;
}


int MMMan::Play( int num )
{
	//		Play sound
	//
    int bank;
	MMM *m;
    bank = SearchBank(num);
    if ( bank < 0 ) return 1;
	m = &(mem_snd[bank]);
	if ( m->flag == MMDATA_INTWAVE ) {
		if ( m->ad_resumed && GetState( m ) == SL_PLAYSTATE_PLAYING ) {
			//	broadcast stopped by an ad and already resumed: keep playing from the current position
			m->ad_resumed = 0;
		} else if ( m->ad_hold && GetState( m ) == SL_PLAYSTATE_PAUSED ) {
			SetState( m, SL_PLAYSTATE_PLAYING );
			m->ad_hold = 0;
			m->pause_flag = 0;
		} else if ( m->script_pause && GetState( m ) == SL_PLAYSTATE_PAUSED ) {
			//	mmstop(一時停止)後のmmplay: 続きから再生
			SetState( m, SL_PLAYSTATE_PLAYING );
			m->script_pause = 0;
			m->pause_flag = 0;
		} else {
			PlayBank( m );
		}
	}
	return 0;
}


void MMMan::Notify( void )
{
	//		callback from windows message
	//			"MM_MCINOTIFY"
	//
}


void MMMan::GetInfo( int bank, char **fname, int *num, int *flag, int *opt )
{
	//		Get MMM info
	//
	MMM *mmm;
	mmm=&mem_snd[bank];
	*fname = mmm->fname;
	*opt=mmm->opt;
	*flag=mmm->flag;
	*num=mmm->num;
}


/*--------------------------------------------------------------------------------*/

float gain_to_attenuation( float gain )
{
    return gain < 0.01F ? -96.0F : 20 * log10( gain );
}

void MMMan::SetVol( int num, int vol )
{
	MMM *mmm;
	int bank,flg;
	char ss[1024];
	bank = SearchBank( num );
	if ( bank < 0 ) return;

	mmm=&mem_snd[bank];
	mmm->vol = vol;
	if ( mmm->vol > 0 ) mmm->vol = 0;
	if ( mmm->vol < -1000 ) mmm->vol = -1000;

	flg=mmm->flag;
	switch(flg) {
	case MMDATA_INTWAVE:							// when "WAV"

		float myvol;
		float maxvol;
		maxvol = 1000.0;
		myvol = (float)(mmm->vol + 1000);
		myvol = myvol / 1000.0f;
		(*mmm->playerVolume)->SetVolumeLevel( mmm->playerVolume, (SLmillibel)(gain_to_attenuation( myvol ) * 100) );

		break;
	}
}


void MMMan::SetPan( int num, int pan )
{
	MMM *mmm;
	int bank,flg;
    int fixpan;
	bank = SearchBank( num );
	if ( bank < 0 ) return;

	mmm=&mem_snd[bank];
	flg=mmm->flag;
	switch(flg) {
	case MMDATA_INTWAVE:							// when "WAV"

	    fixpan = pan;
	    if ( fixpan < -1000 ) fixpan = -1000;
	    if ( fixpan > 1000 ) fixpan = 1000;
	    mmm->pan = fixpan;

		(*mmm->playerVolume)->EnableStereoPosition( mmm->playerVolume, SL_BOOLEAN_TRUE );
		(*mmm->playerVolume)->SetStereoPosition( mmm->playerVolume, fixpan );

		break;
	}
}


int MMMan::GetStatus( int num, int infoid )
{
	MMM *mmm;
	int bank,flg;
	int res;
	bank = SearchBank( num );
	if ( bank < 0 ) return 0;

	mmm = &(mem_snd[bank]);
	if ( mmm->flag != MMDATA_INTWAVE ) return 0;
	flg=mmm->flag;
	res = 0;
	switch( infoid ) {
	case 0:
		res = mmm->opt;
		break;
	case 1:
		res = mmm->vol;
		break;
	case 2:
		res = mmm->pan;
		break;
	case 16:
		if ( GetState(mmm) == SL_PLAYSTATE_PLAYING ) { res = 1; }
		break;
	}
	return res;
}


void MMMan::StopBank( int num )
{
	//		stop playing sound
	//
    int bank;
	MMM *m;
	//	スクリプトの mmstop は「一時停止」として扱う(再生位置を保持。mmloadで先頭に戻る)
	if ( num < 0 ) {
		for ( int a = 0; a < mm_cur; a++ ) PauseByScript( &(mem_snd[a]) );
		return;
	}
    bank = SearchBank(num);
    if ( bank < 0 ) return;
	m = &(mem_snd[bank]);
	PauseByScript( m );
}


void MMMan::PauseByScript( MMM *mmm )
{
	if ( mmm == NULL || mmm->flag != MMDATA_INTWAVE ) return;
	if ( GetState( mmm ) == SL_PLAYSTATE_PLAYING ) {
		SetState( mmm, SL_PLAYSTATE_PAUSED );
		mmm->script_pause = 1;
		mmm->ad_resumed = 0;
	}
}



