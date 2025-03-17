import {
    ButtonRow,
    DeferredItem,
    Form,
    InputRow,
    LabelRow,
    NavigationRow,
    OAuthButtonRow,
    Section,
    SelectRow,
    ToggleRow,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { URLBuilder } from "../utils/url-builder/base";
import { MDImageQuality, MDLanguages, MDRatings } from "./MangaDexHelper";

const GROUP_SEARCH_PAGE_SIZE = 100;

export function getLanguages(): string[] {
    return (
        (Application.getState("languages") as string[] | undefined) ??
        MDLanguages.getDefault()
    );
}

export function getRatings(): string[] {
    return (
        (Application.getState("ratings") as string[] | undefined) ??
        MDRatings.getDefault()
    );
}

export function getDataSaver(): boolean {
    return (Application.getState("data_saver") as boolean | undefined) ?? false;
}

export function getSkipSameChapter(): boolean {
    return (
        (Application.getState("skip_same_chapter") as boolean | undefined) ??
        false
    );
}

export function getForcePort443(): boolean {
    return (
        (Application.getState("force_port_443") as boolean | undefined) ?? false
    );
}

export function getHomepageThumbnail(): string {
    return (
        (Application.getState("homepage_thumbnail") as string | undefined) ??
        MDImageQuality.getDefault("homepage")
    );
}

export function getSearchThumbnail(): string {
    return (
        (Application.getState("search_thumbnail") as string | undefined) ??
        MDImageQuality.getDefault("search")
    );
}

export function getMangaThumbnail(): string {
    return (
        (Application.getState("manga_thumbnail") as string | undefined) ??
        MDImageQuality.getDefault("manga")
    );
}

export function getAccessToken(): MangaDex.AccessToken | undefined {
    const accessToken = Application.getSecureState("access_token") as
        | string
        | undefined;
    const refreshToken = Application.getSecureState("refresh_token") as
        | string
        | undefined;

    if (!accessToken) return undefined;

    return {
        accessToken,
        refreshToken,
        tokenBody: parseAccessToken(accessToken),
    };
}

export function saveAccessToken(
    accessToken: string | undefined,
    refreshToken: string | undefined,
): MangaDex.AccessToken | undefined {
    Application.setSecureState(accessToken, "access_token");
    Application.setSecureState(refreshToken, "refresh_token");

    if (!accessToken) return undefined;

    return {
        accessToken,
        refreshToken,
        tokenBody: parseAccessToken(accessToken),
    };
}

function parseAccessToken(accessToken: string): MangaDex.TokenBody {
    const tokenBodyBase64 = accessToken.split(".")[1];
    if (!tokenBodyBase64) throw new Error("Invalid access token format");

    const tokenBodyJSON = Buffer.from(tokenBodyBase64, "base64").toString(
        "ascii",
    );
    return JSON.parse(tokenBodyJSON) as MangaDex.TokenBody;
}

async function _authEndpointRequest(
    payload: string,
): Promise<MangaDex.AuthResponse> {
    const [response, buffer] = await Application.scheduleRequest({
        method: "POST",
        url: `https://auth.mangadex.org/realms/mangadex/protocol/openid-connect/token`,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: {
            refresh_token: payload,
            client_id: "paperback",
            grant_type: "refresh_token",
        },
    });

    if (response.status > 399) {
        throw new Error(`Request failed with status code: ${response.status}`);
    }

    const data = Application.arrayBufferToUTF8String(buffer);
    const json = JSON.parse(data) as MangaDex.AuthResponse | MangaDex.AuthError;

    if ("error" in json) {
        throw new Error(
            `Auth failed: ${json.error}: ${json.error_description || ""}`,
        );
    }

    return json;
}

const authRequestCache: Record<string, Promise<MangaDex.AuthResponse>> = {};

export function authEndpointRequest(
    payload: string,
): Promise<MangaDex.AuthResponse> {
    const cacheKey = payload;
    if (!(cacheKey in authRequestCache)) {
        authRequestCache[cacheKey] = _authEndpointRequest(payload).finally(
            () => {
                delete authRequestCache[cacheKey];
            },
        );
    }
    return authRequestCache[cacheKey];
}

export function getBlockedGroups(): Record<
    string,
    MangaDex.ScanlationGroupItem
> {
    return (
        (Application.getState("blocked_groups") as
            | Record<string, MangaDex.ScanlationGroupItem>
            | undefined) ?? {}
    );
}

export function saveBlockedGroups(
    groups: Record<string, MangaDex.ScanlationGroupItem>,
): void {
    Application.setState(groups, "blocked_groups");
}

export function blockGroup(group: MangaDex.ScanlationGroupItem): void {
    const blockedGroups = getBlockedGroups();
    blockedGroups[group.id] = group;
    saveBlockedGroups(blockedGroups);
}

export function unblockGroup(groupId: string): void {
    const blockedGroups = getBlockedGroups();
    delete blockedGroups[groupId];
    saveBlockedGroups(blockedGroups);
}

export function getGroupBlockingEnabled(): boolean {
    return (
        (Application.getState("group_blocking_enabled") as
            | boolean
            | undefined) ?? false
    );
}

export function setGroupBlockingEnabled(enabled: boolean): void {
    Application.setState(enabled, "group_blocking_enabled");
}

export class MangaDexSettingsForm extends Form {
    private languagesState = new State<string[]>(
        this,
        "languages",
        getLanguages(),
    );
    private ratingsState = new State<string[]>(this, "ratings", getRatings());
    private dataSaverState = new State<boolean>(
        this,
        "data_saver",
        getDataSaver(),
    );
    private skipSameChapterState = new State<boolean>(
        this,
        "skip_same_chapter",
        getSkipSameChapter(),
    );
    private forcePortState = new State<boolean>(
        this,
        "force_port_443",
        getForcePort443(),
    );
    private oAuthState = new State<boolean>(
        this,
        "oauth_state",
        !!getAccessToken(),
    );

    private homepageThumbState = new State<string>(
        this,
        "homepage_thumbnail",
        getHomepageThumbnail(),
    );
    private searchThumbState = new State<string>(
        this,
        "search_thumbnail",
        getSearchThumbnail(),
    );
    private mangaThumbState = new State<string>(
        this,
        "manga_thumbnail",
        getMangaThumbnail(),
    );

    private resetState = new State<boolean>(this, "reset_trigger", false);

    private blockedGroupsState = new State<
        Record<string, MangaDex.ScanlationGroupItem>
    >(this, "blocked_groups", getBlockedGroups());

    override getSections(): Application.FormSectionElement[] {
        return [
            this.createOAuthSection(),
            this.createContentSettingsSection(),
            this.createThumbnailSettingsSection(),
            this.createResetSection(),
        ];
    }

    private createOAuthSection(): Application.FormSectionElement {
        return Section("oAuthSection", [
            DeferredItem(() => {
                if (this.oAuthState.value) {
                    return NavigationRow("sessionInfo", {
                        title: "Session Info",
                        form: this.createSessionInfoForm(),
                    }) as Application.FormItemElement<unknown>;
                }
                return this.createLoginButton();
            }),
            NavigationRow("mangadex_status", {
                title: "MangaDex Status",
                form: this.createStatusInfoForm(),
            }),
        ]);
    }

    private createStatusSection(): Application.FormSectionElement {
        return Section("status_section", [
            NavigationRow("mangadex_status", {
                title: "MangaDex Status",
                form: this.createStatusInfoForm(),
            }),
        ]);
    }

    private createSessionInfoForm(): Form {
        return new (class SessionInfoForm extends Form {
            parentForm: MangaDexSettingsForm;
            private sessionState: boolean;

            constructor(private outerForm: MangaDexSettingsForm) {
                super();
                this.parentForm = outerForm;
                this.sessionState = outerForm.oAuthState.value;
            }

            override getSections(): Application.FormSectionElement[] {
                if (!this.sessionState) {
                    return [
                        Section("session_status", [
                            LabelRow("status", {
                                title: "Status",
                                value: "Successfully logged out",
                            }),
                        ]),
                    ];
                }

                const accessToken = getAccessToken();
                if (!accessToken) {
                    return [
                        Section("introspect", [
                            LabelRow("logged_out", { title: "LOGGED OUT" }),
                        ]),
                    ];
                }

                return [
                    Section(
                        "introspect",
                        Object.entries(accessToken.tokenBody).map(
                            ([key, value]) =>
                                LabelRow(key, {
                                    title: key,
                                    value: String(value),
                                }),
                        ),
                    ),
                    Section("account_actions", [
                        ButtonRow("refresh_token_button", {
                            title: "Refresh Token",
                            onSelect: Application.Selector(
                                this as SessionInfoForm,
                                "handleRefreshToken",
                            ),
                        }),
                        ButtonRow("logout", {
                            title: "Logout",
                            onSelect: Application.Selector(
                                this as SessionInfoForm,
                                "handleLogout",
                            ),
                        }),
                    ]),
                ];
            }

            async handleRefreshToken(): Promise<void> {
                const accessToken = getAccessToken();
                if (accessToken && accessToken.refreshToken) {
                    try {
                        const response = await authEndpointRequest(
                            accessToken.refreshToken,
                        );

                        if (response.access_token && response.refresh_token) {
                            saveAccessToken(
                                response.access_token,
                                response.refresh_token,
                            );
                            await this.parentForm.oAuthState.updateValue(true);
                            this.sessionState = true;
                            this.reloadForm();
                        } else {
                            throw new Error(
                                "Invalid response from auth endpoint",
                            );
                        }
                    } catch {
                        saveAccessToken(undefined, undefined);
                        await this.parentForm.oAuthState.updateValue(false);
                        this.sessionState = false;
                        this.reloadForm();
                    }
                } else {
                    saveAccessToken(undefined, undefined);
                    await this.parentForm.oAuthState.updateValue(false);
                    this.sessionState = false;
                    this.reloadForm();
                }
            }

            async handleLogout(): Promise<void> {
                saveAccessToken(undefined, undefined);
                await this.parentForm.oAuthState.updateValue(false);
                this.sessionState = false;
                this.reloadForm();
            }
        })(this);
    }

    private createLoginButton(): Application.FormItemElement<unknown> {
        return OAuthButtonRow("oAuthButton", {
            title: "Login with MangaDex",
            authorizeEndpoint:
                "https://auth.mangadex.org/realms/mangadex/protocol/openid-connect/auth",
            clientId: "paperback",
            redirectUri: "paperback://mangadex-login",
            responseType: {
                type: "pkce",
                pkceCodeLength: 64,
                pkceCodeMethod: "S256",
                formEncodeGrant: true,
                tokenEndpoint:
                    "https://auth.mangadex.org/realms/mangadex/protocol/openid-connect/token",
            },
            onSuccess: Application.Selector(
                this as MangaDexSettingsForm,
                "handleOAuthSuccess",
            ),
        });
    }

    private createContentSettingsSection(): Application.FormSectionElement {
        return Section("contentSettings", [
            SelectRow("languages", {
                title: "Languages",
                value: this.languagesState.value,
                minItemCount: 1,
                maxItemCount: 100,
                options: MDLanguages.getMDCodeList().map((x) => ({
                    id: x,
                    title: MDLanguages.getName(x),
                })),
                onValueChange: this.languagesState.selector,
            }),

            SelectRow("ratings", {
                title: "Content Rating",
                value: this.ratingsState.value,
                minItemCount: 1,
                maxItemCount: 4,
                options: MDRatings.getEnumList().map((x) => ({
                    id: x,
                    title: MDRatings.getName(x),
                })),
                onValueChange: this.ratingsState.selector,
            }),

            ToggleRow("data_saver", {
                title: "Data Saver",
                value: this.dataSaverState.value,
                onValueChange: this.dataSaverState.selector,
            }),

            ToggleRow("skip_same_chapter", {
                title: "Skip Same Chapter",
                value: this.skipSameChapterState.value,
                onValueChange: this.skipSameChapterState.selector,
            }),

            ToggleRow("force_port", {
                title: "Force Port 443",
                value: this.forcePortState.value,
                onValueChange: this.forcePortState.selector,
            }),

            NavigationRow("group_block_manager", {
                title: "Scanlation Group Block Settings",
                form: this.createGroupBlockForm(),
            }),
        ]);
    }

    private createGroupBlockForm(): Form {
        return new (class GroupBlockForm extends Form {
            private searchTerm = "";
            private lastSearchTerm = "";
            private searchResults: MangaDex.ScanlationGroupItem[] = [];
            private currentOffset = 0;
            private isLoading = false;
            private isPaginationLoading = false;
            private hasSearched = false;
            private parentForm: MangaDexSettingsForm;
            private blockedGroups: Record<string, MangaDex.ScanlationGroupItem>;
            private groupsToBlock: string[] = [];
            private groupsToUnblock: string[] = [];
            private totalResultsCount = 0;
            private groupBlockingEnabledState = new State<boolean>(
                this,
                "group_blocking_enabled",
                getGroupBlockingEnabled(),
            );

            constructor(private outerForm: MangaDexSettingsForm) {
                super();
                this.parentForm = outerForm;
                this.blockedGroups = getBlockedGroups();
                this.groupsToUnblock = Object.keys(this.blockedGroups);
            }

            override getSections(): Application.FormSectionElement[] {
                const hasSearchResults = this.searchResults.length > 0;
                const blockedGroupIds = Object.keys(this.blockedGroups);
                const currentPage =
                    Math.floor(this.currentOffset / GROUP_SEARCH_PAGE_SIZE) + 1;
                const totalPages =
                    Math.ceil(
                        this.totalResultsCount / GROUP_SEARCH_PAGE_SIZE,
                    ) || 1;
                const showNoResults =
                    this.hasSearched &&
                    !hasSearchResults &&
                    !this.isLoading &&
                    this.searchTerm.trim().length > 0;
                const isAtMaxGroups = blockedGroupIds.length >= 25;

                return [
                    Section("group_blocking_settings", [
                        ToggleRow("group_blocking_enabled", {
                            title: "Enable Group Blocking",
                            value: this.groupBlockingEnabledState.value,
                            onValueChange: Application.Selector(
                                this as GroupBlockForm,
                                "handleGroupBlockingEnabledChange",
                            ),
                        }),
                    ]),

                    Section(
                        {
                            id: "blocked_groups",
                            header: `Currently Blocked Groups ${blockedGroupIds.length}/25`,
                        },
                        [
                            LabelRow("max_groups_warning", {
                                title: "⚠️ Maximum limit reached (25 groups)",
                                subtitle: "Unblock some groups to add new ones",
                                isHidden: !isAtMaxGroups,
                            }),

                            SelectRow("blocked_groups_select", {
                                title: "Select to unblock",
                                value: this.groupsToUnblock,
                                options: Object.values(this.blockedGroups).map(
                                    (group) => ({
                                        id: group.id,
                                        title: group.attributes.name,
                                    }),
                                ),
                                minItemCount: 0,
                                maxItemCount: 25,
                                onValueChange: Application.Selector(
                                    this as GroupBlockForm,
                                    "handleBlockedGroupsSelection",
                                ),
                            }),
                        ],
                    ),

                    Section(
                        {
                            id: "search_groups",
                            header: `Search for Groups to Block`,
                        },
                        [
                            InputRow("search_input", {
                                title: "Enter group name or leave empty to search all",
                                value: this.searchTerm,
                                onValueChange: Application.Selector(
                                    this as GroupBlockForm,
                                    "handleSearchInput",
                                ),
                            }),

                            ButtonRow("clear_button", {
                                title: "Clear Search",
                                onSelect: Application.Selector(
                                    this as GroupBlockForm,
                                    "handleClearSearch",
                                ),
                                isHidden: !(
                                    this.hasSearched &&
                                    (!this.isLoading ||
                                        this.isPaginationLoading)
                                ),
                            }),

                            LabelRow("search_results_info", {
                                title: "Results",
                                subtitle: `Found ${this.totalResultsCount} groups (Page ${currentPage} of ${totalPages})`,
                                isHidden: !(
                                    this.hasSearched &&
                                    hasSearchResults &&
                                    (!this.isLoading ||
                                        this.isPaginationLoading)
                                ),
                            }),

                            LabelRow("no_results", {
                                title: "No results found",
                                isHidden: !(this.hasSearched && showNoResults),
                            }),

                            LabelRow("loading", {
                                title: "Loading results...",
                                isHidden: !(
                                    this.isLoading && !this.isPaginationLoading
                                ),
                            }),

                            SelectRow("search_results", {
                                title: this.isPaginationLoading
                                    ? "Loading next page..."
                                    : "Select groups to block",
                                value: this.groupsToBlock,
                                options: this.searchResults
                                    .filter(
                                        (group) =>
                                            !(group.id in this.blockedGroups),
                                    )
                                    .map((group) => ({
                                        id: group.id,
                                        title: group.attributes.name,
                                    })),
                                minItemCount: 0,
                                maxItemCount: GROUP_SEARCH_PAGE_SIZE,
                                onValueChange: Application.Selector(
                                    this as GroupBlockForm,
                                    "handleSearchResultsSelection",
                                ),
                                isHidden: !(
                                    this.hasSearched &&
                                    hasSearchResults &&
                                    (!this.isLoading ||
                                        this.isPaginationLoading)
                                ),
                            }),
                        ],
                    ),

                    Section("pagination", [
                        ButtonRow("next_page", {
                            title: "Next Page",
                            onSelect: Application.Selector(
                                this as GroupBlockForm,
                                "handleNextPage",
                            ),
                            isHidden: !(
                                hasSearchResults &&
                                this.searchResults.length >=
                                    GROUP_SEARCH_PAGE_SIZE &&
                                (!this.isLoading || this.isPaginationLoading)
                            ),
                        }),

                        ButtonRow("prev_page", {
                            title: "Previous Page",
                            onSelect: Application.Selector(
                                this as GroupBlockForm,
                                "handlePrevPage",
                            ),
                            isHidden: !(
                                hasSearchResults &&
                                this.currentOffset > 0 &&
                                (!this.isLoading || this.isPaginationLoading)
                            ),
                        }),
                    ]),

                    Section("reset_group_blocks", [
                        ButtonRow("reset_group_blocks", {
                            title: "Reset Group Block Settings",
                            onSelect: Application.Selector(
                                this as GroupBlockForm,
                                "handleResetGroupBlocks",
                            ),
                        }),
                    ]),
                ];
            }

            async handleGroupBlockingEnabledChange(
                value: boolean,
            ): Promise<void> {
                await this.groupBlockingEnabledState.updateValue(value);
                setGroupBlockingEnabled(value);
                this.reloadForm();
            }

            async handleBlockedGroupsSelection(value: string[]): Promise<void> {
                const groupsToUnblock = this.groupsToUnblock.filter(
                    (groupId) => !value.includes(groupId),
                );

                for (const groupId of groupsToUnblock) {
                    unblockGroup(groupId);
                }

                this.blockedGroups = getBlockedGroups();
                this.groupsToUnblock = value;

                await this.parentForm.blockedGroupsState.updateValue(
                    this.blockedGroups,
                );

                this.reloadForm();
            }

            async handleSearchResultsSelection(value: string[]): Promise<void> {
                const newSelectedGroups = value.filter(
                    (groupId) => !this.groupsToBlock.includes(groupId),
                );

                const currentBlockedCount = Object.keys(
                    this.blockedGroups,
                ).length;

                const remainingSlots = Math.max(0, 25 - currentBlockedCount);

                const groupsToProcess = newSelectedGroups.slice(
                    0,
                    remainingSlots,
                );

                for (const groupId of groupsToProcess) {
                    const group = this.searchResults.find(
                        (g) => g.id === groupId,
                    );
                    if (group) {
                        blockGroup(group);
                    }
                }

                this.blockedGroups = getBlockedGroups();

                this.groupsToUnblock = Object.keys(this.blockedGroups);

                this.searchResults = this.searchResults.filter(
                    (group) => !(group.id in this.blockedGroups),
                );
                this.groupsToBlock = [];

                await this.parentForm.blockedGroupsState.updateValue(
                    this.blockedGroups,
                );

                this.reloadForm();
            }

            async handleResetGroupBlocks(): Promise<void> {
                saveBlockedGroups({});

                this.blockedGroups = {};
                this.groupsToUnblock = [];

                await this.parentForm.blockedGroupsState.updateValue({});

                this.reloadForm();
            }

            async handleSearchInput(value: string): Promise<void> {
                this.searchTerm = value;

                if (
                    this.isLoading ||
                    (this.hasSearched &&
                        value.trim() === this.lastSearchTerm.trim())
                ) {
                    return;
                }

                this.lastSearchTerm = value.trim();
                this.currentOffset = 0;
                this.groupsToBlock = [];

                this.hasSearched = true;
                await this.fetchGroups(0, false);
            }

            async handleClearSearch(): Promise<void> {
                if (!this.hasSearched || this.isLoading) {
                    return;
                }

                this.searchTerm = "";
                this.hasSearched = false;
                this.searchResults = [];
                this.currentOffset = 0;
                this.totalResultsCount = 0;
                this.groupsToBlock = [];

                this.reloadForm();
            }

            async handlePrevPage(): Promise<void> {
                const hasSearchResults = this.searchResults.length > 0;

                if (
                    !hasSearchResults ||
                    this.currentOffset === 0 ||
                    this.isLoading
                ) {
                    return;
                }

                const newOffset = Math.max(
                    0,
                    this.currentOffset - GROUP_SEARCH_PAGE_SIZE,
                );
                await this.fetchGroups(newOffset, true);
            }

            async handleNextPage(): Promise<void> {
                const hasSearchResults = this.searchResults.length > 0;

                if (
                    !hasSearchResults ||
                    this.searchResults.length < GROUP_SEARCH_PAGE_SIZE ||
                    this.isLoading
                ) {
                    return;
                }

                await this.fetchGroups(
                    this.currentOffset + GROUP_SEARCH_PAGE_SIZE,
                    true,
                );
            }

            async fetchGroups(
                offset: number,
                isPagination: boolean = false,
            ): Promise<void> {
                this.isLoading = true;
                this.isPaginationLoading = isPagination;

                if (!isPagination) {
                    this.searchResults = [];
                    this.totalResultsCount = 0;
                }

                this.reloadForm();

                try {
                    const url = new URLBuilder("https://api.mangadex.org")
                        .addPath("group")
                        .addQuery("limit", GROUP_SEARCH_PAGE_SIZE)
                        .addQuery("offset", offset);

                    if (this.searchTerm.trim().length > 0) {
                        url.addQuery("name", this.searchTerm.trim());
                    }

                    const [response, buffer] =
                        await Application.scheduleRequest({
                            method: "GET",
                            url: url.build(),
                        });

                    if (response.status !== 200) {
                        throw new Error(
                            `Failed to fetch groups: ${response.status}`,
                        );
                    }

                    const data = JSON.parse(
                        Application.arrayBufferToUTF8String(buffer),
                    ) as MangaDex.ScanlationGroupResponse;

                    this.searchResults = data.data;
                    this.currentOffset = offset;
                    this.totalResultsCount = data.total;
                    this.groupsToBlock = [];
                } catch (error) {
                    this.searchResults = [];
                    this.totalResultsCount = 0;
                    console.log(`Error searching groups: ${String(error)}`);
                } finally {
                    this.isLoading = false;
                    this.isPaginationLoading = false;
                    this.reloadForm();
                }
            }
        })(this);
    }

    private createThumbnailSettingsSection(): Application.FormSectionElement {
        return Section("thumbnail_settings", [
            SelectRow("homepage_thumbnail", {
                title: "Homepage Thumbnail Quality",
                value: [this.homepageThumbState.value],
                minItemCount: 1,
                maxItemCount: 1,
                options: MDImageQuality.getEnumList().map((x) => ({
                    id: x,
                    title: MDImageQuality.getName(x),
                })),
                onValueChange: Application.Selector(
                    this as MangaDexSettingsForm,
                    "handleHomepageThumbChange",
                ),
            }),

            SelectRow("search_thumbnail", {
                title: "Search Thumbnail Quality",
                value: [this.searchThumbState.value],
                minItemCount: 1,
                maxItemCount: 1,
                options: MDImageQuality.getEnumList().map((x) => ({
                    id: x,
                    title: MDImageQuality.getName(x),
                })),
                onValueChange: Application.Selector(
                    this as MangaDexSettingsForm,
                    "handleSearchThumbChange",
                ),
            }),

            SelectRow("manga_thumbnail", {
                title: "Manga Thumbnail Quality",
                value: [this.mangaThumbState.value],
                minItemCount: 1,
                maxItemCount: 1,
                options: MDImageQuality.getEnumList().map((x) => ({
                    id: x,
                    title: MDImageQuality.getName(x),
                })),
                onValueChange: Application.Selector(
                    this as MangaDexSettingsForm,
                    "handleMangaThumbChange",
                ),
            }),
        ]);
    }

    private createStatusInfoForm(): Form {
        return new (class StatusInfoForm extends Form {
            private statusData: { loading: boolean; content: string[] };

            constructor() {
                super();
                this.statusData = {
                    loading: true,
                    content: ["Loading status information..."],
                };
                void this.fetchStatusInfo();
            }

            override getSections(): Application.FormSectionElement[] {
                return [
                    Section(
                        "status_info",
                        this.statusData.content.map((text, index) =>
                            LabelRow(`status_${index}`, {
                                title:
                                    index === 0 && this.statusData.loading
                                        ? "Loading..."
                                        : text,
                            }),
                        ),
                    ),
                    Section("status_actions", [
                        ButtonRow("refresh_status", {
                            title: "Refresh Status",
                            onSelect: Application.Selector(
                                this as StatusInfoForm,
                                "handleRefreshStatus",
                            ),
                        }),
                    ]),
                ];
            }

            async handleRefreshStatus(): Promise<void> {
                this.statusData = {
                    loading: true,
                    content: ["Loading status information..."],
                };
                this.reloadForm();
                await this.fetchStatusInfo();
            }

            async fetchStatusInfo(): Promise<void> {
                try {
                    const [response, data] = await Application.scheduleRequest({
                        method: "GET",
                        url: "https://status.mangadex.org/",
                    });

                    if (response.status !== 200) {
                        throw new Error(
                            `Failed to fetch status: ${response.status}`,
                        );
                    }

                    const $ = cheerio.load(
                        Application.arrayBufferToUTF8String(data),
                        {
                            xml: {
                                xmlMode: false,
                                decodeEntities: false,
                            },
                        },
                    );
                    const content: string[] = [];

                    const wrapText = (
                        text: string,
                        maxLength: number = 45,
                    ): string[] => {
                        const lines: string[] = [];
                        const paragraphs = text.split(/(?:<br\s*\/?>|\n)+/);

                        for (const paragraph of paragraphs) {
                            if (paragraph.trim() === "") {
                                lines.push("");
                                continue;
                            }

                            const words = paragraph.trim().split(" ");
                            let currentLine = "";

                            for (const word of words) {
                                if (
                                    (currentLine + " " + word).length <=
                                    maxLength
                                ) {
                                    currentLine = currentLine
                                        ? currentLine + " " + word
                                        : word;
                                } else {
                                    lines.push(currentLine);
                                    currentLine = word;
                                }
                            }

                            if (currentLine) {
                                lines.push(currentLine);
                            }
                        }

                        return lines;
                    };

                    const convertToLocalTime = (
                        utcTimestamp: string,
                    ): string => {
                        if (!utcTimestamp.includes("UTC")) {
                            return utcTimestamp;
                        }

                        try {
                            const timestampWithoutUTC = utcTimestamp.replace(
                                " UTC",
                                "",
                            );
                            const dateParts = timestampWithoutUTC.split(" - ");

                            if (dateParts.length !== 2) return utcTimestamp;

                            const datePart = dateParts[0];
                            const timePart = dateParts[1];

                            const isoString = `${datePart} ${timePart} UTC`;
                            const date = new Date(isoString);

                            if (isNaN(date.getTime())) {
                                return utcTimestamp;
                            }

                            const now = new Date();
                            const diffMs = now.getTime() - date.getTime();
                            const diffSec = Math.floor(diffMs / 1000);
                            const diffMin = Math.floor(diffSec / 60);
                            const diffHour = Math.floor(diffMin / 60);

                            let timeSince: string;
                            if (diffHour > 0) {
                                timeSince = `${diffHour} ${diffHour === 1 ? "hour" : "hours"} ago`;
                            } else if (diffMin > 0) {
                                timeSince = `${diffMin} ${diffMin === 1 ? "minute" : "minutes"} ago`;
                            } else {
                                timeSince = `${Math.max(0, diffSec)} ${diffSec === 1 ? "second" : "seconds"} ago`;
                            }

                            const options: Intl.DateTimeFormatOptions = {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                                timeZoneName: "short",
                            };

                            return `${date.toLocaleString(undefined, options)} (${timeSince})`;
                        } catch {
                            return utcTimestamp;
                        }
                    };

                    const unresolvedIncidents = $("div.unresolved-incident");
                    if (unresolvedIncidents.length) {
                        unresolvedIncidents.each((_, incident) => {
                            const title = $(incident)
                                .find(".actual-title")
                                .text()
                                .trim();
                            if (title) {
                                content.push(`INCIDENT: ${title}`);
                            }

                            $(incident)
                                .find(".update")
                                .each((_, update) => {
                                    const status = $(update)
                                        .find("strong")
                                        .text()
                                        .trim();
                                    if (status) {
                                        content.push(`Status: ${status}`);
                                    }

                                    const $descSpan = $(update).find(
                                        "span.whitespace-pre-wrap",
                                    );
                                    const descriptionHtml =
                                        $descSpan.html() || "";
                                    const description = descriptionHtml
                                        .replace(/<br\s*\/?>/gi, "\n")
                                        .trim();

                                    if (description) {
                                        content.push("");
                                        const wrappedLines =
                                            wrapText(description);
                                        content.push(...wrappedLines);
                                    }

                                    const timestamp = $(update)
                                        .find("small")
                                        .text()
                                        .trim();

                                    if (timestamp) {
                                        content.push("");
                                        const localTime =
                                            convertToLocalTime(timestamp);
                                        content.push(`${localTime}`);
                                    }
                                });
                        });
                    } else {
                        content.push("No unresolved incidents reported.");
                    }

                    this.statusData = {
                        loading: false,
                        content: content.length
                            ? content
                            : ["No status information available."],
                    };
                } catch {
                    this.statusData = {
                        loading: false,
                        content: ["Error fetching status."],
                    };
                }

                this.reloadForm();
            }
        })();
    }

    private createResetSection(): Application.FormSectionElement {
        return Section("reset_section", [
            ButtonRow("reset_settings", {
                title: "Reset to Defaults",
                onSelect: Application.Selector(
                    this as MangaDexSettingsForm,
                    "handleResetSettings",
                ),
            }),
        ]);
    }

    async handleHomepageThumbChange(value: string[]): Promise<void> {
        await this.homepageThumbState.updateValue(value[0]);
    }

    async handleSearchThumbChange(value: string[]): Promise<void> {
        await this.searchThumbState.updateValue(value[0]);
    }

    async handleMangaThumbChange(value: string[]): Promise<void> {
        await this.mangaThumbState.updateValue(value[0]);
    }

    async handleOAuthSuccess(
        accessToken: string,
        refreshToken: string,
    ): Promise<void> {
        saveAccessToken(accessToken, refreshToken);
        await this.oAuthState.updateValue(true);
        this.reloadForm();
    }

    async handleResetSettings(): Promise<void> {
        await Promise.all([
            this.languagesState.updateValue(MDLanguages.getDefault()),
            this.ratingsState.updateValue(MDRatings.getDefault()),
            this.dataSaverState.updateValue(false),
            this.skipSameChapterState.updateValue(false),
            this.homepageThumbState.updateValue(
                MDImageQuality.getDefault("homepage"),
            ),
            this.searchThumbState.updateValue(
                MDImageQuality.getDefault("search"),
            ),
            this.mangaThumbState.updateValue(
                MDImageQuality.getDefault("manga"),
            ),
            this.forcePortState.updateValue(false),
            this.blockedGroupsState.updateValue({}),
        ]);

        await this.resetState.updateValue(!this.resetState.value);
    }
}

class State<T> {
    private _value: T;
    public get value(): T {
        return this._value;
    }

    public get selector(): SelectorID<(value: T) => Promise<void>> {
        return Application.Selector(this as State<T>, "updateValue");
    }

    constructor(
        private form: Form,
        private persistKey: string,
        value: T,
    ) {
        this._value = value;
    }

    public async updateValue(value: T): Promise<void> {
        this._value = value;

        Application.setState(value, this.persistKey);

        this.form.reloadForm();
    }
}
