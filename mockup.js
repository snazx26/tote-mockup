/**
 * Product Mockup Engine v2
 * 
 * KEY IMPROVEMENT: The base product photo itself provides the shading
 * through multiply blending. A separate displacement map is OPTIONAL.
 * If no displacement map is provided, the engine auto-generates one
 * from the base photo's luminance.
 *
 * ASSETS NEEDED:
 *   bag-base.png         - Product photo (REQUIRED)
 *   bag-mask.png          - Printable area mask (REQUIRED)  
 *   bag-displacement.png  - Displacement map (OPTIONAL - auto-generated if missing)
 *   bag-shadow.png        - Extra shadow overlay (OPTIONAL)
 */

(function () {
    'use strict';

    const ASSETS = {
        base: 'assets/bag-base.png',
        displacement: 'assets/bag-displacement.png',
        mask: 'assets/bag-mask.png',
        shadow: 'assets/bag-shadow.png'
    };

    let state = {
        designImg: null,
        baseImg: null,
        dispImg: null,
        maskImg: null,
        shadowImg: null,
        scale: 60,
        offsetX: 50,
        offsetY: 50,
        dispIntensity: 30,
        assetsLoaded: false
    };

    // Pre-computed pixel data cache
    let cache = { baseData: null, dispData: null, maskData: null, maskBounds: null, w: 0, h: 0 };

    const canvas = document.getElementById('mockupCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const uploadContent = document.getElementById('uploadContent');
    const uploadPreview = document.getElementById('uploadPreview');
    const controls = document.getElementById('controls');
    const previewActions = document.getElementById('previewActions');
    const placeholderText = document.getElementById('placeholderText');
    const previewFrame = document.getElementById('previewFrame');

    function loadImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => { console.warn('Optional asset not found:', src); resolve(null); };
            img.src = src;
        });
    }

    async function loadAssets() {
        [state.baseImg, state.dispImg, state.maskImg, state.shadowImg] = await Promise.all([
            loadImage(ASSETS.base),
            loadImage(ASSETS.displacement),
            loadImage(ASSETS.mask),
            loadImage(ASSETS.shadow)
        ]);

        if (!state.baseImg || !state.maskImg) {
            console.error('bag-base.png and bag-mask.png are required!');
            return;
        }

        const w = state.baseImg.width;
        const h = state.baseImg.height;
        cache.w = w;
        cache.h = h;

        // Cache base photo pixels
        cache.baseData = getPixelData(state.baseImg, w, h);

        // Cache mask pixels
        cache.maskData = getPixelData(state.maskImg, w, h);
        cache.maskBounds = getMaskBounds(cache.maskData, w, h);

        // Build displacement map
        if (state.dispImg) {
            cache.dispData = getPixelData(state.dispImg, w, h);
            normalizeDispMap(cache.dispData, cache.maskData, w, h);
            console.log('Using custom displacement map');
        } else {
            // Auto-generate from base photo luminance
            cache.dispData = getPixelData(state.baseImg, w, h);
            autoGenDispMap(cache.dispData, cache.maskData, w, h);
            console.log('Auto-generated displacement map from base photo');
        }

        state.assetsLoaded = true;
        console.log(`Assets ready (${w}×${h})`);
    }

    function getPixelData(img, w, h) {
        const c = createOffscreen(w, h);
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0, w, h);
        return cx.getImageData(0, 0, w, h);
    }

    /**
     * Normalize a user-provided displacement map:
     * - Compute average luminance within the mask area
     * - Re-center so average = 128 (neutral)
     * - Clamp range to prevent extreme displacement
     */
    function normalizeDispMap(imageData, maskData, w, h) {
        const d = imageData.data;
        const m = maskData.data;
        let sum = 0, count = 0;

        // Get average luminance within mask
        for (let i = 0; i < w * h; i++) {
            const pi = i * 4;
            if (m[pi] > 128 && m[pi + 3] > 128) {
                const lum = d[pi] * 0.299 + d[pi + 1] * 0.587 + d[pi + 2] * 0.114;
                sum += lum;
                count++;
            }
        }
        const avg = count > 0 ? sum / count : 128;

        // Re-center on 128 and reduce range
        for (let i = 0; i < w * h; i++) {
            const pi = i * 4;
            const lum = d[pi] * 0.299 + d[pi + 1] * 0.587 + d[pi + 2] * 0.114;
            // Shift so average maps to 128, scale down for subtlety
            const val = 128 + (lum - avg) * 0.5;
            const clamped = Math.max(0, Math.min(255, Math.round(val)));
            d[pi] = clamped;
            d[pi + 1] = clamped;
            d[pi + 2] = clamped;
        }
    }

    /**
     * Auto-generate displacement from base photo luminance
     */
    function autoGenDispMap(imageData, maskData, w, h) {
        // Same as normalize but with gentler settings
        normalizeDispMap(imageData, maskData, w, h);
    }

    // ── RENDER ──
    function render() {
        if (!state.assetsLoaded || !state.designImg) return;

        const w = cache.w;
        const h = cache.h;
        canvas.width = w;
        canvas.height = h;

        const base = cache.baseData.data;
        const disp = cache.dispData.data;
        const mask = cache.maskData.data;
        const bounds = cache.maskBounds;

        // Draw design onto temp canvas at correct scale/position
        const designCanvas = createOffscreen(w, h);
        const designCtx = designCanvas.getContext('2d');

        const areaW = bounds.right - bounds.left;
        const areaH = bounds.bottom - bounds.top;
        const baseFit = Math.min(areaW / state.designImg.width, areaH / state.designImg.height);
        const userScale = state.scale / 100;
        const finalW = state.designImg.width * baseFit * userScale;
        const finalH = state.designImg.height * baseFit * userScale;
        const cx = bounds.left + (areaW - finalW) * (state.offsetX / 100);
        const cy = bounds.top + (areaH - finalH) * (state.offsetY / 100);

        designCtx.drawImage(state.designImg, cx, cy, finalW, finalH);
        const design = designCtx.getImageData(0, 0, w, h).data;

        // Composite
        const outputData = ctx.createImageData(w, h);
        const out = outputData.data;
        const maxDisp = state.dispIntensity * 0.5;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;

                // Start with base
                out[i]     = base[i];
                out[i + 1] = base[i + 1];
                out[i + 2] = base[i + 2];
                out[i + 3] = base[i + 3] || 255;

                // Mask check
                const maskAlpha = (mask[i] / 255) * (mask[i + 3] / 255);
                if (maskAlpha < 0.01) continue;

                // Displacement: sample design from offset position
                const dispVal = disp[i]; // greyscale value
                const dx = Math.round((dispVal / 255 - 0.5) * maxDisp * 2);
                // Use green channel for vertical (or same as red for greyscale maps)
                const dispValG = disp[i + 1];
                const dy = Math.round((dispValG / 255 - 0.5) * maxDisp * 2);

                const sx = Math.min(Math.max(x + dx, 0), w - 1);
                const sy = Math.min(Math.max(y + dy, 0), h - 1);
                const si = (sy * w + sx) * 4;

                const dr = design[si];
                const dg = design[si + 1];
                const db = design[si + 2];
                const da = design[si + 3] / 255;

                if (da < 0.01) continue;

                const alpha = da * maskAlpha;

                // MULTIPLY BLEND
                // White bag pixels (255) × design color = design color (unchanged)
                // Shadow bag pixels (say 200) × design color = darker design color
                // This naturally makes the design follow the bag's lighting
                const mr = (base[i]     * dr) / 255;
                const mg = (base[i + 1] * dg) / 255;
                const mb = (base[i + 2] * db) / 255;

                out[i]     = Math.round(base[i]     + (mr - base[i])     * alpha);
                out[i + 1] = Math.round(base[i + 1] + (mg - base[i + 1]) * alpha);
                out[i + 2] = Math.round(base[i + 2] + (mb - base[i + 2]) * alpha);
            }
        }

        ctx.putImageData(outputData, 0, 0);

        // Optional shadow overlay
        if (state.shadowImg) {
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = 0.25;
            ctx.drawImage(state.shadowImg, 0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }

        canvas.style.display = 'block';
        placeholderText.style.display = 'none';
    }

    // ── Helpers ──
    function createOffscreen(w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    function getMaskBounds(maskData, w, h) {
        let left = w, right = 0, top = h, bottom = 0;
        const d = maskData.data;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (d[i] > 128 && d[i + 3] > 128) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }
        }
        return { left, right, top, bottom };
    }

    // ── File handling ──
    function handleFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                state.designImg = img;
                uploadPreview.src = e.target.result;
                uploadPreview.style.display = 'block';
                uploadContent.style.display = 'none';
                controls.style.display = 'flex';
                previewActions.style.display = 'flex';
                uploadZone.style.padding = '20px';
                uploadZone.style.minHeight = 'auto';
                previewFrame.classList.add('loading');
                requestAnimationFrame(() => { render(); previewFrame.classList.remove('loading'); });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── Events ──
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault(); uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    document.getElementById('scaleSlider').addEventListener('input', (e) => {
        state.scale = parseInt(e.target.value);
        document.getElementById('scaleValue').textContent = state.scale + '%';
        render();
    });
    document.getElementById('xSlider').addEventListener('input', (e) => { state.offsetX = parseInt(e.target.value); render(); });
    document.getElementById('ySlider').addEventListener('input', (e) => { state.offsetY = parseInt(e.target.value); render(); });
    document.getElementById('dispSlider').addEventListener('input', (e) => {
        state.dispIntensity = parseInt(e.target.value);
        document.getElementById('dispValue').textContent = state.dispIntensity + '%';
        render();
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
        state.scale = 60; state.offsetX = 50; state.offsetY = 50; state.dispIntensity = 30;
        document.getElementById('scaleSlider').value = 60;
        document.getElementById('scaleValue').textContent = '60%';
        document.getElementById('xSlider').value = 50;
        document.getElementById('ySlider').value = 50;
        document.getElementById('dispSlider').value = 30;
        document.getElementById('dispValue').textContent = '30%';
        render();
    });

    document.getElementById('changeDesignBtn').addEventListener('click', () => {
        state.designImg = null; fileInput.value = '';
        uploadPreview.style.display = 'none'; uploadContent.style.display = 'flex';
        controls.style.display = 'none'; previewActions.style.display = 'none';
        canvas.style.display = 'none'; placeholderText.style.display = 'block';
        uploadZone.style.padding = '48px 24px'; uploadZone.style.minHeight = '240px';
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
        if (!canvas.width) return;
        const link = document.createElement('a');
        link.download = 'tote-bag-mockup.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

    const modal = document.getElementById('modalOverlay');
    document.getElementById('inquiryBtn').addEventListener('click', () => modal.classList.add('active'));
    document.getElementById('modalClose').addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    document.getElementById('inquiryForm').addEventListener('submit', (e) => {
        e.preventDefault();
        alert('Quote request sent! We\'ll be in touch within 24 hours.');
        modal.classList.remove('active');
    });

    loadAssets();
})();
