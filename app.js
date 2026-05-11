const GRID_KEY = 'bikeSpotLogger.defaultGrid.v1';
const LEGACY_STORAGE_KEY = 'bikeSpotLogger.spots.v1';
const DB_NAME = 'bikeSpotLoggerDB';
const DB_VERSION = 1;
const SPOTS_STORE = 'spots';

let spots = [];
let photoDataUrl = '';
let dbPromise = null;

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `spot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showMessage(message, type = 'info') {
  const el = document.getElementById('appMessage');
  if (!el) {
    if (type === 'error') alert(message);
    return;
  }
  el.textContent = message;
  el.className = `app-message ${type}`;
  el.classList.remove('hidden');
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => el.classList.add('hidden'), 4500);
}

const $ = (id) => document.getElementById(id);
const form = $('spotForm');
const defaultGridInput = $('defaultGrid');
const gridNameInput = $('gridName');
const spotNameInput = $('spotName');
const bikeCapacityInput = $('bikeCapacity');
const spotCategoryInput = $('spotCategory');
const demandInput = $('demand');
const appManagedInput = $('appManaged');
const appSpotNameInput = $('appSpotName');
const appSpotNameField = $('appSpotNameField');
const governmentDesignatedInput = $('governmentDesignated');
const descriptionInput = $('description');
const latitudeInput = $('latitude');
const longitudeInput = $('longitude');
const editingIdInput = $('editingId');
const photoInput = $('photoInput');
const photoPreview = $('photoPreview');
const photoPreviewWrap = $('photoPreviewWrap');
const totalSpots = $('totalSpots');
const spotsList = $('spotsList');
const searchInput = $('searchInput');
const categoryFilter = $('categoryFilter');
const reportDateFromInput = $('reportDateFrom');
const reportDateToInput = $('reportDateTo');
const importJsonInput = $('importJsonInput');

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is not supported in this browser.'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SPOTS_STORE)) {
        const store = db.createObjectStore(SPOTS_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('gridName', 'gridName', { unique: false });
        store.createIndex('spotCategory', 'spotCategory', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
  });
  return dbPromise;
}

async function getAllSpotsFromDb() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SPOTS_STORE, 'readonly');
    const store = tx.objectStore(SPOTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Could not read spots.'));
  });
}

async function putSpotInDb(spot) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SPOTS_STORE, 'readwrite');
    tx.objectStore(SPOTS_STORE).put(spot);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Could not save spot.'));
  });
}

async function deleteSpotFromDb(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SPOTS_STORE, 'readwrite');
    tx.objectStore(SPOTS_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Could not delete spot.'));
  });
}

async function replaceAllSpotsInDb(nextSpots) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SPOTS_STORE, 'readwrite');
    const store = tx.objectStore(SPOTS_STORE);
    store.clear();
    nextSpots.forEach((spot) => store.put(spot));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('Could not replace spots.'));
  });
}

async function migrateLegacyLocalStorage() {
  const migratedKey = 'bikeSpotLogger.indexedDbMigrated.v1';
  if (localStorage.getItem(migratedKey) === 'true') return;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '[]');
    if (Array.isArray(legacy) && legacy.length) {
      const existing = await getAllSpotsFromDb();
      const existingIds = new Set(existing.map((spot) => spot.id));
      const merged = [...existing, ...legacy.map(normalizeImportedSpot).filter((spot) => !existingIds.has(spot.id))];
      await replaceAllSpotsInDb(merged);
    }
    localStorage.setItem(migratedKey, 'true');
  } catch (error) {
    console.warn('Legacy migration skipped:', error);
  }
}

async function refreshSpots(options = {}) {
  try {
    spots = await getAllSpotsFromDb();
    renderSpots();
    if (options.successMessage) showMessage(options.successMessage, 'success');
  } catch (error) {
    console.error(error);
    showMessage('Could not load saved spots from browser database.', 'error');
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
}
function categoryClass(category) {
  return {
    'Government Designated': 'gov',
    'Company Station': 'company',
    'High Demand Spot': 'high',
    'Temporary Opportunity': 'temp',
    'Do Not Use / Risky': 'risky'
  }[category] || 'neutral';
}
function mapsUrl(lat, lng) {
  return lat && lng ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat)},${encodeURIComponent(lng)}` : '';
}
function formatDate(iso) {
  try { return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
  catch { return iso || ''; }
}
function localDateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function normalizeImportedSpot(rawSpot) {
  const now = new Date().toISOString();
  const lat = rawSpot.latitude || '';
  const lng = rawSpot.longitude || '';
  return {
    id: rawSpot.id || makeId(),
    gridName: rawSpot.gridName || '',
    spotName: rawSpot.spotName || 'Imported Spot',
    latitude: lat,
    longitude: lng,
    googleMapsUrl: rawSpot.googleMapsUrl || mapsUrl(lat, lng),
    photoDataUrl: rawSpot.photoDataUrl || '',
    bikeCapacity: rawSpot.bikeCapacity || '',
    spotCategory: rawSpot.spotCategory || 'High Demand Spot',
    demand: rawSpot.demand || 'Null',
    appManaged: rawSpot.appManaged || 'No',
    appSpotName: rawSpot.appSpotName || '',
    governmentDesignated: rawSpot.governmentDesignated || 'No',
    observations: Array.isArray(rawSpot.observations) ? rawSpot.observations : [],
    description: rawSpot.description || '',
    createdAt: rawSpot.createdAt || now,
    updatedAt: rawSpot.updatedAt || now
  };
}
function getSelectedObservations() {
  return Array.from(document.querySelectorAll('#observationsGroup input[type="checkbox"]:checked')).map((input) => input.value);
}
function setSelectedObservations(values) {
  const selected = Array.isArray(values) ? values : [];
  document.querySelectorAll('#observationsGroup input[type="checkbox"]').forEach((input) => {
    input.checked = selected.includes(input.value);
  });
}
function displayNA(value) {
  return value && String(value).trim() ? String(value).trim() : 'N/A';
}
function toggleAppSpotNameField() {
  const isInApp = appManagedInput.value === 'Yes';
  appSpotNameField.classList.toggle('hidden', !isInApp);
  appSpotNameInput.required = isInApp;
  if (!isInApp) appSpotNameInput.value = '';
}
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function setDefaultGrid() {
  const grid = defaultGridInput.value.trim();
  localStorage.setItem(GRID_KEY, grid);
  $('gridStatus').textContent = grid ? `Current Grid: ${grid}` : 'Set this once at the beginning of your walk. New spots will inherit it automatically.';
  if (!gridNameInput.value.trim()) gridNameInput.value = grid;
}
function resetForm() {
  form.reset();
  editingIdInput.value = '';
  $('formTitle').textContent = 'Add New Spot';
  $('saveSpotBtn').textContent = 'Save Spot';
  photoDataUrl = '';
  photoPreview.src = '';
  photoInput.value = '';
  photoPreviewWrap.classList.add('hidden');
  $('locationStatus').textContent = 'No location captured yet.';
  gridNameInput.value = localStorage.getItem(GRID_KEY) || '';
  spotCategoryInput.value = 'Government Designated';
  demandInput.value = 'Null';
  appManagedInput.value = 'No';
  appSpotNameInput.value = '';
  toggleAppSpotNameField();
  governmentDesignatedInput.value = 'No';
  setSelectedObservations([]);
}
function renderSpots() {
  const query = searchInput.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const filtered = spots.filter((spot) => {
    const matchesQuery = !query || [spot.gridName, spot.spotName, spot.appSpotName, spot.description, spot.bikeCapacity, spot.demand, ...(spot.observations || [])].join(' ').toLowerCase().includes(query);
    const matchesCategory = category === 'All' || spot.spotCategory === category;
    return matchesQuery && matchesCategory;
  });
  totalSpots.textContent = spots.length;
  if (!filtered.length) {
    spotsList.innerHTML = $('emptyTemplate').innerHTML;
    return;
  }
  spotsList.innerHTML = filtered.map((spot) => {
    const photo = spot.photoDataUrl ? `<img class="thumb" src="${spot.photoDataUrl}" alt="${escapeHtml(spot.spotName)} photo" />` : `<div class="thumb">No photo</div>`;
    const mapLink = spot.googleMapsUrl ? `<a href="${spot.googleMapsUrl}" target="_blank" rel="noreferrer">Open in Google Maps</a>` : `<span class="hint">No GPS location</span>`;
    return `<article class="spot-card">
      <div class="spot-top">
        ${photo}
        <div>
          <h3>${escapeHtml(spot.spotName)}</h3>
          <p class="hint"><strong>Grid:</strong> ${escapeHtml(spot.gridName || 'No grid')}</p>
          <div class="meta">
            <span class="badge ${categoryClass(spot.spotCategory)}">${escapeHtml(spot.spotCategory)}</span>
            <span class="badge neutral">Capacity: ${escapeHtml(spot.bikeCapacity)}</span>
            <span class="badge neutral">Demand: ${escapeHtml(spot.demand || 'Null')}</span>
            <span class="badge neutral">Spot in App: ${escapeHtml(spot.appManaged)}</span>
            <span class="badge neutral">App Spot Name: ${escapeHtml(spot.appManaged === 'Yes' ? displayNA(spot.appSpotName) : 'N/A')}</span>
            <span class="badge neutral">Government: ${escapeHtml(spot.governmentDesignated)}</span>
          </div>
          <p class="hint"><strong>Observations:</strong> ${escapeHtml((spot.observations && spot.observations.length) ? spot.observations.join(', ') : 'N/A')}</p>
          <p class="hint"><strong>Comments:</strong> ${escapeHtml(displayNA(spot.description))}</p>
          <p class="hint">${formatDate(spot.createdAt)} · ${mapLink}</p>
        </div>
      </div>
      <div class="spot-actions">
        <button class="secondary" onclick="editSpot('${spot.id}')">Edit</button>
        <button class="ghost danger" onclick="deleteSpot('${spot.id}')">Delete</button>
        ${spot.googleMapsUrl ? `<button class="ghost" onclick="window.open('${spot.googleMapsUrl}', '_blank')">Map</button>` : `<button class="ghost" disabled>No Map</button>`}
      </div>
    </article>`;
  }).join('');
}
window.editSpot = function(id) {
  const spot = spots.find((item) => item.id === id);
  if (!spot) return;
  editingIdInput.value = spot.id;
  gridNameInput.value = spot.gridName || '';
  spotNameInput.value = spot.spotName || '';
  bikeCapacityInput.value = spot.bikeCapacity || '';
  spotCategoryInput.value = spot.spotCategory || 'Government Designated';
  demandInput.value = spot.demand || 'Null';
  appManagedInput.value = spot.appManaged || 'No';
  appSpotNameInput.value = spot.appSpotName || '';
  toggleAppSpotNameField();
  governmentDesignatedInput.value = spot.governmentDesignated || 'No';
  setSelectedObservations(spot.observations || []);
  descriptionInput.value = spot.description || '';
  latitudeInput.value = spot.latitude || '';
  longitudeInput.value = spot.longitude || '';
  photoDataUrl = spot.photoDataUrl || '';
  if (photoDataUrl) {
    photoPreview.src = photoDataUrl;
    photoPreviewWrap.classList.remove('hidden');
  } else {
    photoPreviewWrap.classList.add('hidden');
  }
  $('formTitle').textContent = 'Edit Spot';
  $('saveSpotBtn').textContent = 'Update Spot';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.deleteSpot = async function(id) {
  if (!confirm('Are you sure you want to delete this spot?')) return;
  try {
    await deleteSpotFromDb(id);
    await refreshSpots({ successMessage: 'Spot deleted.' });
  } catch (error) {
    console.error(error);
    showMessage('Could not delete this spot.', 'error');
  }
};
function captureLocation() {
  if (!navigator.geolocation) {
    $('locationStatus').textContent = 'Location unavailable: this browser does not support GPS capture.';
    return;
  }
  $('locationStatus').textContent = 'Getting location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latitudeInput.value = pos.coords.latitude.toFixed(6);
      longitudeInput.value = pos.coords.longitude.toFixed(6);
      $('locationStatus').textContent = 'Location captured.';
    },
    () => { $('locationStatus').textContent = 'Location unavailable. You can enter coordinates manually or save without GPS.'; },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}
function resizeImageFile(file, maxSize = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not process the selected image.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

async function handlePhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showMessage('Please select an image file.', 'error');
    return;
  }
  showMessage('Processing photo…', 'info');
  try {
    photoDataUrl = await resizeImageFile(file);
    photoPreview.src = photoDataUrl;
    photoPreviewWrap.classList.remove('hidden');
    showMessage('Photo ready. It was compressed for reliable saving.', 'success');
  } catch (error) {
    console.error(error);
    showMessage('Could not process this photo. Try another image or save without a photo.', 'error');
  }
}
async function submitSpot(event) {
  event.preventDefault();
  const now = new Date().toISOString();
  const id = editingIdInput.value || makeId();
  const lat = latitudeInput.value.trim();
  const lng = longitudeInput.value.trim();
  const existing = spots.find((spot) => spot.id === id);
  const spot = {
    id,
    gridName: gridNameInput.value.trim(),
    spotName: spotNameInput.value.trim(),
    latitude: lat,
    longitude: lng,
    googleMapsUrl: mapsUrl(lat, lng),
    photoDataUrl,
    bikeCapacity: bikeCapacityInput.value.trim(),
    spotCategory: spotCategoryInput.value,
    demand: demandInput.value,
    appManaged: appManagedInput.value,
    appSpotName: appManagedInput.value === 'Yes' ? appSpotNameInput.value.trim() : '',
    governmentDesignated: governmentDesignatedInput.value,
    observations: getSelectedObservations(),
    description: descriptionInput.value.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  if (!spot.gridName) {
    alert('Please set a Grid Name before saving.');
    return;
  }
  if (spot.appManaged === 'Yes' && !spot.appSpotName) {
    alert('Please enter the App Spot Name when the spot is in the app.');
    return;
  }
  try {
    await putSpotInDb(spot);
    await refreshSpots({ successMessage: existing ? 'Spot updated.' : 'Spot saved.' });
    resetForm();
  } catch (error) {
    console.error(error);
    showMessage('Could not save. Browser database storage may be unavailable or full. Try a smaller photo or export/delete older records.', 'error');
  }
}
function exportJson() {
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`bike-spot-backup-${date}.json`, JSON.stringify({ storage: 'IndexedDB', defaultGridName: localStorage.getItem(GRID_KEY) || '', spots }, null, 2), 'application/json');
}
async function deleteTodaysRecords() {
  const todayKey = localDateKey();
  const todaysCount = spots.filter((spot) => localDateKey(spot.createdAt) === todayKey).length;
  if (!todaysCount) {
    alert('There are no records saved today.');
    return;
  }
  const message = `This will delete ${todaysCount} record${todaysCount === 1 ? '' : 's'} saved today. This action cannot be undone. Continue?`;
  if (!confirm(message)) return;
  try {
    const remaining = spots.filter((spot) => localDateKey(spot.createdAt) !== todayKey);
    await replaceAllSpotsInDb(remaining);
    await refreshSpots({ successMessage: 'Today’s records were deleted.' });
    resetForm();
  } catch (error) {
    console.error(error);
    showMessage('Could not delete today’s records.', 'error');
  }
}
function importJsonBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(String(reader.result || ''));
      const importedSpots = Array.isArray(data) ? data : data.spots;
      if (!Array.isArray(importedSpots)) throw new Error('Invalid JSON format.');
      const replace = confirm(`Import ${importedSpots.length} spot${importedSpots.length === 1 ? '' : 's'} from this JSON file? This will replace the current list shown in the app.`);
      if (!replace) return;
      const normalized = importedSpots.map(normalizeImportedSpot);
      await replaceAllSpotsInDb(normalized);
      if (!Array.isArray(data) && typeof data.defaultGridName === 'string') {
        localStorage.setItem(GRID_KEY, data.defaultGridName);
        defaultGridInput.value = data.defaultGridName;
        $('gridStatus').textContent = data.defaultGridName ? `Current Grid: ${data.defaultGridName}` : 'Set this once at the beginning of your walk. New spots will inherit it automatically.';
      }
      await refreshSpots({ successMessage: 'JSON backup imported successfully.' });
      resetForm();
    } catch (error) {
      console.error(error);
      alert('Could not import this JSON file. Please make sure it is a valid Bike Spot Logger backup.');
    } finally {
      importJsonInput.value = '';
    }
  };
  reader.readAsText(file);
}
function getSpotsForReport() {
  const from = reportDateFromInput.value;
  const to = reportDateToInput.value;
  return spots.filter((spot) => {
    const key = localDateKey(spot.createdAt);
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  });
}
function reportDateFilterLabel() {
  const from = reportDateFromInput.value;
  const to = reportDateToInput.value;
  if (from && to && from === to) return from;
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return 'All records';
}
function exportDoc() {
  const defaultGrid = localStorage.getItem(GRID_KEY) || 'Not specified';
  const date = new Date();
  const reportDate = new Intl.DateTimeFormat('en-AU', { dateStyle: 'full', timeStyle: 'short' }).format(date);
  const reportSpots = getSpotsForReport();
  const dateFilterLabel = reportDateFilterLabel();
  const sections = reportSpots.map((spot, index) => `
    <div class="spot-section">
      <h2>${index + 1}. ${escapeHtml(spot.spotName)}</h2>
      <p><strong>Grid Name:</strong> ${escapeHtml(spot.gridName || 'Not specified')}</p>
      <p><strong>Google Maps Location:</strong> ${spot.googleMapsUrl ? `<a href="${spot.googleMapsUrl}">Open in Google Maps</a>` : 'No GPS location captured.'}</p>
      <p><strong>Bike Capacity:</strong> ${escapeHtml(spot.bikeCapacity || 'Not specified')}</p>
      <p><strong>Demand:</strong> ${escapeHtml(spot.demand || 'Null')}</p>
      <p><strong>Spot Category:</strong> ${escapeHtml(spot.spotCategory)}</p>
      <p><strong>Spot in App:</strong> ${escapeHtml(spot.appManaged)}</p>
      <p><strong>App Spot Name:</strong> ${escapeHtml(spot.appManaged === 'Yes' ? displayNA(spot.appSpotName) : 'N/A')}</p>
      <p><strong>Government Designated:</strong> ${escapeHtml(spot.governmentDesignated)}</p>
      <p><strong>Coordinates:</strong><br/>Latitude: ${escapeHtml(spot.latitude || 'N/A')}<br/>Longitude: ${escapeHtml(spot.longitude || 'N/A')}</p>
      <p><strong>Observations:</strong><br/>${escapeHtml((spot.observations && spot.observations.length) ? spot.observations.join(', ') : 'N/A')}</p>
      <p><strong>Additional Comments:</strong><br/>${escapeHtml(displayNA(spot.description))}</p>
      <p><strong>Photo of the Spot:</strong></p>
      ${spot.photoDataUrl ? `<img src="${spot.photoDataUrl}" style="height: 5cm; width: auto; max-width: 100%; object-fit: contain; border: 1px solid #ddd; border-radius: 8px;" />` : '<p>No photo added.</p>'}
    </div>
  `).join('<hr/>');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bike Spot Field Report</title>
    <style>body{font-family:Arial,sans-serif;color:#111827;line-height:1.45;} h1{font-size:28px;} h2{font-size:20px;margin-top:28px;} .header{border-bottom:2px solid #111827;margin-bottom:20px;padding-bottom:12px;} .spot-section{page-break-inside:avoid;margin:20px 0;} a{color:#1d4ed8;} hr{border:0;border-top:1px solid #ddd;margin:24px 0;}</style>
    </head><body><div class="header"><h1>Bike Spot Field Report</h1><p><strong>Report Date:</strong> ${escapeHtml(reportDate)}</p><p><strong>Default Grid:</strong> ${escapeHtml(defaultGrid)}</p><p><strong>Date Filter:</strong> ${escapeHtml(dateFilterLabel)}</p><p><strong>Total Spots in Report:</strong> ${reportSpots.length}</p></div>${sections || '<p>No spots found for the selected report date filter.</p>'}</body></html>`;
  const fileDate = date.toISOString().slice(0, 10);
  downloadFile(`bike-spot-field-report-${fileDate}.doc`, html, 'application/msword;charset=utf-8');
}

$('saveGridBtn').addEventListener('click', setDefaultGrid);
appManagedInput.addEventListener('change', toggleAppSpotNameField);
$('captureLocationBtn').addEventListener('click', captureLocation);
$('resetFormBtn').addEventListener('click', resetForm);
$('removePhotoBtn').addEventListener('click', () => { photoDataUrl = ''; photoInput.value = ''; photoPreview.src = ''; photoPreviewWrap.classList.add('hidden'); });
photoInput.addEventListener('change', handlePhoto);
form.addEventListener('submit', submitSpot);
searchInput.addEventListener('input', renderSpots);
categoryFilter.addEventListener('change', renderSpots);
$('clearReportDatesBtn').addEventListener('click', () => { reportDateFromInput.value = ''; reportDateToInput.value = ''; showMessage('Report date filters cleared.', 'info'); });
$('exportDocBtn').addEventListener('click', exportDoc);
$('exportJsonBtn').addEventListener('click', exportJson);
$('importJsonBtn').addEventListener('click', () => importJsonInput.click());
importJsonInput.addEventListener('change', importJsonBackup);
$('deleteTodayBtn').addEventListener('click', deleteTodaysRecords);

async function initApp() {
  defaultGridInput.value = localStorage.getItem(GRID_KEY) || '';
  setDefaultGrid();
  resetForm();
  try {
    showMessage('Loading browser database…', 'info');
    await openDatabase();
    await migrateLegacyLocalStorage();
    await refreshSpots();
    showMessage('IndexedDB storage ready.', 'success');
  } catch (error) {
    console.error(error);
    showMessage('IndexedDB is unavailable in this browser. The app cannot save records reliably here.', 'error');
    renderSpots();
  }
}

initApp();
