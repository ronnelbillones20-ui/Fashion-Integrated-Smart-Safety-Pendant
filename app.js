/* =========================================================
   AURELIA — Smart Safety Pendant Companion App
   Pure client-side logic. No backend. Everything persists
   to localStorage so it survives a page refresh.
   ========================================================= */

(() => {
  'use strict';

  /* ----------------------------------------------------
     STORAGE KEYS & DEFAULTS
  ---------------------------------------------------- */
  const STORAGE_KEYS = {
    CONTACTS: 'aurelia_contacts',
    SETTINGS: 'aurelia_settings',
    ACTIVITY: 'aurelia_activity',
    LOCATION: 'aurelia_last_location'
  };

  const DEFAULT_SETTINGS = {
    name: 'Aria',
    deviceName: 'Tracelet Pendant',
    battery: 87,
    autoShare: true,
    sound: true
  };

  // Starting mock coordinates (Manila, PH) — used if real GPS is unavailable.
  const MOCK_ORIGIN = { lat: 14.5547, lng: 121.0244 };

  /* ----------------------------------------------------
     STATE
  ---------------------------------------------------- */
  const state = {
    settings: loadJSON(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS),
    contacts: loadJSON(STORAGE_KEYS.CONTACTS, []),
    activity: loadJSON(STORAGE_KEYS.ACTIVITY, []),
    currentLocation: loadJSON(STORAGE_KEYS.LOCATION, MOCK_ORIGIN),
    map: null,
    marker: null,
    accuracyCircle: null,
    sosActive: false,
    simInterval: null
  };

  /* ----------------------------------------------------
     UTILITIES
  ---------------------------------------------------- */
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Failed to parse localStorage key', key, e);
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
  }

  function uid() {
    return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function formatTime(date = new Date()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str = '') {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function initials(name = '?') {
    return name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  }

  function refreshIcons() {
    if (window.lucide) lucide.createIcons();
  }

  /* ----------------------------------------------------
     TOAST NOTIFICATIONS
  ---------------------------------------------------- */
  function toast(message, type = 'info', icon = 'info') {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 mt-0.5 flex-shrink-0"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    refreshIcons();
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3800);
  }

  /* ----------------------------------------------------
     ACTIVITY LOG
  ---------------------------------------------------- */
  function logActivity(text, icon = 'circle') {
    state.activity.unshift({ text, icon, time: formatTime() });
    state.activity = state.activity.slice(0, 8);
    saveJSON(STORAGE_KEYS.ACTIVITY, state.activity);
    renderActivity();
  }

  function renderActivity() {
    const list = document.getElementById('activityLog');
    if (!state.activity.length) {
      list.innerHTML = '<li class="activity-empty">No recent activity yet — your timeline will appear here.</li>';
      return;
    }
    list.innerHTML = state.activity.map(item => `
      <li class="flex items-center gap-2.5">
        <i data-lucide="${item.icon}" class="w-3.5 h-3.5 text-gold-400 flex-shrink-0"></i>
        <span class="flex-1">${escapeHtml(item.text)}</span>
        <span class="text-xs text-slate-500">${item.time}</span>
      </li>
    `).join('');
    refreshIcons();
  }

  /* ----------------------------------------------------
     TAB NAVIGATION
  ---------------------------------------------------- */
  function initTabs() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      document.getElementById('mobileNav').classList.toggle('hidden');
    });
  }

  function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `tab-${name}`);
    });
    document.querySelectorAll('.nav-tab, .nav-tab-mobile').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    document.getElementById('mobileNav').classList.add('hidden');

    // Leaflet needs a resize nudge when its container becomes visible.
    if (name === 'map' && state.map) {
      setTimeout(() => state.map.invalidateSize(), 80);
    }
  }

  /* ----------------------------------------------------
     CLOCK
  ---------------------------------------------------- */
  function startClock() {
    const el = document.getElementById('liveClock');
    function tick() {
      const now = new Date();
      el.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + formatTime(now);
    }
    tick();
    setInterval(tick, 30000);
  }

  /* ----------------------------------------------------
     DASHBOARD / DEVICE INFO
  ---------------------------------------------------- */
  function renderDashboardInfo() {
    document.getElementById('welcomeName').textContent = `Hello, ${state.settings.name || 'there'}`;
    document.getElementById('deviceNameLabel').textContent = state.settings.deviceName || 'Tracelet Pendant';
    document.getElementById('batteryPercentLabel').textContent = `${state.settings.battery}%`;
    document.getElementById('batteryFillBar').style.width = `${state.settings.battery}%`;
    document.getElementById('contactsCountLabel').textContent = `${state.contacts.length} saved`;
  }

  // Slowly drains the mock battery over time, just for realism.
  function simulateBatteryDrain() {
    setInterval(() => {
      if (state.settings.battery > 5) {
        state.settings.battery -= 1;
        saveJSON(STORAGE_KEYS.SETTINGS, state.settings);
        renderDashboardInfo();
      }
    }, 45000);
  }

  /* ----------------------------------------------------
     GPS / MAP
  ---------------------------------------------------- */
  function initMap() {
    state.map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([state.currentLocation.lat, state.currentLocation.lng], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 19
    }).addTo(state.map);

    const goldIcon = L.divIcon({
      className: '',
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#e8c987;border:3px solid #fff;box-shadow:0 0 12px rgba(232,201,135,0.8)"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    state.marker = L.marker([state.currentLocation.lat, state.currentLocation.lng], { icon: goldIcon }).addTo(state.map);
    state.accuracyCircle = L.circle([state.currentLocation.lat, state.currentLocation.lng], {
      radius: 60,
      color: '#e8c987',
      weight: 1,
      fillColor: '#e8c987',
      fillOpacity: 0.08
    }).addTo(state.map);

    updateLocationDisplays();
  }

  function setLocation(lat, lng, persist = true) {
    state.currentLocation = { lat, lng };
    if (persist) saveJSON(STORAGE_KEYS.LOCATION, state.currentLocation);

    if (state.map && state.marker) {
      state.marker.setLatLng([lat, lng]);
      state.accuracyCircle.setLatLng([lat, lng]);
      state.map.panTo([lat, lng]);
    }
    updateLocationDisplays();
  }

  function updateLocationDisplays() {
    const { lat, lng } = state.currentLocation;
    const latStr = lat.toFixed(5);
    const lngStr = lng.toFixed(5);
    document.getElementById('latValue').textContent = latStr;
    document.getElementById('lngValue').textContent = lngStr;
    document.getElementById('lastUpdatedValue').textContent = formatTime();
    document.getElementById('locationLabel').textContent = `${latStr}, ${lngStr}`;
  }

  function useRealGps() {
    if (!('geolocation' in navigator)) {
      toast('Geolocation is not supported on this device. Using simulated location instead.', 'danger', 'alert-triangle');
      return;
    }
    toast('Requesting device location permission…', 'info', 'locate-fixed');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation(pos.coords.latitude, pos.coords.longitude);
        document.getElementById('gpsAccuracyLabel').textContent = `±${Math.round(pos.coords.accuracy)}m`;
        toast('Live GPS location acquired.', 'success', 'check-circle-2');
        logActivity('Switched to real device GPS', 'locate-fixed');
      },
      (err) => {
        toast('Could not access real GPS (' + err.message + '). Falling back to simulation.', 'danger', 'alert-triangle');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // Randomly "wanders" the pendant's position a little, to simulate movement
  // when no real device / GPS hardware is connected.
  function simulateMovement() {
    if (state.simInterval) {
      clearInterval(state.simInterval);
      state.simInterval = null;
      toast('Movement simulation stopped.', 'info', 'pause');
      return;
    }
    toast('Simulating live pendant movement…', 'info', 'shuffle');
    state.simInterval = setInterval(() => {
      const jitterLat = (Math.random() - 0.5) * 0.0015;
      const jitterLng = (Math.random() - 0.5) * 0.0015;
      setLocation(state.currentLocation.lat + jitterLat, state.currentLocation.lng + jitterLng);
    }, 2000);
  }

  /* ----------------------------------------------------
     SOS / EMERGENCY ALERT SYSTEM
  ---------------------------------------------------- */
  function triggerSos() {
    if (state.sosActive) return;
    state.sosActive = true;

    const overlay = document.getElementById('sosOverlay');
    overlay.classList.remove('hidden');
    document.getElementById('sosStatusText').textContent = 'Dispatching alert to emergency contacts…';
    document.getElementById('sosCoordsText').textContent = 'Acquiring precise location…';

    if (state.settings.sound) playAlertTone();
    logActivity('SOS triggered', 'shield-alert');

    const finishDispatch = (lat, lng) => {
      setLocation(lat, lng);
      const coordText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      document.getElementById('sosCoordsText').textContent = `Coordinates: ${coordText}`;
      dispatchMockAlerts(coordText);
    };

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => finishDispatch(pos.coords.latitude, pos.coords.longitude),
        () => finishDispatch(state.currentLocation.lat, state.currentLocation.lng),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } else {
      finishDispatch(state.currentLocation.lat, state.currentLocation.lng);
    }
  }

  function dispatchMockAlerts(coordText) {
    const statusEl = document.getElementById('sosStatusText');

    if (!state.contacts.length) {
      statusEl.textContent = 'No emergency contacts saved — add a guardian to enable alerts.';
      toast('SOS active, but you have no saved emergency contacts.', 'danger', 'user-x');
      return;
    }

    let i = 0;
    const sendNext = () => {
      if (i >= state.contacts.length) {
        statusEl.textContent = `Alert sent to all ${state.contacts.length} guardian(s) with your live coordinates.`;
        return;
      }
      const contact = state.contacts[i];
      const message = `SOS ALERT from ${state.settings.name}: I may be in danger. My current location is ${coordText}. https://maps.google.com/?q=${coordText}`;
      statusEl.textContent = `Sending to ${contact.name} (${contact.phone})…`;
      setTimeout(() => {
        logActivity(`Mock alert sent to ${contact.name}`, 'send');
        console.log('[MOCK SMS DISPATCH]', { to: contact.phone, message });
        i++;
        sendNext();
      }, 700);
    };
    sendNext();
  }

  function cancelSos() {
    state.sosActive = false;
    document.getElementById('sosOverlay').classList.add('hidden');
    if (state.simInterval) { clearInterval(state.simInterval); state.simInterval = null; }
    toast('SOS alert cancelled.', 'info', 'shield-off');
    logActivity('SOS alert cancelled', 'shield-off');
  }

  // Plays a short synthesized alert tone using the Web Audio API — no asset files needed.
  function playAlertTone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ctx.destination);
        const start = ctx.currentTime + idx * 0.28;
        osc.start(start);
        osc.stop(start + 0.22);
      });
    } catch (e) {
      console.warn('Audio alert unavailable', e);
    }
  }

  /* ----------------------------------------------------
     EMERGENCY CONTACTS (CRUD via localStorage)
  ---------------------------------------------------- */
  function renderContacts() {
    const grid = document.getElementById('contactsGrid');
    const empty = document.getElementById('contactsEmptyState');

    if (!state.contacts.length) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      document.getElementById('contactsCountLabel').textContent = '0 saved';
      return;
    }
    empty.classList.add('hidden');
    document.getElementById('contactsCountLabel').textContent = `${state.contacts.length} saved`;

    grid.innerHTML = state.contacts.map(c => `
      <div class="glass-card p-5 contact-card" data-id="${c.id}">
        <div class="flex items-start gap-3">
          <div class="contact-avatar">${initials(c.name)}</div>
          <div>
            <p class="font-semibold text-white">${escapeHtml(c.name)}</p>
            <p class="text-sm text-slate-400">${escapeHtml(c.phone)}</p>
            ${c.relation ? `<span class="inline-block mt-1.5 text-[10px] uppercase tracking-wide text-gold-400 bg-gold-400/10 px-2 py-0.5 rounded-full">${escapeHtml(c.relation)}</span>` : ''}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <button class="glass-btn w-8 h-8 rounded-full flex items-center justify-center edit-contact-btn" data-id="${c.id}" title="Edit">
            <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
          </button>
          <button class="glass-btn w-8 h-8 rounded-full flex items-center justify-center delete-contact-btn" data-id="${c.id}" title="Remove">
            <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-400"></i>
          </button>
        </div>
      </div>
    `).join('');

    refreshIcons();

    grid.querySelectorAll('.edit-contact-btn').forEach(btn =>
      btn.addEventListener('click', () => openContactModal(btn.dataset.id))
    );
    grid.querySelectorAll('.delete-contact-btn').forEach(btn =>
      btn.addEventListener('click', () => deleteContact(btn.dataset.id))
    );
  }

  function openContactModal(id = null) {
    const modal = document.getElementById('contactModal');
    const title = document.getElementById('contactModalTitle');
    const form = document.getElementById('contactForm');
    form.reset();

    if (id) {
      const contact = state.contacts.find(c => c.id === id);
      if (!contact) return;
      title.textContent = 'Edit Guardian';
      document.getElementById('contactId').value = contact.id;
      document.getElementById('contactName').value = contact.name;
      document.getElementById('contactPhone').value = contact.phone;
      document.getElementById('contactRelation').value = contact.relation || '';
    } else {
      title.textContent = 'Add Guardian';
      document.getElementById('contactId').value = '';
    }

    modal.classList.remove('hidden');
  }

  function closeContactModal() {
    document.getElementById('contactModal').classList.add('hidden');
  }

  function saveContactFromForm(e) {
    e.preventDefault();
    const id = document.getElementById('contactId').value;
    const name = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const relation = document.getElementById('contactRelation').value.trim();

    if (!name || !phone) {
      toast('Name and phone number are required.', 'danger', 'alert-triangle');
      return;
    }

    if (id) {
      const contact = state.contacts.find(c => c.id === id);
      Object.assign(contact, { name, phone, relation });
      toast(`Updated ${name}.`, 'success', 'check-circle-2');
      logActivity(`Updated guardian ${name}`, 'pencil');
    } else {
      state.contacts.push({ id: uid(), name, phone, relation });
      toast(`${name} added as a guardian.`, 'success', 'user-plus');
      logActivity(`Added guardian ${name}`, 'user-plus');
    }

    saveJSON(STORAGE_KEYS.CONTACTS, state.contacts);
    renderContacts();
    renderDashboardInfo();
    closeContactModal();
  }

  function deleteContact(id) {
    const contact = state.contacts.find(c => c.id === id);
    if (!contact) return;
    if (!confirm(`Remove ${contact.name} from your emergency contacts?`)) return;
    state.contacts = state.contacts.filter(c => c.id !== id);
    saveJSON(STORAGE_KEYS.CONTACTS, state.contacts);
    renderContacts();
    renderDashboardInfo();
    toast(`${contact.name} removed.`, 'info', 'trash-2');
    logActivity(`Removed guardian ${contact.name}`, 'trash-2');
  }

  function initContactsUI() {
    document.getElementById('openContactModalBtn').addEventListener('click', () => openContactModal());
    document.getElementById('closeContactModalBtn').addEventListener('click', closeContactModal);
    document.getElementById('cancelContactBtn').addEventListener('click', closeContactModal);
    document.getElementById('contactForm').addEventListener('submit', saveContactFromForm);
    document.getElementById('contactModal').addEventListener('click', (e) => {
      if (e.target.id === 'contactModal') closeContactModal();
    });
  }

  /* ----------------------------------------------------
     FASHION CATALOG (static demo data)
  ---------------------------------------------------- */
  // Catalog images correspond to the uploaded product renders, mapped in
  // numbering order (image 1 -> item 1, image 2 -> item 2, etc).
  const CATALOG_ITEMS = [
    { name: 'Étoile Necklace', style: 'Minimalist Pendant', image: 'assets/catalog/catalog-1.png',
      desc: 'A teardrop charm in brushed gold that houses the sensor module — everyday elegance with a hidden SOS trigger.' },
    { name: 'Noir Choker', style: 'Statement Choker', image: 'assets/catalog/catalog-2.png',
      desc: 'A matte black ceramic disc that doubles as a discreet long-press emergency button.' },
    { name: 'Lumière Brooch', style: 'Vintage Brooch', image: 'assets/catalog/catalog-3.png',
      desc: 'An art-deco inspired brooch with the alert module concealed behind a rotating petal clasp.' },
    { name: 'Bracelet Charm', style: 'Layered Bracelet', image: 'assets/catalog/catalog-4.png',
      desc: 'A small charm that clips onto any bracelet stack, vibrating discreetly when an alert is sent.' },
    { name: 'Solstice Keychain', style: 'Everyday Carry', image: 'assets/catalog/catalog-5.png',
      desc: 'A pocket-friendly variant for those who prefer carrying their safety device rather than wearing it.' },
    { name: 'Velour Ribbon Choker', style: 'Soft Statement', image: 'assets/catalog/catalog-6.png',
      desc: 'A velvet ribbon choker with a hidden gold disc module — soft texture, sharp protection.' }
  ];

  function renderCatalog() {
    const grid = document.getElementById('catalogGrid');
    grid.innerHTML = CATALOG_ITEMS.map(item => `
      <div class="glass-card p-5 catalog-card">
        <div class="catalog-image">
          <img src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy" class="catalog-img">
        </div>
        <span class="text-[10px] uppercase tracking-wider text-gold-400/80">${escapeHtml(item.style)}</span>
        <h3 class="font-display text-xl font-700 text-white mt-1 mb-2">${escapeHtml(item.name)}</h3>
        <p class="text-sm text-slate-400 leading-relaxed">${escapeHtml(item.desc)}</p>
      </div>
    `).join('');
    refreshIcons();
  }

  /* ----------------------------------------------------
     SETTINGS
  ---------------------------------------------------- */
  function renderSettingsForm() {
    document.getElementById('settingName').value = state.settings.name || '';
    document.getElementById('settingDeviceName').value = state.settings.deviceName || '';
    document.getElementById('settingAutoShare').checked = !!state.settings.autoShare;
    document.getElementById('settingSound').checked = !!state.settings.sound;
  }

  function initSettingsUI() {
    document.getElementById('settingsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      state.settings.name = document.getElementById('settingName').value.trim() || 'Aria';
      state.settings.deviceName = document.getElementById('settingDeviceName').value.trim() || 'Tracelet Pendant';
      state.settings.autoShare = document.getElementById('settingAutoShare').checked;
      state.settings.sound = document.getElementById('settingSound').checked;
      saveJSON(STORAGE_KEYS.SETTINGS, state.settings);
      renderDashboardInfo();
      toast('Settings saved.', 'success', 'check-circle-2');
      logActivity('Profile settings updated', 'settings');
    });

    document.getElementById('resetDataBtn').addEventListener('click', () => {
      if (!confirm('This will erase all contacts, activity, and settings stored in this browser. Continue?')) return;
      Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
      toast('All local data has been reset.', 'info', 'trash-2');
      setTimeout(() => location.reload(), 800);
    });
  }

  /* ----------------------------------------------------
     QUICK ACTIONS
  ---------------------------------------------------- */
  function initQuickActions() {
    document.querySelectorAll('.quick-action').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        switch (action) {
          case 'share-location':
            toast('Location link copied (simulated) — ready to share with your guardians.', 'success', 'share-2');
            logActivity('Shared current location', 'share-2');
            break;
          case 'check-in':
            toast('Safe check-in sent to your guardians.', 'success', 'check-circle-2');
            logActivity('Sent a safe check-in', 'check-circle-2');
            break;
          case 'goto-contacts':
            switchTab('contacts');
            break;
          case 'goto-map':
            switchTab('map');
            break;
        }
      });
    });
  }

  /* ----------------------------------------------------
     SOS BUTTON BINDINGS
  ---------------------------------------------------- */
  function initSosUI() {
    document.getElementById('sosTriggerBtn').addEventListener('click', triggerSos);
    document.getElementById('cancelSosBtn').addEventListener('click', cancelSos);
    document.getElementById('useRealGpsBtn').addEventListener('click', useRealGps);
    document.getElementById('simulateMoveBtn').addEventListener('click', simulateMovement);
  }

  /* ----------------------------------------------------
     INIT
  ---------------------------------------------------- */
  function init() {
    refreshIcons();
    initTabs();
    initContactsUI();
    initSettingsUI();
    initQuickActions();
    initSosUI();

    startClock();
    renderDashboardInfo();
    renderContacts();
    renderCatalog();
    renderSettingsForm();
    renderActivity();
    simulateBatteryDrain();

    initMap();

    if (!state.contacts.length) {
      logActivity('Welcome to Aurelia — add your first guardian to get started', 'sparkles');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
