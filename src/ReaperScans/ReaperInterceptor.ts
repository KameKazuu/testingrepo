import { PaperbackInterceptor, Request, Response } from "@paperback/types";
import { RS_DOMAIN } from "./ReaperConfig";

export class ReaperInterceptor extends PaperbackInterceptor {
    override async interceptRequest(request: Request): Promise<Request> {
        request.headers = {
            ...request.headers,
            "user-agent": await Application.getDefaultUserAgent(),
            referer: `${RS_DOMAIN}/`,
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
