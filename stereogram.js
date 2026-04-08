'use strict';

///////////////////////////////////////////////////////////////////////////////
// MATH UTILITIES

const PI = Math.PI;
const abs = (a) => a < 0 ? -a : a;
const mod = (a, b=1) => ((a % b) + b) % b;
const clamp = (v, min=0, max=1) => v < min ? min : v > max ? max : v;
const smoothStep = (p) => p * p * (3 - 2 * p);

class Random {
    constructor(seed) { this.seed = seed | 0; }
    float(a=1, b=0) {
        this.seed ^= this.seed << 13;
        this.seed ^= this.seed >>> 17;
        this.seed ^= this.seed << 5;
        return b + (a - b) * Math.abs(this.seed % 1e7) / 1e7;
    }
    int(a=1, b=0) { return this.float(a, b) | 0; }
}

///////////////////////////////////////////////////////////////////////////////
// COLOR

function hslToRgb(h, s, l) {
    h = mod(h); s = clamp(s); l = clamp(l);
    if (s === 0) { const v = l * 255 | 0; return [v, v, v]; }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        hue2rgb(p, q, h + 1/3) * 255 | 0,
        hue2rgb(p, q, h)       * 255 | 0,
        hue2rgb(p, q, h - 1/3) * 255 | 0,
    ];
}

///////////////////////////////////////////////////////////////////////////////
// NOISE

// Gradient (Perlin-style) noise with horizontal wrapping. Returns [0, 1].
// Uses random unit-ish gradient vectors at grid corners and dot products
// against the offset, eliminating the axis-aligned blobs of value noise.
const GRADIENTS = [
    [ 1,  1], [-1,  1], [ 1, -1], [-1, -1],
    [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
];

const intHash = (x, y) => {
    let h = (x | 0) * 374761393 + (y | 0) * 668265263;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
};

const noiseWrap = (X, Y, wrap) => {
    const xi = Math.floor(X);
    const yi = Math.floor(Y);
    const xf = X - xi;
    const yf = Y - yi;

    const grad = (x, y) => {
        x = mod(x + 1e3, wrap) | 0;
        return GRADIENTS[intHash(x, y) & 7];
    };

    const g00 = grad(xi,     yi    );
    const g10 = grad(xi + 1, yi    );
    const g01 = grad(xi,     yi + 1);
    const g11 = grad(xi + 1, yi + 1);

    const n00 = g00[0] * xf       + g00[1] * yf;
    const n10 = g10[0] * (xf - 1) + g10[1] * yf;
    const n01 = g01[0] * xf       + g01[1] * (yf - 1);
    const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);

    const u = smoothStep(xf);
    const v = smoothStep(yf);
    const nx0 = n00 * (1 - u) + n10 * u;
    const nx1 = n01 * (1 - u) + n11 * u;

    // Map roughly [-0.7, 0.7] to [0, 1]
    return clamp((nx0 * (1 - v) + nx1 * v) * 0.7 + 0.5);
};

const fractalNoise = (X, Y, wrap, octaves=2) => {
    let f = 1, a = 1, ta = a, t = 0;
    for (let i = octaves; --i >= 0;) {
        t += a * noiseWrap(X * f, Y * f, wrap * f);
        ta += a *= 0.5;
        f *= 2;
    }
    return t / ta;
};

///////////////////////////////////////////////////////////////////////////////
// STATE

const DEFAULT_IMAGE = 'images/test1.png';

let renderState = null;
let currentImage = null;
let heightData = null;
let heightDataRaw = null;  // unblurred copy used for edge detection
let canvasW = 1920, canvasH = 1080;

let edgeMask = null;
let patternImageData = null;
let patternW = 0, patternH = 0;

///////////////////////////////////////////////////////////////////////////////
// DOM REFERENCES

const mainCanvas  = document.getElementById('mainCanvas');
const depthCanvas = document.getElementById('depthCanvas');
const mainCtx     = mainCanvas.getContext('2d');
const depthCtx    = depthCanvas.getContext('2d');
const canvasArea  = document.getElementById('canvasArea');
const dropOverlay = document.getElementById('dropOverlay');

// Offscreen canvas for image processing
const offCanvas = document.createElement('canvas');
const offCtx    = offCanvas.getContext('2d');

///////////////////////////////////////////////////////////////////////////////
// RESOLUTION & PARAMS

function getResolution() {
    const [w, h] = resolutionSelect.value.split('x');
    return [parseInt(w), parseInt(h)];
}

function getParams() {
    return {
        depthScale:       parseFloat(depthSlider.value),
        textureWrapCount: parseFloat(scaleSlider.value),
        repeatCount:      parseInt(repeatSlider.value),
        pattern:          patternSelect.value,
        invert:           invertCheck.checked,
        edgeEnhance:      edgeCheck.checked,
        edgeStrength:     parseFloat(edgeSlider.value),
        hueVariance:      parseFloat(hueVarSlider.value),
        saturation:       parseFloat(satSlider.value),
        contrast:         parseFloat(contrastSlider.value),
    };
}

///////////////////////////////////////////////////////////////////////////////
// DEPTH MAP

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load: ' + src));
        img.src = src;
    });
}

function setHeightFromImage(image) {
    offCanvas.width = canvasW;
    offCanvas.height = canvasH;
    offCtx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvasW, canvasH);
    const data = offCtx.getImageData(0, 0, canvasW, canvasH).data;

    heightData = new Float32Array(canvasW * canvasH);
    for (let i = 0; i < data.length; i += 4)
        heightData[i >> 2] = data[i] / 255;

    // Keep an unblurred copy for edge detection
    heightDataRaw = new Float32Array(heightData);

    blurHeightData(2);
    setHeightFromArray();
}

// Single-pass separable box blur. Radius is in pixels.
function blurHeightData(radius) {
    if (radius <= 0) return;
    const w = canvasW, h = canvasH;
    const tmp = new Float32Array(w * h);
    // Horizontal
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            let sum = 0, count = 0;
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(w - 1, x + radius);
            for (let k = x0; k <= x1; k++) { sum += heightData[row + k]; count++; }
            tmp[row + x] = sum / count;
        }
    }
    // Vertical
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let sum = 0, count = 0;
            const y0 = Math.max(0, y - radius);
            const y1 = Math.min(h - 1, y + radius);
            for (let k = y0; k <= y1; k++) { sum += tmp[k * w + x]; count++; }
            heightData[y * w + x] = sum / count;
        }
    }
}

function setHeightFromArray() {
    depthCanvas.width = canvasW;
    depthCanvas.height = canvasH;
    const imgData = depthCtx.createImageData(canvasW, canvasH);
    const px = imgData.data;
    for (let i = 0; i < heightData.length; i++) {
        const v = heightData[i] * 255 | 0;
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
        px[i * 4 + 3] = 255;
    }
    depthCtx.putImageData(imgData, 0, 0);
}

function generateSphere() {
    [canvasW, canvasH] = getResolution();
    heightData = new Float32Array(canvasW * canvasH);
    const r = canvasH * 0.45;
    for (let y = 0; y < canvasH; y++)
        for (let x = 0; x < canvasW; x++) {
            const d = (r * r - (x - canvasW / 2) ** 2 - (y - canvasH / 2) ** 2) ** 0.5 / r;
            heightData[x + y * canvasW] = d > 0 ? d : 0;
        }
    heightDataRaw = new Float32Array(heightData);
    setHeightFromArray();
}

///////////////////////////////////////////////////////////////////////////////
// EDGE ENHANCEMENT

function computeEdgeMask(src, w, h) {
    const mask = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = x + y * w;
            // Sobel X
            const gx =
                -src[(x-1)+(y-1)*w] + src[(x+1)+(y-1)*w]
              - 2*src[(x-1)+y*w]    + 2*src[(x+1)+y*w]
                -src[(x-1)+(y+1)*w] + src[(x+1)+(y+1)*w];
            // Sobel Y
            const gy =
                -src[(x-1)+(y-1)*w] - 2*src[x+(y-1)*w] - src[(x+1)+(y-1)*w]
              +  src[(x-1)+(y+1)*w] + 2*src[x+(y+1)*w] + src[(x+1)+(y+1)*w];
            mask[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 2);
        }
    }
    return mask;
}

///////////////////////////////////////////////////////////////////////////////
// CUSTOM PATTERN

function loadPatternImage(image) {
    patternW = image.width;
    patternH = image.height;
    const c = document.createElement('canvas');
    c.width = patternW;
    c.height = patternH;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0);
    patternImageData = ctx.getImageData(0, 0, patternW, patternH).data;
}

function samplePattern(x, y) {
    const px = ((x % patternW) + patternW) % patternW | 0;
    const py = ((y % patternH) + patternH) % patternH | 0;
    const i = (py * patternW + px) * 4;
    return [patternImageData[i], patternImageData[i + 1], patternImageData[i + 2]];
}

///////////////////////////////////////////////////////////////////////////////
// PATTERN COLORS

// Apply hue variance, saturation, and contrast to noise values [n3, n2, n].
// n3 -> hue offset, n2 -> saturation, n -> lightness around 0.5.
function shadeNoise(n3, n2, n, seed, hueVar, sat, contrast) {
    const hue = Math.sin(n3) * hueVar + Math.tan(seed) % 1;
    const s = clamp(n2 * sat);
    const l = clamp(0.5 + (n - 0.5) * contrast);
    return hslToRgb(hue, s, l);
}

function getPatternColor(pattern, X, Y, p, seed, params) {
    const { hueVariance, saturation, contrast } = params;
    switch (pattern) {
        case 'dots': {
            const rand = new Random(((X * 8 | 0) + (Y * 8 | 0) * 9999 + seed) | 0);
            const v = rand.float(255) | 0;
            return [v, v, v];
        }
        case 'checkerboard': {
            // Force an even number of cells per repeat for seamless wrap.
            const N = Math.max(2, Math.round(params.textureWrapCount / 8) * 2);
            const cx = (X * N / p) | 0;
            const cy = (Y * N / p) | 0;
            const v = (cx ^ cy) & 1 ? 255 : 0;
            return [v, v, v];
        }
        case 'warped': {
            const n4 = noiseWrap(X, Y + 1e3 + seed, p);
            const n  = noiseWrap(X, Y + 2e3 + seed + n4 * 5, p);
            const n2 = noiseWrap(X, Y + 3e3 + seed, p);
            const n3 = noiseWrap(X, Y + 4e3 + seed, p);
            return shadeNoise(n3, n2, n, seed, hueVariance * 0.5, saturation, contrast);
        }
        default: {
            // gradient / pixelated
            if (pattern === 'pixelated') { X = (X | 0) + 0.5; Y = (Y | 0) + 0.5; }
            const n  = fractalNoise(X, Y + 1e3 + seed, p);
            const n2 = fractalNoise(X, Y + 2e3 + seed, p);
            const n3 = fractalNoise(X, Y + 3e3 + seed, p);
            return shadeNoise(n3, n2, n, seed, hueVariance, saturation, contrast);
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
// RENDERER

function stopRender() {
    if (renderState) {
        cancelAnimationFrame(renderState.animFrameId);
        renderState = null;
    }
}

function startRender() {
    stopRender();
    if (!heightData) return;

    const params = getParams();
    if (params.pattern === 'custom' && !patternImageData) return;

    const w = canvasW, h = canvasH;
    const seed = new Random(Date.now()).int(1e6);

    mainCanvas.width = w;
    mainCanvas.height = h;
    const imageData = mainCtx.createImageData(w, h);
    const pixels = imageData.data;

    renderState = { frame: 0, animFrameId: null };
    updateProgress(0, h);

    function renderBatch() {
        if (!renderState) return;

        const end = Math.min(renderState.frame + 30, h);
        for (let y = renderState.frame; y < end; y++)
            renderScanline(y, w, params, seed, pixels);

        mainCtx.putImageData(imageData, 0, 0);
        drawConvergenceDots(Math.round(w / params.repeatCount));
        renderState.frame = end;
        updateProgress(end, h);

        if (end < h)
            renderState.animFrameId = requestAnimationFrame(renderBatch);
        else {
            renderState = null;
            updateProgress(h, h);
        }
    }

    renderState.animFrameId = requestAnimationFrame(renderBatch);
}

function drawConvergenceDots(repeatSize) {
    if (!dotsCheck.checked) return;
    const r = Math.max(6, Math.round(repeatSize * 0.025));
    const cy = r * 3;
    const half = repeatSize / 2;
    const xL = canvasW / 2 - half;
    const xR = canvasW / 2 + half;
    mainCtx.fillStyle = '#fff';
    mainCtx.strokeStyle = '#000';
    mainCtx.lineWidth = 2;
    drawDot(xL, cy, r);
    drawDot(xR, cy, r);
}

function drawDot(x, y, r) {
    mainCtx.beginPath();
    mainCtx.moveTo(x + r, y);
    mainCtx.arc(x, y, r, 0, PI * 2);
    mainCtx.fill();
    mainCtx.stroke();
}

function renderScanline(y, w, params, seed, pixels) {
    const { depthScale, textureWrapCount, repeatCount, pattern, invert, edgeEnhance, edgeStrength } = params;
    const useEdges = edgeEnhance && edgeStrength > 0;
    const repeatSize = Math.round(w / repeatCount);
    const maxSep = repeatSize * depthScale;

    // Read depth values for this row
    const depth = new Float32Array(w);
    for (let i = 0; i < w; i++) {
        let d = heightData[i + y * canvasW] || 0;
        if (Number.isNaN(d)) d = 0;
        depth[i] = invert ? 1 - clamp(d) : clamp(d);
    }

    // Bidirectional propagation with subpixel gaps.
    const L = new Float32Array(w);
    const R = new Float32Array(w);
    for (let i = 0; i < w; i++) {
        let gap = repeatSize;
        for (let j = 4; j--;) {
            const m = Math.max(0, Math.min(w - 1, i - gap / 2 | 0));
            gap = repeatSize - maxSep * depth[m];
        }
        const src = i - gap;
        if (src < 0) L[i] = i;
        else {
            const lo = Math.min(i - 1, src | 0);
            const hi = Math.min(i - 1, lo + 1);
            const t = src - lo;
            L[i] = (1 - t) * L[lo] + t * L[hi] + repeatSize;
        }
    }
    for (let i = w - 1; i >= 0; i--) {
        let gap = repeatSize;
        for (let j = 4; j--;) {
            const m = Math.max(0, Math.min(w - 1, i + gap / 2 | 0));
            gap = repeatSize - maxSep * depth[m];
        }
        const src = i + gap;
        if (src >= w) R[i] = i;
        else {
            const lo = Math.max(i + 1, src | 0);
            const hi = Math.min(w - 1, lo + 1);
            const t = src - lo;
            R[i] = (1 - t) * R[lo] + t * R[hi] - repeatSize;
        }
    }
    const avg = new Float32Array(w);
    for (let i = 0; i < w; i++) avg[i] = (L[i] + R[i]) / 2;

    let edgeAvg = avg;
    if (useEdges) {
        const depthRaw = new Float32Array(w);
        for (let i = 0; i < w; i++) {
            let d = heightDataRaw[i + y * canvasW] || 0;
            if (Number.isNaN(d)) d = 0;
            depthRaw[i] = invert ? 1 - clamp(d) : clamp(d);
        }
        const Lr = new Float32Array(w);
        const Rr = new Float32Array(w);
        for (let i = 0; i < w; i++) {
            let gap = repeatSize;
            for (let j = 4; j--;) {
                const m = Math.max(0, Math.min(w - 1, i - gap / 2 | 0));
                gap = repeatSize - maxSep * depthRaw[m];
            }
            const src = i - gap;
            if (src < 0) Lr[i] = i;
            else {
                const lo = Math.min(i - 1, src | 0);
                const hi = Math.min(i - 1, lo + 1);
                const t = src - lo;
                Lr[i] = (1 - t) * Lr[lo] + t * Lr[hi] + repeatSize;
            }
        }
        for (let i = w - 1; i >= 0; i--) {
            let gap = repeatSize;
            for (let j = 4; j--;) {
                const m = Math.max(0, Math.min(w - 1, i + gap / 2 | 0));
                gap = repeatSize - maxSep * depthRaw[m];
            }
            const src = i + gap;
            if (src >= w) Rr[i] = i;
            else {
                const lo = Math.max(i + 1, src | 0);
                const hi = Math.min(w - 1, lo + 1);
                const t = src - lo;
                Rr[i] = (1 - t) * Rr[lo] + t * Rr[hi] - repeatSize;
            }
        }
        edgeAvg = new Float32Array(w);
        for (let i = 0; i < w; i++) edgeAvg[i] = (Lr[i] + Rr[i]) / 2;
    }

    // Texture coordinate mapping
    const p = Math.max(1, Math.round(repeatSize / textureWrapCount));
    const scale = repeatSize / p;
    const texY = y / scale;

    for (let i = 0; i < w; i++) {
        const texX = ((avg[i] % repeatSize) + repeatSize) % repeatSize;

        let r, g, b;
        if (pattern === 'custom') {
            [r, g, b] = samplePattern(texX / repeatSize * patternW, y / repeatSize * patternW);
        } else {
            [r, g, b] = getPatternColor(pattern, texX / scale, texY, p, seed, params);
        }

        if (useEdges) {
            let maxEdge = 0;
            for (let d = 1; d <= 3; d++) {
                const prev = i >= d ? edgeAvg[i - d] : edgeAvg[i];
                const next = i + d < w ? edgeAvg[i + d] : edgeAvg[i];
                const grad = (next - prev) / (2 * d);
                const e = Math.abs(grad - 1);
                if (e > maxEdge) maxEdge = e;
            }
            const e = clamp(maxEdge * edgeStrength);
            r *= 1 - e;
            g *= 1 - e;
            b *= 1 - e;
        }

        const idx = (y * w + i) * 4;
        pixels[idx]     = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
    }
}

///////////////////////////////////////////////////////////////////////////////
// UI HELPERS

function updateProgress(current, total) {
    const pct = total > 0 ? (current / total * 100) : 0;
    progressFill.style.width = pct + '%';
    progressText.textContent =
        current >= total ? 'Done' :
        current === 0    ? 'Rendering...' :
                           `Rendering... ${pct | 0}%`;
}

function setupSlider(id, displayId, decimals = 2) {
    const slider = document.getElementById(id);
    const display = document.getElementById(displayId);
    const update = () => display.textContent = parseFloat(slider.value).toFixed(decimals);
    update();
    slider.addEventListener('input', () => { update(); debouncedRender(); });
}

let debounceTimer = null;
function debouncedRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startRender, 150);
}

///////////////////////////////////////////////////////////////////////////////
// UI SETUP

setupSlider('depthSlider', 'depthVal');
setupSlider('repeatSlider', 'repeatVal', 0);
setupSlider('scaleSlider', 'scaleVal', 1);
setupSlider('hueVarSlider', 'hueVarVal');
setupSlider('satSlider', 'satVal');
setupSlider('contrastSlider', 'contrastVal');

function updatePatternControls() {
    const noisy = ['gradient', 'warped', 'pixelated'].includes(patternSelect.value);
    for (const g of [hueVarGroup, satGroup, contrastGroup])
        g.classList.toggle('disabled', !noisy);
    scaleGroup.classList.toggle('disabled', patternSelect.value === 'custom');
}

patternSelect.addEventListener('change', () => {
    updatePatternControls();
    startRender();
});
updatePatternControls();

invertCheck.addEventListener('change', () => startRender());

edgeCheck.addEventListener('change', () => {
    edgeGroup.style.display = edgeCheck.checked ? '' : 'none';
    startRender();
});
setupSlider('edgeSlider', 'edgeVal', 1);

showHeightCheck.addEventListener('change', () => {
    depthCanvas.style.display = showHeightCheck.checked ? 'block' : 'none';
});

dotsCheck.addEventListener('change', () => startRender());

resolutionSelect.addEventListener('change', () => {
    [canvasW, canvasH] = getResolution();
    if (currentImage) setHeightFromImage(currentImage);
    else generateSphere();
    startRender();
});

regenerateBtn.addEventListener('click', () => startRender());

fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else mainCanvas.requestFullscreen();
});

saveBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = 'stereogram.png';
    a.href = mainCanvas.toDataURL('image/png');
    a.click();
});

resetBtn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar input[type="range"]').forEach(el => {
        el.value = el.defaultValue;
        el.dispatchEvent(new Event('input'));
    });
    document.querySelectorAll('.sidebar input[type="checkbox"]').forEach(el => {
        el.checked = el.defaultChecked;
        el.dispatchEvent(new Event('change'));
    });
    document.querySelectorAll('.sidebar select').forEach(el => {
        const sel = [...el.options].findIndex(o => o.hasAttribute('selected'));
        el.selectedIndex = sel >= 0 ? sel : 0;
    });
    [canvasW, canvasH] = getResolution();
    presetSelect.dispatchEvent(new Event('change'));
});

///////////////////////////////////////////////////////////////////////////////
// FILE LOADING

presetSelect.addEventListener('change', async () => {
    try {
        currentImage = await loadImage(presetSelect.value);
        [canvasW, canvasH] = getResolution();
        setHeightFromImage(currentImage);
        startRender();
    } catch (e) {
        console.error(e);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadFileAsDepth(e.target.files[0]);
});

patternInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = await loadImage(URL.createObjectURL(file));
    loadPatternImage(img);
    patternSelect.value = 'custom';
    updatePatternControls();
    startRender();
});

// Drag and drop
let dragCounter = 0;

canvasArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
});
canvasArea.addEventListener('dragover', (e) => e.preventDefault());
canvasArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); }
});
canvasArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFileAsDepth(file);
});

async function loadFileAsDepth(file) {
    const img = await loadImage(URL.createObjectURL(file));
    currentImage = img;
    [canvasW, canvasH] = getResolution();
    setHeightFromImage(img);
    startRender();
    presetSelect.value = '';
}

///////////////////////////////////////////////////////////////////////////////
// STARTUP

async function startup() {
    try {
        currentImage = await loadImage(DEFAULT_IMAGE);
        [canvasW, canvasH] = getResolution();
        setHeightFromImage(currentImage);
        startRender();
    } catch (e) {
        console.error('Failed to load default image:', e);
        generateSphere();
        startRender();
    }
}

startup();
