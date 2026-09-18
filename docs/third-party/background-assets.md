# Background asset attribution

The author-facing canvas uses a locally frozen paper texture:

- File: `public/assets/old-paper-texture.jpg`
- Source: <https://commons.wikimedia.org/wiki/File:Old_Paper_texture.jpg>
- Direct source file: <https://upload.wikimedia.org/wikipedia/commons/9/9b/Old_Paper_texture.jpg>
- License: CC0 1.0 Universal Public Domain Dedication
- Local treatment: dark blue overlay, low-opacity texture, fixed cover crop, and the existing grid/interactive cursor layer on top.

The asset is used as a low-contrast texture layer only; it is not served from the remote source at runtime.

## Black hole visualization

- File: `public/assets/black-hole-accretion.png`
- Source: <https://svs.gsfc.nasa.gov/14146>
- Direct source file: <https://svs.gsfc.nasa.gov/vis/a010000/a014100/a014146/BH_accretion_disk_viz_desktop.png>
- Credit: NASA's Goddard Space Flight Center / Jeremy Schnittman
- Local treatment: `screen` blend, darkened saturation, radial mask, slow breathing motion, and pointer parallax.
