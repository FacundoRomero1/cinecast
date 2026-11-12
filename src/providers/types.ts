export interface CardItem {
  id: string;
  tmdbId: number;
  title: string;
  posterUrl: string;
  backdropUrl: string;
  year: number;
  rating: number;
  genres: string[];
  category: string;
  type: string;
  quality: string;
  upcoming: boolean;
}

export type CatalogSortOption = 'default' | 'rating' | 'year' | 'title' | 'added';

export interface CatalogQuery {
  q?: string | undefined;
  category?: string | undefined;
  genre?: string[] | undefined;
  genreMode?: 'all' | 'any' | undefined;
  yearFrom?: number | undefined;
  yearTo?: number | undefined;
  minRating?: number | undefined;
  sort?: CatalogSortOption | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  includeUpcoming?: boolean | undefined;
  facets?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface CatalogFacets {
  genres: Record<string, number>;
  yearRange: {
    min: number | null;
    max: number | null;
  };
  minYear: number | null;
  maxYear: number | null;
}

export interface CatalogQueryResult {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: CardItem[];
  facets?: CatalogFacets | undefined;
}

export interface HomeRow {
  id: string;
  title: string;
  items: CardItem[];
}

export interface HomeResponse {
  rows: HomeRow[];
}

export interface GenreCountItem {
  name: string;
  count: number;
}

export interface MediaDetailCastMember {
  name: string;
  character: string;
  photo: string | null;
}

export interface MediaDetailServer {
  name?: string;
  url?: string;
  type?: string;
  language?: string;
}

export interface MediaDetailItem extends CardItem {
  originalTitle?: string;
  overview?: string;
  releaseDate?: string;
  runtime?: number | null;
  director?: string;
  cast?: MediaDetailCastMember[];
  trailerKey?: string | null;
  servers?: MediaDetailServer[];
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
}

export interface CatalogProvider {
  id: string;
  capabilities: {
    offline: boolean;
  };
  getHome(seen?: string[]): Promise<HomeResponse>;
  query(q: CatalogQuery): Promise<CatalogQueryResult>;
  getGenres(): Promise<GenreCountItem[]>;
  search(q: string): Promise<CardItem[]>;
  getDetail(type: string, id: string | number): Promise<MediaDetailItem>;
}

export interface PlaybackProvider {
  id: string;
  resolve(item: CardItem | MediaDetailItem): Promise<{
    kind: 'embed' | 'hls' | 'file';
    url?: string;
    servers?: unknown[];
    sizeBytes?: number;
  }>;
}
