// Interactive CT demo: Shepp–Logan phantom -> sinogram -> (filtered) backprojection.
// Usage: mountCT(element). Colours come from the host page's CSS variables.
(function () {
  // Modified Shepp–Logan phantom: [intensity, a, b, x0, y0, rotation°]
  const E = [
    [1, .69, .92, 0, 0, 0], [-.8, .6624, .874, 0, -.0184, 0],
    [-.2, .11, .31, .22, 0, -18], [-.2, .16, .41, -.22, 0, 18],
    [.1, .21, .25, 0, .35, 0], [.1, .046, .046, 0, .1, 0], [.1, .046, .046, 0, -.1, 0],
    [.1, .046, .023, -.08, -.605, 0], [.1, .023, .023, 0, -.606, 0], [.1, .023, .046, .06, -.605, 0],
  ].map(([r, a, b, x, y, p]) => ({ r, a, b, x, y, p: p * Math.PI / 180 }));

  const N = 96, S = 128, ds = 2 / S;

  function phantom() {
    const img = new Float32Array(N * N);
    for (let i = 0; i < N; i++) {
      const y = 1 - (i + .5) * 2 / N;
      for (let j = 0; j < N; j++) {
        const x = -1 + (j + .5) * 2 / N;
        let v = 0;
        for (const e of E) {
          const dx = x - e.x, dy = y - e.y, c = Math.cos(e.p), s = Math.sin(e.p);
          const xr = dx * c + dy * s, yr = -dx * s + dy * c;
          if ((xr / e.a) ** 2 + (yr / e.b) ** 2 <= 1) v += e.r;
        }
        img[i * N + j] = v;
      }
    }
    return img;
  }

  // Exact line integrals through the ellipses at angle th.
  function project(th) {
    const p = new Float32Array(S), c = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < S; k++) {
      const s = -1 + (k + .5) * ds;
      let v = 0;
      for (const e of E) {
        const al = th - e.p;
        const A2 = e.a * e.a * Math.cos(al) ** 2 + e.b * e.b * Math.sin(al) ** 2;
        const sp = s - (e.x * c + e.y * sn);
        if (sp * sp < A2) v += 2 * e.r * e.a * e.b * Math.sqrt(A2 - sp * sp) / A2;
      }
      p[k] = v;
    }
    return p;
  }

  // Ram-Lak kernel in the spatial domain.
  const h = new Float32Array(2 * S - 1);
  for (let n = -(S - 1); n < S; n++) {
    h[n + S - 1] = n === 0 ? 1 / (4 * ds * ds) : (n % 2 ? -1 / (n * n * Math.PI * Math.PI * ds * ds) : 0);
  }
  function ramp(p) {
    const q = new Float32Array(S);
    for (let k = 0; k < S; k++) {
      let v = 0;
      for (let m = 0; m < S; m++) v += p[m] * h[k - m + S - 1];
      q[k] = v * ds;
    }
    return q;
  }

  function reconstruct(projs, thetas, filtered) {
    const img = new Float32Array(N * N), K = thetas.length;
    for (let t = 0; t < K; t++) {
      const q = filtered ? ramp(projs[t]) : projs[t];
      const c = Math.cos(thetas[t]), sn = Math.sin(thetas[t]);
      for (let i = 0; i < N; i++) {
        const y = 1 - (i + .5) * 2 / N;
        for (let j = 0; j < N; j++) {
          const x = -1 + (j + .5) * 2 / N;
          const u = (x * c + y * sn + 1) / ds - .5, k0 = Math.floor(u);
          if (k0 < 0 || k0 >= S - 1) continue;
          const f = u - k0;
          img[i * N + j] += q[k0] * (1 - f) + q[k0 + 1] * f;
        }
      }
    }
    for (let i = 0; i < img.length; i++) img[i] *= Math.PI / K;
    return img;
  }

  function draw(cv, img, w, hh, lo, hi) {
    cv.width = w; cv.height = hh;
    const ctx = cv.getContext('2d'), d = ctx.createImageData(w, hh);
    for (let i = 0; i < w * hh; i++) {
      let v = (img[i] - lo) / (hi - lo);
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v * 255;
      d.data[4 * i + 3] = 255;
    }
    ctx.putImageData(d, 0, 0);
  }
  const range = a => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi || 1]; };

  const css = `
  .ct{display:grid;gap:14px}
  .ct-panels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .ct-panels figure{margin:0;display:grid;gap:6px}
  .ct-panels canvas{width:100%;aspect-ratio:1;display:block;background:#000;border-radius:var(--ct-radius,2px);image-rendering:pixelated}
  .ct-panels figcaption{font-size:.78em;color:var(--ct-muted,#666);line-height:1.3}
  .ct-controls{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center;font-size:.9em;color:var(--ct-fg,inherit)}
  .ct-controls label{display:flex;align-items:center;gap:8px}
  .ct-controls input[type=range]{accent-color:var(--ct-accent,#2563eb);width:150px}
  .ct-controls input[type=checkbox]{accent-color:var(--ct-accent,#2563eb)}
  .ct-controls output{font-variant-numeric:tabular-nums;min-width:3ch}
  .ct-controls button{font:inherit;padding:4px 12px;border:1px solid var(--ct-accent,#2563eb);color:var(--ct-accent,#2563eb);background:transparent;border-radius:var(--ct-radius,2px);cursor:pointer}
  .ct-controls button:focus-visible,.ct-controls input:focus-visible{outline:2px solid var(--ct-accent,#2563eb);outline-offset:2px}`;

  let styled = false;
  window.mountCT = function (root) {
    if (!styled) { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); styled = true; }
    const uid = 'ct' + Math.random().toString(36).slice(2, 7);
    root.classList.add('ct');
    root.innerHTML = `
      <div class="ct-panels">
        <figure><canvas data-k="ph" aria-label="Phantom"></canvas><figcaption>Object (Shepp–Logan phantom)</figcaption></figure>
        <figure><canvas data-k="sino" aria-label="Sinogram"></canvas><figcaption>Sinogram: what the scanner records</figcaption></figure>
        <figure><canvas data-k="rec" aria-label="Reconstruction"></canvas><figcaption>Reconstruction</figcaption></figure>
      </div>
      <div class="ct-controls">
        <label for="${uid}-k">Angles <input id="${uid}-k" type="range" min="1" max="180" value="12"><output>12</output></label>
        <label for="${uid}-f"><input id="${uid}-f" type="checkbox"> Ramp filter</label>
        <button type="button">Sweep angles</button>
      </div>`;
    const $ = s => root.querySelector(s);
    const ph = phantom();
    draw($('[data-k=ph]'), ph, N, N, 0, .45);
    const slider = $('input[type=range]'), out = $('output'), filt = $('input[type=checkbox]'), btn = $('button');

    function render() {
      const K = +slider.value; out.textContent = K;
      const thetas = Array.from({ length: K }, (_, k) => k * Math.PI / K);
      const projs = thetas.map(project);
      const sino = new Float32Array(K * S);
      projs.forEach((p, r) => sino.set(p, r * S));
      draw($('[data-k=sino]'), sino, S, K, 0, range(sino)[1]);
      const rec = reconstruct(projs, thetas, filt.checked);
      if (filt.checked) draw($('[data-k=rec]'), rec, N, N, 0, .45);
      else { const [lo, hi] = range(rec); draw($('[data-k=rec]'), rec, N, N, lo, hi); }
    }
    let playing = null;
    btn.addEventListener('click', () => {
      if (playing) { clearInterval(playing); playing = null; btn.textContent = 'Sweep angles'; return; }
      slider.value = 1; btn.textContent = 'Stop';
      playing = setInterval(() => {
        slider.value = Math.min(180, Math.ceil(+slider.value * 1.25));
        render();
        if (+slider.value >= 180) { clearInterval(playing); playing = null; btn.textContent = 'Sweep angles'; }
      }, 220);
    });
    slider.addEventListener('input', render);
    filt.addEventListener('change', render);
    render();
  };
})();
