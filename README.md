# Alpha Converter

Convertit les fichiers RAW (CR3, NEF, ARW, RAF, ORF, RW2…) en **DNG sans perte** ou en **JPG**, directement dans le navigateur. Les photos ne sont jamais envoyées sur un serveur.

En ligne : https://alphanexia.github.io/convert/

## Fichiers
- `index.html`, `app.js` : interface
- `converter.js` : conversion (DNG / JPG)
- `dng.js` : écriture des fichiers DNG et des métadonnées EXIF
- `libraw-index.js`, `worker.js`, `libraw.js`, `libraw.wasm` : décodeur RAW [libraw-wasm](https://www.npmjs.com/package/libraw-wasm) (ISC), basé sur [LibRaw](https://www.libraw.org) (LGPL 2.1 / CDDL 1.0)
- `fflate.js` : création des zip ([fflate](https://github.com/101arrowz/fflate), MIT)
- `jpeg-encoder.js` : encodeur JPG de secours ([jpeg-js](https://github.com/jpeg-js/jpeg-js), BSD-3-Clause)

## Mise en ligne
Settings → Pages → Source : « Deploy from a branch », branche `main`, dossier `/ (root)`.
