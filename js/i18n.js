/* Ayomide Studio — i18n (English / Yorùbá / Nigerian Pidgin) */
import { $, $$, emit } from './utils.js';
import { kvGet, kvSet } from './db.js';

const DICT = {
  en: {
    'nav.chat': 'Chat', 'nav.files': 'Files', 'nav.editor': 'Editor', 'nav.video': 'Image → Video',
    'nav.tools': 'Tools', 'nav.settings': 'Settings', 'nav.more': 'More',
    'chat.placeholder': 'type a message…', 'chat.new': '＋ New',
    'files.title': 'Files', 'files.upload': 'Choose files', 'files.drop': 'Drop files here',
    'files.exportall': '📦 Export all (.zip)', 'files.select': '☑️ Select', 'files.allfiles': '📂 All files',
    'editor.title': 'Image Editor', 'video.title': 'Image → Video', 'settings.title': 'Settings',
    'tools.title': 'Tools', 'tools.desc': 'Power tools — generate, convert, compress, inspect',
    'settings.appearance': '🎨 Appearance & language', 'settings.theme': 'Theme',
    'settings.theme.dark': 'Dark', 'settings.theme.light': 'Light', 'settings.theme.auto': 'Auto (system)',
    'settings.accent': 'Accent colour', 'settings.language': 'Language',
    'settings.install': '📲 Install app', 'settings.updates': '🔄 Check for updates',
    'common.save': 'Save', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.download': '⬇️ Download',
    'common.savetofiles': '💾 Save to Files', 'common.back': '← All tools'
  },
  yo: {
    'nav.chat': 'Ọ̀rọ̀', 'nav.files': 'Awọn faìlì', 'nav.editor': 'Oún Ṣààyẹ̀wò', 'nav.video': 'Àwòrán → Fídíò',
    'nav.tools': 'Ohun Èlò', 'nav.settings': 'Àtúnṣe', 'nav.more': 'Si tọ',
    'chat.placeholder': 'Sọ̀rọ̀ sí Ayomide Assistant…', 'chat.new': '＋ Tuntun',
    'files.title': 'Awọn faìlì', 'files.upload': 'Yan awọn faìlì', 'files.drop': 'Gbé wọ́n sí ibí',
    'files.exportall': '📦 Gbójọ gbé (.zip)', 'files.select': '☑️ Yan', 'files.allfiles': '📂Gbogbo rẹ̀',
    'editor.title': 'Àyẹ̀wò àwòrán', 'video.title': 'Àwòrán → Fídíò', 'settings.title': 'Àtúnṣe',
    'tools.title': 'Ohun èlò', 'tools.desc': 'Ohun èlò agbara — ṣẹ̀dá, yí padà, díndínrupa, wo inú rẹ̀',
    'settings.appearance': '🎨 Ìrí & èdè', 'settings.theme': 'Ìrí',
    'settings.theme.dark': 'Ìsálẹ̀ dúdú', 'settings.theme.light': 'Ìsálẹ̀ funfun', 'settings.theme.auto': 'Ìṣerúra (eto)',
    'settings.accent': 'Àwọ̀ pàtàkì', 'settings.language': 'Èdè',
    'settings.install': '📲 Fi s\'óri ibi ìṣàmúlò', 'settings.updates': '🔄 Ṣe àwárí ìmúlò tuntun',
    'common.save': 'Fi pamọ́', 'common.cancel': 'Fagilé', 'common.close': 'Ti', 'common.download': '⬇️ Gbà wá',
    'common.savetofiles': '💾 Fi pamọ́ sí àwọn faìlì', 'common.back': '← Gbogbo ohun èlò'
  },
  pcm: {
    'nav.chat': 'Chat', 'nav.files': 'Files', 'nav.editor': 'Editor', 'nav.video': 'Picture → Video',
    'nav.tools': 'Tools', 'nav.settings': 'Settings', 'nav.more': 'More',
    'chat.placeholder': 'Talk to Ayomide Assistant…', 'chat.new': '＋ New',
    'files.title': 'Files', 'files.upload': 'Choose files', 'files.drop': 'Drop files here',
    'files.exportall': '📦 Pack everything (.zip)', 'files.select': '☑️ Select', 'files.allfiles': '📂 Everything',
    'editor.title': 'Picture Editor', 'video.title': 'Picture → Video', 'settings.title': 'Settings',
    'tools.title': 'Tools', 'tools.desc': 'Power tools — make, convert, squeeze, check',
    'settings.appearance': '🎨 Look & language', 'settings.theme': 'Theme',
    'settings.theme.dark': 'Dark', 'settings.theme.light': 'Light', 'settings.theme.auto': 'Follow system',
    'settings.accent': 'Accent colour', 'settings.language': 'Language',
    'settings.install': '📲 Install app', 'settings.updates': '🔄 Check for update',
    'common.save': 'Save am', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.download': '⬇️ Download',
    'common.savetofiles': '💾 Save to Files', 'common.back': '← All tools'
  }
};

export const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'yo', label: 'Yorùbá' },
  { id: 'pcm', label: 'Nigerian Pidgin' }
];

let current = 'en';

export function t(key) {
  return (DICT[current] && DICT[current][key]) || DICT.en[key] || key;
}

export function applyLang(lang) {
  current = DICT[lang] ? lang : 'en';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.documentElement.lang = current === 'yo' ? 'yo' : current === 'pcm' ? 'pcm' : 'en';
}

export async function setLang(lang) {
  await kvSet('lang', lang);
  applyLang(lang);
  emit('lang:changed', lang);
}

export async function initI18n() {
  const lang = await kvGet('lang', 'en');
  applyLang(lang);
  return lang;
}

export function currentLang() { return current; }
