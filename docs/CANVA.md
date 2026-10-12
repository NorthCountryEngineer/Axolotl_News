# The original Canva presentation

The connected Canva design is **Your paragraph text** (design ID `DAHXRf8lZik`), an eight-page story beginning **The Axolotl**. [Open the existing design](https://www.canva.com/d/FzMloLG4S7ylOK9).

The website includes a clearly identified **text edition** in `src/data/presentation.json`. Its page order, spelling, punctuation, and leading space on page 1 are copied from Canva's read-only rich-text result. Page 8 returned no text. A text-only result cannot establish whether page 8 contains artwork, so it remains in the source record.

The original slide artwork has **not** been exported. The connected Canva tools available in this session could read text and metadata but offered no design-export operation. Canva's view/editor links required a separate browser login, and native browser access was blocked by pending computer-use permissions. No design was changed, no sharing setting was changed, and no paid upgrade or subscription was started. `exportPending: true` records this limitation. A later read-only attempt obtained the eight original thumbnail URLs, but an ordinary GET of each exact URL returned HTTP 403 Forbidden. The service blocked preview acquisition, so no preview files were included. `previewSlides: []` and `previewsImported: false` record that result. URL parameters and export restrictions were left intact.

## Import the original artwork

1. Open the existing design in your signed-in Canva browser.
2. Select **Share → Download**.
3. Choose **PNG**, leave the ordinary export settings, and select **all eight pages**. Download and extract the ZIP if Canva packages the pages together. Preserve their page order. Alternatively, choose **PDF Standard** to download one presentation PDF.
4. If Canva asks for payment, an upgrade, or a trial, cancel. Use an export available under your existing account, or replace any paid design elements yourself before trying again.
5. Open the website's signed-in editor, create a **Presentation**, and upload the eight slide PNGs in order. You can also upload the PDF as a downloadable document.
6. Preview it and publish when ready. Publishing/uploads in local demo mode stay in the browser; the AWS setup guide explains what happens after cloud deployment.

PNG slides preserve the appearance in a browser carousel. A PDF is useful as a download; its browser viewer varies by device. Neither format preserves Canva animations or editable design elements.

Keep an original export on your own computer as a backup. Do not paste a Canva temporary thumbnail URL into a post; use downloaded files through the upload control.

## Optional source files in the repository

If you prefer committing the original slides as application assets, place the eight PNG files in `public/presentation/` with names `slide-01.png` through `slide-08.png`. A PDF backup can be named `the-axolotl.pdf`. The application currently uses the text edition until a published Presentation post supplies the artwork. Simply copying assets to this folder does not publish a post or switch the reader automatically.

## Canva documentation

- [Download or save designs to your device](https://www.canva.com/help/download-or-purchase/)
- [Choose the right download file type](https://www.canva.com/help/download-file-types/)

Instructions checked against Canva's official documentation on October 11, 2026.
