import { icons } from '@iconify-json/mdi';
import { getIconData, iconToHTML, iconToSVG, replaceIDs } from '@iconify/utils';

export const iconNames = Object.keys(icons.icons);

export function icon(name: string, size = 24): string {
  const data = getIconData(icons, name);
  if (!data) return '';
  const { attributes, body } = iconToSVG(data, { height: size });
  return iconToHTML(replaceIDs(body, `i-${name}`), attributes);
}
