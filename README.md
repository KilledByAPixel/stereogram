# Stereogram Generator

A browser-based tool for generating 3D autostereograms (Magic Eye style images) from depth maps. Pure HTML/JS, no build step, no dependencies.

![Stereogram example](images/example1.png)

## [▶ Try the Live Demo](https://killedbyapixel.github.io/stereogram/)

## Features

### Depth sources
- Built-in presets: box frame, sphere, ring, pyramid, waves
- 3D text with selectable font
- Upload your own grayscale depth map (drag-and-drop onto the canvas)

### Pattern styles
- Gradient, warped, and pixelated procedural noise
- Random dots (blue-noise distributed for cleaner fusion)
- Checkerboard
- Upload your own tileable image

### Controls
- **Depth Intensity** with an **Auto** button that picks the strongest setting that won't ghost
- **Repeat Count**, **Invert Depth**
- **Edge Enhancement** — Sobel-based outlines that make silhouettes pop
- **Depth Shading** — tints each pixel by its depth, with decaying echoes through neighboring tiles so the strongest shading lands where the eyes converge
- **Texture Scale**, **Hue Variance**, **Saturation**, **Contrast** for procedural patterns
- **Seed** with lock and randomize controls
- **Convergence Dots** — alignment guides above the image to help your eyes lock in

### Output
- Render at 720p, 1080p, 1440p, or 4K (plus square and portrait variants)
- Save as PNG
- Fullscreen view

## Usage

1. Pick a depth preset, type some 3D text, or drag your own grayscale image onto the canvas (white = near, black = far).
2. Tweak the sliders. Hit **Auto** next to Depth Intensity if you're not sure where to start.
3. Click **Regenerate** to roll a new random pattern seed.
4. View with the **parallel viewing method**: relax your eyes and look *through* the screen as if focusing on something far behind it. The repeating pattern will shift and a 3D shape will emerge. When the convergence dots become three dots instead of two, you're aligned.

## Examples

![Stereogram example](images/example2.png)
![Stereogram example](images/example3.png)
![Stereogram example](images/example4.png)
