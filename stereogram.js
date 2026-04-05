'use strict';

///////////////////////////////////////////////////////////////////////////////
// MATH UTILITIES

const PI = Math.PI;
const abs = (a) => a < 0 ? -a : a;
const mod = (a, b=1) => ((a % b) + b) % b;
const clamp = (v, min=0, max=1) => v < min ? min : v > max ? max : v;
const smoothStep = (p) => p * p * (3 - 2 * p);

///////////////////////////////////////////////////////////////////////////////
// SEEDED RANDOM GENERATOR

class Random {
    constructor(seed) { this.seed = seed|0; }
    float(a=1, b=0) {
        this.seed ^= this.seed << 13;
        this.seed ^= this.seed >>> 17;
        this.seed ^= this.seed << 5;
        return b + (a-b) * Math.abs(this.seed % 1e7) / 1e7;
    }
    int(a=1, b=0) { return this.float(a, b)|0; }
}

///////////////////////////////////////////////////////////////////////////////
// COLOR

function hslToRgb(h, s, l) {
    h = mod(h); s = clamp(s); l = clamp(l);
    if (s === 0) {
        const v = l * 255 | 0;
        return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
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
        x = mod(x + 1e3, wrap);
        x = x | 0;
        y = y | 0;
        return abs(Math.sin(y*y%17371+123^x*x%13331+321)*3e4) % 1;
    };
    const XP = smoothStep(mod(X));
    const YP = smoothStep(mod(Y));
    const noise1 = (X, Y) => (1-XP)*hash(X,Y) + XP*hash(X+1,Y);
    return (1-YP)*noise1(X,Y) + YP*noise1(X,Y+1);
};

const fractalNoise = (X, Y, wrap, octaves=2) => {
    const G = 0.5;
    let f = 1, a = 1, ta = a, t = 0;
    for (let i = octaves; --i >= 0;) {
        t += a * noiseWrap(X*f, Y*f, wrap*f);
        ta += a *= G;
        f *= 2;
    }
    return t / ta;
};

///////////////////////////////////////////////////////////////////////////////
// CONSTANTS

const DEFAULT_IMAGE = 'test1.png';

///////////////////////////////////////////////////////////////////////////////
// RENDERER

let renderState = null;
let currentImage = null;
let heightData = null;
let canvasW = 1920, canvasH = 1080;

// Custom pattern image data
let patternImageData = null;
let patternW = 0, patternH = 0;

const mainCanvas = document.getElementById('mainCanvas');
const mainCtx = mainCanvas.getContext('2d');
const depthCanvas = document.getElementById('depthCanvas');
const depthCtx = depthCanvas.getContext('2d');
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

function getResolution() {
    const parts = resolutionSelect.value.split('x');
    return [parseInt(parts[0]), parseInt(parts[1])];
}

function getParamsFromUI() {
    return {
        depthScale:       parseFloat(depthSlider.value),
        textureWrapCount: parseFloat(scaleSlider.value),
        repeatCount:      parseInt(repeatSlider.value),
        pattern:          patternSelect.value,
        invert:           invertCheck.checked,
    };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load: ' + src));
        img.src = src;
    });
}

function setHeightData(image) {
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

function setHeightDataFromArray() {
    depthCanvas.width = canvasW;
    depthCanvas.height = canvasH;
    const imgData = depthCtx.createImageData(canvasW, canvasH);
    const px = imgData.data;
    for (let i = 0; i < heightData.length; i++) {
        const v = heightData[i] * 255 | 0;
        px[i * 4]     = v;
        px[i * 4 + 1] = v;
        px[i * 4 + 2] = v;
        px[i * 4 + 3] = 255;
    }
    depthCtx.putImageData(imgData, 0, 0);
}

function getHeight(x, y) {
    return heightData[x + y * canvasW] || 0;
}

///////////////////////////////////////////////////////////////////////////////
// CUSTOM PATTERN

function loadPatternImage(image) {
    const c = document.createElement('canvas');
    patternW = image.width;
    patternH = image.height;
    c.width = patternW;
    c.height = patternH;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0);
    patternImageData = ctx.getImageData(0, 0, patternW, patternH).data;
}

function samplePattern(X, Y) {
    const x = ((X % patternW) + patternW) % patternW | 0;
    const y = ((Y % patternH) + patternH) % patternH | 0;
    const idx = (y * patternW + x) * 4;
    return [patternImageData[idx], patternImageData[idx+1], patternImageData[idx+2]];
}

///////////////////////////////////////////////////////////////////////////////
// RENDER LOOP

function stopRender() {
    if (renderState) {
        cancelAnimationFrame(renderState.animFrameId);
        renderState = null;
    }
}

function startRender() {
    stopRender();
    if (!heightData) return;

    const params = getParamsFromUI();
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

        const endFrame = Math.min(renderState.frame + 30, h);
        for (let y = renderState.frame; y < endFrame; y++)
            renderScanline(y, w, params, seed, pixels);

        mainCtx.putImageData(imageData, 0, 0);
        renderState.frame = endFrame;
        updateProgress(endFrame, h);

        if (endFrame < h)
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

    // Read depth
    const depth = new Float32Array(w);
    for (let i = 0; i < w; i++) {
        let d = getHeight(i, y);
        d = Number.isNaN(d) ? 0 : clamp(d);
        depth[i] = invert ? 1 - d : d;
    }

    // Propagate texture coordinates from both directions, then average
    const A = new Float32Array(w);
    const B = new Float32Array(w);

    // Left-to-right: look back by gap (depth-adjusted), add repeatSize
    for (let i = 0; i < w; i++) {
        let gap = repeatSize;
        for (let j = 4; j--;) {
            const mid = Math.max(0, Math.min(w-1, i - gap/2 | 0));
            gap = repeatSize - Math.round(maxSep * depth[mid]);
        }
        A[i] = i < gap ? i : A[i - gap] + repeatSize;
    }

    // Right-to-left: look forward by gap, subtract repeatSize
    for (let i = w - 1; i >= 0; i--) {
        let gap = repeatSize;
        for (let j = 4; j--;) {
            const mid = Math.max(0, Math.min(w-1, i + gap/2 | 0));
            gap = repeatSize - Math.round(maxSep * depth[mid]);
        }
        B[i] = i + gap >= w ? i : B[i + gap] - repeatSize;
    }

    // Assign colors using averaged coordinate
    let p = Math.max(1, Math.round(repeatSize / textureWrapCount));
    if (pattern === 'checkerboard') p = Math.max(2, p + (p & 1));
    const scale = repeatSize / p;
    const Y = y / scale;

    for (let i = 0; i < w; i++) {
        const avg = (A[i] + B[i]) / 2;
        const texX = ((avg % repeatSize) + repeatSize) % repeatSize;

        let r, g, b;
        if (pattern === 'custom') {
            const px = texX / repeatSize * patternW;
            const py = y / repeatSize * patternW;
            [r, g, b] = samplePattern(px, py);
        } else {
            [r, g, b] = getPatternColor(pattern, texX / scale, Y, p, seed);
        }

        const idx = (y * w + i) * 4;
        pixels[idx]     = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
    }
}

function getPatternColor(pattern, X, Y, p, seed) {
    if (pattern === 'dots') {
        const rand = new Random(((X | 0) + (Y | 0) * 9999 + seed) | 0);
        const v = rand.float(255) | 0;
        return [v, v, v];
    }

    if (pattern === 'checkerboard') {
        const v = ((X/4 | 0) ^ (Y/4 | 0)) & 1 ? 255 : 0;
        return [v, v, v];
    }

    if (pattern === 'warped') {
        const n4 = noiseWrap(X, Y + 1e3 + seed, p);
        const n  = noiseWrap(X, Y + 2e3 + seed + n4 * 5, p);
        const n2 = noiseWrap(X, Y + 3e3 + seed, p);
        const n3 = noiseWrap(X, Y + 4e3 + seed, p);
        const hue = Math.sin(n3) * 0.3 + Math.sin(seed);
        return hslToRgb(hue, n2, n);
    }

    if (pattern === 'curl') {
        const f = (x, y) => fractalNoise(x, y + seed, p, 1);
        const e = 0.01;
        const dx = (f(X+e, Y) - f(X-e, Y)) / (2*e);
        const dy = (f(X, Y+e) - f(X, Y-e)) / (2*e);
        const hue = Math.atan2(dy, dx) / PI * 0.1 + Math.sin(seed);
        const lit = 0.3 + 0.4 * clamp(Math.hypot(dx, dy));
        return hslToRgb(hue, 0.7, lit);
    }

    // gradient / pixelated
    if (pattern === 'pixelated') { X |= 0; Y |= 0; }
    const n  = fractalNoise(X, Y + 1e3 + seed, p);
    const n2 = fractalNoise(X, Y + 2e3 + seed, p);
    const n3 = fractalNoise(X, Y + 3e3 + seed, p);
    const hue = Math.sin(n3) * 0.3 + Math.sin(seed);
    return hslToRgb(hue, n2, n);
}

///////////////////////////////////////////////////////////////////////////////
// UI

function updateProgress(current, total) {
    const pct = total > 0 ? (current / total * 100) : 0;
    progressFill.style.width = pct + '%';
    if (current >= total)
        progressText.textContent = 'Done';
    else if (current === 0)
        progressText.textContent = 'Rendering...';
    else
        progressText.textContent = `Rendering... ${pct | 0}%`;
}

function setupSlider(sliderId, displayId, decimals = 2) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    const update = () => display.textContent = parseFloat(slider.value).toFixed(decimals);
    update();
    slider.addEventListener('input', () => { update(); debouncedRender(); });
}

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

let debounceTimer = null;
function debouncedRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startRender, 150);
}

// Resolution
resolutionSelect.addEventListener('change', () => {
    [canvasW, canvasH] = getResolution();
    if (currentImage)
        setHeightData(currentImage);
    else if (heightData)
        generateFallbackSphere();
    startRender();
});

// Depth image loading
async function loadPreset(src) {
    try {
        currentImage = await loadImage(src);
        [canvasW, canvasH] = getResolution();
        setHeightData(currentImage);
        startRender();
    } catch (e) {
        console.error(e);
    }
}

presetSelect.addEventListener('change', () => loadPreset(presetSelect.value));

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadDroppedFile(file);
});

// Custom pattern upload
patternInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const img = await loadImage(ev.target.result);
            loadPatternImage(img);
            startRender();
        } catch (err) {
            console.error(err);
        }
    };
    reader.readAsDataURL(file);
});

// Drag and drop
let dragCounter = 0;
const canvasArea = document.getElementById('canvasArea');
const dropOverlay = document.getElementById('dropOverlay');

canvasArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
});
canvasArea.addEventListener('dragover', (e) => e.preventDefault());
canvasArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragCounter <= 0) {
        dragCounter = 0;
        dropOverlay.classList.remove('active');
    }
});
canvasArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadDroppedFile(file);
});

function loadDroppedFile(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            currentImage = await loadImage(e.target.result);
            [canvasW, canvasH] = getResolution();
            setHeightData(currentImage);
            startRender();
            presetSelect.value = '';
        } catch (err) {
            console.error(err);
        }
    };
    reader.readAsDataURL(file);
}

// Fullscreen
fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement)
        document.exitFullscreen();
    else
        mainCanvas.requestFullscreen();
});

// Buttons
regenerateBtn.addEventListener('click', () => startRender());

saveBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'stereogram.png';
    link.href = mainCanvas.toDataURL('image/png');
    link.click();
});

resetBtn.addEventListener('click', () => {
    for (const el of document.querySelectorAll('.sidebar input[type="range"]')) {
        el.value = el.defaultValue;
        el.dispatchEvent(new Event('input'));
    }
    for (const el of document.querySelectorAll('.sidebar input[type="checkbox"]')) {
        el.checked = el.defaultChecked;
        el.dispatchEvent(new Event('change'));
    }
    for (const el of document.querySelectorAll('.sidebar select')) {
        el.selectedIndex = el.querySelector('[selected]')
            ? [...el.options].findIndex(o => o.hasAttribute('selected'))
            : 0;
    }
    patternUploadGroup.style.display = 'none';
    [canvasW, canvasH] = getResolution();
    presetSelect.dispatchEvent(new Event('change'));
});

///////////////////////////////////////////////////////////////////////////////
// STARTUP

function generateFallbackSphere() {
    [canvasW, canvasH] = getResolution();
    heightData = new Float32Array(canvasW * canvasH);
    const r = canvasH * 0.45;
    for (let y = 0; y < canvasH; y++)
        for (let x = 0; x < canvasW; x++) {
            const d = (r*r - (x-canvasW/2)**2 - (y-canvasH/2)**2) ** 0.5 / r;
            heightData[x + y * canvasW] = d > 0 ? d : 0;
        }
    setHeightDataFromArray();
}

async function startup() {
    try {
        currentImage = await loadImage(DEFAULT_IMAGE);
        [canvasW, canvasH] = getResolution();
        setHeightData(currentImage);
        startRender();
    } catch (e) {
        console.error('Failed to load default image:', e);
        generateFallbackSphere();
        startRender();
    }
}

startup();
