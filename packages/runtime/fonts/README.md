# Bundled fonts

These fonts support offline rendering. All glyphs and embedded copyright and license metadata are retained. The companion license files contain the complete SIL Open Font License texts.

The runtime HTML entries also retain both copyright notices and the shared license in an inert `vp-font-licenses` script so portable pages carry the license when shared on their own.

IBM Plex Sans Var version 3.000 comes from [IBM/plex commit 71f558992315a12ca1f06a2215d57962a1992162](https://github.com/IBM/plex/tree/71f558992315a12ca1f06a2215d57962a1992162/packages/plex-sans-variable). `IBMPlexSansVar-Roman.woff2` and `IBMPlexSansVar-Italic.woff2` are unchanged upstream files from `fonts/complete/woff2/IBM Plex Sans Var-Roman.woff2` and `fonts/complete/woff2/IBM Plex Sans Var-Italic.woff2`. Their weight axis spans 100 to 700. Their width axis spans 85 to 100, with default 100. `IBM-Plex-LICENSE.txt` is the package's unchanged `LICENSE.txt`.

Lilex version 2.700, patched by Nerd Fonts 3.5.0, comes from [ryanoasis/nerd-fonts commit bbb2db23a131139161d66a9b526a6fdc79875c92](https://github.com/ryanoasis/nerd-fonts/tree/bbb2db23a131139161d66a9b526a6fdc79875c92/patched-fonts/Lilex). The Regular, Bold, Italic, and BoldItalic `LilexNerdFontMono` TTF files were converted to WOFF2 without subsetting. Regular and Italic have weight 400; Bold and BoldItalic have weight 700. `Lilex-LICENSE.txt` is the unchanged upstream `LICENSE.txt`.

Lilex source files were read from the installed Nix package `nerd-fonts-lilex-3.5.0+2.700` and verified byte for byte against the pinned upstream files. Conversion used FontTools 4.67.0 with Brotli 1.2.0. For each face, run:

```sh
python -m fontTools.ttLib.woff2 compress LilexNerdFontMono-Regular.ttf -o LilexNerdFontMono-Regular.woff2
```

Conversion verification compared the complete character map and glyph order against each original TTF. Normal faces retain 12,199 glyphs, and italic faces retain 12,200 glyphs. The font name tables retain each original copyright notice, OFL declaration, and license URL.
