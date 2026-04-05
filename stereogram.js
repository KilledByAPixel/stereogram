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

const noiseWrap = (X, Y, wrap) => {
    const hash = (x, y) => {
        x = mod(x + 1e3, wrap) | 0;
        y = y | 0;
        return abs(Math.sin(y*y%17371+123^x*x%13331+321) * 3e4) % 1;
    };
    const xp = smoothStep(mod(X));
    const yp = smoothStep(mod(Y));
    const row = (X, Y) => (1 - xp) * hash(X, Y) + xp * hash(X + 1, Y);
    return (1 - yp) * row(X, Y) + yp * row(X, Y + 1);
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
let canvasW = 1920, canvasH = 1080;

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

    depthCanvas.width = canvasW;
    depthCanvas.height = canvasH;
    depthCtx.drawImage(offCanvas, 0, 0);
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
    setHeightFromArray();
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

function getPatternColor(pattern, X, Y, p, seed) {
    switch (pattern) {
        case 'dots': {
            const rand = new Random(((X * 8 | 0) + (Y * 8 | 0) * 9999 + seed) | 0);
            const v = rand.float(255) | 0;
            return [v, v, v];
        }
        case 'checkerboard': {
            const v = ((X / 4 | 0) ^ (Y / 4 | 0)) & 1 ? 255 : 0;
            return [v, v, v];
        }
        case 'warped': {
            const n4 = noiseWrap(X, Y + 1e3 + seed, p);
            const n  = noiseWrap(X, Y + 2e3 + seed + n4 * 5, p);
            const n2 = noiseWrap(X, Y + 3e3 + seed, p);
            const n3 = noiseWrap(X, Y + 4e3 + seed, p);
            return hslToRgb(Math.sin(n3) * 0.5 + Math.tan(seed)%1, n2, n);
        }
        default: {
            // gradient / pixelated
            if (pattern === 'pixelated') { X |= 0; Y |= 0; }
            const n  = fractalNoise(X, Y + 1e3 + seed, p);
            const n2 = fractalNoise(X, Y + 2e3 + seed, p);
            const n3 = fractalNoise(X, Y + 3e3 + seed, p);
            return hslToRgb(Math.sin(n3) + Math.tan(seed)%1, n2, n);
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

function renderScanline(y, w, params, seed, pixels) {
    const { depthScale, textureWrapCount, repeatCount, pattern, invert } = params;
    const repeatSize = Math.round(w / repeatCount);
    const maxSep = repeatSize * depthScale;

    // Read depth values for this row
    const depth = new Float32Array(w);
    for (let i = 0; i < w; i++) {
        let d = heightData[i + y * canvasW] || 0;
        if (Number.isNaN(d)) d = 0;
        depth[i] = invert ? 1 - clamp(d) : clamp(d);
    }

    // Bidirectional propagation of texture coordinates
    const L = new Float32Array(w);
    const R = new Float32Array(w);

    for (let i = 0; i < w; i++) {
        let gap = repeatSize;
        for (let j = 4; j--;) {
            gap = repeatSize - Math.round(maxSep * depth[Math.max(0, Math.min(w - 1, i - gap / 2 | 0))]);
        }
        L[i] = i < gap ? i : L[i - gap] + repeatSize;
    }

    for (let i = w - 1; i >= 0; i--) {
        let gap = repeatSize;
        for (let j = 4; j--;) {
            gap = repeatSize - Math.round(maxSep * depth[Math.max(0, Math.min(w - 1, i + gap / 2 | 0))]);
        }
        R[i] = i + gap >= w ? i : R[i + gap] - repeatSize;
    }

    // Texture coordinate mapping
    let p = Math.max(1, Math.round(repeatSize / textureWrapCount));
    if (pattern === 'checkerboard') p = Math.max(2, p + (p & 1));
    const scale = repeatSize / p;
    const texY = y / scale;

    for (let i = 0; i < w; i++) {
        const avg = (L[i] + R[i]) / 2;
        const texX = ((avg % repeatSize) + repeatSize) % repeatSize;

        let r, g, b;
        if (pattern === 'custom') {
            [r, g, b] = samplePattern(texX / repeatSize * patternW, y / repeatSize * patternW);
        } else {
            [r, g, b] = getPatternColor(pattern, texX / scale, texY, p, seed);
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

patternSelect.addEventListener('change', () => {
    patternUploadGroup.style.display = patternSelect.value === 'custom' ? '' : 'none';
    startRender();
});

invertCheck.addEventListener('change', () => startRender());

showHeightCheck.addEventListener('change', () => {
    depthCanvas.style.display = showHeightCheck.checked ? 'block' : 'none';
});

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
    patternUploadGroup.style.display = 'none';
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
