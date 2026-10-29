import i18next from 'i18next';
import keys from '../gen/keys.json';
import resources from '../gen/locales.json';

const instance = i18next.createInstance();
await instance.init({ lng: 'en', fallbackLng: 'en', resources, initAsync: false });

export const languages = Object.keys(resources);
export const translationKeys: string[] = keys;
export const t = (lng: string, key: string) => instance.getFixedT(lng)(key);
