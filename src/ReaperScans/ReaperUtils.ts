import { RS_CDN_DOMAIN } from "./ReaperConfig";

export const checkImage = (img: string): string => {
    if (img == "") {
        return "";
    }
    if (img.startsWith("https")) {
        return img;
    }
    return `${RS_CDN_DOMAIN}/${img}`;
};
