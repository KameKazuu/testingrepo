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
  ToggleRow,
  WebViewRow,
} from "@paperback/types";

import { loginWithCredentials, mainRateLimiter, refreshIgneous } from "../network";
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
  getSpoofIP,
  languageFilterAll,
  isLoggedIn,
  setDomainPref,
  setSpoofIP,
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
          // Username/password login. The fields only store what is typed; the
          // "Log In" button below runs the actual forum login, which returns
          // the ipb_member_id + ipb_pass_hash cookies.
          InputRow("username_input", {
            title: "Username",
            value: (Application.getState("eh_username") as string | undefined) ?? "",
            isHidden: isLoggedIn(),
            onValueChange: Application.Selector(this as SettingsForm, "handleUsernameChange"),
          }),
          InputRow("password_input", {
            title: "Password",
            value: (Application.getState("eh_password") as string | undefined) ?? "",
            isSecureEntry: true,
            isHidden: isLoggedIn(),
            onValueChange: Application.Selector(this as SettingsForm, "handlePasswordChange"),
          }),
          ButtonRow("login_button", {
            title: "Log In",
            isHidden: isLoggedIn(),
            onSelect: Application.Selector(this as SettingsForm, "handleLoginButton"),
          }),
          LabelRow("login_error", {
            title: "Login failed",
            subtitle: "Check your username and password, then try again.",
            isHidden:
              isLoggedIn() || !(Application.getState("eh_login_error") as boolean | undefined),
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
          footer:
            "ExHentai needs a logged-in account. If it stays blank, keep " +
            '"Improve ExHentai Access" on and tap "Refresh ExHentai Access".',
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
          ToggleRow("spoof_ip", {
            title: "Improve ExHentai Access",
            value: getSpoofIP(),
            onValueChange: Application.Selector(this as SettingsForm, "handleSpoofIPChange"),
          }),
          ButtonRow("refresh_igneous", {
            title: "Refresh ExHentai Access",
            onSelect: Application.Selector(this as SettingsForm, "handleRefreshIgneous"),
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

  async handleSpoofIPChange(value: boolean): Promise<void> {
    setSpoofIP(value);
  }

  async handleRefreshIgneous(): Promise<void> {
    await refreshIgneous();
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleUsernameChange(value: string): Promise<void> {
    Application.setState(value.trim(), "eh_username");
  }

  async handlePasswordChange(value: string): Promise<void> {
    Application.setState(value, "eh_password");
  }

  async handleLoginButton(): Promise<void> {
    const username = ((Application.getState("eh_username") as string | undefined) ?? "").trim();
    const password = (Application.getState("eh_password") as string | undefined) ?? "";
    if (username.length === 0 || password.length === 0) {
      Application.setState(true, "eh_login_error");
      this.reloadForm();
      return;
    }

    const ok = await loginWithCredentials(username, password);
    Application.setState(undefined, "eh_password");
    if (ok) {
      Application.setState(undefined, "eh_username");
      Application.setState(undefined, "eh_login_error");
    } else {
      Application.setState(true, "eh_login_error");
    }
    this.reloadForm();
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
    Application.setState(undefined, "eh_username");
    Application.setState(undefined, "eh_password");
    Application.setState(undefined, "eh_login_error");
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
