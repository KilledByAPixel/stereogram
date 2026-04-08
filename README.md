# Stereogram Generator

A browser-based tool for generating 3D autostereograms (Magic Eye style images) from depth maps. Pure HTML/JS, no build step, no dependencies.

![Stereogram Screenshot 1](images/example1.png)

# [Try The Live Demo](https://killedbyapixel.github.io/stereogram/)

## Features

- **Depth sources** — built-in presets (box, sphere, ring, pyramid, waves), 3D text with selectable font, or upload your own grayscale depth map (drag-and-drop supported)
- **Pattern styles** — gradient noise, warped noise, pixelated noise, random dots, checkerboard, or upload a custom tileable image
- **Color controls** — hue variance, saturation, and contrast for procedural patterns
- **Depth controls** — adjustable depth intensity, repeat count, invert toggle, and an **Auto Depth** button that picks the strongest setting that won't produce ghosting
- **Edge enhancement** — optional Sobel-based outlines that darken silhouettes to make shapes pop
- **Convergence dots** — optional alignment guides above the image to help your eyes lock in
- **Output** — render at 720p up to 4K, save as PNG, or view fullscreen
- **Live depth preview** — toggle to overlay the source depth map

## Usage

1. Pick a depth preset, type some 3D text, or drag your own grayscale image onto the canvas (white = near, black = far).
2. Tweak the sliders. Click **Auto Depth** if you're not sure where to start.
3. Click **Regenerate** to roll a new random pattern seed.
4. View with the **parallel viewing method**: relax your eyes and look *through* the screen as if focusing on something far behind it. The repeating pattern will shift and a 3D shape will emerge. The convergence dots help — when you see three dots instead of two, you're aligned.

## Examples

![Stereogram Screenshot 2](images/example2.png)
![Stereogram Screenshot 3](images/example3.png)
![Stereogram Screenshot 4](images/example4.png)
