'use strict';

///////////////////////////////////////////////////////////////////////////////
// MATH UTILITIES

const PI      = Math.PI;
const abs     = (a) => a < 0 ? -a : a;
const mod     = (a, b=1) => ((a % b) + b) % b;
const clamp   = (v, min=0, max=1) => v < min ? min : v > max ? max : v;
const lerp    = (p, min=0, max=1) => min + clamp(p) * (max-min);
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
// HSL TO RGB CONVERSION

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
// NOISE FUNCTION

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

///////////////////////////////////////////////////////////////////////////////
// DEFAULT PARAMETERS

const DEFAULTS = {
    maxSeparationScale: 0.3,
    textureScale: 4,
    repeatSize: 120,
    imageExtraDepth: 0,
    pixelate: 0,
    imageFilename: 'test1.png',
};

///////////////////////////////////////////////////////////////////////////////
// RENDERER

let renderState = null;
let currentImage = null;
let heightData = null;
let canvasW = 0, canvasH = 0;

const mainCanvas = document.getElementById('mainCanvas');
const mainContext = mainCanvas.getContext('2d');
const depthCanvas = document.getElementById('depthCanvas');
const depthContext = depthCanvas.getContext('2d');
const offCanvas = document.createElement('canvas');
const offContext = offCanvas.getContext('2d');

function getParamsFromUI() {
    return {
        maxSeparationScale: parseFloat(depthSlider.value),
        textureScale:       parseFloat(scaleSlider.value),
        repeatSize:         parseInt(repeatSlider.value),
        imageExtraDepth:    parseFloat(extraDepthSlider.value),
        pixelate:           pixelateCheck.checked ? 1 : 0,
    };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image: ' + src));
        img.src = src;
    });
}

function setupHeightData(image) {
    const w = canvasW;
    const h = canvasH;

    offCanvas.width = w;
    offCanvas.height = h;
    offContext.drawImage(image, 0, 0, image.width, image.height, 0, 0, w, h);
    const data = offContext.getImageData(0, 0, w, h).data;

    heightData = new Float32Array(w * h);
    for (let i = 0; i < data.length; i += 4)
        heightData[i >> 2] = data[i] / 255;

    depthCanvas.width = w;
    depthCanvas.height = h;
    depthContext.drawImage(offCanvas, 0, 0);
}

function updateDepthCanvas() {
    const w = canvasW;
    const h = canvasH;
    depthCanvas.width = w;
    depthCanvas.height = h;
    const imgData = depthContext.createImageData(w, h);
    const px = imgData.data;
    for (let i = 0; i < heightData.length; i++) {
        const v = heightData[i] * 255 | 0;
        px[i * 4]     = v;
        px[i * 4 + 1] = v;
        px[i * 4 + 2] = v;
        px[i * 4 + 3] = 255;
    }
    depthContext.putImageData(imgData, 0, 0);
}

function getHeight(x, y, imageExtraDepth) {
    let d = heightData[x + y * canvasW] || 0;
    if (d > 0.01)
        d = d * (1 - imageExtraDepth) + imageExtraDepth;
    return d;
}

function stopRender() {
    if (renderState && renderState.animFrameId) {
        cancelAnimationFrame(renderState.animFrameId);
        renderState = null;
    }
}

function startRender() {
    stopRender();

    if (!heightData) return;

    const params = getParamsFromUI();
    const w = canvasW;
    const h = canvasH;
    const drawSeed = new Random(Date.now()).int(1e6);

    const imageData = mainContext.createImageData(w, h);
    const pixels = imageData.data;

    mainCanvas.width = w;
    mainCanvas.height = h;

    renderState = {
        frame: 0,
        totalFrames: h,
        animFrameId: null,
        params,
        drawSeed,
        imageData,
        pixels,
    };

    updateProgress(0, h);

    function renderBatch() {
        if (!renderState) return;

        const batchSize = 30;
        const endFrame = Math.min(renderState.frame + batchSize, h);

        for (let y = renderState.frame; y < endFrame; y++) {
            renderScanline(y, w, h, params, drawSeed, pixels);
        }

        mainContext.putImageData(imageData, 0, 0);

        renderState.frame = endFrame;
        updateProgress(endFrame, h);

        if (endFrame < h) {
            renderState.animFrameId = requestAnimationFrame(renderBatch);
        } else {
            renderState = null;
            updateProgress(h, h);
        }
    }

    renderState.animFrameId = requestAnimationFrame(renderBatch);
}

function renderScanline(y, w, h, params, drawSeed, pixels) {
    const { maxSeparationScale, textureScale,
            repeatSize, imageExtraDepth, pixelate } = params;
    const maxSeparation = repeatSize * maxSeparationScale;

    const depth = new Float32Array(w);
    for (let i = 0; i < w; i++) {
        let d = getHeight(i, y, imageExtraDepth);
        d = Number.isNaN(d) ? 0 : clamp(d);
        depth[i] = d;
    }

    const A = new Float32Array(w);
    const B = new Float32Array(w);

    for (let i = 0; i < w; i++) {
        let g, a;
        const its = 4;
        const i2 = w - 1 - i;

        g = repeatSize;
        for (let j = its; j--;) {
            a = maxSeparation * depth[i - g/2 | 0] || 0;
            g = repeatSize - a;
        }
        A[i] = i < repeatSize ? i : A[i - g | 0] + repeatSize;

        g = repeatSize;
        for (let j = its; j--;) {
            a = maxSeparation * depth[i2 + g/2 | 0] || 0;
            g = repeatSize - a;
        }
        B[i2] = i < repeatSize ? i2 : B[i2 + g | 0] - repeatSize;
    }

    for (let i = 0; i < w; i++)
        A[i] = (A[i] + B[i]) / 2;

    const p = repeatSize / textureScale;
    for (let i = 0; i < w; i++) {
        let X = A[i];
        let Y = y / textureScale;

        X = ((X % repeatSize) + repeatSize) % repeatSize;
        X = X / textureScale;
        if (pixelate) { X |= 0; Y |= 0; }

        const o = drawSeed;
        const n4 = noiseWrap(X, Y + 1e3 + o, p);
        const n  = noiseWrap(X, Y + 2e3 + o + n4 * 5, p);
        const n2 = noiseWrap(X, Y + 3e3 + o, p);
        const n3 = noiseWrap(X, Y + 4e3 + o, p);

        const d = Math.hypot(i - w/2, y - h/2);

        const hue = Math.sin(n3) * 0.3 + d / (w * 2) + 0.5 + Math.sin(drawSeed);
        const [r, g, b] = hslToRgb(hue, n2, n);

        const idx = (y * w + i) * 4;
        pixels[idx]     = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
    }
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
    slider.addEventListener('input', () => {
        display.textContent = parseFloat(slider.value).toFixed(decimals);
        debouncedRender();
    });
}

setupSlider('depthSlider', 'depthVal');
setupSlider('repeatSlider', 'repeatVal', 0);
setupSlider('extraDepthSlider', 'extraDepthVal');
setupSlider('scaleSlider', 'scaleVal', 1);

pixelateCheck.addEventListener('change', () => startRender());
showHeightCheck.addEventListener('change', () => {
    depthCanvas.style.display = showHeightCheck.checked ? 'block' : 'none';
});

let debounceTimer = null;
function debouncedRender() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startRender, 150);
}

presetSelect.addEventListener('change', async () => {
    try {
        currentImage = await loadImage(presetSelect.value);
        canvasW = 2000;
        canvasH = Math.round(2000 * currentImage.height / currentImage.width);
        setupHeightData(currentImage);
        startRender();
    } catch (e) {
        console.error(e);
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadDroppedFile(file);
});

let dragCounter = 0;
const canvasArea = document.getElementById('canvasArea');
const dropOverlay = document.getElementById('dropOverlay');

canvasArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
});
canvasArea.addEventListener('dragover', (e) => {
    e.preventDefault();
});
canvasArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
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
            canvasW = 2000;
            canvasH = Math.round(2000 * currentImage.height / currentImage.width);
            setupHeightData(currentImage);
            startRender();
            presetSelect.value = '';
        } catch (err) {
            console.error(err);
        }
    };
    reader.readAsDataURL(file);
}

regenerateBtn.addEventListener('click', () => startRender());

saveBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'stereogram.png';
    link.href = mainCanvas.toDataURL('image/png');
    link.click();
});

resetBtn.addEventListener('click', () => {
    depthSlider.value = DEFAULTS.maxSeparationScale;
    depthVal.textContent = DEFAULTS.maxSeparationScale.toFixed(2);

    repeatSlider.value = DEFAULTS.repeatSize;
    repeatVal.textContent = DEFAULTS.repeatSize;

    extraDepthSlider.value = DEFAULTS.imageExtraDepth;
    extraDepthVal.textContent = DEFAULTS.imageExtraDepth.toFixed(2);

    scaleSlider.value = DEFAULTS.textureScale;
    scaleVal.textContent = DEFAULTS.textureScale.toFixed(1);

    pixelateCheck.checked = false;
    showHeightCheck.checked = false;

    presetSelect.value = DEFAULTS.imageFilename;
    presetSelect.dispatchEvent(new Event('change'));
});

///////////////////////////////////////////////////////////////////////////////
// STARTUP

async function startup() {
    try {
        currentImage = await loadImage(DEFAULTS.imageFilename);
        canvasW = 2000;
        canvasH = Math.round(2000 * currentImage.height / currentImage.width);
        setupHeightData(currentImage);
        startRender();
    } catch (e) {
        console.error('Failed to load default image:', e);
        canvasW = 2000;
        canvasH = 1000;
        heightData = new Float32Array(canvasW * canvasH);
        for (let y = 0; y < canvasH; y++)
            for (let x = 0; x < canvasW; x++) {
                const d = ((canvasH*0.45)**2 - (x-canvasW/2)**2 - (y-canvasH/2)**2)**0.5 / (canvasH*0.45);
                heightData[x + y * canvasW] = d > 0 ? d : 0;
            }
        updateDepthCanvas();
        startRender();
    }
}

startup();
