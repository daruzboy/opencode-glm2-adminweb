// Parse <mbr-parameters> sebuah blok → daftar definisi kontrol + nilai default.
// Dipakai untuk (a) membangkitkan panel gear di editor, (b) menyediakan default param
// yang ditimpa oleh _params instance saat render.

import { parse, type HTMLElement } from 'node-html-parser';
import type { ParamContext } from './expr.js';

export type ParamType =
  | 'checkbox'
  | 'range'
  | 'color'
  | 'image'
  | 'video'
  | 'text'
  | 'number'
  | 'select'
  | 'background';

export interface ParamOption {
  readonly value: string;
  readonly label: string;
}

export interface ParamDef {
  readonly name: string;
  readonly type: ParamType;
  readonly title: string;
  readonly defaultValue: unknown;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly inline?: boolean;
  readonly condition?: string;
  readonly options?: readonly ParamOption[];
  /** Untuk fieldset background: apakah mendukung parallax. */
  readonly parallax?: boolean;
  /** Grup <header> tempat kontrol ini berada (untuk tata letak panel). */
  readonly group?: string;
}

export interface ParametersSchema {
  readonly defs: readonly ParamDef[];
  /** Nilai default gabungan, siap dijadikan basis konteks evaluasi. */
  readonly defaults: ParamContext;
}

function numAttr(el: HTMLElement, name: string): number | undefined {
  const v = el.getAttribute(name);
  return v == null ? undefined : Number(v);
}

// Nilai default background fieldset: pilih <input> anak yang bertanda `selected`,
// atau yang pertama. type = image|color|video → {type, value, parallax}.
function backgroundDefault(fieldset: HTMLElement): Record<string, unknown> {
  const inputs = fieldset.querySelectorAll('input');
  let chosen = inputs.find((i) => i.hasAttribute('selected')) ?? inputs[0];
  const type = chosen?.getAttribute('type') ?? 'color';
  const value = chosen?.getAttribute('value') ?? '';
  const kind = type === 'image' ? 'image' : type === 'video' ? 'video' : 'color';
  return {
    type: kind,
    value: kind === 'video' ? { url: value } : value,
    parallax: fieldset.hasAttribute('parallax') ? false : undefined,
  };
}

export function parseParameters(customHTML: string): ParametersSchema {
  const root = parse(customHTML, { comment: false });
  const container = root.querySelector('mbr-parameters');
  if (!container) return { defs: [], defaults: {} };

  const defs: ParamDef[] = [];
  const defaults: ParamContext = {};
  let currentGroup: string | undefined;

  for (const el of container.childNodes) {
    if (el.nodeType !== 1) continue;
    const node = el as HTMLElement;
    const tag = node.rawTagName?.toLowerCase();

    if (tag === 'header') {
      currentGroup = node.text.trim();
      continue;
    }

    const condition = node.getAttribute('condition');

    if (tag === 'fieldset' && node.getAttribute('type') === 'background') {
      const name = node.getAttribute('name') ?? 'bg';
      const def: ParamDef = {
        name,
        type: 'background',
        title: node.getAttribute('title') ?? 'Background',
        defaultValue: backgroundDefault(node),
        parallax: node.hasAttribute('parallax'),
        condition: condition ?? undefined,
        group: currentGroup,
      };
      defs.push(def);
      defaults[name] = def.defaultValue;
      continue;
    }

    if (tag === 'select') {
      const name = node.getAttribute('name');
      if (!name) continue;
      const options = node.querySelectorAll('option').map((o) => ({
        value: o.getAttribute('value') ?? o.text.trim(),
        label: o.text.trim(),
      }));
      const selected = node.querySelector('option[selected]');
      const def: ParamDef = {
        name,
        type: 'select',
        title: node.getAttribute('title') ?? name,
        defaultValue: selected?.getAttribute('value') ?? options[0]?.value ?? '',
        options,
        condition: condition ?? undefined,
        group: currentGroup,
      };
      defs.push(def);
      defaults[name] = def.defaultValue;
      continue;
    }

    if (tag === 'input') {
      const name = node.getAttribute('name');
      const rawType = (node.getAttribute('type') ?? 'text').toLowerCase();
      if (!name) continue;
      const type = (
        ['checkbox', 'range', 'color', 'image', 'video', 'text', 'number'].includes(rawType)
          ? rawType
          : 'text'
      ) as ParamType;

      let defaultValue: unknown;
      if (type === 'checkbox') defaultValue = node.hasAttribute('checked');
      else if (type === 'range' || type === 'number') defaultValue = numAttr(node, 'value') ?? 0;
      else defaultValue = node.getAttribute('value') ?? '';

      const def: ParamDef = {
        name,
        type,
        title: node.getAttribute('title') ?? name,
        defaultValue,
        min: numAttr(node, 'min'),
        max: numAttr(node, 'max'),
        step: numAttr(node, 'step'),
        inline: node.hasAttribute('inline'),
        condition: condition ?? undefined,
        group: currentGroup,
      };
      defs.push(def);
      defaults[name] = defaultValue;
    }
  }

  return { defs, defaults };
}

// Konteks evaluasi = default ditimpa nilai instance (_params). _params bisa berisi
// nilai skalar atau objek (background). Penggabungan dangkal cukup: tiap param adalah
// satu entri bernama.
export function buildContext(schema: ParametersSchema, params: ParamContext): ParamContext {
  return { ...schema.defaults, ...params };
}
