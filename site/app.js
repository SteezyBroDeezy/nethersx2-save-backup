// NetherSX2 Save Backup — zips whatever you exported from NetherSX2's
// Transfer Data -> Export and saves the zip to Downloads (or the share
// sheet). Everything runs in this tab: files are hashed, zipped with fflate,
// and archived in IndexedDB so recent backups survive a reload.

const HASH_STORE_KEY = 'nsb-file-hashes'
const KEEP_COUNT = 10 // how many recent backups to keep in history
const DB_NAME = 'nsb-archives'
const DB_STORE = 'archives'

const els = {
  pickFilesBtn: document.getElementById('pickFilesBtn'),
  pickFolderBtn: document.getElementById('pickFolderBtn'),
  fileInput: document.getElementById('fileInput'),
  folderInput: document.getElementById('folderInput'),
  selectedSummary: document.getElementById('selectedSummary'),
  forceFull: document.getElementById('forceFull'),
  backupDownloadsBtn: document.getElementById('backupDownloadsBtn'),
  backupShareBtn: document.getElementById('backupShareBtn'),
  status: document.getElementById('status'),
  restoreZipBtn: document.getElementById('restoreZipBtn'),
  restoreZipInput: document.getElementById('restoreZipInput'),
  historyList: document.getElementById('historyList'),
  historyEmptyHint: document.getElementById('historyEmptyHint'),
}

let selectedFiles = []

function setStatus(text, kind) {
  els.status.textContent = text
  els.status.className = 'status' + (kind ? ' ' + kind : '')
}

function setSelectedFiles(fileList) {
  selectedFiles = Array.from(fileList || [])
  if (selectedFiles.length === 0) {
    els.selectedSummary.textContent = 'No files selected yet.'
    return
  }
  const totalKb = selectedFiles.reduce((sum, f) => sum + f.size, 0) / 1024
  els.selectedSummary.textContent =
    `${selectedFiles.length} file(s) selected (${totalKb.toFixed(1)} KB).`
}

els.pickFilesBtn.addEventListener('click', () => els.fileInput.click())
els.pickFolderBtn.addEventListener('click', () => els.folderInput.click())
els.fileInput.addEventListener('change', (e) => setSelectedFiles(e.target.files))
els.folderInput.addEventListener('change', (e) => setSelectedFiles(e.target.files))

// ------------------------------------------------------------- hashing

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function loadHashes() {
  try {
    return JSON.parse(localStorage.getItem(HASH_STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveHashes(map) {
  localStorage.setItem(HASH_STORE_KEY, JSON.stringify(map))
}

// --------------------------------------------------------- archive store

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function addArchive(record) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).add(record)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function getAllArchives() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).getAll()
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt))
    req.onerror = () => reject(req.error)
  })
}

async function deleteArchive(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

async function pruneArchives(keep) {
  const all = await getAllArchives()
  for (const old of all.slice(keep)) await deleteArchive(old.id)
}

// ----------------------------------------------------------- delivery

// A programmatic <a download> click is what actually lands a file in
// Chrome's Downloads folder on Android — no file-system API needed.
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  downloadBlob(file, file.name)
  return 'downloaded'
}

// ------------------------------------------------------------- backup

function archiveName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `nethersx2_${stamp}.zip`
}

async function buildZip(files, forceFull) {
  const prevHashes = loadHashes()
  const nextHashes = { ...prevHashes }
  const zipEntries = {}
  let included = 0
  let skipped = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const name = file.webkitRelativePath || file.name
    setStatus(`Hashing ${i + 1}/${files.length}: ${name}`)

    const buf = await file.arrayBuffer()
    const hash = await sha256Hex(buf)
    nextHashes[name] = hash

    if (!forceFull && prevHashes[name] === hash) {
      skipped++
      continue
    }
    zipEntries[name] = new Uint8Array(buf)
    included++
  }

  if (included === 0) return { included, skipped, blob: null, name: null, nextHashes }

  setStatus(`Zipping ${included} file(s)...`)
  const zipped = await new Promise((resolve, reject) => {
    fflate.zip(zipEntries, { level: 6 }, (err, data) => err ? reject(err) : resolve(data))
  })

  return {
    included,
    skipped,
    blob: new Blob([zipped], { type: 'application/zip' }),
    name: archiveName(),
    nextHashes,
  }
}

async function runBackup(deliver) {
  if (selectedFiles.length === 0) {
    setStatus('Pick the files you exported from NetherSX2 first.', 'error')
    return
  }

  els.backupDownloadsBtn.disabled = true
  els.backupShareBtn.disabled = true
  try {
    const result = await buildZip(selectedFiles, els.forceFull.checked)
    if (!result.blob) {
      setStatus(`No changes in ${result.skipped} file(s) since the last backup. Check "Include unchanged files" to force one.`)
      return
    }

    await addArchive({
      name: result.name,
      blob: result.blob,
      size: result.blob.size,
      fileCount: result.included,
      createdAt: Date.now(),
    })
    await pruneArchives(KEEP_COUNT)
    saveHashes(result.nextHashes)
    await renderHistory()

    const file = new File([result.blob], result.name, { type: 'application/zip' })
    const outcome = await deliver(file)
    setStatus(
      `${result.name} — ${(result.blob.size / 1024).toFixed(1)} KB, ${result.included} file(s) ` +
      `(${result.skipped} unchanged skipped). ${outcome}.`,
      'success'
    )
  } catch (err) {
    setStatus(`Backup failed: ${err.message}`, 'error')
  } finally {
    els.backupDownloadsBtn.disabled = false
    els.backupShareBtn.disabled = false
  }
}

els.backupDownloadsBtn.addEventListener('click', () => runBackup(async (file) => {
  downloadBlob(file, file.name)
  return 'Saved to Downloads'
}))

els.backupShareBtn.addEventListener('click', () => runBackup(async (file) => {
  const outcome = await shareOrDownload(file)
  return outcome === 'shared' ? 'Sent to share sheet'
    : outcome === 'cancelled' ? 'Share cancelled — still kept in history'
    : 'Saved to Downloads'
}))

// ------------------------------------------------------------ restore

async function extractAndDownload(blob, sourceName) {
  setStatus(`Extracting ${sourceName}...`)
  const buf = new Uint8Array(await blob.arrayBuffer())
  const entries = await new Promise((resolve, reject) => {
    fflate.unzip(buf, (err, data) => err ? reject(err) : resolve(data))
  })

  const names = Object.keys(entries).filter(k => !k.endsWith('/'))
  if (names.length === 0) {
    setStatus('That archive had no files in it.', 'error')
    return
  }

  for (const path of names) {
    const flatName = path.split('/').pop()
    downloadBlob(new Blob([entries[path]]), flatName)
  }

  setStatus(
    `Extracted ${names.length} file(s) to Downloads. Move them into your ` +
    `NetherSX2 export folder, then Transfer Data -> Import in NetherSX2.`,
    'success'
  )
}

els.restoreZipBtn.addEventListener('click', () => els.restoreZipInput.click())
els.restoreZipInput.addEventListener('change', async (e) => {
  const zipFile = e.target.files[0]
  e.target.value = ''
  if (!zipFile) return
  try {
    await extractAndDownload(zipFile, zipFile.name)
  } catch (err) {
    setStatus(`Restore failed: ${err.message}`, 'error')
  }
})

// ------------------------------------------------------------- history

async function renderHistory() {
  const items = await getAllArchives()
  els.historyEmptyHint.hidden = items.length > 0
  els.historyList.innerHTML = ''

  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'history-item'

    const name = document.createElement('div')
    name.className = 'hi-name'
    name.textContent = item.name
    row.appendChild(name)

    const meta = document.createElement('div')
    meta.className = 'hi-meta'
    meta.textContent = `${item.fileCount} file(s) · ${(item.size / 1024).toFixed(1)} KB · ${new Date(item.createdAt).toLocaleString()}`
    row.appendChild(meta)

    const actions = document.createElement('div')
    actions.className = 'hi-actions'

    const dlBtn = document.createElement('button')
    dlBtn.className = 'small secondary'
    dlBtn.textContent = 'Downloads'
    dlBtn.onclick = () => { downloadBlob(item.blob, item.name); setStatus(`Saved ${item.name} to Downloads.`, 'success') }

    const shareBtn = document.createElement('button')
    shareBtn.className = 'small secondary'
    shareBtn.textContent = 'Share'
    shareBtn.onclick = async () => {
      const file = new File([item.blob], item.name, { type: 'application/zip' })
      const outcome = await shareOrDownload(file)
      setStatus(outcome === 'shared' ? `Shared ${item.name}.` : `Saved ${item.name} to Downloads.`, 'success')
    }

    const restoreBtn = document.createElement('button')
    restoreBtn.className = 'small secondary'
    restoreBtn.textContent = 'Restore'
    restoreBtn.onclick = () => extractAndDownload(item.blob, item.name)

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'small danger'
    deleteBtn.textContent = 'Delete'
    deleteBtn.onclick = async () => { await deleteArchive(item.id); await renderHistory() }

    actions.append(dlBtn, shareBtn, restoreBtn, deleteBtn)
    row.appendChild(actions)
    els.historyList.appendChild(row)
  }
}

renderHistory()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {})
  })
}
