# Kagane reader contract

Checked 2026-11-13 against Keiyoushi `all/kagane` and Aidoku Community `multi.kagane`.

- Request a legitimate integrity token from `POST /api/integrity`, then a book session from `POST /api/v2/books/{book_id}?is_datasaver={true|false}` with `x-integrity-token` and JSON `{}`.
- Use the session's `cache_url`, `access_token`, and manifest page IDs/extensions. Quality is a required CDN path segment: `/api/v2/books/page/original/{book_id}/{page_id}.{ext}?token=...` or `/page/datasaver/...`. The `is_datasaver` query remains on the book request, not the image request.
- Keep Origin and Referer consistent with the selected Kagane mirror. Keiyoushi explicitly requires the site's Origin for images. Refresh an issued page in its original quality mode even if preferences changed meanwhile. Accept legacy saved page URLs when renewing them.
- Keiyoushi uses the quality paths. The checked Aidoku revision still uses the legacy image path, so it is a reference for the integrity/manifest flow rather than evidence that its image URL remains valid.
- Live API on kagane.org returned the reported book `01a1d408-76cd-7e4f-9ae4-199bc14e0426` with 35 pages and first page `acb704bf-ae4b-561d-bbaa-17f511b94e82.jxl`. Both legacy and quality-specific CDN requests returned `404 {"error": -7}` with org/cx origins in this environment. Requests using the moe origin and the moe API were blocked with 403 HTML. The cloud browser could open kagane.moe after its initial automatic verification, but the website reader itself reported image-load failures for Not Your Typical Reincarnation Story, chapter 116 (61 pages). The reported book’s image delivery and iOS playback remain unverified.
- The mirror selector contains only kagane.moe and kagane.org. New installs and saved choices for removed mirrors use kagane.moe; an explicit kagane.org choice is preserved.

Never store a live access token in source or fixtures.

## Catalog and health reports

The root `sources.json` is separate from the generated `bundles/versioning.json`; keep Kagane’s version and domain synchronized with `pbconfig.ts` when updating it. The root catalog still advertised alpha.42 and kagane.to after alpha.50 was deployed.

The health report checked on 2026-11-13 for book `01a0017a-7314-70e8-b5b4-1d8cb9a99c08` belongs to pirate.vodka’s Kagane `0.0.1-alpha.19`, tested at 08:04 UTC. Its URLs omit the quality path. KameKazuu’s alpha.50 was separately verified in its published bundle with the quality segment present. The health service’s current state does not list KameKazuu’s repository.

Keiyoushi’s current book request uses `intent=Read` instead of `is_datasaver`. Both request forms returned the reported book’s 13-page manifest on kagane.org, but both still produced CDN `404 {"error": -7}` here, including quality-specific paths. Adding that argument alone was not a verified fix and was not shipped.
