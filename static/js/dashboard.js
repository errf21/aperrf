/* ===========================================================
   errfpanel — dashboard controller (v1.5.3)
   Fully compatible with plain‑text subscription links
   (Info Configs + TLS), no Non‑TLS, no Clean IP.
   =========================================================== */
(() => {
  let currentInbounds = [];
  let lastHourly = [];

  // ---------------- guard: must be logged in ----------------
  ERRF.api('/api/me').then(me => {
    if (!me.logged_in) { window.location.href = '/login'; return; }
    document.getElementById('appVersion').textContent = me.app_version || '';
    document.getElementById('panelVersionChip').textContent = me.app_version || '';
    if (me.settings) {
      document.getElementById('settingPublicDomain').value = me.settings.public_domain || '';
      document.getElementById('settingKeepAlive').checked = me.settings.keep_alive !== false;
      document.getElementById('settingFingerprint').value = me.settings.default_fingerprint || 'chrome';
      document.getElementById('settingAlpn').value = me.settings.default_alpn || 'http/1.1';
      document.getElementById('settingSniOverride').value = me.settings.sni_override || '';
      document.getElementById('settingLinkPrefix').value = me.settings.link_prefix || 'errfpanel';
      document.getElementById('settingNameVlWsTls').value = me.settings.link_name_vl_ws_tls || '';
      document.getElementById('settingNameVmWsTls').value = me.settings.link_name_vm_ws_tls || '';
      document.getElementById('settingNameVlXhttpTls').value = me.settings.link_name_vl_xhttp_tls || '';
      document.getElementById('settingSubscriptionName').value = me.settings.subscription_name || '';
      document.getElementById('settingFragmentEnabled').checked = me.settings.fragment_enabled !== false;
      document.getElementById('settingFragmentPackets').value = me.settings.fragment_packets || 'tlshello';
      document.getElementById('settingFragmentLength').value = me.settings.fragment_length || '10-30';
      document.getElementById('settingFragmentInterval').value = me.settings.fragment_interval || '10-20';
    }
  }).catch(() => { window.location.href = '/login'; });

  // ---------------- nav / view switching ----------------
  const views = document.querySelectorAll('.view');
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const viewTitle = document.getElementById('viewTitle');
  const titleKeys = { dashboard: 'nav_dashboard', inbounds: 'nav_inbounds', traffic: 'nav_traffic', security: 'nav_security', settings: 'nav_settings' };

  function showView(name) {
    views.forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    navItems.forEach(n => n.classList.toggle('active', n.dataset.view === name));
    viewTitle.setAttribute('data-i18n', titleKeys[name]);
    viewTitle.textContent = ERRF.t(titleKeys[name]);
    if (name === 'inbounds') loadInbounds();
    if (name === 'traffic') loadInbounds();
    closeSidebarMobile();
  }
  navItems.forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));

  // ---------------- mobile sidebar ----------------
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  document.getElementById('menuToggle').addEventListener('click', () => {
    const opening = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', opening);
    backdrop.classList.toggle('open', opening);
    document.body.classList.toggle('sidebar-locked', opening);
  });
  backdrop.addEventListener('click', closeSidebarMobile);
  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.classList.remove('sidebar-locked');
  }

  // ---------------- lang / theme ----------------
  document.querySelectorAll('.lang-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      ERRF.setLang(btn.dataset.lang);
      viewTitle.textContent = ERRF.t(viewTitle.getAttribute('data-i18n'));
    });
  });
  document.getElementById('themeToggle').addEventListener('click', () => {
    ERRF.setTheme(ERRF.getTheme() === 'dark' ? 'light' : 'dark');
    renderTrafficChart(document.getElementById('trafficChart'), lastHourly);
  });

  // ---------------- dashboard music : persistent prefs ----------------
  // [MUSIC-PREFS-BEGIN]
  function normalizeMusicPrefs(rawEnabled, rawVolume) {
    const enabled = (rawEnabled === null || rawEnabled === undefined)
      ? true : String(rawEnabled) === '1';
    // default = full level; never auto-reduced — only user adjustments change it
    let volume = 1;
    const v = parseFloat(rawVolume);
    if (Number.isFinite(v)) volume = Math.min(100, Math.max(0, v)) / 100;
    return { enabled, volume };
  }
  // [MUSIC-PREFS-END]

  const MUSIC_KEYS = { enabled: 'errfpanel_music_enabled', volume: 'errfpanel_music_volume' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } }

  const music = new Audio('/static/sfx/cornfield.mp3?v=2');
  music.loop = true;

  const musicSwitch = document.getElementById('settingMusic');
  const volumeRange = document.getElementById('musicVolume');
  const volumePct = document.getElementById('musicVolumePct');
  const volumeRow = document.getElementById('musicVolumeRow');
  const musicPrefs = normalizeMusicPrefs(lsGet(MUSIC_KEYS.enabled), lsGet(MUSIC_KEYS.volume));

  music.volume = musicPrefs.volume;
  musicSwitch.checked = musicPrefs.enabled;

  function paintMusicVolume(vol) {
    const pct = Math.round(vol * 100);
    if (volumeRange) {
      volumeRange.value = String(pct);
      volumeRange.style.setProperty('--fill', pct + '%');
    }
    if (volumePct) volumePct.textContent = pct + '%';
    if (volumeRow) volumeRow.classList.toggle('is-off', !musicSwitch.checked);
  }
  paintMusicVolume(musicPrefs.volume);

  // graceful autoplay: one-shot listeners until the browser allows playback
  let gestureResumeArmed = false;
  function disarmMusicGesture() {
    if (!gestureResumeArmed) return;
    gestureResumeArmed = false;
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      document.removeEventListener(ev, onMusicGesture, true));
  }
  function onMusicGesture() {
    if (!musicSwitch.checked) { disarmMusicGesture(); return; }
    music.play().then(disarmMusicGesture).catch(() => { /* still blocked, keep armed */ });
  }
  function startMusic() {
    const p = music.play(); // resumes naturally from the paused position
    if (p && p.catch) p.catch(() => {
      if (gestureResumeArmed) return;
      gestureResumeArmed = true;
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
        document.addEventListener(ev, onMusicGesture, true));
    });
  }
  function stopMusic() {
    music.pause(); // position preserved for natural resume
    disarmMusicGesture();
  }

  musicSwitch.addEventListener('change', (e) => {
    const on = e.target.checked;
    lsSet(MUSIC_KEYS.enabled, on ? '1' : '0'); // playback state only — volume untouched
    if (volumeRow) volumeRow.classList.toggle('is-off', !on);
    if (on) startMusic(); else stopMusic();
  });

  if (volumeRange) {
    volumeRange.addEventListener('input', (e) => {
      const vol = Math.min(1, Math.max(0, e.target.value / 100));
      music.volume = vol;
      paintMusicVolume(vol);
    });
    volumeRange.addEventListener('change', (e) => {
      lsSet(MUSIC_KEYS.volume, e.target.value); // persist once the user adjusts
    });
  }

  if (musicPrefs.enabled) startMusic();

  // ---------------- logout ----------------
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await ERRF.api('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  // ---------------- modal helpers ----------------
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(ov.id); });
  });

  // ---------------- dashboard stats polling ----------------
  async function refreshStats() {
    try {
      const s = await ERRF.api('/stats');
      document.getElementById('statCpu').textContent = s.cpu_percent.toFixed(1) + '%';
      document.getElementById('barCpu').style.width = Math.min(100, s.cpu_percent) + '%';
      document.getElementById('statMem').textContent = s.mem_percent.toFixed(1) + '%';
      document.getElementById('barMem').style.width = Math.min(100, s.mem_percent) + '%';
      document.getElementById('statUptime').textContent = ERRF.fmtDuration(s.uptime_seconds);
      const loc = s.location || {};
      document.getElementById('statLocation').textContent = `${loc.flag || ''} ${loc.city || '?'}`;
      document.getElementById('statTotalTraffic').textContent = ERRF.fmtBytes((s.total_up || 0) + (s.total_down || 0));
      document.getElementById('statUp').textContent = ERRF.fmtBytes(s.total_up || 0);
      document.getElementById('statDown').textContent = ERRF.fmtBytes(s.total_down || 0);
      document.getElementById('statActiveConn').textContent = s.active_connections || 0;
      document.getElementById('statInboundCount').textContent = s.inbounds_count || 0;
      document.getElementById('navInboundCount').textContent = s.inbounds_count || 0;
      document.getElementById('trafficUp').textContent = ERRF.fmtBytes(s.total_up || 0);
      document.getElementById('trafficDown').textContent = ERRF.fmtBytes(s.total_down || 0);
      lastHourly = s.hourly || [];
      renderTrafficChart(document.getElementById('trafficChart'), lastHourly);
    } catch (e) { /* ignore transient errors */ }
  }
  refreshStats();
  setInterval(refreshStats, 8000);
  window.addEventListener('resize', () => renderTrafficChart(document.getElementById('trafficChart'), lastHourly));

  document.getElementById('quickAddBtn').addEventListener('click', () => { showView('inbounds'); openInboundModal(); });

  // ---------------- inbounds ----------------
  const fpKeyMap = { chrome: 'fp_chrome', ios: 'fp_ios', firefox: 'fp_firefox', edge: 'fp_edge', random: 'fp_random' };

  async function loadInbounds() {
    try {
      const r = await ERRF.api('/api/inbounds');
      currentInbounds = r.inbounds || [];
      renderInboundsTable();
      renderTrafficTable();
      document.getElementById('navInboundCount').textContent = currentInbounds.length;
    } catch (e) { ERRF.toast(e.detail || 'error', 'error'); }
  }

  function renderInboundsTable(filter = '') {
    const tbody = document.getElementById('inboundsTableBody');
    const empty = document.getElementById('inboundsEmpty');
    const rows = currentInbounds.filter(ib => !filter || ib.name.toLowerCase().includes(filter.toLowerCase()));
    tbody.innerHTML = '';
    empty.style.display = rows.length ? 'none' : 'block';

    rows.forEach(ib => {
      const st = ib.status;
      const tr = document.createElement('tr');
      const statusPill = st.live_enabled
        ? `<span class="pill pill-on"><span class="pill-dot"></span>${ERRF.t('active')}</span>`
        : `<span class="pill pill-off"><span class="pill-dot"></span>${st.expired ? ERRF.t('expired') : ERRF.t('inactive')}</span>`;
      const quotaTxt = ib.quota_gb > 0
        ? `${ERRF.fmtBytes(st.used)} ${ERRF.t('inb_used_of')} ${ib.quota_gb} GB`
        : `${ERRF.fmtBytes(st.used)} / ${ERRF.t('unlimited')}`;
      const pct = ib.quota_gb > 0 ? Math.min(100, (st.used / st.quota_bytes) * 100) : (st.used > 0 ? 8 : 0);
      const expireTxt = ib.expire_at
        ? `${st.days_left} ${ERRF.t('inb_days_left')}`
        : ERRF.t('inb_no_expire');
      tr.innerHTML = `
        <td data-label="${ERRF.t('inb_name')}"><b>${escapeHtml(ib.name)}</b><div class="small muted">${ib.note ? escapeHtml(ib.note) : ''}</div></td>
        <td data-label="${ERRF.t('inb_status')}">${statusPill}</td>
        <td data-label="${ERRF.t('inb_usage')}" style="min-width:160px;">
          <div class="small num">${quotaTxt}</div>
          <div class="bar progress-accent"><span style="width:${pct}%"></span></div>
        </td>
        <td class="num" data-label="${ERRF.t('inb_expire')}">${expireTxt}</td>
        <td class="num" data-label="${ERRF.t('inb_max_conn')}">${st.active_connections}${ib.max_connections ? ' / ' + ib.max_connections : ''} <span class="small muted">${ERRF.t('inb_active_devices')}</span></td>
        <td data-label="${ERRF.t('inb_actions')}">
          <div class="row-actions">
            <button class="icon-btn btn-sm" data-action="links" data-uid="${ib.uid}" title="${ERRF.t('inb_links')}"><svg width="15" height="15"><use href="#icon-qr"/></svg></button>
            <button class="icon-btn btn-sm" data-action="edit" data-uid="${ib.uid}" title="${ERRF.t('edit')}"><svg width="15" height="15"><use href="#icon-edit"/></svg></button>
            <button class="icon-btn btn-sm" data-action="reset" data-uid="${ib.uid}" title="${ERRF.t('inb_reset_usage')}"><svg width="15" height="15"><use href="#icon-refresh"/></svg></button>
            <button class="icon-btn btn-sm" data-action="regen" data-uid="${ib.uid}" title="${ERRF.t('inb_regenerate')}"><svg width="15" height="15"><use href="#icon-key"/></svg></button>
            <button class="icon-btn btn-sm danger" data-action="delete" data-uid="${ib.uid}" title="${ERRF.t('delete')}"><svg width="15" height="15"><use href="#icon-trash"/></svg></button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleInboundAction(btn.dataset.action, btn.dataset.uid));
    });
  }

  function renderTrafficTable() {
    const tbody = document.getElementById('trafficTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    currentInbounds.forEach(ib => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="${ERRF.t('inb_name')}"><b>${escapeHtml(ib.name)}</b></td>
        <td data-label="${ERRF.t('dash_upload')}" class="num">${ERRF.fmtBytes(ib.used_up || 0)}</td>
        <td data-label="${ERRF.t('dash_download')}" class="num">${ERRF.fmtBytes(ib.used_down || 0)}</td>
        <td data-label="${ERRF.t('inb_usage')}" class="num">${ERRF.fmtBytes((ib.used_up || 0) + (ib.used_down || 0))}</td>`;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('inboundSearch').addEventListener('input', (e) => renderInboundsTable(e.target.value));

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function openInboundModal(ib = null) {
    document.getElementById('inboundModalTitle').textContent = ib ? ERRF.t('edit') : ERRF.t('inb_add');
    document.getElementById('inboundUid').value = ib ? ib.uid : '';
    document.getElementById('fName').value = ib ? ib.name : '';
    document.getElementById('fQuota').value = ib ? (ib.quota_gb || '') : '';
    document.getElementById('fExpire').value = ib ? (ib.expire_days || '') : '';
    document.getElementById('fMaxConn').value = ib ? (ib.max_connections || '') : '';
    document.getElementById('fMaxReq').value = ib ? (ib.max_requests || '') : '';
    document.getElementById('fFingerprint').value = ib ? (ib.fp || 'chrome') : 'chrome';
    document.getElementById('fStrictIp').checked = ib ? !!ib.strict_single_ip : false;
    document.getElementById('fNote').value = ib ? (ib.note || '') : '';
    openModal('inboundModal');
  }

  document.getElementById('addInboundBtn').addEventListener('click', () => openInboundModal());

  document.getElementById('inboundSaveBtn').addEventListener('click', async () => {
    const uid = document.getElementById('inboundUid').value;
    const payload = {
      name: document.getElementById('fName').value.trim() || 'User',
      quota_gb: parseFloat(document.getElementById('fQuota').value || 0),
      expire_days: parseInt(document.getElementById('fExpire').value || 0),
      max_connections: parseInt(document.getElementById('fMaxConn').value || 0),
      max_requests: parseInt(document.getElementById('fMaxReq').value || 0),
      fp: document.getElementById('fFingerprint').value,
      strict_single_ip: document.getElementById('fStrictIp').checked,
      note: document.getElementById('fNote').value.trim(),
    };
    const btn = document.getElementById('inboundSaveBtn');
    ERRF.setLoading(btn, true);
    try {
      if (uid) {
        await ERRF.api(`/api/inbounds/${uid}`, { method: 'PATCH', body: payload });
        ERRF.toast(ERRF.t('inb_updated'), 'success');
      } else {
        await ERRF.api('/api/inbounds', { method: 'POST', body: payload });
        ERRF.toast(ERRF.t('inb_created'), 'success');
      }
      closeModal('inboundModal');
      loadInbounds();
    } catch (e) {
      ERRF.toast(e.detail || 'error', 'error');
    } finally {
      ERRF.setLoading(btn, false);
    }
  });

  async function handleInboundAction(action, uid) {
    const ib = currentInbounds.find(x => x.uid === uid);
    if (!ib) return;
    if (action === 'edit') return openInboundModal(ib);
    if (action === 'links') return showLinksModal(uid);
    if (action === 'reset') {
      try {
        await ERRF.api(`/api/inbounds/${uid}/reset-usage`, { method: 'POST' });
        ERRF.toast(ERRF.t('inb_reset_done'), 'success');
        loadInbounds();
      } catch (e) { ERRF.toast(e.detail || 'error', 'error'); }
      return;
    }
    if (action === 'regen') {
      if (!confirm(ERRF.t('inb_regenerate_confirm'))) return;
      try {
        await ERRF.api(`/api/inbounds/${uid}/regenerate`, { method: 'POST' });
        ERRF.toast(ERRF.t('inb_regenerated'), 'success');
        loadInbounds();
      } catch (e) { ERRF.toast(e.detail || 'error', 'error'); }
      return;
    }
    if (action === 'delete') {
      if (!confirm(ERRF.t('inb_delete_confirm'))) return;
      try {
        await ERRF.api(`/api/inbounds/${uid}`, { method: 'DELETE' });
        ERRF.toast(ERRF.t('inb_deleted'), 'success');
        loadInbounds();
      } catch (e) { ERRF.toast(e.detail || 'error', 'error'); }
      return;
    }
  }

  // ============ LINKS MODAL (v1.4.1) ============
  async function showLinksModal(uid) {
    try {
      const r = await ERRF.api(`/api/inbounds/${uid}/links`);
      
      // نمایش لینک TLS
      document.getElementById('linkTls').textContent = r.links.tls || '';
      
      // لینک اشتراک (با پروتکل https)
      document.getElementById('linkSub').textContent = r.sub_url || '';
      
      // لینک وضعیت
      document.getElementById('linkStatus').textContent = r.status_url || '';
      
      // لینک JSON
      document.getElementById('linkSubJson').textContent = r.sub_json_url || '';

      // لینک DoH
      const elDoh = document.getElementById('linkDoh');
      if (elDoh) elDoh.textContent = r.doh_url || '';
      
      // QR Code
      document.getElementById('qrImg').src = `/api/inbounds/${uid}/qr?t=${Date.now()}`;
      
      openModal('linksModal');
    } catch (e) { 
      ERRF.toast(e.detail || 'error', 'error'); 
    }
  }

  // ---------------- copy functionality ----------------
  function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
      ERRF.toast(ERRF.t('copied'), 'success', 1600);
    }).catch(() => ERRF.toast('error', 'error'));
  }

  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.copy;
      const el = document.getElementById(targetId);
      if (el) copyText(el.textContent);
    });
  });

  // ---------------- حذف کامل بخش Clean IP ----------------
  // تمام توابع مربوط به Clean IP حذف شدند: 
  // loadAddresses, renderAddressesTable, addAddressBtn, fetchCleanIpBtn, addressSaveBtn

  // ---------------- security ----------------
  document.getElementById('securityForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const old_password = document.getElementById('oldPassword').value;
    const new_username = document.getElementById('newUsername').value.trim();
    const new_password = document.getElementById('newPassword').value;
    const new_password2 = document.getElementById('newPassword2').value;
    if (new_password && new_password !== new_password2) {
      ERRF.toast(ERRF.t('setup_mismatch'), 'error');
      ERRF.shake(document.getElementById('securityForm'));
      return;
    }
    const btn = document.getElementById('securityBtn');
    ERRF.setLoading(btn, true);
    try {
      await ERRF.api('/api/change-password', { method: 'POST', body: { old_password, new_username, new_password } });
      ERRF.toast(ERRF.t('sec_updated'), 'success');
      document.getElementById('securityForm').reset();
    } catch (e) {
      let msg = e.detail;
      if (msg === 'wrong-old-password') msg = ERRF.t('sec_wrong_old');
      ERRF.toast(msg || 'error', 'error');
      ERRF.shake(document.getElementById('securityForm'));
    } finally {
      ERRF.setLoading(btn, false);
    }
  });

  // ---------------- settings ----------------
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const payload = {
      public_domain: document.getElementById('settingPublicDomain').value.trim(),
      keep_alive: document.getElementById('settingKeepAlive').checked,
    };
    const btn = document.getElementById('saveSettingsBtn');
    ERRF.setLoading(btn, true);
    try {
      await ERRF.api('/api/settings', { method: 'POST', body: payload });
      ERRF.toast(ERRF.t('settings_saved'), 'success');
    } catch (e) {
      ERRF.toast(e.detail || 'error', 'error');
    } finally {
      ERRF.setLoading(btn, false);
    }
  });

  // ---------------- advanced config settings ----------------
  document.getElementById('saveAdvancedBtn').addEventListener('click', async () => {
    const payload = {
      default_fingerprint: document.getElementById('settingFingerprint').value,
      default_alpn: document.getElementById('settingAlpn').value,
      sni_override: document.getElementById('settingSniOverride').value.trim(),
      link_prefix: document.getElementById('settingLinkPrefix').value.trim() || 'errfpanel',
      link_name_vl_ws_tls: document.getElementById('settingNameVlWsTls').value.trim(),
      link_name_vm_ws_tls: document.getElementById('settingNameVmWsTls').value.trim(),
      link_name_vl_xhttp_tls: document.getElementById('settingNameVlXhttpTls').value.trim(),
      subscription_name: document.getElementById('settingSubscriptionName').value.trim(),
      fragment_enabled: document.getElementById('settingFragmentEnabled').checked,
      fragment_packets: document.getElementById('settingFragmentPackets').value.trim() || 'tlshello',
      fragment_length: document.getElementById('settingFragmentLength').value.trim() || '10-30',
      fragment_interval: document.getElementById('settingFragmentInterval').value.trim() || '10-20',
    };
    const btn = document.getElementById('saveAdvancedBtn');
    ERRF.setLoading(btn, true);
    try {
      await ERRF.api('/api/settings', { method: 'POST', body: payload });
      ERRF.toast(ERRF.t('settings_saved'), 'success');
    } catch (e) {
      ERRF.toast(e.detail || 'error', 'error');
    } finally {
      ERRF.setLoading(btn, false);
    }
  });

  document.getElementById('settingFragmentEnabled').addEventListener('change', (e) => {
    document.getElementById('fragmentFields').style.opacity = e.target.checked ? '1' : '.45';
    document.getElementById('fragmentFields').style.pointerEvents = e.target.checked ? 'auto' : 'none';
  });

  // ---------------- initial load ----------------
  loadInbounds();
})();
