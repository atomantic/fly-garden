# Distribution provenance inventory

Snapshot of the unchanged npm lockfile and current project assets, September 12, 2026. This inventory distinguishes package declarations from a complete transitive embedded-component audit. No dependencies or datasets were downloaded or installed for this check.

The browser distribution now includes [third-party notices](../public/third-party-notices.html), linked from its footer. React, React DOM, Scheduler and Three.js license texts were copied from the installed versions matching the lockfile. Vite core attribution covers its generated browser helpers. The source repository's [MIT license](../LICENSE) applies to original project code; dependency and dataset terms remain separate.

## npm packages

The lockfile contains 45 package entries: 30 MIT, 12 MPL-2.0, one Apache-2.0, one ISC and one BSD-3-Clause. Platform alternatives are counted separately and are not all installed on this machine. All four non-development package entries are MIT. Build tools remain installed packages with their own license files; the table does not replace bundled dependency notices inside them. In particular, Vite's LICENSE.md contains additional Apache/BSD/CC0/ISC/MIT notices and Lightning CSS declares MPL-2.0. They are not relicensed as Fly Garden code.

| Package | Pinned version | Declared license | Scope |
| --- | --- | --- | --- |
| `@oxc-project/types` | 0.149.0 | MIT | Build / optional platform |
| `@rolldown/binding-android-arm-eabi` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-android-arm64` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-darwin-arm64` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-darwin-x64` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-freebsd-x64` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-arm-gnueabihf` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-arm64-gnu` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-arm64-musl` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-ppc64-gnu` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-s390x-gnu` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-x64-gnu` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-linux-x64-musl` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-openharmony-arm64` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-win32-arm64-msvc` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/binding-win32-x64-msvc` | 1.2.8 | MIT | Build / optional platform |
| `@rolldown/pluginutils` | 1.0.1 | MIT | Build / optional platform |
| `@vitejs/plugin-react` | 6.1.1 | MIT | Build / optional platform |
| `detect-libc` | 2.1.2 | Apache-2.0 | Build / optional platform |
| `fdir` | 6.5.0 | MIT | Build / optional platform |
| `fsevents` | 2.3.3 | MIT | Build / optional platform |
| `lightningcss` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | Build / optional platform |
| `nanoid` | 3.3.19 | MIT | Build / optional platform |
| `picocolors` | 1.1.1 | ISC | Build / optional platform |
| `picomatch` | 4.0.7 | MIT | Build / optional platform |
| `postcss` | 8.5.28 | MIT | Build / optional platform |
| `react` | 19.3.0 | MIT | Browser runtime |
| `react-dom` | 19.3.0 | MIT | Browser runtime |
| `rolldown` | 1.2.8 | MIT | Build / optional platform |
| `scheduler` | 0.28.0 | MIT | Browser runtime |
| `source-map-js` | 1.2.1 | BSD-3-Clause | Build / optional platform |
| `three` | 0.186.0 | MIT | Browser runtime |
| `tinyglobby` | 0.2.17 | MIT | Build / optional platform |
| `vite` | 8.3.0 | MIT | Build / optional platform |

## Project assets and research data

- Runtime flies, flowers, garden and atlas geometry are original procedural project code; Three.js provides rendering. Cell points and straight connection lines are distinct from neurite morphology. No reference-site code or assets were copied. See [anatomical provenance](ANATOMICAL_ATLAS.md).
- Two aspirational image-generation concepts are documented with creation date and limitations in [design notes](DESIGN.md). They are not anatomy or runtime evidence.
- MaleCNS and BANC data retain their pinned CC-BY-4.0 sources, specimen namespaces, hashes and attribution in [MaleCNS model card](CONNECTOME_MODEL_CARD.md), [BANC model card](BANC_MODEL_CARD.md), and the checked-in source locks. Large source/graph/atlas arrays remain local ignored data, separate from the app bundle.
- The optional offline FlyGym/MuJoCo study has its own pinned environment and component terms in [body feasibility](BODY_FEASIBILITY.md). No richer body backend, external controller code, third-party meshes or FFmpeg binary is bundled into the browser by this inventory.

Recheck the inventory and copied notices when dependencies or assets change. This snapshot does not certify every embedded build-tool component or a future packaged Python/body distribution. The normal production build copies the public notice page; its presence and exact license text were checked in the generated output.
