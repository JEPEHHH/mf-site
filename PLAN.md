# Rencana Kerja — site-generator-speed-01-run-20261122

## Target & Batasan
- Drop-in pengganti `makefun-site 1.0.0` (`run(input)`) dengan output 100% identik byte-per-byte.
- Node 22 (JS/TS murni, tanpa dependensi eksternal, tanpa WASM/native addon/binary).
- Tanpa cache lintas kasus, deterministik (2x eksekusi identik), ukuran repo total <= 4 MiB.
- Metrik utama: CPU time lebih cepat dari baseline `makefun-site` pada 95% confidence.

## Rencana Kerja (Commit per Milestone)
1. **Milestone 1 — Analisis & Baseline Benchmark**
   - Baca spesifikasi penuh di `baselines/makefun-site/vendor/makefun-site/` (`README.md`, `index.js`, `lib/*.js`).
   - Ukur CPU time baseline dan profil hotspot pada `practice/input/cases.json` terhadap `practice/reference/expected.json`.
2. **Milestone 2 — Kerangka Entri & Verifikasi**
   - Buat `package.json`, `LICENSE` (MIT), `main.ts`, dan `solve.js` awal.
   - Verifikasi exact-match dengan `program/scorer/main.ts` serta uji determinisme (2x run).
3. **Milestone 3 — Optimasi Parser Frontmatter & Utilitas Teks**
   - Tulis ulang `lib/frontmatter.js` (scan berbasis indeks/charCode, minim regex & alokasi).
   - Optimasi `lib/text.js` (`escapeHtml`, `slugify`, `uniqueSlug`, `longDate`).
4. **Milestone 4 — Optimasi Renderer Markdown**
   - Tulis ulang `lib/markdown.js` dengan scanner linear satu-pass yang mempertahankan semua edge-case dialek `makefun-site`.
5. **Milestone 5 — Optimasi Template Engine & Pipeline Utama**
   - Kompilasi template di `lib/template.js` sekali per kasus menjadi fungsi render cepat (tanpa re-traversal AST berulang).
   - Optimasi pipeline `solve.js` (sorting, tagging, pagination, link resolution, build report) & tuning flag V8 di `main.ts`.
6. **Milestone 6 — Fuzz Testing, Benchmark Final & Validasi**
   - Uji kebenaran pada banyak seed acak menggunakan `program/generator/draw.ts` + oracle referensi.
   - Jalankan benchmark CPU time multi-round vs baseline, pastikan tidak ada regresi dan ukuran repo <= 4 MiB.

## Daftar Berkas yang Akan Dibuat
- `PLAN.md` — Rencana kerja dan daftar berkas ini.
- `package.json` — Konfigurasi ES module (`{"type":"module"}`).
- `LICENSE` — Lisensi OSI (MIT) sesuai aturan submisi.
- `main.ts` — Driver harness (`/input/cases.json` -> `run()` -> `/output/answers.json`) + tuning V8.
- `solve.js` — Modul ES utama bebas dependensi yang mengekspor `run(input)`.
- `lib/frontmatter.js` — Parser frontmatter cepat sesuai spesifikasi `makefun-site`.
- `lib/markdown.js` — Lexer/renderer Markdown cepat sesuai dialek `makefun-site`.
- `lib/template.js` — Kompiler dan renderer template cepat.
- `lib/text.js` — Utilitas teks (`escapeHtml`, `slugify`, `uniqueSlug`, `longDate`) teroptimasi.
- `scripts/bench.mjs` — Alat bantu lokal untuk verifikasi, fuzzing, dan pengukuran CPU time.
