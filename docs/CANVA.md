# The original Canva presentation

The connected Canva design is **Your paragraph text** (design ID `DAHXRf8lZik`), an eight-page story beginning **The Axolotl**. [Open the existing design](https://www.canva.com/d/FzMloLG4S7ylOK9).

**The Story** now plays Canva's original MP4 export, including the artwork, page order, timing, and audio. It is served as a static frontend asset at `/presentation/the-axolotl.mp4`, without requiring reader authentication or new backend infrastructure. The video has playback controls, fullscreen support, and no autoplay. `preload="none"` avoids downloading the 51 MiB video until a reader chooses to play it. The poster is the video's first frame.

The export downloaded on October 13, 2026 is 1920 × 1080, 69.333 seconds, with one audio track. The repository file is byte-for-byte identical to Canva's download; its SHA-256 is recorded in `src/data/presentation.json`. The Canva design remains editable in Canva. No design or sharing settings were changed, and no paid upgrade or subscription was started.

The exact text originally extracted from pages 1–7 remains under **Read the story**, with its spelling and punctuation preserved. Page 8 returned no text; all eight pages are included in the video.

## Refresh the video after editing in Canva

1. Open the existing design in your signed-in Canva browser.
2. Select **Share → Download**.
3. Choose **MP4 Video**, **1920 × 1080**, and **All** pages. Leave **Download pages as separate files** off. Preserve the design's existing timing and audio.
4. Click **Download**. If Canva asks for a payment, upgrade, or trial, stop; use an export available under your existing account.
5. Replace `public/presentation/the-axolotl.mp4` with the downloaded file. Keep an original copy on your computer.
6. Update `public/presentation/the-axolotl.jpg` with the video's first frame and record the new export metadata in `src/data/presentation.json`.
7. Run `npm run build:preview` and verify playback locally, then commit and push the changed assets and metadata.
8. To make the new video live, deploy the frontend through Amplify. A cloud build and video delivery can incur charges; this change does not start a cloud build automatically.

Publishing a blog post does not replace the original video in **The Story**. New videos and presentations can still be included in posts through the editor.
