import { SourceManga, URL } from "@paperback/types";
import { parseMangaDetails } from "../MangaDexParser";
import { checkId, fetchJSON, MANGADEX_API } from "../utils/CommonUtil";

/**
 * Handles fetching manga details and information
 */
export class MangaProvider {
    /**
     * Retrieves detailed information for a specific manga
     */
    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        checkId(mangaId);

        let request = {
            url: new URL(MANGADEX_API)
                .addPathComponent("manga")
                .addPathComponent(mangaId)
                .setQueryItems({
                    "includes[]": ["author", "artist", "cover_art"],
                })
                .toString(),
            method: "GET",
        };

        const json = await fetchJSON<MangaDex.MangaDetailsResponse>(request);

        request = {
            url: new URL(MANGADEX_API)
                .addPathComponent("statistics")
                .addPathComponent("manga")
                .addPathComponent(mangaId)
                .toString(),
            method: "GET",
        };

        const ratingJson =
            await fetchJSON<MangaDex.StatisticsResponse>(request);
        return parseMangaDetails(mangaId, json, ratingJson);
    }
}
