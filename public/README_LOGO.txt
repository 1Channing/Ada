MC EXPORT LOGO SETUP
=====================

To complete the PDF export feature, please add the MC Export logo:

1. Save the logo file as: mc-export-logo.png
2. Place it in this directory: /public/mc-export-logo.png

The logo should be the "MC_EXPORT_Export_from_France.png" file that was shared.

The PDF exporter will automatically:
- Load the logo from /mc-export-logo.png
- Add it as a footer on every PDF page
- Center it horizontally at the bottom (8mm from bottom edge)
- Scale it to 12mm height while maintaining aspect ratio

If the logo file is missing, the PDF generation will still work but may show a broken image icon in the footer.
