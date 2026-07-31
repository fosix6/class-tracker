(function() {
  // ----- constants & state -----
  const STORAGE_KEY = 'tardiness-tracker-v1';
  const SYNC_KEY_PREFIX = 'tardiness-sync-';

  let state = loadState();
  let view = { screen: 'home', sublistId: null, showModal: false };
  let modalState = { jurusan: '', kelas: '', filter: '', selectedStudent: null };
  let students = [];
  let uniqueJurusan = [];
  let uniqueKelas = [];
  let deferredPrompt = null;
  let gun = null;
  let syncEnabled = false;
  let deviceId = '';
  let roomCode = localStorage.getItem('room-code') || '';
  let isSyncing = false;

  // ----- Room Code Setup -----
  function getSyncKey() {
    if (!roomCode) return null;
    return SYNC_KEY_PREFIX + roomCode;
  }

  function setRoomCode(code) {
    roomCode = code.trim().toUpperCase();
    localStorage.setItem('room-code', roomCode);
    if (gun) {
      gun.get(getSyncKey()).off();
      broadcastState();
    }
  }

  // ----- PWA Installation -----
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById('installBanner');
    if (banner) banner.style.display = 'flex';
  });

  window.addEventListener('appinstalled', () => {
    const banner = document.getElementById('installBanner');
    if (banner) banner.style.display = 'none';
  });

  document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const result = await deferredPrompt.userChoice;
          if (result.outcome === 'accepted') {
            const banner = document.getElementById('installBanner');
            if (banner) banner.style.display = 'none';
          }
          deferredPrompt = null;
        }
      });
    }
  });

  // ----- helpers -----
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { sublists: [] };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.sublists)) parsed.sublists = [];
      return parsed;
    } catch { return { sublists: [] }; }
  }
  
  function saveState() {
    try { 
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (syncEnabled) {
        broadcastState();
      }
    } catch (e) { 
      alert('Gagal menyimpan data.'); 
    }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function todayISO() { return new Date().toISOString().slice(0,10); }
  function formatDate(iso) {
    if (!iso) return 'Tanpa tanggal';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
  }
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  }
  function formatFullDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' }) + ' ' + 
           d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  }
  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ----- FUZZY SEARCH -----
  function fuzzySearch(query, text) {
    if (!query || query.length === 0) return true;
    const q = query.toLowerCase().trim();
    const t = text.toLowerCase().trim();
    
    if (t.includes(q)) return true;
    
    const queryWords = q.split(/\s+/);
    const textWords = t.split(/\s+/);
    
    for (const qWord of queryWords) {
      if (qWord.length < 2) continue;
      for (const tWord of textWords) {
        if (tWord.startsWith(qWord)) return true;
        if (tWord.includes(qWord)) return true;
      }
    }
    
    const allWordsMatch = queryWords.every(qWord => {
      if (qWord.length < 2) return true;
      return textWords.some(tWord => tWord.includes(qWord));
    });
    if (allWordsMatch) return true;
    
    let i = 0;
    for (let j = 0; j < t.length && i < q.length; j++) {
      if (t[j] === q[i]) i++;
    }
    if (i === q.length) return true;
    
    return false;
  }

  // ----- Helper: Check if a student matches a jurusan filter -----
  function studentMatchesJurusan(student, filterJurusan) {
    if (!filterJurusan) return true;
    const studentJurusanList = student.jurusan.split('/').map(j => j.trim());
    return studentJurusanList.includes(filterJurusan);
  }

  // ----- CSV Upload -----
  function parseCSVText(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return false;
    const header = lines[0].split(',').map(s => s.trim());
    const idx = { NID: -1, Nama: -1, Kelas: -1, Jurusan: -1 };
    header.forEach((h,i) => { 
      const clean = h.trim();
      if (clean === 'NID') idx.NID=i; 
      else if (clean === 'Nama') idx.Nama=i; 
      else if (clean === 'Kelas') idx.Kelas=i; 
      else if (clean === 'Jurusan') idx.Jurusan=i; 
    });
    if (idx.NID === -1 || idx.Nama === -1 || idx.Kelas === -1 || idx.Jurusan === -1) {
      return false;
    }
    const newStudents = [];
    for (let i=1; i<lines.length; i++) {
      const parts = lines[i].split(',').map(s => s.trim());
      if (parts.length < 4) continue;
      newStudents.push({
        nid: parts[idx.NID],
        nama: parts[idx.Nama],
        kelas: parts[idx.Kelas],
        jurusan: parts[idx.Jurusan]
      });
    }
    if (newStudents.length === 0) return false;
    
    students = newStudents;
    
    const jurusanSet = new Set();
    const kelasSet = new Set();
    students.forEach(s => {
      const parts = s.jurusan.split('/').map(j => j.trim());
      parts.forEach(p => jurusanSet.add(p));
      if (s.kelas) kelasSet.add(s.kelas);
    });
    uniqueJurusan = Array.from(jurusanSet).sort();
    uniqueKelas = Array.from(kelasSet).sort();
    
    localStorage.setItem('cached-students', JSON.stringify(students));
    localStorage.setItem('cached-jurusan', JSON.stringify(uniqueJurusan));
    localStorage.setItem('cached-kelas', JSON.stringify(uniqueKelas));
    
    return true;
  }

  function loadCachedStudents() {
    try {
      const cached = localStorage.getItem('cached-students');
      if (cached) {
        students = JSON.parse(cached);
        uniqueJurusan = JSON.parse(localStorage.getItem('cached-jurusan') || '[]');
        uniqueKelas = JSON.parse(localStorage.getItem('cached-kelas') || '[]');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function handleCSVUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (parseCSVText(text)) {
        showToast('✅ ' + students.length + ' siswa berhasil dimuat!');
        render();
      } else {
        showToast('❌ Format CSV tidak valid. Pastikan kolom: NID,Nama,Kelas,Jurusan');
      }
    };
    reader.onerror = () => showToast('❌ Gagal membaca file');
    reader.readAsText(file);
  }

  // ----- Gun.js Sync with Room Code -----
  function initGun() {
    try {
      deviceId = localStorage.getItem('device-id') || 'device-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      localStorage.setItem('device-id', deviceId);

      gun = Gun(['https://gun-manhattan.herokuapp.com/gun']);
      syncEnabled = true;
      console.log('✅ Gun.js initialized with device ID:', deviceId);

      const savedRoom = localStorage.getItem('room-code');
      if (savedRoom) {
        roomCode = savedRoom;
        setupSyncListener();
      }

      return true;
    } catch (e) {
      console.warn('⚠️ Gun.js initialization failed:', e);
      syncEnabled = false;
      return false;
    }
  }

  function setupSyncListener() {
    const key = getSyncKey();
    if (!key || !gun) return;
    
    gun.get(key).off();
    
    gun.get(key).on((data, key) => {
      if (data && data.sublists && data._deviceId !== deviceId) {
        console.log('📡 Remote data received from:', data._deviceId, 'room:', roomCode);
        mergeRemoteData(data);
      }
    });
    
    broadcastState();
  }

  function broadcastState() {
    if (!syncEnabled || !gun || !roomCode) return;
    const key = getSyncKey();
    if (!key) return;
    
    const data = JSON.parse(JSON.stringify(state));
    data._deviceId = deviceId;
    data._timestamp = Date.now();
    data._room = roomCode;
    gun.get(key).put(data);
  }

  function mergeRemoteData(remoteData) {
    if (!remoteData || !remoteData.sublists || isSyncing) return;
    isSyncing = true;
    
    let changed = false;
    
    remoteData.sublists.forEach(remoteSub => {
      const localSub = state.sublists.find(s => s.id === remoteSub.id);
      if (!localSub) {
        state.sublists.push(JSON.parse(JSON.stringify(remoteSub)));
        changed = true;
      } else {
        remoteSub.entries.forEach(remoteEntry => {
          const localEntry = localSub.entries.find(e => e.id === remoteEntry.id);
          if (!localEntry) {
            localSub.entries.push(JSON.parse(JSON.stringify(remoteEntry)));
            changed = true;
          }
        });
      }
    });

    if (changed) {
      saveState();
      render();
      showToast('🔄 Data tersinkron dari perangkat lain!');
    }
    
    isSyncing = false;
  }

  // ----- Room Code Dialog -----
  function showRoomDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>🔑 Kode Ruangan</h2>
        <p style="color:#6b7d92; margin-bottom:0.5rem;">Masukkan kode yang sama di semua perangkat untuk sinkronisasi.</p>
        <label>
          Kode Ruangan
          <input type="text" id="roomCodeInput" placeholder="Contoh: KELAS10A" value="${roomCode}" maxlength="20" style="text-transform:uppercase;" />
        </label>
        <div style="margin-top:0.5rem; display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn" id="roomCancelBtn">Batal</button>
          <button class="primary" id="roomSaveBtn">Simpan</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById('roomCodeInput');
    document.getElementById('roomCancelBtn').onclick = () => overlay.remove();
    document.getElementById('roomSaveBtn').onclick = () => {
      const code = input.value.trim().toUpperCase();
      if (code) {
        setRoomCode(code);
        setupSyncListener();
        showToast('✅ Kode ruangan: ' + code);
        overlay.remove();
        render();
      } else {
        showToast('❌ Masukkan kode ruangan');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('roomSaveBtn').click();
    });
    setTimeout(() => input.focus(), 100);
  }

  // ----- load students from CSV or cache -----
  async function loadStudents() {
    if (loadCachedStudents()) {
      console.log('📊 Loaded ' + students.length + ' students from cache');
      return true;
    }
    
    try {
      const resp = await fetch('students.csv');
      if (!resp.ok) throw new Error('file not found');
      const text = await resp.text();
      if (parseCSVText(text)) {
        console.log('✅ Loaded ' + students.length + ' students from students.csv');
        return true;
      }
    } catch (e) {
      console.warn('⚠️ students.csv tidak ditemukan');
    }
    
    const defaultData = `NID,Nama,Kelas,Jurusan
2627.10.001,Abdul Jabbar Ibnu Malik,10,TKJ
2627.10.041,Abimanyu Wiguna,10,RPL
2627.10.124,Abelia Septiani Putri,10,DKV
2627.10.162,Agni Farren Sabiya,10,KKR
2526.10.036,Abdurrahman,11,RPL
2526.10.001,Alanis Sabrina Suharman,11,TKJ/DKV
2526.10.072,Alifia Chalista,11,KKR
2425.10.035,Abib Brenatanta Tarigan,12,RPL
2425.10.001,Abdul Patah,12,TKJ/PSPT
2425.10.074,Aida Hidayanti Lestari,12,DKV
2425.10.110,Alfira Rahmawati,12,KKR`;
    parseCSVText(defaultData);
    console.log('📊 Using default data with ' + students.length + ' students');
    return true;
  }

  // ----- render engine -----
  const app = document.getElementById('app');

  function render() {
    if (view.screen === 'sublist' && view.sublistId) {
      renderSublistDetail(view.sublistId);
    } else if (view.screen === 'analysis') {
      renderAnalysis();
    } else if (view.screen === 'studentDetail' && view.studentNid) {
      renderStudentDetail(view.studentNid);
    } else {
      renderHome();
    }
    const existingModal = document.querySelector('.modal-overlay');
    if (existingModal) existingModal.remove();
    if (view.showModal) {
      renderModal();
    }
  }

  // ----- HOME: daftar sublist -----
  function renderHome() {
    const sublists = state.sublists.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    let listHtml = sublists.length === 0 ? `<div class="empty">Belum ada daftar. Buat baru di bawah.</div>` :
      sublists.map(s => {
        const count = (s.entries || []).length;
        return `<div class="card" style="cursor:pointer;" data-id="${s.id}">
          <div class="card-header">
            <span class="card-title">${formatDate(s.date)}</span>
            <span class="card-sub">${count} siswa</span>
          </div>
          <div class="flex">
            <span class="tag">${s.createdAt ? formatTime(s.createdAt) : ''}</span>
            <button class="danger" style="margin-left:auto; padding:0.3rem 0.8rem; font-size:0.75rem;" data-action="delete-sublist" data-id="${s.id}">Hapus</button>
          </div>
        </div>`;
      }).join('');

    const syncStatus = syncEnabled && roomCode ? 
      `<span class="sync-status online"><span class="sync-dot online"></span> ${roomCode}</span>` :
      `<span class="sync-status offline"><span class="sync-dot offline"></span> Offline</span>`;

    const studentCount = students.length > 0 ? `${students.length} siswa` : 'Belum ada data siswa';

    app.innerHTML = `
      <header>
        <h1>⏰ Pencatatan Terlambat</h1>
        <button class="primary" id="newSublistBtn">+ Daftar Baru</button>
      </header>
      <div style="margin-bottom:1rem; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button class="btn" id="analysisBtn">📊 Analisis</button>
        <button class="btn warning" id="roomBtn" style="font-size:0.7rem; padding:0.3rem 0.8rem;">🔑 ${roomCode || 'Setel Kode'}</button>
        <span style="font-size:0.8rem; color:#6b7d92; align-self:center;">${studentCount}</span>
        ${syncStatus}
      </div>
      
      <div class="card" style="padding:0.8rem;">
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <span style="font-size:0.8rem; color:#6b7d92;">📂 Upload data siswa:</span>
          <div class="file-input-wrapper">
            <button class="btn" style="font-size:0.8rem; padding:0.3rem 0.8rem;">Pilih CSV</button>
            <input type="file" id="csvUploadInput" accept=".csv" />
          </div>
          <span style="font-size:0.7rem; color:#6b7d92;">(CSV: NID,Nama,Kelas,Jurusan)</span>
        </div>
      </div>
      
      ${listHtml}
      <div style="margin-top:1rem; font-size:0.8rem; color:#6b7d92; text-align:center;">Total daftar: ${sublists.length}</div>
    `;

    document.getElementById('newSublistBtn').onclick = () => {
      if (students.length === 0) {
        showToast('⚠️ Upload data siswa terlebih dahulu!');
        return;
      }
      const newSub = { id: uid(), date: todayISO(), createdAt: new Date().toISOString(), entries: [] };
      state.sublists.push(newSub);
      saveState();
      render();
    };
    document.getElementById('analysisBtn').onclick = () => { view.screen = 'analysis'; render(); };
    document.getElementById('roomBtn').onclick = showRoomDialog;

    document.getElementById('csvUploadInput').onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        handleCSVUpload(file);
      }
      e.target.value = '';
    };

    app.querySelectorAll('[data-action="delete-sublist"]').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); if (confirm('Hapus daftar ini?')) { state.sublists = state.sublists.filter(s => s.id !== btn.dataset.id); saveState(); render(); } };
    });
    app.querySelectorAll('.card[data-id]').forEach(card => {
      card.onclick = () => { view.screen = 'sublist'; view.sublistId = card.dataset.id; render(); };
    });
  }

  // ----- SUBLIST DETAIL -----
  function renderSublistDetail(id) {
    const sub = state.sublists.find(s => s.id === id);
    if (!sub) { view.screen = 'home'; render(); return; }
    const entries = sub.entries || [];
    const sorted = entries.slice().sort((a,b) => a.timestamp.localeCompare(b.timestamp));

    let entriesHtml = sorted.length === 0 ? `<div class="empty">Belum ada siswa tercatat terlambat.</div>` :
      sorted.map(e => {
        const student = students.find(s => s.nid === e.nid);
        const nama = student ? student.nama : e.nid;
        const kelas = student ? student.kelas : '-';
        const jurusan = student ? student.jurusan : '-';
        const reason = e.reason || '';
        return `<div class="list-item">
          <div>
            <strong>${nama}</strong> 
            <span class="tag">${kelas} ${jurusan}</span>
            ${reason ? `<span class="reason-tag" title="${reason}">💬 ${reason}</span>` : ''}
          </div>
          <div class="flex">
            <span class="time-tag">${formatTime(e.timestamp)}</span>
            <button class="danger" style="padding:0.1rem 0.6rem; font-size:0.7rem;" data-action="delete-entry" data-entryid="${e.id}">✕</button>
          </div>
        </div>`;
      }).join('');

    app.innerHTML = `
      <header>
        <div><button class="btn" id="backHomeBtn">← Kembali</button></div>
        <button class="primary" id="addLateBtn">+ Catat Terlambat</button>
      </header>
      <div class="card">
        <div class="card-header"><span class="card-title">${formatDate(sub.date)}</span>
          <span class="card-sub">${sorted.length} siswa</span>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:0.3rem;">
          <button class="btn" id="exportCsvBtn">📥 Export CSV</button>
          <button class="btn success" id="exportTextBtn">📋 Export Text</button>
        </div>
        ${entriesHtml}
      </div>
    `;

    document.getElementById('backHomeBtn').onclick = () => { view.screen = 'home'; render(); };
    document.getElementById('addLateBtn').onclick = () => { 
      if (students.length === 0) {
        showToast('⚠️ Upload data siswa terlebih dahulu!');
        return;
      }
      view.showModal = true; 
      modalState = { jurusan: '', kelas: '', filter: '', selectedStudent: null };
      render(); 
    };
    document.getElementById('exportCsvBtn').onclick = () => exportSublistCSV(sub);
    document.getElementById('exportTextBtn').onclick = () => exportSublistText(sub);

    app.querySelectorAll('[data-action="delete-entry"]').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); if (confirm('Hapus catatan ini?')) { sub.entries = sub.entries.filter(ent => ent.id !== btn.dataset.entryid); saveState(); render(); } };
    });
  }

  // ----- MODAL: pilih jurusan + kelas, daftar nama, dan alasan -----
  function renderModal() {
    const individualJurusans = uniqueJurusan;
    let filtered = students;
    if (modalState.jurusan) filtered = filtered.filter(s => studentMatchesJurusan(s, modalState.jurusan));
    if (modalState.kelas) filtered = filtered.filter(s => s.kelas === modalState.kelas);
    if (modalState.filter) filtered = filtered.filter(s => fuzzySearch(modalState.filter, s.nama));

    const nameBtns = filtered.map(s => `<div class="name-btn" data-nid="${s.nid}" data-nama="${s.nama}" data-kelas="${s.kelas}" data-jurusan="${s.jurusan}">${s.nama}</div>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>📌 Catat Terlambat</h2>
        <div class="filter-row">
          <select id="modalJurusanSelect">
            <option value="">Semua Jurusan</option>
            ${individualJurusans.map(j => `<option value="${j}" ${j===modalState.jurusan?'selected':''}>${j}</option>`).join('')}
          </select>
          <select id="modalKelasSelect">
            <option value="">Semua Kelas</option>
            ${uniqueKelas.map(k => `<option value="${k}" ${k===modalState.kelas?'selected':''}>${k}</option>`).join('')}
          </select>
        </div>
        <input class="search-box" id="modalFilterInput" placeholder="Cari nama (fuzzy)..." value="${modalState.filter}" autofocus />
        <div class="student-count">${filtered.length} dari ${students.length} siswa</div>
        <div class="name-grid" id="nameGrid">${nameBtns || '<div class="empty" style="grid-column:1/-1;">Tidak ada siswa</div>'}</div>
        
        <div style="margin-top:0.8rem;">
          <label style="font-size:0.85rem; font-weight:500; color:#2c3e55;">Alasan (opsional)</label>
          <textarea id="modalReasonInput" placeholder="Mis: Macet, bangun kesiangan, dll..." rows="2" style="width:100%; padding:0.7rem 0.8rem; border:1px solid #d0d8e0; border-radius:16px; font-size:1rem; background:#f8faff; font-family:inherit; resize:vertical; min-height:50px;"></textarea>
        </div>
        
        <div style="margin-top:0.8rem; display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn" id="modalCloseBtn">Batal</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('modalCloseBtn').onclick = () => { view.showModal = false; render(); };
    
    const jurusanSelect = document.getElementById('modalJurusanSelect');
    const kelasSelect = document.getElementById('modalKelasSelect');
    const filterInput = document.getElementById('modalFilterInput');
    const reasonInput = document.getElementById('modalReasonInput');
    
    jurusanSelect.onchange = (e) => { 
      modalState.jurusan = e.target.value; 
      updateModalContent();
    };
    kelasSelect.onchange = (e) => { 
      modalState.kelas = e.target.value; 
      updateModalContent();
    };
    filterInput.oninput = (e) => { 
      modalState.filter = e.target.value; 
      updateModalContent();
    };

    setTimeout(() => filterInput.focus(), 50);

    attachNameButtonHandlers(reasonInput);

    function updateModalContent() {
      let filtered2 = students;
      if (modalState.jurusan) filtered2 = filtered2.filter(s => studentMatchesJurusan(s, modalState.jurusan));
      if (modalState.kelas) filtered2 = filtered2.filter(s => s.kelas === modalState.kelas);
      if (modalState.filter) filtered2 = filtered2.filter(s => fuzzySearch(modalState.filter, s.nama));

      const grid = document.getElementById('nameGrid');
      const countDisplay = document.querySelector('.student-count');
      if (!grid) return;
      
      if (countDisplay) {
        countDisplay.textContent = `${filtered2.length} dari ${students.length} siswa`;
      }
      
      if (filtered2.length === 0) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">Tidak ada siswa</div>';
        return;
      }
      
      grid.innerHTML = filtered2.map(s => 
        `<div class="name-btn" data-nid="${s.nid}" data-nama="${s.nama}" data-kelas="${s.kelas}" data-jurusan="${s.jurusan}">${s.nama}</div>`
      ).join('');
      
      const currentReason = document.getElementById('modalReasonInput');
      attachNameButtonHandlers(currentReason);
    }

    function attachNameButtonHandlers(reasonField) {
      document.querySelectorAll('.name-btn').forEach(btn => {
        btn.onclick = () => {
          const nid = btn.dataset.nid;
          const sub = state.sublists.find(s => s.id === view.sublistId);
          if (!sub) return;
          
          const reason = reasonField ? reasonField.value.trim() : '';
          
          const existingIndex = sub.entries.findIndex(entry => entry.nid === nid);
          
          if (existingIndex !== -1) {
            sub.entries[existingIndex] = {
              ...sub.entries[existingIndex],
              timestamp: new Date().toISOString(),
              reason: reason || ''
            };
            showToast('✅ Data siswa diperbarui!');
          } else {
            sub.entries.push({ 
              id: uid(), 
              nid, 
              timestamp: new Date().toISOString(),
              reason: reason || '' 
            });
            showToast('✅ Siswa berhasil dicatat!');
          }
          
          saveState();
          view.showModal = false;
          render();
        };
      });
    }
  }

  // ----- EXPORT CSV -----
  function exportSublistCSV(sub) {
    const entries = sub.entries || [];
    const rows = [['NID', 'Nama', 'Kelas', 'Jurusan', 'Waktu Kedatangan', 'Alasan']];
    entries.forEach(e => {
      const s = students.find(st => st.nid === e.nid);
      const nama = s ? s.nama : e.nid;
      const kelas = s ? s.kelas : '-';
      const jurusan = s ? s.jurusan : '-';
      rows.push([e.nid, nama, kelas, jurusan, formatFullDateTime(e.timestamp), e.reason || '']);
    });
    const csv = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terlambat_${sub.date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✅ CSV berhasil diexport!');
  }

  // ----- EXPORT TEXT (copy to clipboard) -----
  function exportSublistText(sub) {
    const entries = sub.entries || [];
    if (entries.length === 0) {
      showToast('⚠️ Tidak ada data untuk diexport');
      return;
    }

    const sorted = entries.slice().sort((a,b) => a.timestamp.localeCompare(b.timestamp));
    
    let text = `📋 DAFTAR SISWA TERLAMBAT\n`;
    text += `📅 Tanggal: ${formatDate(sub.date)}\n`;
    text += `👥 Total: ${sorted.length} siswa\n\n`;
    
    sorted.forEach((e, index) => {
      const s = students.find(st => st.nid === e.nid);
      const nama = s ? s.nama : e.nid;
      const kelas = s ? s.kelas : '-';
      const jurusan = s ? s.jurusan : '-';
      const waktu = formatFullDateTime(e.timestamp);
      const reason = e.reason || '-';
      
      text += `${index + 1}. ${nama} (${kelas} ${jurusan}) - ${waktu}`;
      if (reason !== '-') text += ` - Alasan: ${reason}`;
      text += `\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ Teks berhasil disalin ke clipboard!');
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('✅ Teks berhasil disalin ke clipboard!');
    });
  }

  // ----- STUDENT DETAIL -----
  function renderStudentDetail(nid) {
    const student = students.find(s => s.nid === nid);
    if (!student) { view.screen = 'analysis'; render(); return; }

    const allEntries = [];
    state.sublists.forEach(sub => {
      (sub.entries || []).forEach(e => {
        if (e.nid === nid) {
          allEntries.push({ ...e, subDate: sub.date });
        }
      });
    });

    const sorted = allEntries.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
    const total = sorted.length;

    let entriesHtml = sorted.length === 0 ? 
      `<div class="empty">Belum ada catatan keterlambatan untuk siswa ini.</div>` :
      sorted.map(e => {
        const date = formatDate(e.subDate);
        const waktu = formatFullDateTime(e.timestamp);
        const reason = e.reason || 'Tidak ada alasan';
        return `<div class="detail-item">
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px;">
            <span><strong>${date}</strong></span>
            <span class="time-tag">${waktu}</span>
          </div>
          <div class="detail-reason">💬 ${reason}</div>
        </div>`;
      }).join('');

    app.innerHTML = `
      <header>
        <button class="btn" id="backFromStudentDetail">← Kembali</button>
        <h1 style="font-size:1.2rem;">${student.nama}</h1>
      </header>
      <div class="card">
        <div class="card-header">
          <span class="card-title">📋 Riwayat Keterlambatan</span>
          <span class="card-sub">${total} kali</span>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:0.5rem;">
          <span class="tag">${student.kelas}</span>
          <span class="tag">${student.jurusan}</span>
          <span class="tag">NID: ${student.nid}</span>
        </div>
        ${entriesHtml}
      </div>
    `;

    document.getElementById('backFromStudentDetail').onclick = () => { 
      view.screen = 'analysis'; 
      render(); 
    };
  }

  // ----- ANALYSIS -----
  function renderAnalysis() {
    const allEntries = [];
    state.sublists.forEach(sub => {
      (sub.entries || []).forEach(e => {
        allEntries.push({ ...e, subDate: sub.date });
      });
    });

    const map = new Map();
    allEntries.forEach(e => {
      const s = students.find(st => st.nid === e.nid);
      const nama = s ? s.nama : e.nid;
      const key = e.nid;
      if (!map.has(key)) map.set(key, { nid: e.nid, nama, count: 0, details: [] });
      const rec = map.get(key);
      rec.count += 1;
      rec.details.push({ tanggal: e.subDate, waktu: e.timestamp, reason: e.reason || '' });
    });

    const sorted = Array.from(map.values()).sort((a,b) => b.count - a.count);
    const total = allEntries.length;
    const unique = sorted.length;

    let topHtml = sorted.slice(0,5).map((item, idx) => {
      const emoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}.`;
      return `<div class="list-item" style="cursor:pointer;" data-nid="${item.nid}">
        <span>${emoji} ${item.nama}</span> 
        <span class="tag">${item.count} kali</span>
      </div>`;
    }).join('');

    app.innerHTML = `
      <header>
        <button class="btn" id="backHomeFromAnalysis">← Kembali</button>
        <h1 style="font-size:1.2rem;">📊 Analisis</h1>
      </header>
      <div class="card">
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-number">${total}</div><div class="stat-label">Total keterlambatan</div></div>
          <div class="stat-card"><div class="stat-number">${unique}</div><div class="stat-label">Siswa unik</div></div>
        </div>
        <div style="font-size:0.8rem; color:#4a5b6e;">Rata-rata: ${unique ? (total/unique).toFixed(1) : 0} per siswa</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">🏆 Paling sering terlambat</span></div>
        ${topHtml || '<div class="empty">Belum ada data</div>'}
      </div>
      <div class="card" style="max-height:200px; overflow-y:auto;">
        <div class="card-header"><span class="card-title">Semua siswa</span></div>
        ${sorted.map(item => `<div class="list-item" style="cursor:pointer;" data-nid="${item.nid}">
          <span>${item.nama}</span>
          <span class="tag">${item.count} kali</span>
        </div>`).join('') || '<div class="empty">Tidak ada</div>'}
      </div>
      <div style="font-size:0.7rem; color:#6b7d92; text-align:center; margin-top:0.5rem;">👆 Klik nama siswa untuk melihat alasan keterlambatan</div>
    `;

    document.getElementById('backHomeFromAnalysis').onclick = () => { view.screen = 'home'; render(); };

    app.querySelectorAll('.list-item[data-nid]').forEach(item => {
      item.onclick = () => {
        view.screen = 'studentDetail';
        view.studentNid = item.dataset.nid;
        render();
      };
    });
  }

  // ----- init -----
  async function init() {
    await loadStudents();
    console.log('✅ Students loaded:', students.length);
    initGun();
    render();
  }

  // service worker (PWA)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('✅ Service Worker registered'))
        .catch(err => console.log('❌ Service Worker registration failed:', err));
    });
  }

  init();
})();