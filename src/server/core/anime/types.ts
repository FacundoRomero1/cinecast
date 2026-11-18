export interface AnimeServer {
  id?: string;
  provider: string;
  name: string;
  url: string;
  type: 'hls' | 'iframe';
  language: 'latino' | 'sub' | 'es';
  audioLangs?: string[];
  qualityScore?: number;
}

export interface QualityScoreRecord {
  score: number;
  failures: number;
  successes: number;
  lastUpdated: number;
}
