interface Language {
    name: string;
    langCode: string;
    flagCode: string;
    default?: boolean;
}

class BTTLanguagesClass {
    Languages: Language[] = [
        // Existing languages
        { name: "اَلْعَرَبِيَّةُ", langCode: "ar", flagCode: "🇦🇪" },
        { name: "български", langCode: "bg", flagCode: "🇧🇬" },
        { name: "বাংলা", langCode: "bn", flagCode: "🇧🇩" },
        { name: "Català", langCode: "ca", flagCode: "🇪🇸" },
        { name: "Čeština", langCode: "cs", flagCode: "🇨🇿" },
        { name: "Dansk", langCode: "da", flagCode: "🇩🇰" },
        { name: "Deutsch", langCode: "de", flagCode: "🇩🇪" },
        { name: "English", langCode: "en", flagCode: "🇬🇧", default: true },
        { name: "Español", langCode: "es", flagCode: "🇪🇸" },
        { name: "Español (Latinoamérica)", langCode: "es-la", flagCode: "🇪🇸" },
        { name: "فارسی", langCode: "fa", flagCode: "🇮🇷" },
        { name: "Suomi", langCode: "fi", flagCode: "🇫🇮" },
        { name: "Français", langCode: "fr", flagCode: "🇫🇷" },
        { name: "עִבְרִית", langCode: "he", flagCode: "🇮🇱" },
        { name: "हिन्दी", langCode: "hi", flagCode: "🇮🇳" },
        { name: "Magyar", langCode: "hu", flagCode: "🇭🇺" },
        { name: "Indonesia", langCode: "id", flagCode: "🇮🇩" },
        { name: "Italiano", langCode: "it", flagCode: "🇮🇹" },
        { name: "日本語", langCode: "ja", flagCode: "🇯🇵" },
        { name: "한국어", langCode: "ko", flagCode: "🇰🇷" },
        { name: "Lietuvių", langCode: "lt", flagCode: "🇱🇹" },
        { name: "монгол", langCode: "mn", flagCode: "🇲🇳" },
        { name: "Melayu", langCode: "ms", flagCode: "🇲🇾" },
        { name: "မြန်မာဘာသာ", langCode: "my", flagCode: "🇲🇲" },
        { name: "Nederlands", langCode: "nl", flagCode: "🇳🇱" },
        { name: "Norsk", langCode: "no", flagCode: "🇳🇴" },
        { name: "Polski", langCode: "pl", flagCode: "🇵🇱" },
        { name: "Português", langCode: "pt", flagCode: "🇵🇹" },
        { name: "Português (Brasil)", langCode: "pt-br", flagCode: "🇧🇷" },
        { name: "Română", langCode: "ro", flagCode: "🇷🇴" },
        { name: "Pусский", langCode: "ru", flagCode: "🇷🇺" },
        { name: "Cрпски", langCode: "sr", flagCode: "🇷🇸" },
        { name: "Svenska", langCode: "sv", flagCode: "🇸🇪" },
        { name: "ไทย", langCode: "th", flagCode: "🇹🇭" },
        { name: "Filipino", langCode: "tl", flagCode: "🇵🇭" },
        { name: "Türkçe", langCode: "tr", flagCode: "🇹🇷" },
        { name: "Yкраї́нська", langCode: "uk", flagCode: "🇺🇦" },
        { name: "Tiếng Việt", langCode: "vi", flagCode: "🇻🇳" },
        { name: "中文 (简化字)", langCode: "zh", flagCode: "🇨🇳" },
        { name: "中文 (繁體字)", langCode: "zh-hk", flagCode: "🇭🇰" },

        // New languages from the HTML
        { name: "Afrikaans", langCode: "af", flagCode: "🇿🇦" },
        { name: "Albanian", langCode: "sq", flagCode: "🇦🇱" },
        { name: "Amharic", langCode: "am", flagCode: "🇪🇹" },
        { name: "Armenian", langCode: "hy", flagCode: "🇦🇲" },
        { name: "Azerbaijani", langCode: "az", flagCode: "🇦🇿" },
        { name: "Belarusian", langCode: "be", flagCode: "🇧🇾" },
        { name: "Bosnian", langCode: "bs", flagCode: "🇧🇦" },
        { name: "Burmese", langCode: "my", flagCode: "🇲🇲" },
        { name: "Cambodian", langCode: "km", flagCode: "🇰🇭" },
        { name: "Cebuano", langCode: "ceb", flagCode: "🇵🇭" },
        { name: "Chinese (繁)", langCode: "zh-hant", flagCode: "🇹🇼" },
        { name: "Chinese (粵)", langCode: "yue", flagCode: "🇭🇰" },
        { name: "Croatian", langCode: "hr", flagCode: "🇭🇷" },
        { name: "Estonian", langCode: "et", flagCode: "🇪🇪" },
        { name: "Faroese", langCode: "fo", flagCode: "🇫🇴" },
        { name: "Georgian", langCode: "ka", flagCode: "🇬🇪" },
        { name: "Greek", langCode: "el", flagCode: "🇬🇷" },
        { name: "Guarani", langCode: "gn", flagCode: "🇵🇾" },
        { name: "Gujarati", langCode: "gu", flagCode: "🇮🇳" },
        { name: "Haitian Creole", langCode: "ht", flagCode: "🇭🇹" },
        { name: "Hausa", langCode: "ha", flagCode: "🇳🇪" },
        { name: "Icelandic", langCode: "is", flagCode: "🇮🇸" },
        { name: "Igbo", langCode: "ig", flagCode: "🇳🇬" },
        { name: "Irish", langCode: "ga", flagCode: "🇮🇸" },
        { name: "Javanese", langCode: "jv", flagCode: "🇮🇩" },
        { name: "Kannada", langCode: "kn", flagCode: "🇮🇳" },
        { name: "Kazakh", langCode: "kk", flagCode: "🇰🇿" },
        { name: "Kurdish", langCode: "ku", flagCode: "🇮🇶" },
        { name: "Kyrgyz", langCode: "ky", flagCode: "🇰🇬" },
        { name: "Laothian", langCode: "lo", flagCode: "🇱🇦" },
        { name: "Latvian", langCode: "lv", flagCode: "🇱🇻" },
        { name: "Luxembourgish", langCode: "lb", flagCode: "🇱🇺" },
        { name: "Macedonian", langCode: "mk", flagCode: "🇲🇰" },
        { name: "Malagasy", langCode: "mg", flagCode: "🇲🇬" },
        { name: "Malayalam", langCode: "ml", flagCode: "🇮🇳" },
        { name: "Maltese", langCode: "mt", flagCode: "🇲🇹" },
        { name: "Maori", langCode: "mi", flagCode: "🇳🇿" },
        { name: "Marathi", langCode: "mr", flagCode: "🇮🇳" },
        { name: "Moldavian", langCode: "mo", flagCode: "🇲🇩" },
        { name: "Nepali", langCode: "ne", flagCode: "🇳🇵" },
        { name: "Nyanja", langCode: "ny", flagCode: "🇲🇼" },
        { name: "Pashto", langCode: "ps", flagCode: "🇦🇫" },
        { name: "Persian", langCode: "fa", flagCode: "🇮🇷" },
        { name: "Portuguese (BR)", langCode: "pt-br", flagCode: "🇧🇷" },
        { name: "Romansh", langCode: "rm", flagCode: "🇨🇭" },
        { name: "Samoan", langCode: "sm", flagCode: "🇼🇸" },
        { name: "Serbo-Croatian", langCode: "sh", flagCode: "🇷🇸" },
        { name: "Sesotho", langCode: "st", flagCode: "🇱🇸" },
        { name: "Shona", langCode: "sn", flagCode: "🇿🇼" },
        { name: "Sindhi", langCode: "sd", flagCode: "🇵🇰" },
        { name: "Sinhalese", langCode: "si", flagCode: "🇱🇰" },
        { name: "Slovak", langCode: "sk", flagCode: "🇸🇰" },
        { name: "Slovenian", langCode: "sl", flagCode: "🇸🇮" },
        { name: "Somali", langCode: "so", flagCode: "🇸🇴" },
        { name: "Spanish (LA)", langCode: "es-la", flagCode: "🇲🇽" },
        { name: "Swahili", langCode: "sw", flagCode: "🇰🇪" },
        { name: "Tajik", langCode: "tg", flagCode: "🇹🇯" },
        { name: "Tamil", langCode: "ta", flagCode: "🇱🇰" },
        { name: "Telugu", langCode: "te", flagCode: "🇮🇳" },
        { name: "Tigrinya", langCode: "ti", flagCode: "🇪🇷" },
        { name: "Tonga", langCode: "to", flagCode: "🇹🇴" },
        { name: "Turkmen", langCode: "tk", flagCode: "🇹🇲" },
        { name: "Urdu", langCode: "ur", flagCode: "🇵🇰" },
        { name: "Uzbek", langCode: "uz", flagCode: "🇺🇿" },
        { name: "Yoruba", langCode: "yo", flagCode: "🇳🇬" },
        { name: "Zulu", langCode: "zu", flagCode: "🇿🇦" },
        { name: "Other", langCode: "other", flagCode: "🏳️‍🌈" },
    ];

    constructor() {
        // Sorts the languages based on name
        this.Languages = this.Languages.sort((a, b) =>
            a.name > b.name ? 1 : -1,
        );
    }

    getlangCodeList(): string[] {
        return this.Languages.map((Language) => Language.langCode);
    }

    getName(langCode: string): string {
        return (
            this.Languages.filter(
                (Language) => Language.langCode == langCode,
            )[0]?.name ?? "Unknown"
        );
    }

    getFlagCode(langCode: string): string {
        return (
            this.Languages.filter(
                (Language) => Language.langCode == langCode,
            )[0]?.flagCode ?? "_unknown"
        );
    }

    getDefault(): string[] {
        return this.Languages.filter((Language) => Language.default).map(
            (Language) => Language.langCode,
        );
    }
}

export const BTTLanguages = new BTTLanguagesClass();
