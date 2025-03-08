export interface ReaperSearchMetadata {
    page?: number;
}

export interface ReaperMangaDetails {
    id: number;
    title: string;
    series_slug: string;
    thumbnail: string;
    description: string;
    series_type: string;
    tags: ReaperTag[];
    rating: number;
    status: string;
    release_schedule?: string;
    nu_link?: string;
    season?: [];
    alternative_names: string;
    studio: string;
    author: string;
    release_year: string;
    first_chapter: ReaperChapter;
    last_chapter: ReaperChapter;
    meta: ReaperMangaDetailsMetadata;
}

interface ReaperMangaDetailsMetadata {
    background: string;
    metadata?: null;
    chapter_count: string;
    who_bookmarked_count?: string;
}

export interface ReaperTag {
    id: number;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    color: string;
    meta: ReaperTagMeta;
}

export interface ReaperTagMeta {
    pivot_series_id: number;
    pivot_tag_id: number;
}

interface ReaperChapterMetadata {
    adonis_group_limit_counter?: string;
}

export interface ReaperQueryResult {
    meta: ReaperQueryResultMeta;
    data: ReaperQueryResultData[];
}
export interface ReaperQueryResultMeta {
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
    first_page: number;
    first_page_url?: string;
    last_page_url?: string;
    next_page_url?: string;
    previous_page_url?: string;
}

export interface ReaperQueryResultData {
    id: number;
    title: string;
    description: string;
    alternative_names: string;
    series_type: string;
    series_slug: string;
    thumbnail: string;
    status: string;
    created_at: string;
    badge: string;
    latest: string;
    rating: number;
    release_schedule?: string;
    nu_link?: string;
    is_coming_soon: boolean;
    discord_role_id: number;
    acronym: string;
    color: string;
    free_chapters: ReaperChapter[];
    paid_chapters?: ReaperChapter[];
    meta: ReaperMangaDetailsMetadata;
}

export interface ReaperChapterList {
    meta: ReaperQueryResultMeta;
    data: ReaperChapter[];
}

interface ReaperChapter {
    id: number;
    chapter_slug: string;
    chapter_name?: string;
    chapter_title?: string;
    series_id?: number;
    price?: number;
    index?: string;
    public?: boolean;
    chapter_thumbnail?: string;
    chapter_type?: string;
    created_at?: string;
    updated_at?: string;
    series: ReaperSeries;
    chapters_to_be_freed?: [];
    novel_chapters?: [];
    excerpt?: string;
    meta?: ReaperChapterMetadata;
    season_id?: number;
    chapter_data?: ReaperChapterDataS3 | ReaperChapterDataLocal;
    chapter_content?: string;
    chapter_unique_id?: number;
    storage?: string;
}

export interface ReaperChapterDetails {
    chapter: ReaperChapter;
    previous_chapter: ReaperChapter;
    next_chapter: ReaperChapter;
}

export interface ReaperChapterDataS3 {
    files: ReaperPageFile[];
}
export interface ReaperChapterDataLocal {
    images: string[];
}

interface ReaperPageFile {
    url: string;
    width: number;
    height: number;
}

interface ReaperSeries {
    series_slug: string;
    id: number;
    meta: null;
}
