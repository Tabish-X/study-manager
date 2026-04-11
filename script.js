// script.js — Firestore for everything, files stored as base64 chunks
// PDF rendered with PDF.js canvas + text layer = true vector quality

import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const CHUNK_SIZE = 500 * 1024;

/* ── Modal ───────────────────────────────────────────────────────────── */
document.body.insertAdjacentHTML("beforeend", `
<div id="file-modal" style="
    display:none;position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.92);z-index:9999;flex-direction:column;">
  <div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 16px;background:#1a1a1a;flex-shrink:0;gap:12px;">
    <span id="modal-title" style="color:white;font-weight:600;font-size:1rem;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;"></span>
    <button onclick="closeModal()" style="background:#dc3545;color:white;border:none;
        padding:8px 16px;border-radius:4px;cursor:pointer;font-size:0.95rem;font-weight:600;
        flex-shrink:0;">✕ Close</button>
  </div>
  <div id="modal-body" style="flex:1;overflow:auto;background:#525659;
      display:flex;flex-direction:column;align-items:center;padding:20px;gap:12px;"></div>
</div>

<style>
  .pdf-page-wrapper {
    position: relative;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    background: white;
    line-height: 0;
  }
  .pdf-page-wrapper canvas {
    display: block;
    width: 100% !important;
    height: auto !important;
  }
  .pdf-text-layer {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    opacity: 0.2;
    line-height: 1;
    pointer-events: auto;
  }
  .pdf-text-layer span {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
  }
  /* Make text selectable and visible on hover */
  .pdf-text-layer span::selection {
    background: rgba(0, 0, 255, 0.3);
    color: transparent;
  }
</style>`);

window.closeModal = () => {
  document.getElementById("file-modal").style.display = "none";
  document.getElementById("modal-body").innerHTML = "";
};
function openModal(title, contentHTML) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = contentHTML;
  document.getElementById("file-modal").style.display = "flex";
}

/* ── Wait for globals ────────────────────────────────────────────────── */
function waitForApp(cb) {
  if (window.firestoreDb && window.currentUser) cb();
  else setTimeout(() => waitForApp(cb), 100);
}

/* ── Firestore helpers ───────────────────────────────────────────────── */
function userCol(colName) {
  return collection(window.firestoreDb, "users", window.currentUser.uid, colName);
}
async function addItem(colName, data) {
  return addDoc(userCol(colName), { ...data, createdAt: Date.now() });
}
async function getItems(colName) {
  const snap = await getDocs(query(userCol(colName), orderBy("createdAt")));
  return snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
}
async function removeItem(colName, firestoreId) {
  await deleteDoc(doc(window.firestoreDb, "users", window.currentUser.uid, colName, firestoreId));
}

/* ── Duplicate check ─────────────────────────────────────────────────── */
// Returns true if an item with the same value for `field` already exists (case-insensitive)
async function isDuplicate(colName, field, value) {
  const items = await getItems(colName);
  return items.some(item =>
    (item[field] || "").trim().toLowerCase() === value.trim().toLowerCase()
  );
}

/* ── File → Base64 ───────────────────────────────────────────────────── */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── Chunked storage ─────────────────────────────────────────────────── */
async function storeFileChunked(fileId, base64Data) {
  const chunks = [];
  for (let i = 0; i < base64Data.length; i += CHUNK_SIZE)
    chunks.push(base64Data.slice(i, i + CHUNK_SIZE));
  const uid = window.currentUser.uid;
  for (let i = 0; i < chunks.length; i++) {
    const ref = doc(window.firestoreDb, "users", uid, "files", fileId, "chunks", String(i));
    await setDoc(ref, { data: chunks[i], index: i });
  }
  return chunks.length;
}
async function loadFileChunked(fileId, totalChunks) {
  const uid = window.currentUser.uid;
  let base64 = "";
  for (let i = 0; i < totalChunks; i++) {
    const ref  = doc(window.firestoreDb, "users", uid, "files", fileId, "chunks", String(i));
    const snap = await getDoc(ref);
    base64 += snap.data().data;
  }
  return base64;
}
async function deleteFileChunks(fileId, totalChunks) {
  const uid = window.currentUser.uid;
  for (let i = 0; i < totalChunks; i++) {
    const ref = doc(window.firestoreDb, "users", uid, "files", fileId, "chunks", String(i));
    await deleteDoc(ref);
  }
}

/* ── Load PDF.js ─────────────────────────────────────────────────────── */
async function loadPdfJs() {
  if (window.pdfjsLib) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  // Also load the text layer CSS from PDF.js CDN
  const link = document.createElement("link");
  link.rel  = "stylesheet";
  link.href = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css";
  document.head.appendChild(link);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/* ── PDF viewer — canvas + text layer ───────────────────────────────── */
async function renderPDF(base64DataUrl, name) {
  openModal(name, `<p style="color:white;padding:40px;font-size:1.1rem;">Rendering PDF…</p>`);
  try {
    await loadPdfJs();

    // Decode base64 → Uint8Array
    const base64  = base64DataUrl.split(",")[1];
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;

    const modalBody = document.getElementById("modal-body");
    modalBody.innerHTML = "";

    // devicePixelRatio ensures sharp rendering on retina screens
    const dpr   = window.devicePixelRatio || 1;
    // Base scale: render at screen resolution × devicePixelRatio
    // This gives true native resolution — text stays perfectly sharp at any browser zoom
    const SCALE = dpr * 2;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page     = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: SCALE });

      // Wrapper holds canvas + text layer together
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page-wrapper";
      // CSS width = full container, height proportional
      const cssWidth  = Math.min(900, modalBody.clientWidth - 40);
      const cssHeight = cssWidth * (viewport.height / viewport.width);
      wrapper.style.width  = cssWidth + "px";
      wrapper.style.height = cssHeight + "px";

      // ── Canvas (pixel-perfect background) ──
      const canvas = document.createElement("canvas");
      canvas.width  = viewport.width;   // high-res pixels
      canvas.height = viewport.height;
      wrapper.appendChild(canvas);

      // ── Text layer (real selectable text on top) ──
      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "pdf-text-layer";
      wrapper.appendChild(textLayerDiv);

      modalBody.appendChild(wrapper);

      // Render the canvas
      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport
      }).promise;

      // Render the text layer — this is what makes text crisp & selectable
      const textContent = await page.getTextContent();
      const textViewport = page.getViewport({ scale: SCALE });

      window.pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container:         textLayerDiv,
        viewport:          textViewport,
        textDivs:          []
      });
    }

  } catch (err) {
    console.error("PDF render error:", err);
    openModal(name, `
      <div style="padding:40px;text-align:center;">
        <p style="color:white;font-size:1.1rem;margin-bottom:20px;">Could not render PDF.</p>
      </div>`);
  }
}

/* ── View file ───────────────────────────────────────────────────────── */
window.viewFile = async (firestoreId, name, mimeType, totalChunks) => {
  openModal(name, `<p style="color:white;padding:40px;">Loading file…</p>`);
  try {
    const base64 = await loadFileChunked(firestoreId, totalChunks);
    if (mimeType && mimeType.startsWith("image/")) {
      openModal(name,
        `<img src="${base64}" style="max-width:100%;max-height:85vh;object-fit:contain;border-radius:4px;">`);
    } else if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      await renderPDF(base64, name);
    } else {
      downloadFromBase64(base64, name);
      closeModal();
    }
  } catch (err) {
    console.error(err);
    openModal(name, `<p style="color:white;padding:40px;">Failed to load: ${err.message}</p>`);
  }
};

/* ── Download ────────────────────────────────────────────────────────── */
window.downloadFile = async (firestoreId, name, totalChunks) => {
  setStatus("Preparing download…");
  try {
    const base64 = await loadFileChunked(firestoreId, totalChunks);
    downloadFromBase64(base64, name);
    setStatus("");
  } catch (err) {
    setStatus("Download failed: " + err.message, true);
  }
};
function downloadFromBase64(base64DataUrl, name) {
  const a = document.createElement("a");
  a.href = base64DataUrl; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/* ── Nav ─────────────────────────────────────────────────────────────── */
document.querySelectorAll(".nav-btn").forEach(btn => {
  if (!btn.dataset.section) return;
  btn.onclick = () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
    document.getElementById(btn.dataset.section + "-section").classList.add("active");
  };
});

/* ── SUBJECTS ────────────────────────────────────────────────────────── */
document.getElementById("add-subject-btn").onclick = async () => {
  const name = document.getElementById("subject-name").value.trim();
  if (!name) return alert("Enter subject name");
  if (await isDuplicate("subjects", "name", name)) return alert("Already exists");
  await addItem("subjects", { name });
  document.getElementById("subject-name").value = "";
  renderSubjects();
};
async function renderSubjects() {
  const box = document.getElementById("subjects-list");
  box.innerHTML = "<em style='color:#999'>Loading…</em>";
  const items = await getItems("subjects");
  box.innerHTML = "";
  if (!items.length) box.innerHTML = "<p style='color:#999;padding:12px'>No subjects yet.</p>";
  items.forEach(s => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<span>${s.name}</span>
      <button class="delete-file" onclick="deleteSubject('${s.firestoreId}')">Delete</button>`;
    box.appendChild(div);
  });
  updateSelector(items);
}
window.deleteSubject = async (id) => { await removeItem("subjects", id); renderSubjects(); };

/* ── TOPICS ──────────────────────────────────────────────────────────── */
document.getElementById("add-topic-btn").onclick = async () => {
  const name = document.getElementById("topic-name").value.trim();
  if (!name) return alert("Enter topic name");
  if (await isDuplicate("topics", "name", name)) return alert("Already exists");
  await addItem("topics", { name });
  document.getElementById("topic-name").value = "";
  renderTopics();
};
async function renderTopics() {
  const box = document.getElementById("topics-list");
  box.innerHTML = "<em style='color:#999'>Loading…</em>";
  const items = await getItems("topics");
  box.innerHTML = "";
  if (!items.length) box.innerHTML = "<p style='color:#999;padding:12px'>No topics yet.</p>";
  items.forEach(t => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<span>${t.name}</span>
      <button class="delete-file" onclick="deleteTopic('${t.firestoreId}')">Delete</button>`;
    box.appendChild(div);
  });
}
window.deleteTopic = async (id) => { await removeItem("topics", id); renderTopics(); };

/* ── NOTES ───────────────────────────────────────────────────────────── */
document.getElementById("add-note-btn").onclick = async () => {
  const title   = document.getElementById("note-title").value.trim();
  const content = document.getElementById("note-content").value.trim();
  if (!title || !content) return alert("Fill both fields");
  if (await isDuplicate("notes", "title", title)) return alert("Already exists");
  await addItem("notes", { title, content });
  document.getElementById("note-title").value   = "";
  document.getElementById("note-content").value = "";
  renderNotes();
};
async function renderNotes() {
  const box = document.getElementById("notes-list");
  box.innerHTML = "<em style='color:#999'>Loading…</em>";
  const items = await getItems("notes");
  box.innerHTML = "";
  if (!items.length) box.innerHTML = "<p style='color:#999;padding:12px'>No notes yet.</p>";
  items.forEach(n => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <div>
        <b>${n.title}</b>
        <p style="margin-top:5px;color:#555">${n.content}</p>
      </div>
      <button class="delete-file" onclick="deleteNote('${n.firestoreId}')">Delete</button>`;
    box.appendChild(div);
  });
}
window.deleteNote = async (id) => { await removeItem("notes", id); renderNotes(); };

/* ── Subject selector ────────────────────────────────────────────────── */
function updateSelector(items) {
  const sel = document.getElementById("subject-selector");
  sel.innerHTML = '<option value=""> SELECT SUBJECT </option>';
  items.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.firestoreId; opt.textContent = s.name;
    sel.appendChild(opt);
  });
}

/* ── Upload ──────────────────────────────────────────────────────────── */
function setStatus(msg, isError = false) {
  const el = document.getElementById("upload-status");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#dc3545" : "#4a6fa5";
}

document.getElementById("upload-files-btn").onclick = async () => {
  const fileInput = document.getElementById("file-upload");
  const subjectId = document.getElementById("subject-selector").value;
  const files     = Array.from(fileInput.files);
  if (!files.length) return alert("Select at least one file");
  if (!subjectId)    return alert("Select a subject first");

  const btn = document.getElementById("upload-files-btn");
  btn.disabled = true; btn.textContent = "Uploading…";
  setStatus("Checking for duplicates…");

  try {
    // Check all files for duplicates before uploading any
    for (const file of files) {
      if (await isDuplicate("files", "name", file.name)) {
        setStatus(`❌ "${file.name}" already exists. Remove it and try again.`, true);
        btn.disabled = false; btn.textContent = "Upload Files";
        return;
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`Uploading ${i + 1} of ${files.length}: ${file.name}…`);
      const base64 = await fileToBase64(file);
      const docRef = await addItem("files", {
        name: file.name, mimeType: file.type,
        subjectId, bytes: file.size, totalChunks: 0
      });
      const totalChunks = await storeFileChunked(docRef.id, base64);
      const fileDocRef  = doc(window.firestoreDb, "users", window.currentUser.uid, "files", docRef.id);
      await setDoc(fileDocRef, { totalChunks }, { merge: true });
    }
    setStatus("✅ Upload complete!");
    fileInput.value = "";
    renderFiles();
  } catch (err) {
    console.error(err);
    setStatus("❌ Upload failed: " + err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Upload Files";
  }
};

/* ── Render files ────────────────────────────────────────────────────── */
async function renderFiles() {
  const box = document.getElementById("uploaded-files-list");
  box.innerHTML = "<em style='color:#999'>Loading…</em>";
  let items;
  try { items = await getItems("files"); }
  catch (e) {
    box.innerHTML = "<p style='color:red'>Failed to load files: " + e.message + "</p>";
    return;
  }
  box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = "<p style='color:#999;padding:12px'>No files uploaded yet.</p>";
    return;
  }
  items.forEach(f => {
    if (!f.totalChunks) return;
    const sizeText = f.bytes ? `(${(f.bytes / 1024).toFixed(1)} KB)` : "";
    const safeName = (f.name     || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const safeMime = (f.mimeType || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `
      <span>${f.name} <small style="color:#999">${sizeText}</small></span>
      <div class="file-actions">
        <button class="view-file"
          onclick="viewFile('${f.firestoreId}','${safeName}','${safeMime}',${f.totalChunks})">
          View
        </button>
        <button style="background:#f4c20d;color:black;border:none;padding:8px 14px;
            border-radius:4px;cursor:pointer;font-weight:600;"
          onclick="downloadFile('${f.firestoreId}','${safeName}',${f.totalChunks})">
          Download
        </button>
        <button class="delete-file"
          onclick="deleteFile('${f.firestoreId}',${f.totalChunks})">
          Delete
        </button>
      </div>`;
    box.appendChild(div);
  });
}

window.deleteFile = async (firestoreId, totalChunks) => {
  if (!confirm("Delete this file?")) return;
  await deleteFileChunks(firestoreId, totalChunks);
  await removeItem("files", firestoreId);
  setStatus("File deleted.");
  renderFiles();
};

/* ── Boot ────────────────────────────────────────────────────────────── */
waitForApp(() => {
  renderSubjects();
  renderTopics();
  renderNotes();
  renderFiles();
});
