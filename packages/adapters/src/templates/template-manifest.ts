// P3: manifest template (template.json di folder tiap template). Ditulis TANGAN oleh PO
// saat menaruh template — satu-satunya metadata yang tak bisa diturunkan dari isi template
// (jenis usaha apa yang cocok itu penilaian manusia). Sisanya (slot, halaman) di-derive
// indexer dari project.mobirise.

import { z } from 'zod';

export const templateManifestSchema = z.object({
  name: z.string().min(1).max(120),
  // 1-2 kalimat untuk prompt pemilihan LLM — tulis seperti menjelaskan ke sales.
  description: z.string().min(1).max(500),
  // Jenis usaha yang cocok, kata kunci bebas huruf kecil (mis. "kuliner", "rental mobil").
  businessTypes: z.array(z.string().min(1).max(60)).min(1),
  tags: z.array(z.string().min(1).max(40)).default([]),
  active: z.boolean().default(true),
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
