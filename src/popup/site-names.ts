import type { SourceModel } from '../types';

export const SITE_NAMES: Record<SourceModel['site'], string> = {
  printables: 'Printables',
  thingiverse: 'Thingiverse',
  makerworld: 'MakerWorld',
  github: 'GitHub',
  voron: 'Voron Mods',
  other: 'the site',
};
