// Browser-safe voice catalogs per provider, for the playground voice picker.
import { defaultVoice, licensedLanguageVoices } from "./fish-audio";

export type VoiceOption = { value: string; label: string };

export const GEMINI_VOICE_LIST = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

export const OPENAI_VOICE_LIST = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx",
  "sage", "shimmer", "verse", "marin", "cedar",
];

export const DEEPGRAM_VOICE_LIST = [
  "aura-2-thalia-en", "aura-2-asteria-en", "aura-2-luna-en", "aura-2-stella-en",
  "aura-2-athena-en", "aura-2-hera-en", "aura-2-orion-en", "aura-2-arcas-en",
  "aura-2-perseus-en", "aura-2-angus-en", "aura-2-orpheus-en", "aura-2-helios-en",
  "aura-2-zeus-en", "aura-2-celeste-es", "aura-2-helena-de", "aura-2-rhea-nl",
  "aura-2-agathe-fr", "aura-2-maia-it", "aura-2-ama-ja",
];

const fishLanguageNames: Record<string, string> = {
  fr: "French", it: "Italian", es: "Spanish", de: "German", pt: "Portuguese",
  ar: "Arabic", zh: "Chinese", ja: "Japanese", ko: "Korean", ru: "Russian",
  hi: "Hindi", nl: "Dutch", pl: "Polish", tr: "Turkish",
};

export const FISH_VOICE_LIST: VoiceOption[] = [
  { value: defaultVoice, label: "English (default)" },
  ...Object.entries(licensedLanguageVoices).map(([lang, id]) => ({
    value: id,
    label: fishLanguageNames[lang] ?? lang,
  })),
];

const named = (list: string[]): VoiceOption[] => list.map((v) => ({ value: v, label: v }));

/** Selectable voices per provider. ElevenLabs voices are account-specific, so it has no preset list. */
export const providerVoices: Record<string, VoiceOption[]> = {
  lovable: named(GEMINI_VOICE_LIST),
  gemini: named(GEMINI_VOICE_LIST),
  openai: named(OPENAI_VOICE_LIST),
  deepgram: named(DEEPGRAM_VOICE_LIST),
  openrouter: FISH_VOICE_LIST,
};
