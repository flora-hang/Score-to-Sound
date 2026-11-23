# Third-party notices

This project uses the following. Each remains under its own license. The libraries are installed from npm (see `package.json`) and included in the built app; the piano samples are in `public/piano/`.

| Component | Files | Author | License |
|---|---|---|---|
| Salamander Grand Piano V3 (4 velocity layers, MP3) | `public/piano/*.mp3` | Alexander Holm | [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) |
| VexFlow 4.2.3 | npm `vexflow` | Mohit Muthanna Cheppudira and contributors | MIT |
| Tone.js 14.7.77 | npm `tone` | Yotam Mann and contributors | MIT |
| PDF.js 3.11.174 | npm `pdfjs-dist` | Mozilla Foundation | Apache License 2.0 |
| React 18.3.1, React DOM 18.3.1 | npm `react`, `react-dom` | Meta Platforms, Inc. and affiliates | MIT |
| JSZip 3.10.1 | npm `jszip` | Stuart Knightley and contributors | MIT (dual-licensed MIT or GPLv3; used under MIT) |
| homr 0.7.1 (free note reading, server only) | `omr/` container, installed from PyPI | Christian Liebhardt and contributors | [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html) |
| ONNX Runtime 1.32.0 (used by homr) | `omr/` container, installed from PyPI | Microsoft Corporation | MIT |

## Salamander Grand Piano

Recorded from a Yamaha C5 grand piano by Alexander Holm. Licensed under CC BY 3.0: https://creativecommons.org/licenses/by/3.0/
The MP3 velocity-layer files were prepared by the Tone.js project (https://github.com/tambien/Piano). No changes were made to the recordings.

## Apache License 2.0 (PDF.js)

PDF.js is licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
Copyright Mozilla Foundation. You may not use these files except in compliance with the License. Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.

## MIT License (React, VexFlow, Tone.js, JSZip)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## homr (free note reading)

The free note reader runs [homr](https://github.com/liebharc/homr), an optical music recognition program by Christian Liebhardt and contributors, licensed under the GNU Affero General Public License v3. It runs **unchanged**, as a separate program in its own container (`omr/`), and the app only sends it page images and reads back the MusicXML it writes. Its complete source code is available at https://github.com/liebharc/homr (version 0.7.1). If you change homr's own code, the AGPL requires you to offer your changed source to the people who use it over the network.
