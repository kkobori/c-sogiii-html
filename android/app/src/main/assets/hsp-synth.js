// ====================================================================
// ★ 自作MMLシンセサイザークラス (hsp-synth.js) - バグ修正・完全版
// ====================================================================
class HspSynth {
    constructor() {
        console.log("HspSynth: 初期化を開始します...");
        this.SAMPLE_RATE = 44100;
        this.SAMPLE_SEC = 6;
        this.ENVDAT_SIZE = this.SAMPLE_RATE * this.SAMPLE_SEC;
        this.TABLE_SIZE = 256;
        this.NOISE_SIZE = 1024;
        this.ENV_MAX = 16;
        this.RELEASE_TIME_SEC = 0.5;

        this.REVERB_Z1_VOL_PCT = 15.0;  
        this.REVERB_Z2_VOL_PCT = 100.0; 
        this.REVERB_Z3_VOL_PCT = 50.0;  

        this.envtbl = new Int32Array(this.ENVDAT_SIZE * this.ENV_MAX);
        this.envendpos = new Int32Array(this.ENV_MAX);
        
        this.wave_sound = new Int32Array(6 * this.TABLE_SIZE);
        this.wave_noise = new Int32Array(this.NOISE_SIZE);
        this.wave_noise_short = new Int32Array(this.NOISE_SIZE);
        this.wave_noise_low = new Int32Array(256);
        this.wave_noise_mid = new Int32Array(512);
        this.wave_noise_high = new Int32Array(2048);

        // ★ファミコンリアルタイムノイズエミュレータ用の状態変数
        this.fc_reg = 1;      // 15bit LFSRレジスタ
        this.fc_timer = 0.0;  // タイマーカウンター

        this.freqtbl = [261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30, 440.00, 466.16, 493.88];
        this.powfoct = [0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0];

        this.loopStartSample = -1;
        this.lowpassState = 0;
        this.highpassPrev = 0;
        this.noiseFilterState = 0;

        // ★@128 ドラムキット用: MIDIノート番号 -> 楽器定義
        // type:'synth' は既存の波形合成(疑似バスドラム)を内部レシピで鳴らす
        // type:'sample' は PCM サンプルを再生する
        this.drumMap = {
            // crushBits: 0で無効。数を上げるほど音が粗く(チープに)なる(目安1〜6)
            // rateDiv: 1で無効。2以上にすると再生を間引いてサンプルレートを落とした感じになる
            // gain: この楽器だけの音量倍率。1.0が基準、0.5で半分、1.5で1.5倍など
            36: { type: 'sample', id: 'kick', crushBits: 0, rateDiv: 3, gain: 0.6 },   // Bass Drum 1 (o2c)
            38: { type: 'sample', id: 'snare', crushBits: 0, rateDiv: 1, gain: 1.2 },  // Acoustic Snare (o2d)
        };
        this.drumSamplesRaw = {
            // 16000Hz / 8bit(unsigned) / mono ・無音トリム済み
            kick: "gnqGbwpm685YBkqB0sMGO3Of75RpRy2X36Q7T+haBjeJxVpajw84gF5RL26BYGRlhY0nBk5ZJlhcEzqqmBMSepp6ITNNbb6FURF67z5f92e3wHagW8b6vaNvlcHV+Zai0NPCm+Kvj8rr9c/Ek2nX+sbXyKTCy8nSgFjc86x8s9Kol42bo56XcYqdhZB4eaygmIZjk6uBfoKOjIGilIl8dZaXfIWNfn+Jl4V4nI+LnZWVmpeUkqGunH6QtJGQxZZmf415fZ+3jFOFpIJea5mRjYOKcHd6ZHeKgGlaT3h+X29gRVpqaWJfWWBYUkZcaExXUllhLzdeYkVBUFVCPz83SlM7M081Q0Q2SkhDPENATVZDQEZRTkxOSmJ1aGZWS1BLRWBoTWBsYEg6WmtMSFVYYlxQd3hNU1tsiGVPiJFsiIR0qpZolpuHj3esoXqkro2epH6XoZWpnYaetqCPkJaSm7WTkJyWrI+HqqGcp6GYiIiko6afiaCrnpijrpeTkJ6foKWii36UjpyRhoF5iZKOa2KMbnNyTWuIcFpha19gak5MTl5yX1ZraGNwV09WWGNWUYR0UV1GV4xzVmlpdXBwb2x2ZHCJhYd3bImId4KFhpGXin9yjZF/nJ6erZJ7mrytmZmtxL2smanMrbLpwL/S0tPIycjRz8XP2NPZ3MbPz9Xc0tC/zdjTy7vPz8bexqXQ6cazz8Cvyb2vxtHAtbirsLi1qKKvoKSlqJqTqImVrJubk5Gam5GRj5CHgYOHgH5/a3iIb2SBdWNhbH9lWmVlY1hQXl9tbkxRWlh1XjhLYV1NTUtWW0lSUUlcUExUR1NYSFBOSVFSXmZKUlVZYUVWWFVlW1teXG9vWlRoeG9sd3dgbIF9d2xwhH9zeG90hHJ+gXF8jJGDf3eOmImCgIiFjJGHh5iie3uRiZh4bImOl4qBi359g3pzhI+AfIF/e3Z7hIN9cmxvanx9ZlxofmticFhDYGdlaE1UWE1ZTFNcSUNWVUpaYktJTEVOR1RTPkhUR0NMOjdQRzhFRUNNQURUOzVZQ0VWQ0NDSktCUVRHS0hOUkNGXlE8VmFUZVtVY2BlZnF2WmJvc3dzb3+HfX14hYVvgIN3kYt1jot2g5+WgpaUi4+SnJuGjKeorJ2Fn6+foJ2ZsqSgopClrp6RlKitnqeYnKSSn5SerKSqlZSllqmulqGZmKqYlaahl5WZhpScjIp7mKCIio6OjoePjIeDj4d7go+Vhnt4io2Bgod/h357kY6UeHeMjZd1h5+Vh3majYKXiIuajIiIlKiRg5WTkZqOlp2MnJqDkZmeo4iWpZScn5einZ2kj5WrmKOgkaygm62cnKielKGfl5ydmqGXlJmdpJKPppeOoJmYnZibmp6XjpaZlJaako6NmqGMhpKbkX6Rn4eHmpeJioySh5GPhJCIg4OHlJKEfoyRjnt/iIOUjH6DhoaNhn+BgIOHgoF7hId3g3x5jIJwdIGLdWZ6jHxug356gXZ0hIZyeI+Gd3GAj3ZwiIR5fX2CeXN0gX9zdnV2dnx5XnZ5bYR3ZXN6e3pwbW92dHd9c2d0e292bXKBbHFudntpcIJwYX5+fHprdnN8hm1qfXBtfW94dHV+bnN0eHZrcnt0eId8eX56f4J7hIp8en6DiIZ9foaFho2JioSDnY6Dh4yRhJKOfoqKiZyLhpiRgpGUgJObhYeTl5CUmoSMnYiKlI2NiYmXlYWRko6Mh5SUhYqOlpWJhpCak4aLkY+MhISMiICPiXqEjoyGhoeEi4h6fZGMgoB7gIaGe4GAdYKEenl4dW59gXiFe3CAf3d9dnt/eG97dnSJf2pmgId1a3R9e3lscn5ucntzbHh3bnZ2fWhye3B2Z3OHcGp8dnB1amuDdGZ0enhvaXBweXByfGttdnt3ZW59dG5vcnF6b2BxenV1bmhudm1re3hvcXp0cXdxZH2GcHhzcYB1cHhwhIZxc292eXF/f3B/e3uBdn98fYV5h4iBfImQeoqJhJCRjoeHkYiFlZSJh5KXmZKQk5iXkpGTmZWVmpickJOgmpOYn5Obn5KIkaGZkZWVlJKMlJCKjo6WloiBjpqShomGhpSCe4aPjIGBfYOIe3Z+fn6GhHhzcYWGdHdzcX14cWlqfHFmaG5wb2BqdVpeaGVlYGVnXVlfX2FaXm5jUVtfXGtgVFJdZmBaVF5jYlhUYF1OVWBYUldUWF1QVFxWXVtKU2BaTlViX1hUWGNjX1xka2BfY15pb2doa2RpcWpqcW5weG5renVzdW1wdXd4c3l7eYB7bm16d3Z4cneDgXV4f4R9d4OBgYB7hIaEdn6Og3eDhHmHi3x+goaDeH+HeXyFiH99hYF8eYKFfoV/e4mBf4B3i5V/fICFjoWBh4qEgoeIhoiHg4+MfomLiIqLiYqJiYaFjo+GiYmQmYeFgYWSjoeEhpCYkISGjZOUjIaFjY6Ij5iNi4+LkIqGjpSQiY2RjZiQf5CWmJGCiZKSjIqOj46QlI+Kj46RjoyUjo2VjoiPk46JioWNjo6Oh4uQloyEh5CLh5CHioqEjIyHhoeKi4SIkpCPi4WJiY6IiZKLhIiNjIKJioqMg4qJiI6HjoyCi4qIi4mQh46NhZCMho6MhJOPgI6ZlZCHi5KXmIiOmpOLlJuWlJCYmJaakJimnZiVmJ+YnqGem5iepqCUl6Ghm52jopaZn5maoKCcmJSYoZ2Wl5STlJSZkI6UkZaTipORio2OjIqQk42Hi5KKh46KjouLkIeGhoiJiYiDhIOKjHt/jYh/fIWJgX1+hYKCgYKBd319enx2d3h5dHp5bXyDdnR3fnl5eXN/enR/eXV4eXx/e3R3e3tyfYByeXZ1enx8dXl7enZ0d3J1d3R3c3J1dnBtcW5zdG9ub3Bqam9wdGxpbnFucXZvbXJzcHN0am91dHtwZXZ8dXZzbnR3dHRva3N3cHZyaHV4dHBvdG90d3Jucnd2enRyeH15eHdzeoCBeXuEf3x5f4WGh3+AhYODf32DioF9h4KBiISBgoaJgnyFh4GAgH+HhoGDf4GBhIZ+hYl8foSGhIJ/hIiCg4KBh42EeoCJhIGDhoZ9gIaDgH+KgoGEfoR/fYmEfIKBhYJ+gn6AhIKGgX+EgoKFg4KDgH+Cgn9/gHt7hIR6dYCFgHp5f319eXl9enp4dnt9fXlzfoF2d3t7enZ+enV9d3V4dXN1dnV3d3l4and8d3dweXp3eHF7e3R3eXp5eHZ5enR8fnZ8eXN4fn9+enZ8gHZ6gXt7enZ4fnp7enp7eX57c3d6d3Z1dXp4c3h4c3N1eXV0dXN1d3Z2d3d4dXJ1d3V3dXR2cnV6eHZ3end1eHt7eXt0d314e3t6fH58e3p6gYWAenyDgYKAf4ODhoaEgYSKioqGg4aKjIuGhYqOiYeIjI6Hi5GIioyNjouLkpCLjIuOkI+OjY+PjI2OiouRjIeMjYmKioeJioyLioiFjYiBiYuKhoaIh4iIioSAioyIhoSJh4aKhoKGjIuFgYqMhoaCg4uLhYGCh4aIioSEiIiDg4ODhYSFgn2DhoZ/f4aGhoOAgoaCfYOEf3+AfH6Bg4F+f3x/gX2BgYJ/fYF+e32AfoCCfX2AfX6Af357foF7fYF+foF/f4B+f318gH6BgH2AgYOCgX9+gYOFfn2FhH9+goSAgYaFgX6DhoSBgoWEgICJhH2Eg4WFfICGhIF+gYSBf39/goB/fnx/gXx9fnx9e3yBfnt+gYF+fHt+f358gIF+fHx/e31/e3x8fH59f358fX1/fHp/fnp5fX99enqAgXl6e3p+e3t9e3p6fHp5eXx8eXt+fnx7gIB5fH5/hH18g4B6eYGBfH2AgH+AfX+CfICCgYN9fX59f4B/goF6fIF9fn19gX19fnl7e35+eXp7fn56fIB/enp8foF7fYB7fH5/ent+fnt6fHx+f3l8gHx8enuBfnh8f3p8fnt6fHx7fXx4eHx+e3x9eHZ4fIB6dnp7eXt7ent6fH5+en5/fHx6fH99e319fn18fn5+en5+eX9+ent7fHp9gH98fXx6fX17gH17gH2BhYF/foCDfn2Bf31/goJ+fn17foCAfHx/f35/fXt/fn2Af3x8fH6BfXp7fYB8eXt7e356eHx/fHh6fn17enp6fXx6e3t8fHt3dXp/enV2e3t2d3l6fXx4d3d/f3p5en1+fnt3e319fn98enx/gH5+fX19f4B+foCCfXx+fX9/foCAgIKBfoB+gYR/foCEgH6CgoKDhYN/goeGgoCBhIaCgIKEhIKAhIaEgYGBgYKFg4KEg4OCgYKCgYGDgoGAgICBgX+Cg39/foCDgYF/fX5+gIB8fYGBgICCg359goOBf4CEhIB/goOAg4eAf4SDgYKDhIOCgIGCgYB/g4OBgYOEgoSGgoCGhoODhISFhYSFhoSFhoeJh4aHh4mFhomIiIWHh4eJh4aFiIaFh4SDhYWHhIKDhYaGhYSEhoWFhIeKhoSGhoeHhoiIiIaJjImHiY2MiYqKh4qNjYuIi42LioiJjIuJiImIh4eIiIiJh4iHhoeFhIaGhIWHhYeGg4WFhYaEhYeHhYaHhISFg4eJhIKFh4OEh4WFhoKDhYaHgoSHhIOChYeChIiHhYaGgoOEhIWGhYSFh4mFg4aGhoiIhIKGiIaFhoaGiIiGhoeGhomIhYaHhYOFhoWGhYWEhYWCg4OFhYSDgoSEhIKAg4SDhoJ+goKAg4R9foKCg4CAgYCBgYF/foGBfYCAfX9/f4B/f36Af3x+fn+Cfnp9gH57fX19fnt4e319fH17e358e3t6e3t7fXx7enl7fHt6fHx5fHt6fHx8ent+e3yBfHd6fX19e3x+gHt5fICBfXx+f399e3+AfH5+fX9/gYB9f4B9fX+AfoB/fX5+fX2CgXx7f4B9fn58f39/fXyAfnt8fX99fX18fH1+fXt9f3t7fHt7en59e316foB6eXx+fHh7fnx6ent5ent8e3p7fHt8fHt8fXx8e3t9fH1+fX5+fH5+fH9/fnx9gH1+gH9+fn9+fn+Afn5+fX59fX9+f4B+fHx9fn9/fX1+fX5/fn19fX5/gH99f39+f399foGBf318fn+AfX19f4B/f317f4J+e3t+fn1+fHx+f356fX9+fX59e3x+fnx8fHt7enp6e3t7eXt8enp8fHl5enl8fXl5e3t5eHp7e3x6enp6e3p8fXp6e3t8fHt7fH19e3t8f359f35/fnx/gICAf39/gYF/gYKAgIOCgICCg4OCgIGCgoODg4KBg4KDgoCCg4WDgYOCgYGCgYKBgYJ/foKDgYCBgIGBgoKChIGBg4KDgYGDgoKBgYGAgYKBgICAf4CAgIB/f3+Afn6CgX6AgH9+foKCfX2Ag4J9foGAgYB/gYKBgIGCgYCAgIGBgIGAgIOBfoB/gIKAgIGBgICAgoB/gYGCgX+BgYKBgICBgYGAgoKAgICBf3+BgH+AgYKBgYOCgIGCgoGBgYKCgoOBgIGAg4R/gYODgoCCg4KCgIKCg4OChIWCgYSFg4CChoWBgISDgYKCgYKCg4SDgYGCgICCgoKCgYCBgYCCgYGBfoCEgX6AgYCAgYGBgYGBgIGBgoKAgoKBgYKDgICDhIKAgoSCg4OCgoODgoKCg4ODhIKEhIKBgoSEgYCCgoOEgoGCg4KBg4OCgoSEhIGDg4GDhYKDhoWDgoODg4KCg4OBgoKCgYKFhIKDg4SEgoKEhYOBg4aFgoGDh4SCgoKEhIOCgYSEgoGChISDgYGDg4KDgYODgoSDgoOFhIGBg4KDgoGDgoKCg4GAgoKBgIGBf4CAf3+BgH5/gH9+f4CAf3+Af4B/gIB+f4F/fX+Afn1/f359fn19fX9+fX5+fn59fX5+fn5+fX6AgH5+f4B/foGBgICAgICAgYKBgIGEhICBgoGEg4SEgoKDhISCg4SFhYSEgoOEhIaGhISFhYaFhIaHhoaGhoWDhYaGhoaFhYSGhYWFhIWFg4SDg4SChIWDg4ODg4GChIKCgYCBgYKBgICBgX+Af36AgH5/gYB+f39/gIB/fn5+fn5+fXx8fX58fX18e3p7e3t9fHp5enx7enx8e3t7e3t7fX18fHt8fn19fXt8fn5+fn5+foCAfn9/f39/f3+AgIF/fn+AgH9/gIB/fn+AgH9/gICAgIB/f4CAgYGAgICAgICAgIB/gICAgH9+f4F/fn9/gIGAfn9/f3+Afn1/fn1/gH59fn1/gYB9fX9/f3+Af31+f35/gH5+fn+Af39/fn9+fX1+gIB+fX1/f35+f39/f4CAfn9/fn6AgoGAf4CBgH+AgICCgIGCgH+AgIOCgYGBg4KBgoKDg4GBg4OCgoKBg4WCgYKEhICAgoKCgoKDgoCBgYKCgYGAgIGDgoKBgYCAgYKBgH+AgoGAgYKAf3+AgICAgYB+f4GBf35/gH5/gICAf39+f4B/fn5/gH9/f4B/fn9+gIB+fn5/gIGAf3+AgH9/gH9/gIGBgIB/gIB/gIGBgH9/gIB/gIGBgH9/f4GBgIB+gIKBf3+AgoF/f4CCgH6AgYCAf4CBgYB/gICAf3+AgICAgICAgICAf4CBgX9/gYF/gYF/gYF/gICAgYB/f4GBf35/gH9+gIB/f4CAfn5/f39/fn5/f39/fn19fn5/f35+fn19f39/fn19f399fX+Af319fn99fX1+f35+fn5+f39+f39+fn9/f39/f3+Af39/gH9+f4CAgH+AgH9/fn9/f35+fn5/gH9+fn5+fX9+f35+f35+fX1+f399fX1+f39+fn5/gH99f4GAgH9/f3+Af39/f4B+foGAgICAf39+f4GAgIB/fn+Af3+Af31+gIB+foCBf3+Af35/f4CAf35+gIB+fX9/gH9+f39+fn9+fn59foB+fX5+fn1/f35+fn5/f39+f4B/fn9/fn+Af39+f39/gICAf3+AgYCAgYGBgICCg4KBgYGDgoKCgoKCgYCChIKAgYKCgoKCgYGBgYKCgoKBgYKCg4KCgoKBgoKCg4KBgYKDgoGBgoGBgoGCgoGCg4OCgoKCgoKDgoKDg4KBgoKCgoODgoKCg4KCgoGAgoOCgYGCg4GBgYGBgoGBgoKCgoKCgoKBgoKCgoOCgoKDg4ODgoKDg4KCgoKDg4OCgoKCgoKCgoKDgYGCg4OCgoKCgYKDgYGCgoKCgoKCgYGDg4GBgoKBgYKDgoKCgoGCgoOCgYKBgYKDgoKDg4KCgoOCgoGCg4ODgoKDhIKBgoSDgoOCgoODg4KCg4OBgIKDg4KBgYKCgYGBgoKBgYKCgYGBgoKCgYKCgoKBgIGBgoF/gICAgICBgH+AgH9+f4B+f4B/fn5/f39+fn9/f319f39+fn5+fn5+fn1+f319fn5+fX1/fn1+fn19fn5/f39+fn5/gH9+f39/gICAgICAgH9/gICAgH+AgH9+f4GAfoCBgH9/gIB/gIF/f4CBgICAgICAgICAgICBgH+AgIKCgICAgICAgICAgH+AgH9+f4B/fn9/f39/f4B/fn+AgH9+f4CAgH9/f4B/f4CAf3+Af39/f3+Af39/f39+fn9/f359fn9/fn5/fn19fX1+fn19fX1+fX1+fn19fX5+fn19fn5+fn5+f35/f39+f39/f39/gICAf39/gIGBgYCBgoGBgoKCgoKBgoKCgoKDg4KCgoOEg4KDhISDgoODg4KCg4WEg4OEhIOCg4ODgoODg4ODgoKDg4OCgYKCgoKBgYKDgoGBgoGBgoGBgIKCgYCBgIGBgYCBgYGBgIB/gIGBgYCBgYCAgICAgYB/gICAgIGBgH+AgIB/gICAgICAgICAgICAgICAgIGAgIGBgICAgIGAgICAgICAgICAf4CAgICBgH+AgICBgICBgYCAgYGAgYGBgYGBgYCBgYGAgIGBgYGBgICAgYGBgYCAgICAgYB/gIGBgYCAgYCAgH+AgYCAgICAgICAgICAgH9/f4CAgIB/fn5+f39+fn9/f39/fn9/f39/f39/fn9/f39+foCAf35+gH9/f4B/f39/f39/f3+Af39/f39/f4B/f35+f39/f39/f39/fn+AgH9/f3+AgH9/gICAgH9/f4CAf3+AgIB/f4CAgIB/gIB/f39/f39/gICAgIB/gICAgICAgICAgICBgYGAgICAgICAgH+AgICAgICAgIB/f4CAf39/f4CAf39/f4B/f4B/f39/f39/f39/gH9/f4CAfn+AgIB/f4CAgIB/f4CAf3+AgIB/f4CAf3+Af39/f39/gH9/f39/f4B/f39+f39+f39/f39+fn5+fn9/f39/f39+fn5/f39+fn9/f35+f39+f39/fn5/f39/f39/f39/f3+AgH9/f39/gICAf3+AgIB/f4B/f4CAgICAgICAgICAgH+AgICAgYGBgICAgICAgIGBgYCAgYGBgYGBgYCBgYGBgICBgYGBgYGAgIGBgIGBgICBgYCBgYCBgYGBgYCAgIGBgYGBgICBgYGCgYCBgYGBgYGBgYCAgICBgYB/gIGBgICBgYGAgICBgYCAgYGBgICBgYGBgYGBgYGBgYGBgYKCgYGBgYKCgYGBgYGCgoGBgYKCgYGCgoKBgYKCgYGCgoGCgoKCgoGBgoOCgYGCgoKCgoKBgYGCgoGBgYGBgYKCgYGCgYGBgoKBgIGBgYCAgYGBgIGBgYGBgYGBgYGBgICAgYCBgYCAgICAgICAgYGAgICAgIB/gIGAgICAgICAgICAgICAgICAgIB/gICAf4CAgICAgIB/gICAgICAgICAgYGAgICAgIGBgICAgYGAgYGBgIGCgYCAgYGBgYGBgYGBgYGBgYCAgYGBgIGBgYCAgYGBgYCAgIGAgIGBgYCAgIGBgICAgYCAgICAgICAgICAgICAgICAgICAgICAf4CAgICAgICAgICAgICAgICAgICAgIB/gICAgICAgICAgICAgYCAgYCAgICAgICBgIGAgICBgYCAgIGBgYGBgYGAgYGAgIGBgIGBgYGBgICAgIGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==",
            snare: "hH+u1L+1r6uolY90DAxIHBAjO5KlVRZbiYOAbmlkeVJ+xGo/ZIjT8OnZ46Wyxmm/1bWdd4eAnWp+WWKHh5EDDKDwz56phpLKlltMOVlVQy48dHxweHEzRmVcVypEYF9UZmpJWYCIZWCQjYSGjYiIprWhocK1t9XQr5y8spWvoZKyyMC1sbnYx6mVko9rhIdlWW5gaJBbMEVgWlR1WVdfXmRfbE5BOTBIVn1vTXR6couef2OCWk2PYlRwXZekiMvTsMjTrLycW5a2uaCRnK7Cp5qpjaateG9+k3V/fJ2oU1KKkop8aXBwd4JhXWtuTGh8TpRcWWc9O01ld2dWXHGDZV1mqs2GkJyBdnWZl1GAV26BcImNbm+Rqq6NgKqbxLV3dbHPo9XElrLiqYmVoGk6X1I5QDdtmUI8d6yQdGKQdGhbSYCQcC9odURLeU9qe35nd5ikh2N9c214dnJriI+Tp2uhoYuWuc2uyqHGx6TGlKyykat8eoeTZ12OcU16jVlzf3NqhGZldXBvXjdmlFZZaktjfmtOWGw7c599XVJodH+BbGmWpZSLnrqpeJyMn6OaspGjdZGfoJOnmYKIkaObmHF7iaGYh6R0rbWSk2NqXGh4Tm5OMnZlW2pTX15ldlFSdGiAdmdrc2hJeZOYco2MX4WKdIaHY3udk4unopvCpa/AvayaxZyhlpmHfnt4hm53aomxcoFngauDeXR4aGBhU1Q/VIJnVG1oi21tkoF0VkZjbGN2jH6Vj5GLaLiahnRtk3Z7fpB8hIaklJmsjaCWlYyJkI2KoaqfoJugh3V9i4N3bYB6VYOUZGGVkKNma4BZU0V2cmuAYlhze4dgWHNsYVuPjYJIj6J2mHiVjX14gJl8k6B4qbGgjX15iIF2o5JakH6QjX99dKShjpeSjWBqiJ99aXiLgol5X4l/Un18gntncI9vaZGMfHacoX2JiZWNfklzcWB6e25ld4OEj4lrem+RgW2Tb3CCZX6CfYyEi3CCoHdWmH+LopWho62ShpOEkZyEmG10eoeBiIRuonBZdmZ+pXBwjIB3Z25yfHCVe3V0WnKXgl98YnOHhpRqlnhnb3yYWn+AYoJxYWqiiJeph6uOno2YnZCRdn6FcnSCjniCeo+ilKaBjrOIZ32FZohzcIZLcXZzc3V5iZB6jZJvmINYbGdabWpceGp5in5riYOCbXeDk2Ngi5mEfaqFnqWMtplsiox8j4J0bX2CgoKJeZFigI1yd422iK2lbnGOeoBbR3WAcI6Gkol1goV+hnNmiXN7fIF0XJFyYIZfdXJ5empta3yRh4l9loyHhYaHkImOlpiWiYWIi3eXkH2KgG53nJB+d2+Nf3t3aoGEeomQdXJxcmJjkXJ7hol0bneEh4yHe5migY1+g3djjn6FZ2GKenyfdYF/inpmdVJ1dV9odoOTjY2mnH+Po5GTd5CSeZKDl5CTmpGYjGV8gXFccHRziIJ/fWZ1gXqEkIVtaHiHamOIa3aLg4Btb3RuhIF0in+Gf6Kadoyelo+XfGh2jI97cnZkbnSBhGiIeGiIbZR3hJJskKaGjIyKlZWDd49saomWkJaRfa6YfJp5dGlxdHB0dHp1dIWDgndyeYFiT3KBdIiPZYx3g4V/dHp9epmIe4KMkpR9j4Nwgnx9iHdvh3eDnX6DfoF7f4VtjI+Lkn6Yj36Php6sfGqRf3Zyd3R6dH1vfqNlh4iFh4N3aX+GeW9xeIRzd31leGtpbl92dpaEbHWDh3mHboCPgot8koqHl5uhlpqcgpGPl5KJlYV/f4F3coB0bH1vhX5uiISFbnuIaI6Jd3SKjoJ+gmtodm1hbWhtkoRzenWNg3yTgox+c4iIjYuIj39/imp9fImJd4iCeo2XeoSDg3+biYiDeI2Bg4mSe398gHhofX91dYF6cnp5gYR8eHaCdGt9dYNnbolyjpGIjH2GfIGWj5OHhpaNl4d+d3dycXd+d3t+f5CLiImPiISOgnWBa3R5cHqAcW94aHZ5cXaSi4WHhISOfouOdnByg3yNi5F8eIBziYZ+g5STh45zjIJ4eXmLh3qAiYaFiHZ/gWJ3fXZ1hn1whIOEdHWMeHuSeHl1cW95gWiEg5OJhpiKeH6Kh4KQhnx7foGBeYN5f3+GjHSBkpB+nZh6iIx6jHuLmIuBd3pzbGiFd2Rzd2hhfnJpgHt8gX5+dm90cYGIj5GGlp+ZgYuPhXeMh4KKhIp+f4Jyf4KEiI2BjYt0mo6JfYKCc39uZm9leHlpc3mAcnV+enl8fXJthYODjoaIi4h7gImIhYCMi4OCeIOFf5SHf42Gg4OFiIyLe42BgIV+c3V6dnJwd36HioWDf4iMfIeIiIGBgHF1bW9xdn53d3d4f396goWCi4mHf3JrdX10f32NdX2Ie4OCkIaQlZGSjpGLg42Aho6HgYSEe4iCgIWFd358c4B7dHZ0bW97dX52c3qEeXp7cXF+gnyHen+OgYh4eoqRh4WJjoV6gntygn57hX+CiIV2iYeLi3l+eoSEjYp8fIKIeoV+g4V8iIqDcH+Hg4B+h4iMhoZ9enpucXZwa25vaXJ/fXV5fYqGgpaPiY6JgYWGdICSkIiEe4J7coN/eoZ9hoiBe3h1enhxcnh4d4GKjYuIkYR6jYyIjImJgX2Id3yEf3d2cHmFgHKEiIOCh392jIh7eXt+hHyAgXB3dmt4e3N9g36Df4R8eICBkYmAin1xgoB4dHuHjIqDi4eFiJCLi5CFfH2Afnx7fYKGh3yFiYV9f3uLinB4dHpzdYF6f3WBfnh6fYKBfHWDi4eBd3Z0goF/foF+hol/gHeKiYeMiXx8in90eoKBhHp6hn6Ci4yRh4aKgH11gIGBdnx/e392f4OGio2Lg4iJgnd3fZCFfHlrc3Z1entzgod9eoGBeX6Cgn2Ff3l4c4SBeIuBgoWGjYmAhoWGiomckoeEfYGAfYGCgH97ioJ8d3t7dHaCf3+JfHl0fX+Gf3J+hYaBgoWJhYmEfIeAiYqCfn99fHdyc2p9gnp7iH56kIiGkH98eHuEdnx9fIOMhoeFhYWMhISGd4SIgH6DhoOFf3p8i49+hImKgX9/dHR0eHR3e3h4eIKChICBfH6DhYJ6gn6AeHx+gIV6fYeFgYeCh4R/h4OBh4SBhH2AiIqAe4SAfICLf36IhX58gn1/e358eX18e359e4WCgIJ7hIR5eYiGfn19gnyDiIeCf3d5iIZ/hYWGiYGBeX94dX94fH2GhomHf4ODfYKHfnmAf4OFhIJ7g4KBe32DgH57fHd0b355g4yHjYiGiox/fYOEg395fn5+gn+DgoaJjIGGjI2HgoKCgn98end7enR4dnd7dHh+eXl8gn11eHx3eoF8f42EgXx+ioCAfYCFhY2Qk42Ih4J/hoOAgoCIfoWJg4J/i4SDi4J7d39/gn51end7gn93dHN5dXd/eXp9gISBgYaIgX1+gYuBeXp/gXyAhHt+g4mGgYWIg3x7g4qEg4qEhYWFg4GDhoaEhn9+f3x7e4B5en9+fXt9goB8eHJ5fnx1fYd4fXx1fnt+gIODhYWLg4CCf4iKh4KCgoZ/g4eBgIeLg4eCfX+Ci4V9hYaAfnV4fHZ6hIV/fIWEeXx6c3d8gH+Ae4B9gn98hIR/g4iDe4J+fIGAgnqAgYGDgHx+enB3hYSCiYF/h4mJiIaOjoSEg4KJgoGEfYOBgoOBg319d3h1d318fX+BgYWDgH5+foR8dnx7f3t6fHt5eXt4foKFh4J/gYGAgoCGhoaKf4uNhIuDgIKBf3x3eYKFgYKChIB8fIGFhYGBh4F3f4iEfoGCfXl9hXtzdnt4fX99fYGDf4J+fnuBgn6DfIN9eoGFgoCAhX53e4SFf3h+hIWHjIiEhH99iIaEi4uOjYyEfoOBf4F5dnZ6eXh1en1/gXh6hH9+gn95d3Z3eHp7eH59e4SBgIKFh4KEf31+g4iHf3t+h4GCiIOKiIWLiYWDhYeFiYuGgoCAg3d+fXt8fH93cHd6gX99gYN3eoB9fX94dn2GhXuAhIV+fYGFg4WGgYB9d3l4fIF/hIF9g4CEgnqAg4eGgn+AgoWFgoWHg4SFiIiGi4Z9goJ/fHt8fIB+fX2AfXp5dnd7eHl+fHl/e399f3t+goOEfIGAfX6DhYWEg4aAhoKHioGEhoSEgYCDh4R+fYKBfoB+gH9+f398gYB3b3Z/gHp3gYCEgXx6fIGDiYiAfYqNfoJ/eYKAg4OBgoSJhYOCf4KBfX58fIOBfn55foR+e3h7e3l8goCAgXuAiYV9gX+CgYCCgH6AfHyDhYSKiYKAgH17gH+BfYGGg4B+g4B9fX2EgoB/gH+AgYeKiIGHhoWGhYiFhYOBfnhzdHZ5e3p3eH56e3t9eHyCgHt+enp+f4OAgYKDg4aGgoaJioeFhoSEioWChHt3eX6EgYKEh4mDfn+GgH19fHp3f4eEf36Af3+Bgnp4en1/gX98e3t+goGBe3yGg4GAf4WBgH56gIJ1fH57fH2HhoqLg36Gh4mHfX59eXx6eH58f4SHhYSEhYGFh39/goJ+fX57fn98f4B7d3x8gH16gH6GgYCAg4J9hYKGg4KEgIGChYF8gn93enuAfn+DfYCFgoKAhIWChoGCg35+hH19gISHgH+DhYJ4eHt1dnp9gXx7f36FgISCfoiFhouDfIB+gX98dXV+d32FgX98gYaGg4WDgoGChYiJhYeGfnx/g4KDfnyIgnt+goSCf4KDfnx7eX+CfHx8e319gYJ6dnx8eXl5fH+BgH1+f35/f4WFfn6Af4aEf4aLg4WJiISCg4OEg3+CiYODgoB+eHx6hIeBgX6Cg3x7gH96fIGDf3+Cfn2Af4B8eXp+eXh+hH94eHp5fICCgYF7eYGBfoCAg4OAhISAg4OCgoeGi4mMh4eMh4SEgoCEg4B/gX15fn6BgoOAfnx6dnuCgHp4fHh/fnl7enl/gH+CgH2BfHp9fH6CgIGEhIR+foB8hYR8fH6BgoaHhYODhoeCiYaEhX+BgIODgoCChISEg4B/fn19fnt6f36DhIOAfHt8f39+en+AgIJ/gHx5fn9/gX54d399e4CDgoCFgn1/goSCg4WEh4WEg4KBiIR9f4CBhIaDgH58foKAfXp8f36Af36BgIB/fYB+goN8fn6BgH19gX52e4CCgIaIgYGDg4KAgIGBf3x+gYKEg4J/fn5+fXx9fn98f4KAfH2FhX5+f4J/f4SCg4OFhYWCg4KBgIOGhHx+hIWHgXqAgHp5fX57fX55eX59f3+Af39+e3+BgIB+gH56e39/gYJ/f4F9gIOAhod9goaDgYKAgoaCg4B9goKDgICEhYSCfXx+g4SEgYGHhYB8f3+BgXx9gYSAgoB9e3+Bfnx6eXt6d3l7eX9+fXx8gISEf39+hIWBgH9/f4GDhIN+gIOBgYCEiYSFhYKDhYOEioiHiYWAe4CBf3yCgn18fH15fH59e3l5e3+Af4B+foF/enyDf4GBgoF+fXp/g4N+fn+Ag4ODhIV/f3t5fH+BgX58e36GiYKCg4GFhoKAhIB/gnx7gH+Bg4KFhoOBhYWCf36BgH+AfXl+g358gYB6e32Af4CDfH+BgX1+gXp9f4F/fYGAgX15fH56fX95fH2Af4CAgIGEhoKFiIaEhYR9foN9f4KBhYWEhICAgoGCh4eHhISIh4F/gH19e3uAfHx8en17e35/eXt/fn9+fXt+fX18enx8e31/fn99foKChIB7fH+FhIKDgYOEiYeChYWDg4SFg4GDg4KHgYSEhYaEhoaCgIB9eXh9gX5+gIF+e4CBf3p4eHd5e318e319e3t8d3x9e36ChoaEhIB/hIKBgoWBf31/gH18fYCHiomIhoSDh4KEg4CEgISEgX+Agn9+fHp7fYB/fHp9fn6DhICDgoCAgIN/foB+gH99e3d7gX+Cg4F/fX1+fn5+gIWEgYGAfXl7eXp9goN/goR+f4KAgIF9gIKEhIOEhYODhYOAgIKChIeFhISDgoJ/goJ/f358fn94eoB8fH+BfXx/e3p5e36AhICAg4SEgoB/eXp9fX18gH56f4B9f399gIF9f4SCg4ODg4SEf4CCgoOFg4aIhoR/f4OAfYKDf36BgoOFgH9/f4CCf3x+gn59fHyAf39/f4CCfnt9fHt7eXt/gH+AgYCAfn9/gIJ/gIB/gn1+gIF/gIF/gIGCfoGCg4ODg4SGhYSCgX+BgoaGgn+AgoCCgX17fX+AgH5/gX5+f318ent/gX9+f3+AgoWCf31+f357fYB/f39+fH+BgIGCgoOBf39+f4KBgoOChIB+gICEgoCAf4GDf318fXt+gICCgYKEhn58gICCg4GAgoGAf39+fXx/gIGFg4F+fX19foCCgoGAfXt7e35/f4CBgoOCgoGCgoGAgIB/f3x+f35+gIJ6e4B7f4CAg4OFhYKChIGDgX+BgYN/gYSDgYCAgX9+fX9/gH+Ag4B8foOAfYCAf359f3+Af316fH99foCAfoCAfn5+fn+Af4KCf319fX6AgYCBhYSDg4KFhYKAgIGCg4WDgH5+goKEhoSEgHx8fn97fn6AgoCAfX1+fH1+fHh7foGAgIF/gICBf39/f39/gH6Cf35+fH19f4B/gIKBgoOBf4GBgoOAgYKBgYGAgIKFhIKBhIOCgYGEgoKCgICBgoKCfnt9f3x4eH5/fX58foB/fn6Af4CBf35/fICBgH5+gICAgoKAfXt7fYGAgH99gYKEhIOCgoWCgH+AgYGBgIODhIODgoSFg4KAgoOBf4CBf319fXx9foCAgH18fn5+fX9+fX59fn58fHp8gYGCgH+DhIKBgoB/gYCAgIB/gIB+gIKCgYCDhYSCgICAg4KBgYKEgoCBgYCAf4CBfX1/gYSCgYKCgICBgYB9fX59fX18fHx7fH19fHyBgX+AgYGBf32AgYB/f39/foCAf4CCgn99gIGBgH+Bg4SDg4OChYSDg4SDgICCgX9+fH2AgYKCg4KBgn9/fX+Bf318f4CBfn+BgYGCgoGAfn98enx+f39/fX+Cf4B/fn98fn5+fXx8fICDgX+BhISCgYKDgIKFgYGDgoKAgYKEhICAgYOCgYGCg4GAgH+Af35/f35+gICAf4CCgH9/f4CAf39/fX1/f359fn9+fn5/fn1+fn6AgH+Af3+AgIKCgIKCgYCBgYOCg4KBgIGDgYGCg4KCg4KAgYKCgYGAf36BgYCAgYB/gH5+f399fH1+gYB+f39+fX9/fnx9fX+Af4B/gH9/f4CCgYGBf35/gYKCgYOCgoGBf4CAf4GDgoKBgYKCgoB/gICDg4GBgoGAf39+gYKCgH9/gICAfnx8fX19fHx+f39/f359fn9/foB+fYCAgH9+f4GBgYCBgoGBgH+AgoKAgoGBgoGBgYGBgYB/f4CBgICBgoGCgoCCgoKAgYB+f39/gIGCgn9/f36Afn19fXx8fn59fn5+fX9+fHx8fH6AgYCBgoOEgoKCgoKBg4ODgoGAfn5/f4GCgoGCg4KCgYKCgoCBg4KAf39/f4B/gIB/f359fn19fn9+gIF9f4CAgYCBgH9+gH9+f4B+fn9/f35/f39+fn5/gYKDg4KAgIKBgYKCgoKBgYKCgYGCgoKCgYB/gYKBgoGAf39/f3+Af31/f39/f318fX58e31+f3+BgIB/fn5/f36AgX+AgH+AgIB/f4GDgoGAgYKDgoGBgoKBgIGBgYF/gICAgYOEg4CAgIGBgX9+fX5/f39+f3+AgIB+fn9/gIB/f4B+f39+fn5+fX5+fn5/gYKCgoGBgYCBgYCBgoGBgYGBf3+Af3+AgYGAgX5/gICBgIGBgoJ/fn+AgICBgIGBgYGBf31/fn+AgIB/gIGCgH+AgH+AgYCAgYKCgYCBf39/f39/f39/f39+fn6AgICBgIB/f4CBgYGAgYGAgIGBgYCBgn99foB/f4CAf3+AgoKBgYGBgYGBgYB/gIB/f4CAf4CBgICCgX9/gICBgH9/fX1+fn9/f39+f4CAf39/gIGBgYGAgIB/f4CAf3+BgYB/gYKCgYCAgYGCgYGBf39+gICAgYGBgYCAgX9/f35/f36AgICAgH9/gIB/gYGAgH9/f39/gICAgYCAgH5/f35/gYB+f4CAgIGAf39+f39/f3+AgYGCgoKBgoOCgIGBgYGBgH+AgYKBgH9/gIGBgICBgH5/gICBgYB+fn+Af35+fn5+fX6Af3+AgICBgYGBgYGAgYCAgICAf3+Af39/gICAgX9/gICAgIGBgIB/f35/f3+AgYODgoKBgYCAgH9/f3+AgICAgICBgoGBgH+AgH9/fn9/f39+f4CAf4CAgYB/fn5/f4CAf3+AgYGAgICAgIGAf4CBf39/gIGBgoCAgYCAgIGBgIGBgYGAgH+AgYCAgH9+fn9/gIGBgH+AgIB/gICAgIGBgH9/f4CAgIF/fn9/f35/gH+AgYGAgICAgH+AgICAgYGAgIGBgYCAf3+AgIGBgoKCgYCAgH9+fn9/f3+AgIGBgYGAgIGBgYB/f39+f35/gICAgYKBgYGAf3+BgYGBgICAf35+f39/fn9/f3+AgYGBgICAgYCBgYGBgYB/gH+AgICAgYGCgoGAgICAf39/f3+BgYCAgH+AgICBgICAgH9/f4CAgICAgICAgH9+gICBgYB/gICAf3+AgICAf39/f4CAgYGAgIGBgoB/f4CBgICBgH+AgH9/gIGAgIGAgICAgICAgIGBgYGAgIGBgICAgICAf39+f39+fn9/fn5/f4CAgICAgICAgYGBgYB/gICAgICAgICBgYGBgYGBgICAgICBgYGBgICAgICAgICAgICBgH9/fn5/f39/gIGBgICAgIB/f3+Af3+AgH9/f4CAf4CAf3+AgICAgICAgICAgYGBgYGBgYGBgYGAgIGCgoGBgICBgIGBgYGBf39+fn5/fn5+fn+AgICAgIGBgYB/f4CAgICAgICAgICBgICAgYGBgIB/f36AgIGBgIGBgYCAf3+AgICAgIGBgYCAgYGAgIB/fn9/gICAgIB/gIGBgYKCgYF/f4CAgIB/f4CAf4CAgH9/f4B/f3+AgICAgYGBgYB+foCAgIGAgIGAgH9/f39/f39/f4CAgICAgIKCgYGAgICAgICAgICAgICBgYGBgYCAgH9/gIB/gICAgICAgICAgIB/f3+AgICAgICAgICAgH9+f39/f4CAgICAgICAgICBgoKBgICAf3+AgIGBgYGBgYGBgYGBgICAgIGBgICAgICAgIB/f39/f3+AgICAgICAgICBgICBgICAgH+Af35/gH9/f3+AgIGBgICAgICAgICBgYGBgoGBgYGBgYGAf4CAgICAf35/gICBgYCAgICAgICAf3+AgICAgICAgICAgICAgICAgH+AgICAgYGBgICAgICAf3+AgICAf4CAgYCAgICAgICBgYGAgICAgICAgICAgH9/gICAgICAgYGBgICAgICAgICAgYGBgIB/f35+fn9/f39/f4B/f4CAgYGAgYGAgYGBgYCAf39/f39/gICAgICBgYGBgICAgYCAgIB/f4CAgICAgYCAf39/gIGBgYGBgYCAgICAf39/f39/gICBgYGBgYCAgIB/f4CAgICAf39/f4CAgICBgYGBgICAgICAgYGAgICBgYGBgIB/f3+AgICAgICAgIB/gICAgICBgIGBgICAgICAgICAgICAgICAf3+AgICAgICAf3+AgICAgICAgICAgICAgICAgICBgYGBgICAgICAgIGAf4CAgICAgICAf39/f3+AgICAgICAgICAgICAgICAgICAgICAgA=="
        };
        this.drumSamples = {};
        for (const key in this.drumSamplesRaw) {
            const b64 = this.drumSamplesRaw[key];
            const bin = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
            const raw = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
            // 8bit unsigned(0-255) -> 符号付きレンジ(-32768〜32767相当)へセンタリング
            const centered = new Int32Array(raw.length);
            for (let i = 0; i < raw.length; i++) centered[i] = (raw[i] - 128) * 256;
            this.drumSamples[key] = { data: centered, sampleRate: 16000 };
        }

        this.makeTable();
        console.log("HspSynth: 初期化完了");
    }

    setEnvTbl(cnt, envid, val) { this.envtbl[cnt * this.ENV_MAX + envid] = val; }
    getEnvTbl(cnt, envid) { return this.envtbl[cnt * this.ENV_MAX + envid]; }
    setWaveSound(waveid, wpcnt, val) { this.wave_sound[waveid * this.TABLE_SIZE + wpcnt] = val; }
    getWaveSound(waveid, wpcnt) { return this.wave_sound[waveid * this.TABLE_SIZE + wpcnt]; }

    makeTable() {
        const pi = Math.PI;
        for (let cnt = 0; cnt < this.ENVDAT_SIZE; cnt++) {
            this.setEnvTbl(cnt, 0, 255);
            if (this.getEnvTbl(cnt, 0) > 0) this.envendpos[0] = cnt;

            let cutsec = Math.floor(this.ENVDAT_SIZE / this.SAMPLE_SEC);
            if (cnt < cutsec) this.setEnvTbl(cnt, 1, 255 - Math.floor((cnt * 255) / cutsec));
            if (this.getEnvTbl(cnt, 1) > 0) this.envendpos[1] = cnt;

            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 2));
            if (cnt < cutsec) this.setEnvTbl(cnt, 2, 255 - Math.floor((cnt * 255) / cutsec));
            if (this.getEnvTbl(cnt, 2) > 0) this.envendpos[2] = cnt;

            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 5));
            if (cnt < cutsec) this.setEnvTbl(cnt, 3, 255 - Math.floor((cnt * 255) / cutsec));
            if (this.getEnvTbl(cnt, 3) > 0) this.envendpos[3] = cnt;

            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 6));
            this.setEnvTbl(cnt, 4, 255);
            if (cnt < cutsec) this.setEnvTbl(cnt, 4, Math.floor((cnt * 255) / cutsec));
            if (this.getEnvTbl(cnt, 4) > 0) this.envendpos[4] = cnt;

            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 12));
            this.setEnvTbl(cnt, 5, 255);
            if (cnt < cutsec) this.setEnvTbl(cnt, 5, Math.floor((cnt * 255) / cutsec));
            if (this.getEnvTbl(cnt, 5) > 0) this.envendpos[5] = cnt;

            let sinwidth = 50;
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 3));
            let deg = (cnt * 360.0) / cutsec;
            let rad = deg * pi / 180.0;
            let getsin = Math.sin(rad) * sinwidth + sinwidth;
            this.setEnvTbl(cnt, 7, 255 - Math.floor(getsin));
            if (this.getEnvTbl(cnt, 7) > 0) this.envendpos[7] = cnt;

            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 5));
            deg = (cnt * 360.0) / cutsec; rad = deg * pi / 180.0;
            getsin = Math.sin(rad) * sinwidth + sinwidth;
            this.setEnvTbl(cnt, 8, 255 - Math.floor(getsin));
            if (this.getEnvTbl(cnt, 8) > 0) this.envendpos[8] = cnt;

            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 7));
            deg = (cnt * 360.0) / cutsec;
            rad = deg * pi / 180.0; getsin = Math.sin(rad) * sinwidth + sinwidth;
            this.setEnvTbl(cnt, 9, 255 - Math.floor(getsin));
            if (this.getEnvTbl(cnt, 9) > 0) this.envendpos[9] = cnt;

            this.setEnvTbl(cnt, 10, 255 - Math.floor((cnt * 127) / this.ENVDAT_SIZE));
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 6));
            if (cnt < cutsec) this.setEnvTbl(cnt, 10, Math.floor(Math.floor((cnt * 255) / cutsec) / 2) + 127);
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 3));
            if (cnt > cutsec) {
                sinwidth = 40;
                deg = (cnt * 360.0) / cutsec; rad = deg * pi / 180.0;
                getsin = Math.sin(rad) * sinwidth + sinwidth;
                this.setEnvTbl(cnt, 10, this.getEnvTbl(cnt, 10) - Math.floor(getsin));
            }
            if (this.getEnvTbl(cnt, 10) > 0) this.envendpos[10] = cnt;

            this.setEnvTbl(cnt, 11, 255 - Math.floor((cnt * 127) / this.ENVDAT_SIZE));
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 12));
            if (cnt < cutsec) this.setEnvTbl(cnt, 11, Math.floor(Math.floor((cnt * 255) / cutsec) / 2) + 127);
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 4));
            if (cnt > cutsec) {
                sinwidth = 35;
                deg = (cnt * 360.0) / cutsec; rad = deg * pi / 180.0;
                getsin = Math.sin(rad) * sinwidth + sinwidth;
                this.setEnvTbl(cnt, 11, this.getEnvTbl(cnt, 11) - Math.floor(getsin));
            }
            if (this.getEnvTbl(cnt, 11) > 0) this.envendpos[11] = cnt;

            this.setEnvTbl(cnt, 12, 255 - Math.floor((cnt * 127) / this.ENVDAT_SIZE));
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 24));
            if (cnt < cutsec) this.setEnvTbl(cnt, 12, Math.floor(Math.floor((cnt * 255) / cutsec) / 2) + 127);
            cutsec = Math.floor(this.ENVDAT_SIZE / (this.SAMPLE_SEC * 5));
            if (cnt > cutsec) {
                sinwidth = 30;
                deg = (cnt * 360.0) / cutsec; rad = deg * pi / 180.0;
                getsin = Math.sin(rad) * sinwidth + sinwidth;
                this.setEnvTbl(cnt, 12, this.getEnvTbl(cnt, 12) - Math.floor(getsin));
            }
            if (this.getEnvTbl(cnt, 12) > 0) this.envendpos[12] = cnt;
        }

        for (let wpcnt = 0; wpcnt < this.TABLE_SIZE; wpcnt++) {
            this.setWaveSound(0, wpcnt, (wpcnt % 256 < 128) ? 32767 : -32768);
            this.setWaveSound(1, wpcnt, (wpcnt % 256 < 64) ? 32767 : -32768);
            this.setWaveSound(2, wpcnt, (wpcnt % 256 < 32) ? 32767 : -32768);
            if (wpcnt % 256 < this.TABLE_SIZE / 2) {
                this.setWaveSound(3, wpcnt, -32767 + Math.floor(((wpcnt % 256) * 65534) / (this.TABLE_SIZE / 2)));
            } else {
                let pp = (wpcnt % 256) - (this.TABLE_SIZE / 2);
                this.setWaveSound(3, wpcnt, 32767 - Math.floor((pp * 65534) / (this.TABLE_SIZE / 2)));
            }
            this.setWaveSound(4, wpcnt, -32767 + Math.floor(((wpcnt % 256) * 65534) / this.TABLE_SIZE));
        }

        let lfsr = 0xACE1;
        for (let cnt = 0; cnt < this.NOISE_SIZE; cnt++) {
            let bit = ((lfsr >> 0) ^ (lfsr >> 2) ^ (lfsr >> 3) ^ (lfsr >> 5)) & 1;
            lfsr = (lfsr >> 1) | (bit << 15);
            this.wave_noise[cnt] = ((lfsr & 1) > 0) ? 32767 : -32767;
        }

        let lfsrShort = 0x40;
        for (let cnt = 0; cnt < this.NOISE_SIZE; cnt++) {
            let bit = ((lfsrShort >> 6) ^ (lfsrShort >> 5)) & 1;
            lfsrShort = ((lfsrShort << 1) | bit) & 0x7F;
            this.wave_noise_short[cnt] = ((lfsrShort & 1) > 0) ? 32767 : -32767;
        }
        
        let lfsrLow = 0xACE1;
        for (let cnt = 0; cnt < 256; cnt++) {
            let bit = ((lfsrLow >> 0) ^ (lfsrLow >> 2) ^ (lfsrLow >> 3) ^ (lfsrLow >> 5)) & 1;
            lfsrLow = (lfsrLow >> 1) | (bit << 15);
            this.wave_noise_low[cnt] = ((lfsrLow & 1) > 0) ? 32767 : -32767;
        }
        
        let lfsrMid = 0xACE1;
        for (let cnt = 0; cnt < 512; cnt++) {
            let bit = ((lfsrMid >> 0) ^ (lfsrMid >> 2) ^ (lfsrMid >> 3) ^ (lfsrMid >> 5)) & 1;
            lfsrMid = (lfsrMid >> 1) | (bit << 15);
            this.wave_noise_mid[cnt] = ((lfsrMid & 1) > 0) ? 32767 : -32767;
        }
        
        let lfsrHigh = 0xACE1;
        for (let cnt = 0; cnt < 2048; cnt++) {
            let bit = ((lfsrHigh >> 0) ^ (lfsrHigh >> 2) ^ (lfsrHigh >> 3) ^ (lfsrHigh >> 5)) & 1;
            lfsrHigh = (lfsrHigh >> 1) | (bit << 15);
            this.wave_noise_high[cnt] = ((lfsrHigh & 1) > 0) ? 32767 : -32767;
        }
    }

    generateAudioData(mmlTracks) {
        const maxSamples = this.SAMPLE_RATE * 600;
        const mixbuf = new Int32Array(maxSamples); 
        let globalWritePosMax = 0;
        this.loopStartSample = -1;

        const readNumber = (mml, start) => {
            let num = 0; let p = start;
            while (p < mml.length) {
                let c = mml.charAt(p);
                if (c >= '0' && c <= '9') { num = num * 10 + (c.charCodeAt(0) - 48); p++; } else { break; }
            }
            return num;
        };

        const getNumLength = (mml, start) => {
            let len = 0; let p = start;
            while (p < mml.length) {
                let c = mml.charAt(p);
                if (c >= '0' && c <= '9') { len++; p++; } else { break; }
            }
            return len;
        };

        const calcSamplesFromPattern = (pattern, beatsec) => {
            if (pattern.startsWith("00")) return 0;
            let nlen = parseInt(pattern.substring(0, 2), 10); if (isNaN(nlen) || nlen <= 0) return 0;
            let type = pattern.charAt(2);
            let sec = beatsec * (4.0 / nlen);
            if (type === '.') sec *= 1.5;
            else if (type === '}') sec = (beatsec * (4.0 / nlen)) / 3.0;
            return Math.floor(sec * this.SAMPLE_RATE);
        };

        const calcDynamicVolume = (current_sample, v_base, v_enabled, v_delta, v_wait_s, v_bend_s) => {
            if (!v_enabled) return v_base;
            if (current_sample < v_wait_s) return v_base;
            let target_v = v_base + v_delta; if (v_bend_s <= 0) return Math.max(0, Math.min(15, target_v));
            if (current_sample < v_wait_s + v_bend_s) { let ratio = (current_sample - v_wait_s) / v_bend_s;
            let v = v_base + Math.round((target_v - v_base) * ratio); return Math.max(0, Math.min(15, v));
            }
            return Math.max(0, Math.min(15, target_v));
        };

        const getNoiseStep = (wv, freq) => {
            if (wv >= 11 && wv <= 13) return 1.0;

            let step = (freq / 12.0) * this.NOISE_SIZE * 65536.0 / this.SAMPLE_RATE;
            switch (wv) {
                case 7: step *= 0.25; break;
                case 8: step *= 3.0; break;
                case 9: step *= 0.7; break;
            }
            return Math.max(65536.0, step);
        };

        const LFO_DEPTH = 0.3;

        // ★バグ修正：引数の末尾に lfo_freq を追加
        const processNoiseSample = (wv, freq, ph, wobble, xmod, lfo_ph, lfo_freq) => {
            if (wv >= 11 && wv <= 13) {
                const CPU_CLOCK = 1789773;
                const clockStep = CPU_CLOCK / this.SAMPLE_RATE;

                let base_period = CPU_CLOCK / freq;

                const frameLen = this.SAMPLE_RATE / 60;
                let frameIndex = Math.floor(ph / frameLen);
                
                const frameRand = (idx) => {
                    let x = Math.sin(idx * 4321.123) * 10000;
                    return x - Math.floor(x);
                };
                
                let period_mod_frame = 1.0;
                let fx_vol = 1.0;
                
                if (wv === 11) {
                    let r1 = frameRand(frameIndex);
                    let r2 = frameRand(frameIndex + 500);
                    period_mod_frame = 1.0 + r1 * 0.4;
                    fx_vol = 0.3 + r2 * 0.7;
                } else if (wv === 13) {
                    let r1 = frameRand(frameIndex);
                    let r2 = frameRand(frameIndex + 800);
                    period_mod_frame = 0.5 + r1 * 1.0;
                    fx_vol = 0.6 + r2 * 0.4;
                } else if (wv === 12) {
                    period_mod_frame = 1.0;
                    fx_vol = 1.0;
                }
                
                let command_period_mod = 1.0;
                
                if (lfo_ph !== undefined && lfo_ph !== null && lfo_freq > 0) {
                    command_period_mod += Math.sin(lfo_ph) * LFO_DEPTH;
                }
                if (xmod > 0) {
                    command_period_mod += Math.sin(ph / 2000.0) * (xmod * 0.05);
                }
                if (wobble > 0) {
                    command_period_mod += (Math.random() - 0.5) * (wobble * 0.04);
                }
                
                let final_period = base_period * period_mod_frame * command_period_mod;
                if (final_period < 4) final_period = 4;
                
                this.fc_timer += clockStep;
                while (this.fc_timer >= final_period) {
                    this.fc_timer -= final_period;
                    let bit0 = this.fc_reg & 1;
                    let feedback = bit0 ^ ((this.fc_reg >> 1) & 1);
                    this.fc_reg = (this.fc_reg >> 1) | (feedback << 14);
                }
                
                let raw_sample = (this.fc_reg & 1) ? -32767 : 32767;
                return raw_sample * fx_vol;
            }

            if (wv === 10) {
                let idx = (Math.floor(ph) >> 16) & 0xFF;
                return this.wave_noise_low[idx];
            }

            let isShort = (wv === 6);
            let noiseTbl = isShort ? this.wave_noise_short : this.wave_noise;
            let tableLen = isShort ? 127 : 1024;
            let sample = 0;
            let idx = (Math.floor(ph) >> 16);

            if (xmod > 0) {
                let mod = Math.sin(ph / 3000.0) * xmod * 200;
                idx += Math.floor(mod);
            }
            if (wobble > 0) {
                let jitterRange = wobble * (tableLen / 64.0);
                idx += Math.floor((Math.random() - 0.5) * jitterRange);
            }

            idx %= tableLen;
            if (idx < 0) idx += tableLen;

            sample = noiseTbl[idx];
            if (wv === 9) { sample = noiseTbl[idx & ~7]; }

            let cutoff = freq / 1000.0;
            switch (wv) {
                case 5: cutoff *= 0.8; break;
                case 6: cutoff *= 1.2; break;
                case 7: cutoff *= 0.5; break;
                case 8: cutoff *= 2.0; break;
                case 9: cutoff *= 0.7; break;
            }

            if (lfo_ph !== undefined && lfo_ph !== null) {
                let lfo_mod = Math.sin(lfo_ph) * LFO_DEPTH;
                cutoff *= (1.0 + lfo_mod);
            }

            cutoff = Math.max(0.02, Math.min(0.8, cutoff));
            this.noiseFilterState += (sample - this.noiseFilterState) * cutoff;
            sample = this.noiseFilterState;
            if (wv === 7) {
                this.lowpassState = (this.lowpassState * 15 + sample) / 16;
                sample = this.lowpassState * 1.4;
            }
            if (wv === 8) {
                let hp = sample - this.highpassPrev;
                this.highpassPrev = sample;
                sample = hp * 2.0;
                if (sample > 32767) sample = 32767;
                if (sample < -32768) sample = -32768;
            }
            if (wv === 9) {
                sample = Math.floor(sample / 4096) * 4096;
                sample *= 1.8;
                if (sample > 32767) sample = 32767;
                if (sample < -32768) sample = -32768;
            }

            return sample;
        };

        for (let mml of mmlTracks) {
            if (!mml || mml.length === 0) continue;
            this.noiseFilterState = 0;
            this.lowpassState = 0;
            this.highpassPrev = 0;
            
            this.fc_reg = 1;
            this.fc_timer = 0.0;

            let tempo = 120; let oct = 4;
            let deflen = 4; let volume = 8; let waveform = 0; let qtime = 8; let envno = 0;
            let writepos = 0;let wobble = 0;let xmod = 0;let noisemix = 0;let lfo_freq = 0;let lfo_phase = 0.0;
            let z_mode = 0; let last_freq = 0; let last_waveform = 0; let last_volume = 0; let last_phase = 0;
            let m_enabled = false; let m_semi_delta = 0; let m_wait_pat = "00_"; let m_bend_pat = "00_";
            let v_enabled = false;
            let v_cmd_writepos = 0; let v_base_vol = 8; let v_delta = 0; let v_wait_pat = "00_"; let v_bend_pat = "00_";
            let tuplet_mode = 0; let tuplet_count = 0; 
            
            let loopStack = [];
            let pospo = 0;
            while (pospo < mml.length) {
                let c = mml.charAt(pospo);
                if (c === ' ') { pospo++; continue; }
                if (c === '$') { this.loopStartSample = Math.floor(writepos / 2); pospo++; continue; }
                if (c === '{') {
                    tuplet_mode = 1; tuplet_count = 0; let scanpos = pospo + 1;
                    while (scanpos < mml.length) { let cc = mml.charAt(scanpos);
                    if (cc === '}') break; if ('abcdefgr'.includes(cc)) { tuplet_count++; } scanpos++;
                    }
                    pospo++; continue;
                }
                if (c === '}') { tuplet_mode = 0; pospo++; continue; }
                
                if (c === '[') { loopStack.push({ pos: pospo + 1, count: 0, init: 0 }); pospo++; continue; }
                if (c === ']') {
                    pospo++;
                    if (loopStack.length > 0) {
                        let state = loopStack[loopStack.length - 1];
                        if (state.init === 0) {
                            let lcnt = readNumber(mml, pospo); pospo += getNumLength(mml, pospo);
                            if (lcnt <= 0) lcnt = 2;
                            state.count = lcnt - 1; state.init = 1;
                        }
                        if (state.count > 0) { state.count--; pospo = state.pos; } else { loopStack.pop(); }
                    }
                    continue;
                }

                if (c === 't') { pospo++; tempo = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); continue; }
                if (c === 'o') { pospo++; oct = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); continue; }
                if (c === 'l') { pospo++; deflen = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); continue; }
                if (c === 'v') {
                    pospo++;
                    if (pospo < mml.length && (mml.charAt(pospo) === '+' || mml.charAt(pospo) === '-')) {
                        if (pospo + 9 <= mml.length) { try { v_delta = parseInt(mml.substring(pospo, pospo + 3), 10);
                        v_wait_pat = mml.substring(pospo + 3, pospo + 6); v_bend_pat = mml.substring(pospo + 6, pospo + 9); v_cmd_writepos = writepos;
                        v_base_vol = volume; v_enabled = true; } catch (e) { v_enabled = false; } pospo += 9;
                        } else { pospo++; }
                    } else { v_enabled = false;
                    volume = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); volume = Math.max(0, Math.min(15, volume)); v_base_vol = volume;
                    }
                    continue;
                }
                if (c === 'q') { pospo++; qtime = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); qtime = Math.max(1, Math.min(8, qtime)); continue; }
                if (c === 'p') { pospo++; envno = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); envno = Math.max(0, Math.min(this.ENV_MAX - 1, envno)); continue; }
                if (c === '@') { pospo++; waveform = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); continue; }
                if (c === 'w') { pospo++; wobble = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); wobble = Math.max(0, Math.min(15, wobble)); continue; }
                if (c === 'x') { pospo++; xmod = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); xmod = Math.max(0, Math.min(15, xmod)); continue; }
                if (c === 'n') { pospo++; noisemix = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); noisemix = Math.max(0, Math.min(15, noisemix)); continue; }
                if (c === 's') { pospo++; lfo_freq = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); lfo_freq = Math.max(0, Math.min(20, lfo_freq)); continue; }
                if (c === 'z') { pospo++; z_mode = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); continue; }
                if (c === 'm') {
                    pospo++;
                    if (pospo < mml.length && mml.charAt(pospo) === '0') { m_enabled = false; pospo++; }
                    else if (pospo + 9 <= mml.length) { let sign = mml.charAt(pospo);
                    if (sign === '+' || sign === '-') { try { m_semi_delta = parseInt(mml.substring(pospo, pospo + 3), 10);
                    m_wait_pat = mml.substring(pospo + 3, pospo + 6); m_bend_pat = mml.substring(pospo + 6, pospo + 9); m_enabled = true;
                    } catch (e) { m_enabled = false; } pospo += 9; } else { m_enabled = false; pospo++;
                    } } else { m_enabled = false; pospo++; }
                    continue;
                }
                if (c === '>') { oct++; pospo++; continue; } if (c === '<') { oct--; pospo++; continue; }

                if ('abcdefgr'.includes(c)) {
                    let notechar = c;
                    let sharp = false, flat = false, dot = false; pospo++;
                    if (pospo < mml.length) { let c2 = mml.charAt(pospo);
                    if (c2 === '+' || c2 === '#') { sharp = true; pospo++; } else if (c2 === '-') { flat = true; pospo++; } }
                    let nlen = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); if (nlen === 0) nlen = deflen;
                    if (pospo < mml.length && mml.charAt(pospo) === '.') { dot = true; pospo++; }

                    let beatsec = 60.0 / tempo;
                    let notesec = beatsec * (4.0 / nlen); if (dot) notesec *= 1.5;
                    let note_samples = Math.floor(notesec * this.SAMPLE_RATE);
                    let gate_samples = Math.floor((note_samples * qtime) / 8);

                    if (tuplet_mode > 0 && tuplet_count > 0) { note_samples = Math.floor(note_samples / tuplet_count); gate_samples = Math.floor((note_samples * qtime) / 8); }
                    let total_samples = note_samples;
                    while (pospo < mml.length && mml.charAt(pospo) === '&') {
                        pospo++;
                        if (pospo < mml.length && mml.charAt(pospo) === notechar) {
                            pospo++;
                            if (pospo < mml.length) { let tc2 = mml.charAt(pospo); if (tc2 === '+' || tc2 === '#') pospo++; else if (tc2 === '-') pospo++; }
                            let tie_len = readNumber(mml, pospo); pospo += getNumLength(mml, pospo); if (tie_len === 0) tie_len = deflen;
                            let tie_dot = false; if (pospo < mml.length && mml.charAt(pospo) === '.') { tie_dot = true; pospo++; }
                            let tie_notesec = beatsec * (4.0 / tie_len); if (tie_dot) tie_notesec *= 1.5;
                            let tie_samples = Math.floor(tie_notesec * this.SAMPLE_RATE);
                            if (tuplet_mode > 0 && tuplet_count > 0) tie_samples = Math.floor(tie_samples / tuplet_count);
                            total_samples += tie_samples;
                        }
                    }
                    note_samples = total_samples;
                    gate_samples = Math.floor((total_samples * qtime) / 8);
                    let v_wait_s = v_enabled ? calcSamplesFromPattern(v_wait_pat, beatsec) : 0;
                    let v_bend_s = v_enabled ? calcSamplesFromPattern(v_bend_pat, beatsec) : 0;

                    if (notechar === 'r') {
                        let mixpos = writepos >> 1;
                        let rest_samples = note_samples;
                        if (z_mode > 0 && last_freq > 0) {
                            let r_type = z_mode % 10;
                            let r_wave = last_waveform; if (z_mode < 100) { r_wave = Math.floor(z_mode / 10) % 10; }
                            let release_total = Math.floor(this.RELEASE_TIME_SEC * this.SAMPLE_RATE);
                            for (let cnt = 0; cnt < rest_samples; cnt++) {
                                let current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + cnt;
                                volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                                let maxamp = Math.floor((12000 * volume) / 15);
                                if (r_wave === 3) maxamp = Math.floor((24000 * volume) / 15);
                                let vol_factor = 0.0;
                                if (r_type === 1) vol_factor = this.REVERB_Z1_VOL_PCT / 100.0; else if (r_type === 2) { if (cnt < release_total) vol_factor = (this.REVERB_Z2_VOL_PCT / 100.0) * (1.0 - (cnt / release_total)); } else if (r_type === 3) { if (cnt < release_total) vol_factor = (this.REVERB_Z3_VOL_PCT / 100.0) * (1.0 - (cnt / release_total)); }
                                if (vol_factor > 0) {
                                    let amp = Math.floor(maxamp * vol_factor);
                                    if (r_wave < 5) { 
                                        let step = last_freq * this.TABLE_SIZE * 65536.0 / this.SAMPLE_RATE;
                                        let idx = (Math.floor(last_phase) >> 16) & 255; amp = Math.floor((this.getWaveSound(r_wave, idx) * amp) / 32767); last_phase += step;
                                        if (last_phase >= 16777216.0) last_phase -= 16777216.0; 
                                    } else if (r_wave >= 5 && r_wave <= 13) {
                                        let noise_step = getNoiseStep(r_wave, last_freq);
                                        if (lfo_freq > 0) { lfo_phase += 2.0 * Math.PI * lfo_freq / this.SAMPLE_RATE; if (lfo_phase >= 2.0 * Math.PI) lfo_phase -= 2.0 * Math.PI; }
                                        // ★バグ修正：第7引数に lfo_freq を引き渡し
                                        let sample = processNoiseSample(r_wave, last_freq, last_phase, wobble, xmod, lfo_phase, lfo_freq);
                                        
                                        if (r_wave >= 11 && r_wave <= 13 && noisemix > 0) {
                                            let tone_step = last_freq * this.TABLE_SIZE / this.SAMPLE_RATE;
                                            let tone_idx = Math.floor(cnt * tone_step) % this.TABLE_SIZE;
                                            let tone_sample = this.getWaveSound(0, tone_idx);
                                            sample = Math.floor((sample * (15 - noisemix) + tone_sample * noisemix) / 15);
                                        }

                                        amp = Math.floor((sample * amp) / 32767);
                                        let phaseWrap = (r_wave === 6) ? 8323072.0 : 67108864.0;
                                        last_phase += noise_step; if (last_phase >= phaseWrap) last_phase -= phaseWrap;
                                    }
                                    if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                                }
                                mixpos++;
                            }
                        } else { for (let cnt = 0; cnt < rest_samples; cnt++) { let current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + cnt; volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s); } }
                        writepos += rest_samples * 2;
                    } else {
                        let semitone = 0;
                        switch (notechar) { case 'c': semitone = 0; break; case 'd': semitone = 2; break; case 'e': semitone = 4; break; case 'f': semitone = 5; break; case 'g': semitone = 7; break; case 'a': semitone = 9; break; case 'b': semitone = 11; break; }
                        if (sharp) semitone++; if (flat) semitone--;
                        let workingOct = oct; while (semitone < 0) { semitone += 12; workingOct--; } while (semitone > 11) { semitone -= 12; workingOct++; }
                        workingOct = Math.max(0, Math.min(11, workingOct));
                        let base_freq = this.freqtbl[semitone] * this.powfoct[workingOct]; let target_freq = base_freq * Math.pow(2.0, m_semi_delta / 12.0);
                        let wait_samples = m_enabled ? calcSamplesFromPattern(m_wait_pat, beatsec) : 0; let bend_samples = m_enabled ? calcSamplesFromPattern(m_bend_pat, beatsec) : 0;
                        let phase = 0; let mixpos = writepos >> 1;

                        if (waveform < 5) {
                            let gateset_samples = gate_samples;
                            if (envno > 0 && gateset_samples > this.envendpos[envno]) gateset_samples = this.envendpos[envno];
                            for (let cnt = 0; cnt < gateset_samples; cnt++) {
                                let current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + cnt;
                                volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                                let maxamp = Math.floor((12000 * volume) / 15);
                                if (waveform === 3) maxamp = Math.floor((24000 * volume) / 15);
                                let current_freq = base_freq;
                                if (m_enabled && cnt >= wait_samples) { if (bend_samples <= 0) current_freq = target_freq; else if (cnt < wait_samples + bend_samples) { let ratio = (cnt - wait_samples) / bend_samples; current_freq = base_freq + (target_freq - base_freq) * ratio; } else current_freq = target_freq; }
                                let step = current_freq * this.TABLE_SIZE * 65536.0 / this.SAMPLE_RATE;
                                let idx = (Math.floor(phase) >> 16) & 255; let wave_sample = this.getWaveSound(waveform, idx);
                                let amp = Math.floor((wave_sample * maxamp) / 32767);
                                if (noisemix > 0) {
                                    // ★バグ修正：第7引数に lfo_freq を引き渡し
                                    let noise_sample = processNoiseSample(5, current_freq, phase, wobble, xmod, lfo_phase, lfo_freq);
                                    let noise_amp = Math.floor((noise_sample * maxamp) / 32767);
                                    amp = Math.floor((amp * (15 - noisemix) + noise_amp * noisemix) / 15);
                                }
                                if (envno > 0) amp = Math.floor((amp * this.getEnvTbl(cnt, envno)) / 255);
                                if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                                mixpos++; phase += step; if (phase >= 16777216.0) phase -= 16777216.0;
                            }
                        } else if (waveform >= 5 && waveform <= 13) {
                            let gateset_samples = gate_samples;
                            if (envno > 0 && gateset_samples > this.envendpos[envno]) gateset_samples = this.envendpos[envno];
                            for (let cnt = 0; cnt < gateset_samples; cnt++) {
                                let current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + cnt;
                                volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                                let maxamp = Math.floor((12000 * volume) / 15);
                                let current_freq = base_freq;
                                if (m_enabled && cnt >= wait_samples) { if (bend_samples <= 0) current_freq = target_freq; else if (cnt < wait_samples + bend_samples) { let ratio = (cnt - wait_samples) / bend_samples; current_freq = base_freq + (target_freq - base_freq) * ratio; } else current_freq = target_freq; }
                                
                                let noise_step = getNoiseStep(waveform, current_freq);
                                if (lfo_freq > 0) { lfo_phase += 2.0 * Math.PI * lfo_freq / this.SAMPLE_RATE; if (lfo_phase >= 2.0 * Math.PI) lfo_phase -= 2.0 * Math.PI; }
                                
                                // ★バグ修正：第7引数に lfo_freq を引き渡し
                                let sample = processNoiseSample(waveform, current_freq, phase, wobble, xmod, lfo_phase, lfo_freq);
                                
                                if (waveform >= 11 && waveform <= 13 && noisemix > 0) {
                                    let tone_step = current_freq * this.TABLE_SIZE / this.SAMPLE_RATE;
                                    let tone_idx = Math.floor(cnt * tone_step) % this.TABLE_SIZE;
                                    let tone_sample = this.getWaveSound(0, tone_idx);
                                    sample = Math.floor((sample * (15 - noisemix) + tone_sample * noisemix) / 15);
                                }

                                let amp = Math.floor((sample * maxamp) / 32767);
                                if (envno > 0) amp = Math.floor((amp * this.getEnvTbl(cnt, envno)) / 255);
                                if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                                mixpos++; 
                                let phaseWrap = (waveform === 6) ? 8323072.0 : 67108864.0;
                                phase += noise_step; if (phase >= phaseWrap) phase -= phaseWrap;
                            }
                        } else if (waveform === 128) {
                            // ★@128 ドラムキットモード: 音程(=MIDIノート番号相当)で楽器を選択
                            const midiNote = workingOct * 12 + semitone + 12;
                            const drum = this.drumMap[midiNote];
                            const gateset_samples = gate_samples;
                            if (drum && drum.type === 'sample' && this.drumSamples[drum.id]) {
                                const sdata = this.drumSamples[drum.id].data;
                                const srate = this.drumSamples[drum.id].sampleRate;
                                const step = srate / this.SAMPLE_RATE; // サンプル側の1サンプル進み幅
                                const rateDiv = (drum.rateDiv && drum.rateDiv > 1) ? drum.rateDiv : 1;
                                const crushLevels = (drum.crushBits && drum.crushBits > 0) ? Math.pow(2, drum.crushBits) : 0;
                                const crushStep = crushLevels ? (32768 / crushLevels) : 1;
                                const gain = (typeof drum.gain === 'number') ? drum.gain : 1.0;
                                for (let cnt = 0; cnt < gateset_samples; cnt++) {
                                    const current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + cnt;
                                    volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                                    const maxamp = Math.floor((24000 * volume * gain) / 15);
                                    let srcIdx = Math.floor(cnt * step);
                                    if (rateDiv > 1) srcIdx = Math.floor(srcIdx / rateDiv) * rateDiv; // サンプルレート感を粗く
                                    if (srcIdx >= sdata.length) break; // サンプルの最後まで再生し終えたら無音
                                    let amp = Math.floor((sdata[srcIdx] * maxamp) / 32767);
                                    if (envno > 0) amp = Math.floor((amp * this.getEnvTbl(cnt, envno)) / 255);
                                    if (crushLevels) amp = Math.round(amp / crushStep) * crushStep; // ビット数を落として粗くする(エンベロープ適用後に行うことで階段状を維持)
                                    if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                                    mixpos++;
                                }
                            } else if (drum && drum.type === 'synth') {
                                // 内部レシピで疑似バスドラムを合成(音程は使わず固定レシピ)
                                const synthFreq = drum.freq;
                                const synthTarget = synthFreq / Math.pow(2, drum.bendOctaves);
                                const bendSamplesFixed = Math.floor((drum.bendMs / 1000) * this.SAMPLE_RATE);
                                let dphase = 0;
                                for (let cnt = 0; cnt < gateset_samples; cnt++) {
                                    const current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + cnt;
                                    volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                                    const maxamp = Math.floor((12000 * volume) / 15); // バスドラム: 標準音量に戻す(@3同士の重なりによる音割れ対策)
                                    let cfreq = synthTarget;
                                    if (cnt < bendSamplesFixed) { const ratio = cnt / bendSamplesFixed; cfreq = synthFreq + (synthTarget - synthFreq) * ratio; }
                                    const dstep = cfreq * this.TABLE_SIZE * 65536.0 / this.SAMPLE_RATE;
                                    const idx = (Math.floor(dphase) >> 16) & 255;
                                    const wave_sample = this.getWaveSound(drum.wave, idx);
                                    let amp = Math.floor((wave_sample * maxamp) / 32767);
                                    if (envno > 0) amp = Math.floor((amp * this.getEnvTbl(cnt, envno)) / 255);
                                    if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                                    mixpos++; dphase += dstep; if (dphase >= 16777216.0) dphase -= 16777216.0;
                                }
                            }
                            // 未定義のノート番号は無音(将来ここにハイハットやタムを追加していく)
                        }

                        let blank_samples = note_samples - gate_samples;
                        if (blank_samples > 0) {
                            if (z_mode > 0) {
                                let r_type = z_mode % 10;
                                let r_wave = waveform; if (z_mode < 100) { r_wave = Math.floor(z_mode / 10) % 10; }
                                let release_total = Math.floor(this.RELEASE_TIME_SEC * this.SAMPLE_RATE);
                                for (let cnt = 0; cnt < blank_samples; cnt++) {
                                    let current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + gate_samples + cnt;
                                    volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                                    let r_maxamp = Math.floor((12000 * volume) / 15);
                                    if (waveform !== 3 && r_wave === 3) r_maxamp = Math.floor((24000 * volume) / 15);
                                    if (waveform === 3 && r_wave !== 3) r_maxamp = Math.floor((12000 * volume) / 15);
                                    let current_freq = base_freq;
                                    if (m_enabled) { let total_cnt = gate_samples + cnt; if (total_cnt >= wait_samples) { if (bend_samples <= 0) current_freq = target_freq; else if (total_cnt < wait_samples + bend_samples) { let ratio = (total_cnt - wait_samples) / bend_samples; current_freq = base_freq + (target_freq - base_freq) * ratio; } else current_freq = target_freq; } }
                                    let vol_factor = 0.0;
                                    if (r_type === 1) vol_factor = this.REVERB_Z1_VOL_PCT / 100.0; else if (r_type === 2) { if (cnt < release_total) vol_factor = (this.REVERB_Z2_VOL_PCT / 100.0) * (1.0 - (cnt / release_total)); } else if (r_type === 3) { if (cnt < release_total) vol_factor = (this.REVERB_Z3_VOL_PCT / 100.0) * (1.0 - (cnt / release_total)); }
                                    if (vol_factor > 0) {
                                        let amp = Math.floor(r_maxamp * vol_factor);
                                        if (r_wave < 5) { 
                                            let step = current_freq * this.TABLE_SIZE * 65536.0 / this.SAMPLE_RATE;
                                            let idx = (Math.floor(phase) >> 16) & 255; let wave_sample = this.getWaveSound(r_wave, idx); amp = Math.floor((wave_sample * amp) / 32767);
                                            if (noisemix > 0) {
                                                if (lfo_freq > 0) { lfo_phase += 2.0 * Math.PI * lfo_freq / this.SAMPLE_RATE; if (lfo_phase >= 2.0 * Math.PI) lfo_phase -= 2.0 * Math.PI; }
                                                // ★バグ修正：第7引数に lfo_freq を引き渡し
                                                let noise_sample = processNoiseSample(5, current_freq, phase, wobble, xmod, lfo_phase, lfo_freq);
                                                let noise_amp = Math.floor((noise_sample * amp) / 32767);
                                                amp = Math.floor((amp * (15 - noisemix) + noise_amp * noisemix) / 15);
                                            }
                                            phase += step; if (phase >= 16777216.0) phase -= 16777216.0; 
                                        } else if (r_wave >= 5 && r_wave <= 13) { 
                                            if (lfo_freq > 0) { lfo_phase += 2.0 * Math.PI * lfo_freq / this.SAMPLE_RATE; if (lfo_phase >= 2.0 * Math.PI) lfo_phase -= 2.0 * Math.PI; }
                                            let noise_step = getNoiseStep(r_wave, current_freq);
                                            // ★バグ修正：第7引数に lfo_freq を引き渡し
                                            let sample = processNoiseSample(r_wave, current_freq, phase, wobble, xmod, lfo_phase, lfo_freq);
                                            
                                            if (r_wave >= 11 && r_wave <= 13 && noisemix > 0) {
                                                let total_cnt = gate_samples + cnt;
                                                let tone_step = current_freq * this.TABLE_SIZE / this.SAMPLE_RATE;
                                                let tone_idx = Math.floor(total_cnt * tone_step) % this.TABLE_SIZE;
                                                let tone_sample = this.getWaveSound(0, tone_idx);
                                                sample = Math.floor((sample * (15 - noisemix) + tone_sample * noisemix) / 15);
                                            }

                                            amp = Math.floor((sample * amp) / 32767);
                                            let phaseWrap = (r_wave === 6) ? 8323072.0 : 67108864.0;
                                            phase += noise_step; if (phase >= phaseWrap) phase -= phaseWrap;
                                        }
                                        if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                                    }
                                    mixpos++;
                                }
                            } else { for (let cnt = 0; cnt < blank_samples; cnt++) { let current_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + gate_samples + cnt; volume = calcDynamicVolume(current_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s); } }
                        }

                        let last_total_s = Math.floor(writepos / 2) - Math.floor(v_cmd_writepos / 2) + note_samples;
                        volume = calcDynamicVolume(last_total_s, v_base_vol, v_enabled, v_delta, v_wait_s, v_bend_s);
                        let final_freq = base_freq;
                        if (m_enabled) { if (note_samples >= wait_samples) { if (bend_samples <= 0 || note_samples >= wait_samples + bend_samples) { final_freq = target_freq; } else { let ratio = (note_samples - wait_samples) / bend_samples; final_freq = base_freq + (target_freq - base_freq) * ratio; } } }
                        last_freq = final_freq; last_waveform = waveform; last_volume = volume; last_phase = phase;
                        writepos += note_samples * 2;
                    }
                    continue;
                }
                pospo++;
            }
            
            if (z_mode > 0 && last_freq > 0) {
                let release_samples = Math.floor(this.RELEASE_TIME_SEC * this.SAMPLE_RATE);
                let r_type = z_mode % 10; let r_wave = last_waveform; if (z_mode < 100) { r_wave = Math.floor(z_mode / 10) % 10; }
                let mixpos = writepos >> 1;
                for (let cnt = 0; cnt < release_samples; cnt++) {
                    let maxamp = Math.floor((12000 * last_volume) / 15);
                    if (r_wave === 3) maxamp = Math.floor((24000 * last_volume) / 15);
                    let vol_factor = 0.0;
                    if (r_type === 1) vol_factor = this.REVERB_Z1_VOL_PCT / 100.0;
                    else if (r_type === 2) vol_factor = (this.REVERB_Z2_VOL_PCT / 100.0) * (1.0 - (cnt / release_samples));
                    else if (r_type === 3) vol_factor = (this.REVERB_Z3_VOL_PCT / 100.0) * (1.0 - (cnt / release_samples));
                    if (vol_factor > 0) {
                        let amp = Math.floor(maxamp * vol_factor);
                        if (r_wave < 5) {
                            let step = last_freq * this.TABLE_SIZE * 65536.0 / this.SAMPLE_RATE;
                            let idx = (Math.floor(last_phase) >> 16) & 255; let wave_sample = this.getWaveSound(r_wave, idx); amp = Math.floor((wave_sample * amp) / 32767);
                            if (noisemix > 0) {
                                if (lfo_freq > 0) { lfo_phase += 2.0 * Math.PI * lfo_freq / this.SAMPLE_RATE; if (lfo_phase >= 2.0 * Math.PI) lfo_phase -= 2.0 * Math.PI; }
                                // ★バグ修正：第7引数に lfo_freq を引き渡し
                                let noise_sample = processNoiseSample(5, last_freq, last_phase, wobble, xmod, lfo_phase, lfo_freq);
                                let noise_amp = Math.floor((noise_sample * amp) / 32767); amp = Math.floor((amp * (15 - noisemix) + noise_amp * noisemix) / 15);
                            }
                            last_phase += step; if (last_phase >= 16777216.0) last_phase -= 16777216.0;
                        } else if (r_wave >= 5 && r_wave <= 13) {
                            if (lfo_freq > 0) { lfo_phase += 2.0 * Math.PI * lfo_freq / this.SAMPLE_RATE; if (lfo_phase >= 2.0 * Math.PI) lfo_phase -= 2.0 * Math.PI; }
                            let noise_step = getNoiseStep(r_wave, last_freq);
                            // ★バグ修正：第7引数に lfo_freq を引き渡し
                            let sample = processNoiseSample(r_wave, last_freq, last_phase, wobble, xmod, lfo_phase, lfo_freq);
                            
                            if (r_wave >= 11 && r_wave <= 13 && noisemix > 0) {
                                let tone_step = last_freq * this.TABLE_SIZE / this.SAMPLE_RATE;
                                let tone_idx = Math.floor(cnt * tone_step) % this.TABLE_SIZE;
                                let tone_sample = this.getWaveSound(0, tone_idx);
                                sample = Math.floor((sample * (15 - noisemix) + tone_sample * noisemix) / 15);
                            }

                            amp = Math.floor((sample * amp) / 32767);
                            let phaseWrap = (r_wave === 6) ? 8323072.0 : 67108864.0;
                            last_phase += noise_step; if (last_phase >= phaseWrap) last_phase -= phaseWrap;
                        }
                        if (mixpos < maxSamples) mixbuf[mixpos] += amp;
                    }
                    mixpos++;
                }
                writepos += release_samples * 2;
            }
            if (writepos > globalWritePosMax) globalWritePosMax = writepos;
        }

        let realSamples = Math.floor(globalWritePosMax / 2);
        if (realSamples <= 0) realSamples = 1;
        const pcm = new Int16Array(realSamples);
        const LIMIT_THRESHOLD = 26000; // ここまでは今まで通りそのまま
        const LIMIT_CEILING = 32000;   // 最終的な天井(なだらかに近づく)
        for (let i = 0; i < realSamples; i++) {
            let mix = mixbuf[i];
            const sign = mix < 0 ? -1 : 1;
            const abs = Math.abs(mix);
            if (abs > LIMIT_THRESHOLD) {
                const over = abs - LIMIT_THRESHOLD;
                const range = LIMIT_CEILING - LIMIT_THRESHOLD;
                mix = sign * (LIMIT_THRESHOLD + range * (1 - Math.exp(-over / range)));
            }
            if (mix > 32767) mix = 32767; if (mix < -32768) mix = -32768;
            pcm[i] = Math.round(mix);
        }
        return pcm;
    }
}

window.HspSynth = HspSynth;
