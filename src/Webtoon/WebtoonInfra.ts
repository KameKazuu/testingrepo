import {
    BasicRateLimiter,
    Extension,
    PagedResults,
    Request,
    Response,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { CheerioAPI } from "cheerio";
import { WebtoonParser, WebtoonsSearchingMetadata } from "./WebtoonParser";

export abstract class WebtoonInfra extends WebtoonParser implements Extension {
    cheerio = cheerio;
    globalRateLimiter = new BasicRateLimiter("rateLimiter", {
        numberOfRequests: 10,
        bufferInterval: 1,
        ignoreImages: false,
    });
    cookies: Record<string, string>;

    constructor(BASE_URL: string, MOBILE_URL: string) {
        super(BASE_URL, MOBILE_URL);
        this.cookies = {
            ageGatePass: "true",
        };
    }

    async initialise(): Promise<void> {
        this.registerInterceptors();
    }

    registerInterceptors() {
        this.globalRateLimiter.registerInterceptor();
        Application.registerInterceptor(
            "requestInterceptor",
            Application.Selector(this as WebtoonInfra, "interceptRequest"),
            Application.Selector(this as WebtoonInfra, "interceptResponse"),
        );
    }

    async interceptRequest(request: Request): Promise<Request> {
        request.headers = {
            ...(request.headers ?? {}),
            ...{
                referer: request.headers?.referer ?? `${this.BASE_URL}/`,
                "user-agent": await Application.getDefaultUserAgent(),
            },
        };
        request.cookies = { ...request.cookies, ...this.cookies };
        return request;
    }

    async interceptResponse(
        _request: Request,
        _response: Response,
        data: ArrayBuffer,
    ): Promise<ArrayBuffer> {
        return data;
    }

    async ExecRequest<T>(
        infos: {
            url: string;
            headers?: Record<string, string>;
            params?: Record<string, string | number>;
        },
        parseMethods: (_: CheerioAPI) => T,
    ): Promise<T> {
        if (infos.params)
            infos.url += `?${Object.entries(infos.params)
                .map(([key, value]) => `${key}=${value}`)
                .join("&")}`;

        const request = { ...infos, method: "GET" };
        const data = (await Application.scheduleRequest(request))[1];
        const $ = this.cheerio.load(Application.arrayBufferToUTF8String(data));
        return parseMethods.call(this, $);
    }

    async ExecPagedResultsRequest<T>(
        infos: {
            url: string;
            headers?: Record<string, string>;
            params?: Record<string, string | number>;
        },
        metadata: WebtoonsSearchingMetadata,
        parseMethods: (_: CheerioAPI) => PagedResults<T>,
    ): Promise<PagedResults<T>> {
        infos.params ??= {};
        const page = (infos.params.page = metadata.page + 1);

        if (metadata?.maxPages && page > metadata.maxPages)
            return { items: [], metadata };

        return {
            items: (await this.ExecRequest(infos, parseMethods)).items,
            metadata: { ...metadata, page: page },
        };
    }
}
