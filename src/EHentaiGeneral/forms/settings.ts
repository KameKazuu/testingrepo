import {
  ButtonRow,
  type Cookie,
  Form,
  FormConfirmationError,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  StepperRow,
  WebViewRow,
} from "@paperback/types";

import { mainRateLimiter } from "../network";
import {
  getAccountID,
  getDefaultArtist,
  getDefaultCharacter,
  getDefaultCosplayer,
  getDefaultFemale,
  getDefaultGroup,
  getDefaultMale,
  getDefaultMixed,
  getDefaultOther,
  getDefaultParody,
  getDefLangStatus,
  getDomainPref,
  getIgneous,
  getPassHash,
  languageFilterAll,
  isLoggedIn,
  setDomainPref,
  typeFilter,
} from "../utils";

export class SettingsForm extends Form {
  override getSections() {
    const types: { id: string; title: string }[] = typeFilter.map((tag) => ({
      id: tag.id,
      title: tag.value,
    }));
    const languages: { id: string; title: string }[] = languageFilterAll.map((tag) => ({
      id: tag.id,
      title: `${tag.flag} ${tag.value}`,
    }));
    return [
      Section(
        {
          id: "account",
          header: "Account Settings",
        },
        [
          WebViewRow("loginRow", {
            title: "Login",
            request: {
              url: "https://e-hentai.org/bounce_login.php",
              method: "GET",
            },
            isHidden: isLoggedIn(),
            onComplete: Application.Selector(this as SettingsForm, "handleLogin"),
            onCancel: Application.Selector(this as SettingsForm, "handleLoginCancel"),
          }),
          // Manual fallback: paste the cookie values straight from a browser
          // when the login WebView isn't available.
          InputRow("member_id_input", {
            title: "ipb_member_id",
            value: getAccountID(),
            isHidden: isLoggedIn(),
            onValueChange: Application.Selector(this as SettingsForm, "handleMemberIdChange"),
          }),
          InputRow("pass_hash_input", {
            title: "ipb_pass_hash",
            value: getPassHash(),
            isSecureEntry: true,
            isHidden: isLoggedIn(),
            onValueChange: Application.Selector(this as SettingsForm, "handlePassHashChange"),
          }),
          InputRow("igneous_input", {
            title: "igneous (optional)",
            value: getIgneous(),
            onValueChange: Application.Selector(this as SettingsForm, "handleIgneousChange"),
          }),
          LabelRow("logged", {
            title: "Logged in as",
            subtitle: getAccountID(),
            isHidden: !isLoggedIn(),
          }),
          ButtonRow("logout", {
            title: "Logout",
            isHidden: !isLoggedIn(),
            onSelect: Application.Selector(this as SettingsForm, "handleLogoutButton"),
          }),
        ],
      ),
      Section(
        {
          id: "domain",
          header: "Source",
          footer: "ExHentai requires a logged-in, eligible account.",
        },
        [
          SelectRow("domain", {
            title: "Domain",
            value: [getDomainPref()],
            layout: "list",
            items: [
              { id: "e", title: "E-Hentai" },
              { id: "ex", title: "ExHentai" },
            ],
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as SettingsForm, "handleDomainChange"),
          }),
        ],
      ),
      Section(
        {
          id: "update_settings",
          header: "Global Settings",
          footer: "Filter Settings",
        },
        [
          SelectRow("hide_type", {
            title: "Contents",
            subtitle: "Default value for content type, affect search and sections",
            value: this.getHideTypeStatus(),
            layout: "list",
            items: types,
            minItemCount: 1,
            maxItemCount: types.length,
            onValueChange: Application.Selector(this as SettingsForm, "handleHideTypeStatusChange"),
          }),
          StepperRow("rate_limit", {
            title: "Rate Limit",
            subtitle: "Set Custom Rate Limit",
            value: this.getRateFormsValue(),
            minValue: 5,
            maxValue: 100,
            stepValue: 1,
            loopOver: false,
            onValueChange: Application.Selector(this as SettingsForm, "handleRateStatusChange"),
          }),
        ],
      ),
      Section(
        {
          id: "default_value",
          footer: "Separate filters with `,`",
          header: "Default Search Filter",
        },
        [
          SelectRow("def_languages", {
            title: "Default Languages",
            subtitle: "Default languages",
            value: getDefLangStatus(),
            layout: "list",
            items: languages,
            minItemCount: 0,
            maxItemCount: languages.length,
            onValueChange: Application.Selector(this as SettingsForm, "handleDefLangStatusChange"),
          }),
          InputRow("character", {
            title: "Default value for `character` filter",
            value: getDefaultCharacter().join(","),
            onValueChange: Application.Selector(
              this as SettingsForm,
              "handleDefaultCharacterChange",
            ),
          }),
          InputRow("male", {
            title: "Default value for `male` filter",
            value: getDefaultMale().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultMaleChange"),
          }),
          InputRow("female", {
            title: "Default value for `female` filter",
            value: getDefaultFemale().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultFemaleChange"),
          }),
          InputRow("other", {
            title: "Default value for `other` filter",
            value: getDefaultOther().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultOtherChange"),
          }),
          InputRow("parody", {
            title: "Default value for `parody` filter",
            value: getDefaultParody().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultParodyChange"),
          }),
          InputRow("artist", {
            title: "Default value for `artist` filter",
            value: getDefaultArtist().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultArtistChange"),
          }),
          InputRow("mixed", {
            title: "Default value for `mixed` filter",
            value: getDefaultMixed().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultMixedChange"),
          }),
          InputRow("cosplayer", {
            title: "Default value for `cosplayer` filter",
            value: getDefaultCosplayer().join(","),
            onValueChange: Application.Selector(
              this as SettingsForm,
              "handleDefaultCosplayerChange",
            ),
          }),
          InputRow("group", {
            title: "Default value for `group` filter",
            value: getDefaultGroup().join(","),
            onValueChange: Application.Selector(this as SettingsForm, "handleDefaultGroupChange"),
          }),
        ],
      ),
    ];
  }
  public async updateValue<T>(value: T, filter: string): Promise<void> {
    Application.setState(value, filter);
    this.reloadForm();
  }

  getHideTypeStatus(): string[] {
    return (
      (Application.getState("_type") as string[] | undefined) ?? [
        "1",
        "2",
        "4",
        "8",
        "16",
        "32",
        "64",
        "128",
        "256",
        "512",
      ]
    );
  }

  async handleLogin(cookies: Cookie[]): Promise<void> {
    console.log("Login");
    cookies.forEach((cookie) => {
      console.log(cookie.name);
      if (cookie.name == "ipb_member_id") {
        Application.setSecureState(cookie.value, "ipb_member_id");
      }
      if (cookie.name == "ipb_pass_hash") {
        Application.setSecureState(cookie.value, "ipb_pass_hash");
      }
      if (cookie.name == "igneous" && cookie.value != "mystery") {
        Application.setSecureState(cookie.value, "igneous");
      }
    });
    this.reloadForm();
  }

  async handleLoginCancel(): Promise<void> {
    console.log("LoginCancel");
    this.reloadForm();
  }

  async handleDomainChange(value: string[]): Promise<void> {
    setDomainPref(value[0] ?? "e");
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleMemberIdChange(value: string): Promise<void> {
    Application.setSecureState(value.trim(), "ipb_member_id");
  }

  async handlePassHashChange(value: string): Promise<void> {
    Application.setSecureState(value.trim(), "ipb_pass_hash");
  }

  async handleIgneousChange(value: string): Promise<void> {
    const igneous = value.trim();
    if (igneous.length > 0 && igneous !== "mystery") {
      Application.setSecureState(igneous, "igneous");
    }
  }

  async handleLogoutButton(): Promise<void> {
    throw new FormConfirmationError(
      Application.Selector(this as SettingsForm, "handleLogoutConfirm"),
      "Do you want to logout?",
    );
  }

  async handleLogoutConfirm() {
    Application.setSecureState(undefined, "ipb_pass_hash");
    Application.setSecureState(undefined, "ipb_member_id");
    Application.setSecureState(undefined, "igneous");
    this.reloadForm();
  }

  async handleDefLangStatusChange(value: string[]): Promise<void> {
    await this.updateValue(value, "_languages");
  }
  async handleHideTypeStatusChange(value: string[]): Promise<void> {
    await this.updateValue(value, "_type");
  }
  async handleDefaultCharacterChange(value: string): Promise<void> {
    await this.updateValue(value, "_character");
  }
  async handleDefaultFemaleChange(value: string): Promise<void> {
    await this.updateValue(value, "_female");
  }
  async handleDefaultMaleChange(value: string): Promise<void> {
    await this.updateValue(value, "_male");
  }
  async handleDefaultOtherChange(value: string): Promise<void> {
    await this.updateValue(value, "_other");
  }
  async handleDefaultParodyChange(value: string): Promise<void> {
    await this.updateValue(value, "_parody");
  }
  async handleDefaultArtistChange(value: string): Promise<void> {
    await this.updateValue(value, "_artist");
  }
  async handleDefaultMixedChange(value: string): Promise<void> {
    await this.updateValue(value, "_mixed");
  }
  async handleDefaultCosplayerChange(value: string): Promise<void> {
    await this.updateValue(value, "_cosplayer");
  }
  async handleDefaultGroupChange(value: string): Promise<void> {
    await this.updateValue(value, "_group");
  }

  getRateFormsValue(): number {
    return (
      (Application.getState("RateFilter") as number | undefined) ??
      mainRateLimiter.options.numberOfRequests.valueOf()
    );
  }

  async handleRateStatusChange(value: number): Promise<void> {
    await this.updateValue(value, "RateFilter");
    mainRateLimiter.options.numberOfRequests = value;
  }
}
