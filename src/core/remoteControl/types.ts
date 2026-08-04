export interface IRemoteControlConfig {
    enabled: boolean;
    port: number;
    accessToken?: string;
    allowLanOnly: boolean;
}

export interface IApiResponse<T = any> {
    code: number;
    message: string;
    data?: T;
}

export interface IPlayerStatus {
    isPlaying: boolean;
    currentMusic: IMusic.IMusicItem | null;
    playList: IMusic.IMusicItem[];
    progress: {
        position: number;
        duration: number;
    };
    repeatMode: string;
    quality: string;
    volume: number;
}

export interface ISearchResult {
    query: string;
    results: IMusic.IMusicItem[];
    plugin: string;
}
