/**
 * Tote Bag Mockup Engine
 * Client-side displacement mapping with multiply blending
 */

(function () {
    'use strict';

    // ── Asset paths ──
    const ASSETS = {
        base: 'assets/bag-base.png',
        displacement: 'assets/bag-displacement.png',
        mask: 'assets/bag-mask.png',
        shadow: 'assets/bag-shadow.png'
    };

    // ── State ──
    let state = {
        designImg: null,
        baseImg: null,
        dispImg: null,
        maskImg: null,
        shadowImg: null,
        scale: 80,
        offsetX: 50,
        offsetY: 50,
        dispIntensity: 40,
        assetsLoaded: false
    };

    // ── DOM refs ──
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

    // ── Load all assets ──
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load: ${src}`));
            img.src = src;
        });
    }

    async function loadAssets() {
        try {
            [state.baseImg, state.dispImg, state.maskImg, state.shadowImg] = await Promise.all([
                loadImage(ASSETS.base),
                loadImage(ASSETS.displacement),
                loadImage(ASSETS.mask),
                loadImage(ASSETS.shadow)
            ]);
            state.assetsLoaded = true;
            console.log('All assets loaded');
        } catch (err) {
            console.error('Asset loading error:', err);
        }
    }

    // ── Core rendering engine ──
    function render() {
        if (!state.assetsLoaded || !state.designImg) return;

        const w = state.baseImg.width;
        const h = state.baseImg.height;
        canvas.width = w;
        canvas.height = h;

        // Step 1: Draw base product photo
        ctx.drawImage(state.baseImg, 0, 0, w, h);
        const baseData = ctx.getImageData(0, 0, w, h);

        // Step 2: Get displacement map data
        const dispCanvas = createOffscreen(w, h);
        const dispCtx = dispCanvas.getContext('2d');
        dispCtx.drawImage(state.dispImg, 0, 0, w, h);
        const dispData = dispCtx.getImageData(0, 0, w, h);

        // Step 3: Get mask data
        const maskCanvas = createOffscreen(w, h);
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(state.maskImg, 0, 0, w, h);
        const maskData = maskCtx.getImageData(0, 0, w, h);

        // Step 4: Draw design at desired scale and position onto temp canvas
        const designCanvas = createOffscreen(w, h);
        const designCtx = designCanvas.getContext('2d');

        const scale = state.scale / 100;
        const dw = state.designImg.width * scale;
        const dh = state.designImg.height * scale;

        // Calculate position based on mask bounds
        const maskBounds = getMaskBounds(maskData, w, h);
        const areaW = maskBounds.right - maskBounds.left;
        const areaH = maskBounds.bottom - maskBounds.top;

        // Fit design within mask area
        const fitScale = Math.min(areaW / dw, areaH / dh) * scale;
        const finalW = state.designImg.width * fitScale;
        const finalH = state.designImg.height * fitScale;

        const cx = maskBounds.left + (areaW - finalW) * (state.offsetX / 100);
        const cy = maskBounds.top + (areaH - finalH) * (state.offsetY / 100);

        designCtx.drawImage(state.designImg, cx, cy, finalW, finalH);
        const designData = designCtx.getImageData(0, 0, w, h);

        // Step 5: Apply displacement + multiply blending
        const outputData = ctx.createImageData(w, h);
        const out = outputData.data;
        const base = baseData.data;
        const design = designData.data;
        const disp = dispData.data;
        const mask = maskData.data;

        const intensity = state.dispIntensity * 0.3; // Scale intensity to reasonable pixel range

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;

                // Start with base image
                out[i] = base[i];
                out[i + 1] = base[i + 1];
                out[i + 2] = base[i + 2];
                out[i + 3] = 255;

                // Check mask - only apply design within masked area
                const maskAlpha = mask[i + 3] > 0 ? mask[i] / 255 : 0;
                if (maskAlpha < 0.01) continue;

                // Get displacement offset
                const dispValue = disp[i] / 255; // 0 to 1, 0.5 = neutral
                const dx = Math.round((dispValue - 0.5) * intensity * 2);
                const dy = Math.round((disp[i + 1] / 255 - 0.5) * intensity * 2);

                // Sample design at displaced position
                const sx = Math.min(Math.max(x + dx, 0), w - 1);
                const sy = Math.min(Math.max(y + dy, 0), h - 1);
                const si = (sy * w + sx) * 4;

                const dr = design[si];
                const dg = design[si + 1];
                const db = design[si + 2];
                const da = design[si + 3] / 255;

                if (da < 0.01) continue;

                // Multiply blend: result = (base * design) / 255
                const blendAlpha = da * maskAlpha;
                const mr = (base[i] * dr) / 255;
                const mg = (base[i + 1] * dg) / 255;
                const mb = (base[i + 2] * db) / 255;

                // Lerp between base and multiplied based on design alpha
                out[i] = Math.round(base[i] * (1 - blendAlpha) + mr * blendAlpha);
                out[i + 1] = Math.round(base[i + 1] * (1 - blendAlpha) + mg * blendAlpha);
                out[i + 2] = Math.round(base[i + 2] * (1 - blendAlpha) + mb * blendAlpha);
            }
        }

        ctx.putImageData(outputData, 0, 0);

        // Step 6: Draw shadow overlay on top
        if (state.shadowImg) {
            ctx.globalAlpha = 0.6;
            ctx.drawImage(state.shadowImg, 0, 0, w, h);
            ctx.globalAlpha = 1;
        }

        // Show canvas
        canvas.style.display = 'block';
        placeholderText.style.display = 'none';
    }

    // ── Helpers ──
    function createOffscreen(w, h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
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

                // Update UI
                uploadPreview.src = e.target.result;
                uploadPreview.style.display = 'block';
                uploadContent.style.display = 'none';
                controls.style.display = 'flex';
                previewActions.style.display = 'flex';
                uploadZone.style.padding = '20px';
                uploadZone.style.minHeight = 'auto';

                // Render
                previewFrame.classList.add('loading');
                requestAnimationFrame(() => {
                    render();
                    previewFrame.classList.remove('loading');
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── Event listeners ──

    // Upload zone click
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    // Sliders
    document.getElementById('scaleSlider').addEventListener('input', (e) => {
        state.scale = parseInt(e.target.value);
        document.getElementById('scaleValue').textContent = state.scale + '%';
        render();
    });

    document.getElementById('xSlider').addEventListener('input', (e) => {
        state.offsetX = parseInt(e.target.value);
        render();
    });

    document.getElementById('ySlider').addEventListener('input', (e) => {
        state.offsetY = parseInt(e.target.value);
        render();
    });

    document.getElementById('dispSlider').addEventListener('input', (e) => {
        state.dispIntensity = parseInt(e.target.value);
        document.getElementById('dispValue').textContent = state.dispIntensity + '%';
        render();
    });

    // Reset
    document.getElementById('resetBtn').addEventListener('click', () => {
        state.scale = 80;
        state.offsetX = 50;
        state.offsetY = 50;
        state.dispIntensity = 40;
        document.getElementById('scaleSlider').value = 80;
        document.getElementById('scaleValue').textContent = '80%';
        document.getElementById('xSlider').value = 50;
        document.getElementById('ySlider').value = 50;
        document.getElementById('dispSlider').value = 40;
        document.getElementById('dispValue').textContent = '40%';
        render();
    });

    // Change design
    document.getElementById('changeDesignBtn').addEventListener('click', () => {
        state.designImg = null;
        fileInput.value = '';
        uploadPreview.style.display = 'none';
        uploadContent.style.display = 'flex';
        controls.style.display = 'none';
        previewActions.style.display = 'none';
        canvas.style.display = 'none';
        placeholderText.style.display = 'block';
        uploadZone.style.padding = '48px 24px';
        uploadZone.style.minHeight = '240px';
    });

    // Download
    document.getElementById('downloadBtn').addEventListener('click', () => {
        if (!canvas.width) return;
        const link = document.createElement('a');
        link.download = 'tote-bag-mockup.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    });

    // Inquiry modal
    const modal = document.getElementById('modalOverlay');
    document.getElementById('inquiryBtn').addEventListener('click', () => {
        modal.classList.add('active');
    });
    document.getElementById('modalClose').addEventListener('click', () => {
        modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
    });

    // Form submit
    document.getElementById('inquiryForm').addEventListener('submit', (e) => {
        e.preventDefault();
        // In production, send form data + mockup image to your form handler / API
        alert('Quote request sent! We\'ll be in touch within 24 hours.');
        modal.classList.remove('active');
    });

    // ── Init ──
    loadAssets();

})();
