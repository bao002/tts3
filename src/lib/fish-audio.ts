export const FISH_MODEL = 'fish-audio/s2.1-pro-free:free';
export const speechLanguages = [
  ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'],
  ['hy', 'Armenian'], ['as', 'Assamese'], ['ay', 'Aymara'], ['az', 'Azerbaijani'],
  ['eu', 'Basque'], ['be', 'Belarusian'], ['bn', 'Bengali'], ['bho', 'Bhojpuri'],
  ['bs', 'Bosnian'], ['bg', 'Bulgarian'], ['my', 'Burmese'], ['ca', 'Catalan'],
  ['ceb', 'Cebuano'], ['zh', 'Chinese'], ['zh-Hans', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)'],
  ['co', 'Corsican'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'],
  ['dv', 'Dhivehi'], ['doi', 'Dogri'], ['nl', 'Dutch'], ['en', 'English'],
  ['eo', 'Esperanto'], ['et', 'Estonian'], ['ee', 'Ewe'], ['fil', 'Filipino'], ['tl', 'Tagalog'],
  ['fi', 'Finnish'], ['fr', 'French'], ['fy', 'Frisian'], ['gl', 'Galician'],
  ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['gn', 'Guarani'],
  ['gu', 'Gujarati'], ['ht', 'Haitian Creole'], ['ha', 'Hausa'], ['haw', 'Hawaiian'],
  ['he', 'Hebrew'], ['iw', 'Hebrew (legacy code)'], ['hi', 'Hindi'], ['hmn', 'Hmong'],
  ['hu', 'Hungarian'], ['is', 'Icelandic'], ['ig', 'Igbo'], ['id', 'Indonesian'],
  ['ga', 'Irish'], ['it', 'Italian'], ['ja', 'Japanese'], ['jv', 'Javanese'],
  ['jw', 'Javanese (legacy code)'], ['kn', 'Kannada'], ['kk', 'Kazakh'], ['km', 'Khmer'],
  ['rw', 'Kinyarwanda'], ['ko', 'Korean'], ['kri', 'Krio'], ['ku', 'Kurdish'],
  ['ky', 'Kyrgyz'], ['lo', 'Lao'], ['la', 'Latin'], ['lv', 'Latvian'],
  ['ln', 'Lingala'], ['lt', 'Lithuanian'], ['lb', 'Luxembourgish'], ['mk', 'Macedonian'],
  ['mg', 'Malagasy'], ['ms', 'Malay'], ['ml', 'Malayalam'], ['mt', 'Maltese'],
  ['mi', 'Maori'], ['mr', 'Marathi'], ['mn', 'Mongolian'], ['ne', 'Nepali'],
  ['nso', 'Northern Sotho'], ['no', 'Norwegian'], ['ny', 'Nyanja'], ['or', 'Odia'],
  ['om', 'Oromo'], ['ps', 'Pashto'], ['fa', 'Persian'], ['pl', 'Polish'],
  ['pt', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)'],
  ['pa', 'Punjabi'], ['qu', 'Quechua'], ['ro', 'Romanian'], ['ru', 'Russian'],
  ['sm', 'Samoan'], ['sa', 'Sanskrit'], ['gd', 'Scottish Gaelic'], ['sr', 'Serbian'],
  ['sn', 'Shona'], ['sd', 'Sindhi'], ['si', 'Sinhala'], ['sk', 'Slovak'],
  ['sl', 'Slovenian'], ['so', 'Somali'], ['st', 'Southern Sotho'], ['es', 'Spanish'],
  ['es-419', 'Spanish (Latin America)'], ['es-MX', 'Spanish (Mexico)'], ['su', 'Sundanese'],
  ['sw', 'Swahili'], ['sv', 'Swedish'], ['tg', 'Tajik'], ['ta', 'Tamil'],
  ['tt', 'Tatar'], ['te', 'Telugu'], ['th', 'Thai'], ['ti', 'Tigrinya'],
  ['ts', 'Tsonga'], ['tr', 'Turkish'], ['tk', 'Turkmen'], ['uk', 'Ukrainian'],
  ['ur', 'Urdu'], ['ug', 'Uyghur'], ['uz', 'Uzbek'], ['vi', 'Vietnamese'],
  ['cy', 'Welsh'], ['xh', 'Xhosa'], ['yi', 'Yiddish'], ['yo', 'Yoruba'],
  ['zu', 'Zulu'], ['en-GB', 'English (United Kingdom)'], ['en-US', 'English (United States)'],
  ['fr-CA', 'French (Canada)'],
] as const;

const defaultVoice = 'b347db033a6549378b48d00acb0d06cd';
const licensedLanguageVoices: Record<string, string> = {
  fr: 'fce1bed339724d91b5c9c4d01bb6e796',
  it: '081b06713d084d4da1724846b52832ac',
  es: 'f40c5dc43e7e4e3ba641b6e8b53ad7c2',
  de: '2c96d68b356b422a8c7036e75a042112',
  pt: 'b5f8214552da406f801acf049ef1def4',
  ar: '90265c332d894a04b9c09a91c32b6a7f',
  zh: '09f2e5951ea543319af82e7d2219a92c',
  ja: '297a6fd278df47c3b9da9bfdf55ac89a',
  ko: '1522b08ff8824100b4df795a4d149206',
  ru: '0e16ac9230bd4dd5b2eba5394a9379b9',
  hi: '18e8999c98b746bda58521980d817e8c',
  nl: '34e7be0209bb4c848f34338687dd6c20',
  pl: 'ea599e3ccab045cda2b45ad8910e08fe',
  tr: '8257f4d6d6334d9bb1603bfcd815e707',
};

export function speechBody(text: string, lang: string, voice?: string, speed?: number, options?: Record<string, unknown>) {
  const model = typeof options?.['model'] === 'string' ? options['model'] : FISH_MODEL;
  const language = lang.toLowerCase().replaceAll('_', '-').split('-')[0] ?? '';
  const isFish = model.startsWith('fish-audio/');
  // Fish clones the reference voice's accent. Using the English default voice for
  // other languages makes speech sound English, so only fall back to it for English.
  const chosen = voice || licensedLanguageVoices[language] || (!isFish || language === 'en' ? defaultVoice : undefined);
  return { ...options, input: text, model, response_format: 'mp3', speed: speed ?? 1,
    ...(chosen ? { voice: chosen } : {}),
    ...(isFish ? { language: lang } : {}),
  };
}