// Instansiasi blok baru dari sumber tema (template.html + style.less) → BlockInstance
// siap dimasukkan ke proyek. Memberi _cid/_anchor baru, mengubah style.less → _styles,
// dan menyematkan data-edit-id untuk edit inline. @THEME_PATH@ diganti path aset konkret
// agar gambar placeholder blok tetap termuat lintas tema.

import { annotateEditable } from './editable.js';
import { parseLess } from './less-parse.js';
import type { BlockInstance } from './render.js';

export interface InstantiateInput {
  readonly name: string;
  readonly sourceTheme: string;
  readonly templateHtml: string;
  readonly styleLess: string;
  /** Path aset tema konkret untuk menggantikan @THEME_PATH@ (mis. /blocks/mobirise5). */
  readonly themeAssetPath: string;
}

function randomCid(): string {
  return 'ew' + Math.random().toString(36).slice(2, 10);
}

export function instantiateBlock(input: InstantiateInput): BlockInstance {
  const cid = randomCid();
  const html = input.templateHtml.replaceAll('@THEME_PATH@', input.themeAssetPath);
  return {
    _cid: cid,
    _name: input.name,
    _anchor: `${input.name}-${cid}`,
    _customHTML: annotateEditable(html),
    _styles: parseLess(input.styleLess),
    _params: {},
  };
}
