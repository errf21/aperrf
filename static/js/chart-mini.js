/* ===========================================================
   StanNG — dependency-free hourly traffic chart (canvas + HTML tooltip)
   Redesigned for more detail: dual bars (up/down) + a smooth total-traffic
   line overlay, real byte-formatted Y-axis, day-boundary markers, a legend,
   and an interactive hover/tap tooltip. Still zero external chart library.
   =========================================================== */
(function () {
  const state = new WeakMap();

  function fmtBytesShort(bytes) {
    if (!bytes || bytes <= 0) return '0';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    return (i === 0 ? Math.round(val) : val.toFixed(val < 10 ? 1 : 0)) + ' ' + units[i];
  }

  function niceStep(maxVal) {
    // pick a "nice" rounded step for Y-axis gridlines (1/2/5 * 10^n)
    if (maxVal <= 0) return 1;
    const rough = maxVal / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h <= 0.5 || w <= 0) return;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function ensureTooltip(wrap) {
    let tip = wrap.querySelector('.chart-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tooltip';
      wrap.appendChild(tip);
    }
    return tip;
  }

  function ensureLegend(wrap, lang) {
    let legend = wrap.querySelector('.chart-legend');
    if (!legend) {
      legend = document.createElement('div');
      legend.className = 'chart-legend';
      wrap.insertBefore(legend, wrap.firstChild);
    }
    const upLabel = (window.STANNG && STANNG.t('dash_upload')) || 'Upload';
    const downLabel = (window.STANNG && STANNG.t('dash_download')) || 'Download';
    const totalLabel = (window.STANNG && STANNG.t('dash_total_traffic')) || 'Total';
    legend.innerHTML = `
      <span class="chart-legend-item"><i class="dot dot-gold"></i>${upLabel}</span>
      <span class="chart-legend-item"><i class="dot dot-azure"></i>${downLabel}</span>
      <span class="chart-legend-item"><i class="dot dot-line"></i>${totalLabel}</span>
    `;
    return legend;
  }

  function computeLayout(canvas, data) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 280);
    // Cache original logical height once
    if (!canvas.dataset.logicalHeight) {
      canvas.dataset.logicalHeight = canvas.getAttribute('height') || '220';
    }
    const height = parseInt(canvas.dataset.logicalHeight, 10) || 220;
    const maxTotal = Math.max(0, ...(data || []).map(d => (d.up || 0) + (d.down || 0)));
    let niceMax;
    let step;
    if (maxTotal <= 0) {
      niceMax = 100 * 1024 * 1024; // 100 MB default headroom when no traffic recorded
      step = niceMax / 4;
    } else {
      step = niceStep(maxTotal);
      niceMax = Math.max(step, Math.ceil(maxTotal / step) * step);
    }
    const yLabelW = fmtBytesShort(niceMax).length * 6.5 + 14;
    const padding = { top: 16, right: 14, bottom: 28, left: Math.max(48, yLabelW) };
    return { width, height, padding, niceMax, step };
  }

  function drawChart(canvas, data) {
    const dpr = window.devicePixelRatio || 1;
    const { width, height, padding, niceMax } = computeLayout(canvas, data);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(document.documentElement);
    const goldColor = styles.getPropertyValue('--gold-500').trim() || '#35D0C5';
    const goldLight = styles.getPropertyValue('--gold-300').trim() || '#5FDCCF';
    const azureColor = styles.getPropertyValue('--azure').trim() || '#4CA6E8';
    const emeraldColor = styles.getPropertyValue('--accent-300').trim() || '#5FDCCF';
    const textColor = styles.getPropertyValue('--text-2').trim() || '#A9BCCB';
    const textMuted = styles.getPropertyValue('--text-muted').trim() || '#7B8EA0';
    const gridColor = styles.getPropertyValue('--border-soft').trim() || 'rgba(148,171,196,0.13)';

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const bars = [];

    if (!data || !data.length) {
      return { bars: [], padding, chartW, chartH, width, height };
    }

    const n = data.length;
    const groupW = chartW / n;
    const barW = Math.max(3, Math.min(14, groupW * 0.34));

    // ---- horizontal gridlines + Y-axis byte labels ----
    const rows = 4;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.font = '10.5px Vazirmatn, sans-serif';
    ctx.fillStyle = textMuted;
    ctx.textAlign = 'end';
    for (let i = 0; i <= rows; i++) {
      const y = padding.top + (chartH / rows) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y + 0.5);
      ctx.lineTo(width - padding.right, y + 0.5);
      ctx.stroke();
      const val = niceMax * (1 - i / rows);
      ctx.fillText(fmtBytesShort(val), padding.left - 8, y + 3.5);
    }

    // ---- day-boundary vertical markers (midnight ticks) ----
    let lastDay = null;
    data.forEach((d, i) => {
      const dt = new Date((d.t || 0) * 1000);
      const dayKey = dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
      if (lastDay !== null && dayKey !== lastDay) {
        const x = padding.left + groupW * i;
        ctx.strokeStyle = gridColor;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      lastDay = dayKey;
    });

    // ---- bars (upload / download) ----
    data.forEach((d, i) => {
      const cx = padding.left + groupW * i + groupW / 2;
      const upH = ((d.up || 0) / niceMax) * chartH;
      const downH = ((d.down || 0) / niceMax) * chartH;

      if (upH > 0.5) {
        const gradUp = ctx.createLinearGradient(0, padding.top + chartH - upH, 0, padding.top + chartH);
        gradUp.addColorStop(0, goldLight);
        gradUp.addColorStop(1, 'rgba(53,208,197,0.18)');
        ctx.fillStyle = gradUp;
        roundRect(ctx, cx - barW - 1, padding.top + chartH - upH, barW, upH, 2.5);
        ctx.fill();
      }

      if (downH > 0.5) {
        const gradDown = ctx.createLinearGradient(0, padding.top + chartH - downH, 0, padding.top + chartH);
        gradDown.addColorStop(0, azureColor);
        gradDown.addColorStop(1, 'rgba(76,166,232,0.18)');
        ctx.fillStyle = gradDown;
        roundRect(ctx, cx + 1, padding.top + chartH - downH, barW, downH, 2.5);
        ctx.fill();
      }

      bars.push({
        cx, x0: cx - groupW / 2, x1: cx + groupW / 2,
        up: d.up || 0, down: d.down || 0, t: d.t || 0,
      });

      // Label every 3-4 hours and last hour
      const labelInterval = Math.max(1, Math.floor(n / 7));
      if (i % labelInterval === 0 || i === n - 1) {
        const dt = new Date((d.t || 0) * 1000);
        const label = dt.getHours().toString().padStart(2, '0') + ':00';
        ctx.fillStyle = textColor;
        ctx.font = '10px Vazirmatn, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, height - 8);
      }
    });

    // ---- smooth total-traffic line overlay ----
    ctx.beginPath();
    data.forEach((d, i) => {
      const cx = padding.left + groupW * i + groupW / 2;
      const total = (d.up || 0) + (d.down || 0);
      const y = padding.top + chartH - (total / niceMax) * chartH;
      if (i === 0) ctx.moveTo(cx, y);
      else {
        const prevCx = padding.left + groupW * (i - 1) + groupW / 2;
        const prevTotal = (data[i - 1].up || 0) + (data[i - 1].down || 0);
        const prevY = padding.top + chartH - (prevTotal / niceMax) * chartH;
        const midX = (prevCx + cx) / 2;
        ctx.bezierCurveTo(midX, prevY, midX, y, cx, y);
      }
    });
    ctx.strokeStyle = emeraldColor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(53,208,197,0.22)';
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // dots on the line
    data.forEach((d, i) => {
      const total = (d.up || 0) + (d.down || 0);
      if (total > 0 || i === 0 || i === n - 1 || i % Math.max(1, Math.floor(n / 6)) === 0) {
        const cx = padding.left + groupW * i + groupW / 2;
        const y = padding.top + chartH - (total / niceMax) * chartH;
        ctx.beginPath();
        ctx.arc(cx, y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = emeraldColor;
        ctx.fill();
      }
    });

    return { bars, padding, chartW, chartH, width, height };
  }

  function attachInteractivity(canvas, wrap, getLayout) {
    const tip = ensureTooltip(wrap);
    let raf = null;

    function showAt(clientX, clientY) {
      const layout = getLayout();
      if (!layout || !layout.bars.length) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      let nearest = layout.bars[0];
      let bestDist = Infinity;
      for (const b of layout.bars) {
        const d = Math.abs(b.cx - x);
        if (d < bestDist) { bestDist = d; nearest = b; }
      }
      const dt = new Date(nearest.t * 1000);
      const dateLabel = dt.toLocaleString(document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const upLabel = (window.STANNG && STANNG.t('dash_upload')) || 'Upload';
      const downLabel = (window.STANNG && STANNG.t('dash_download')) || 'Download';
      const totalLabel = (window.STANNG && STANNG.t('dash_total_traffic')) || 'Total';
      const fmt = (window.STANNG && STANNG.fmtBytes) || fmtBytesShort;
      tip.innerHTML = `
        <div class="chart-tooltip-time">${dateLabel}</div>
        <div class="chart-tooltip-row"><i class="dot dot-gold"></i>${upLabel}: <b>${fmt(nearest.up)}</b></div>
        <div class="chart-tooltip-row"><i class="dot dot-azure"></i>${downLabel}: <b>${fmt(nearest.down)}</b></div>
        <div class="chart-tooltip-row"><i class="dot dot-line"></i>${totalLabel}: <b>${fmt(nearest.up + nearest.down)}</b></div>
      `;
      tip.style.opacity = '1';
      const wrapRect = wrap.getBoundingClientRect();
      let left = nearest.cx + 12;
      const tipW = 170;
      if (left + tipW > wrapRect.width) left = nearest.cx - tipW - 12;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = '8px';
    }

    function hide() { tip.style.opacity = '0'; }

    canvas.addEventListener('mousemove', (e) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => showAt(e.clientX, e.clientY));
    });
    canvas.addEventListener('mouseleave', hide);
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) showAt(t.clientX, t.clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) showAt(t.clientX, t.clientY);
    }, { passive: true });
    canvas.addEventListener('touchend', () => setTimeout(hide, 1500));
  }

  window.renderTrafficChart = function (canvas, hourlyData) {
    if (!canvas) return;
    let wrap = canvas.closest('.chart-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'chart-wrap';
      canvas.parentNode.insertBefore(wrap, canvas);
      wrap.appendChild(canvas);
    }
    ensureLegend(wrap);

    let data = (hourlyData || []).slice(-48);
    if (!data.length) {
      const nowBucket = Math.floor(Date.now() / 1000 / 3600) * 3600;
      data = [];
      for (let i = 23; i >= 0; i--) {
        data.push({ t: nowBucket - (i * 3600), up: 0, down: 0 });
      }
    }
    const layout = drawChart(canvas, data);
    state.set(canvas, layout);

    if (!canvas.dataset.interactiveBound) {
      attachInteractivity(canvas, wrap, () => state.get(canvas));
      canvas.dataset.interactiveBound = '1';
    }
  };
})();
