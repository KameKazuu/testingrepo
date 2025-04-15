import { PaperbackInterceptor, Request, Response } from "@paperback/types";
import { getAccessToken, saveAccessToken } from "./MangaDexSettings";
import { MANGADEX_DOMAIN } from "./utils/CommonUtil";

/**
 * Intercepts requests to handle authentication and headers
 * Handles token refresh when needed
 */
export class MangaDexInterceptor extends PaperbackInterceptor {
    // Regex to identify image requests
    private readonly imageRegex = new RegExp(
        /\.(png|gif|jpeg|jpg|webp)(\?|$)/i,
    );

    /**
     * Adds authentication and referer headers to requests
     * Handles token refresh if expired
     */
    override async interceptRequest(request: Request): Promise<Request> {
        // Impossible to have undefined headers, ensured by the app
        request.headers = {
            ...request.headers,
            referer: `${MANGADEX_DOMAIN}/`,
        };

        let accessToken = getAccessToken();
        if (
            this.imageRegex.test(request.url) ||
            request.url.includes("auth/") ||
            request.url.includes("auth.mangadex") ||
            !accessToken
        ) {
            return request;
        }

        // Padding 60 secs to make sure it won't expire in-transit if the connection is really bad
        // Also, only refresh if the request needs credentials
        if (
            Number(accessToken.tokenBody.exp) <= Date.now() / 1000 - 60 &&
            (request.url.includes("/read") ||
                request.url.includes("/status") ||
                request.url.includes("/rating"))
        ) {
            try {
                const [response, buffer] = await Application.scheduleRequest({
                    url: "https://auth.mangadex.org/realms/mangadex/protocol/openid-connect/token",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: {
                        grant_type: "refresh_token",
                        refresh_token: accessToken.refreshToken,
                        client_id: "paperback",
                    },
                });

                if (response.status > 399) {
                    return request;
                }

                const data = Application.arrayBufferToUTF8String(buffer);
                const json = JSON.parse(data) as
                    | MangaDex.AuthResponse
                    | MangaDex.AuthError;

                if ("error" in json) {
                    return request;
                }
                accessToken = saveAccessToken(
                    json.access_token,
                    json.refresh_token,
                );
                if (!accessToken) {
                    return request;
                }
            } catch {
                return request;
            }
        }

        // Impossible to have undefined headers, ensured by the app
        request.headers = {
            ...request.headers,
            Authorization: "Bearer " + accessToken.accessToken,
        };
        return request;
    }

    override async interceptResponse(
        request: Request,
        response: Response,
        data: ArrayBuffer,
    ): Promise<ArrayBuffer> {
        return data;
    }
}
