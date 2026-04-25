const colors = {
  yellow: "#f6d95f",
  mint: "#64d6a4",
  pink: "#ef7fa2",
  blue: "#65a8ff",
  lilac: "#a897ff"
};

const statusLabels = {
  next: "Sirada",
  doing: "Simdi",
  waiting: "Bekliyor",
  done: "Bitti"
};

const typeLabels = {
  board: "Pano",
  postit: "Post-it",
  todo: "To-do",
  text: "Yazi",
  image: "Resim"
};

const sizeDefaults = {
  small: { w: 190, h: 130 },
  medium: { w: 260, h: 180 },
  large: { w: 340, h: 250 },
  board: { w: 520, h: 360 }
};

let data;
let editingNoteId = null;
let selectedColor = "yellow";
let addParentId = null;
let dragState = null;
let resizeState = null;

const $ = (selector) => document.querySelector(selector);

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function persist() {
  data = await window.planner.save(data);
}

function activeSection() {
  return data.sections.find((section) => section.id === data.selectedSectionId) || data.sections[0];
}

function activeItems(parentId = null) {
  const section = activeSection();
  return data.notes.filter((item) => item.sectionId === section.id && (item.parentId || null) === parentId);
}

function itemChildren(itemId) {
  return data.notes.filter((item) => item.parentId === itemId);
}

function normalizeData() {
  let changed = false;
  data.notes = data.notes.map((item, index) => {
    const normalized = { ...item };
    if (!normalized.type) {
      normalized.type = "todo";
      changed = true;
    }
    if (!("parentId" in normalized)) {
      normalized.parentId = null;
      changed = true;
    }
    if (!Array.isArray(normalized.tasks)) {
      const fallbackText = normalized.body?.trim() || normalized.title;
      normalized.tasks = fallbackText ? [{ id: uid("t"), text: fallbackText, done: normalized.status === "done" }] : [];
      changed = true;
    }
    if (!normalized.size) {
      normalized.size = "medium";
      changed = true;
    }
    if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) {
      normalized.x = 36 + (index % 3) * 280;
      normalized.y = 50 + Math.floor(index / 3) * 210;
      changed = true;
    }
    if (!Number.isFinite(normalized.w) || !Number.isFinite(normalized.h)) {
      const defaults = normalized.type === "board" ? sizeDefaults.board : sizeDefaults[normalized.size];
      normalized.w = defaults.w;
      normalized.h = defaults.h;
      changed = true;
    }
    if (!normalized.imageUrl) normalized.imageUrl = "";
    return normalized;
  });
  return changed;
}

function renderSections() {
  const list = $("#section-list");
  list.innerHTML = "";

  data.sections.forEach((section) => {
    const count = data.notes.filter((item) => item.sectionId === section.id && !item.parentId && item.status !== "done").length;
    const button = document.createElement("button");
    button.className = `section-button${section.id === data.selectedSectionId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span class="section-accent" style="background:${section.accent}"></span>
      <span>${section.title}</span>
      <span class="section-count">${count}</span>
    `;
    button.addEventListener("click", async () => {
      data.selectedSectionId = section.id;
      await persist();
      render();
    });
    list.append(button);
  });
}

function renderFocus() {
  const focus = data.notes.find((item) => item.id === data.focusNoteId) || activeItems().find((item) => item.status === "doing");
  const strip = $("#focus-strip");

  if (!focus) {
    strip.innerHTML = `<div class="focus-card"><strong>Odak objesi yok</strong><span>Bir objeyi Simdi durumuna al.</span><div class="timer">25:00</div></div>`;
    return;
  }

  strip.innerHTML = `
    <div class="focus-card">
      <div>
        <strong>${escapeHtml(focus.title)}</strong>
        <span>${typeLabels[focus.type]} · ${taskProgress(focus)}</span>
      </div>
      <div class="timer">25:00</div>
    </div>
  `;
}

function renderItems() {
  const board = $("#corkboard");
  const section = activeSection();
  board.innerHTML = `
    <div class="workspace-canvas">
      <div class="canvas-head">
        <span>${escapeHtml(section.title)}</span>
        <span>${activeItems().length} root obje</span>
      </div>
      <div class="object-layer" id="root-layer" data-parent-id=""></div>
    </div>
  `;
  renderLayer($("#root-layer"), null);
}

function renderLayer(layer, parentId) {
  layer.innerHTML = "";
  activeItems(parentId).forEach((item) => {
    const node = document.createElement("article");
    node.className = `object-card type-${item.type} ${item.color} status-${item.status}`;
    node.tabIndex = 0;
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    node.style.width = `${item.w}px`;
    node.style.height = `${item.h}px`;
    node.innerHTML = renderItemInner(item);
    wireItem(node, item);
    layer.append(node);

    if (item.type === "board") {
      const childLayer = node.querySelector(".object-layer");
      renderLayer(childLayer, item.id);
    }
  });
}

function renderItemInner(item) {
  const body = item.type === "board" ? renderBoardBody(item) : renderObjectBody(item);
  return `
    <div class="object-head" data-drag-handle="true">
      <div>
        <span class="object-type">${typeLabels[item.type]}</span>
        <h4>${escapeHtml(item.title)}</h4>
      </div>
      <div class="note-tools">
        ${
          item.type === "board"
            ? `<button class="size-button" data-add-child="postit" type="button" title="Ic post-it">+</button>
               <button class="size-button" data-add-child="board" type="button" title="Ic pano">▣</button>`
            : ""
        }
        <button class="size-button" data-edit="true" type="button" title="Duzenle">••</button>
      </div>
    </div>
    ${body}
    <div class="object-foot">
      <span class="pill">${statusLabels[item.status] || typeLabels[item.type]}</span>
      <span class="pill">${item.type === "board" ? `${itemChildren(item.id).length} obje` : taskProgress(item)}</span>
    </div>
    <span class="resize-handle" data-resize-handle="true"></span>
  `;
}

function renderBoardBody(item) {
  return `
    <div class="board-inner">
      <div class="object-layer nested-layer" data-parent-id="${item.id}"></div>
    </div>
  `;
}

function renderObjectBody(item) {
  if (item.type === "image") {
    return item.imageUrl
      ? `<div class="image-body"><img src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.title)}" /></div>`
      : `<p class="text-body muted">Resim yolu yok</p>`;
  }

  if (item.type === "text") {
    return `<p class="text-body">${escapeHtml(item.tasks.map((task) => task.text).join(" ") || "Yazi ekle")}</p>`;
  }

  return `<div class="task-list">${renderTaskList(item)}</div>`;
}

function wireItem(node, item) {
  node.addEventListener("click", (event) => {
    if (node.dataset.dragged === "true") {
      node.dataset.dragged = "false";
      return;
    }
    if (event.target.closest("button, input, label, .resize-handle")) return;
    openObjectDialog(item, item.parentId || null);
  });

  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter") openObjectDialog(item, item.parentId || null);
  });

  node.querySelector("[data-drag-handle]").addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    startDrag(node, item.id, event);
  });

  node.querySelector("[data-resize-handle]").addEventListener("pointerdown", (event) => {
    startResize(node, item.id, event);
  });

  node.querySelectorAll("[data-task-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      await toggleTask(item.id, checkbox.dataset.taskId, checkbox.checked);
    });
  });

  node.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openObjectDialog(item, item.parentId || null));
  });

  node.querySelectorAll("[data-add-child]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.addChild === "board") {
        addBoard(item.id);
        return;
      }
      openObjectDialog(null, item.id, button.dataset.addChild);
    });
  });
}

function render() {
  $("#active-title").textContent = activeSection().title;
  renderSections();
  renderFocus();
  renderItems();
}

function openObjectDialog(item = null, parentId = null, forcedType = "postit") {
  editingNoteId = item?.id || null;
  addParentId = parentId;
  selectedColor = item?.color || "yellow";
  $("#dialog-title").textContent = item ? "Objeyi duzenle" : "Yeni obje";
  $("#note-title").value = item?.title || "";
  $("#note-type").value = item?.type || forcedType;
  $("#note-tasks").value = (item?.tasks || []).map((task) => task.text).join("\n");
  $("#note-image").value = item?.imageUrl || "";
  $("#note-status").value = item?.status || "next";
  $("#note-size").value = item?.size || "medium";
  $("#note-energy").value = item?.energy || "low";
  $("#delete-note").hidden = !item;
  syncDialogFields();
  renderSwatches();
  $("#note-dialog").showModal();
  $("#note-title").focus();
}

function syncDialogFields() {
  const type = $("#note-type").value;
  $("#note-tasks").placeholder = type === "text" ? "Metin" : "Her satir bir is";
  $("#note-tasks").hidden = type === "image" || type === "board";
  $("#note-image").hidden = type !== "image";
}

function renderSwatches() {
  const root = $("#color-swatches");
  root.innerHTML = "";
  Object.entries(colors).forEach(([name, value]) => {
    const button = document.createElement("button");
    button.className = `swatch${name === selectedColor ? " active" : ""}`;
    button.type = "button";
    button.title = name;
    button.style.background = value;
    button.addEventListener("click", () => {
      selectedColor = name;
      renderSwatches();
    });
    root.append(button);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function renderTaskList(item) {
  if (!item.tasks.length) return `<p class="empty-tasks">Madde yok</p>`;
  return item.tasks
    .map(
      (task) => `
        <label class="task-item${task.done ? " done" : ""}">
          <input data-task-id="${task.id}" type="checkbox" ${task.done ? "checked" : ""} />
          <span>${escapeHtml(task.text)}</span>
        </label>
      `
    )
    .join("");
}

function taskProgress(item) {
  if (!item.tasks?.length) return "0/0";
  const done = item.tasks.filter((task) => task.done).length;
  return `${done}/${item.tasks.length}`;
}

function readTasksFromDialog(existingTasks = []) {
  const existingByText = new Map(existingTasks.map((task) => [task.text, task]));
  return $("#note-tasks")
    .value.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((text) => existingByText.get(text) || { id: uid("t"), text, done: false });
}

async function saveObject() {
  const title = $("#note-title").value.trim() || "Adsiz obje";
  const existing = data.notes.find((item) => item.id === editingNoteId);
  const type = $("#note-type").value;
  const size = $("#note-size").value;
  const defaults = type === "board" ? sizeDefaults.board : sizeDefaults[size];
  const position = existing ? { x: existing.x, y: existing.y } : nextObjectPosition(addParentId);
  const item = {
    id: editingNoteId || uid("o"),
    sectionId: activeSection().id,
    parentId: existing?.parentId ?? addParentId,
    type,
    title,
    body: "",
    tasks: type === "image" || type === "board" ? [] : readTasksFromDialog(existing?.tasks || []),
    imageUrl: $("#note-image").value.trim(),
    size,
    x: position.x,
    y: position.y,
    w: existing?.w || defaults.w,
    h: existing?.h || defaults.h,
    color: selectedColor,
    status: $("#note-status").value,
    energy: $("#note-energy").value
  };

  if (editingNoteId) {
    data.notes = data.notes.map((current) => (current.id === editingNoteId ? item : current));
  } else {
    data.notes.push(item);
  }

  if (item.status === "doing") data.focusNoteId = item.id;
  await persist();
  render();
}

function nextObjectPosition(parentId) {
  const count = activeItems(parentId).length;
  return {
    x: 28 + (count % 3) * 230,
    y: 44 + Math.floor(count / 3) * 170
  };
}

async function addBoard(parentId = null) {
  const position = nextObjectPosition(parentId);
  data.notes.push({
    id: uid("b"),
    sectionId: activeSection().id,
    parentId,
    type: "board",
    title: "Yeni pano",
    body: "",
    tasks: [],
    imageUrl: "",
    size: "large",
    x: position.x,
    y: position.y,
    w: sizeDefaults.board.w,
    h: sizeDefaults.board.h,
    color: "blue",
    status: "next",
    energy: "medium"
  });
  await persist();
  render();
}

function startDrag(card, itemId, event) {
  const layer = card.parentElement;
  const layerRect = layer.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  dragState = {
    itemId,
    card,
    layer,
    startX: event.clientX,
    startY: event.clientY,
    initialX: cardRect.left - layerRect.left,
    initialY: cardRect.top - layerRect.top,
    moved: false
  };
  card.classList.add("dragging");
  card.setPointerCapture(event.pointerId);
  card.addEventListener("pointermove", dragMove);
  card.addEventListener("pointerup", dragEnd);
  card.addEventListener("pointercancel", dragEnd);
}

function dragMove(event) {
  if (!dragState) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (Math.abs(dx) + Math.abs(dy) > 6) dragState.moved = true;
  const maxX = Math.max(0, dragState.layer.clientWidth - dragState.card.offsetWidth - 8);
  const maxY = Math.max(0, dragState.layer.clientHeight - dragState.card.offsetHeight - 8);
  const x = Math.min(maxX, Math.max(8, dragState.initialX + dx));
  const y = Math.min(maxY, Math.max(8, dragState.initialY + dy));
  dragState.card.style.left = `${x}px`;
  dragState.card.style.top = `${y}px`;
}

async function dragEnd(event) {
  if (!dragState) return;
  const { itemId, card, moved } = dragState;
  card.releasePointerCapture(event.pointerId);
  card.removeEventListener("pointermove", dragMove);
  card.removeEventListener("pointerup", dragEnd);
  card.removeEventListener("pointercancel", dragEnd);
  card.classList.remove("dragging");
  card.dataset.dragged = moved ? "true" : "false";
  dragState = null;

  if (!moved) return;
  const x = Number.parseInt(card.style.left, 10);
  const y = Number.parseInt(card.style.top, 10);
  data.notes = data.notes.map((item) => (item.id === itemId ? { ...item, x, y } : item));
  await persist();
}

function startResize(card, itemId, event) {
  event.stopPropagation();
  resizeState = {
    itemId,
    card,
    startX: event.clientX,
    startY: event.clientY,
    initialW: card.offsetWidth,
    initialH: card.offsetHeight
  };
  card.setPointerCapture(event.pointerId);
  card.addEventListener("pointermove", resizeMove);
  card.addEventListener("pointerup", resizeEnd);
  card.addEventListener("pointercancel", resizeEnd);
}

function resizeMove(event) {
  if (!resizeState) return;
  const w = Math.max(150, resizeState.initialW + event.clientX - resizeState.startX);
  const h = Math.max(110, resizeState.initialH + event.clientY - resizeState.startY);
  resizeState.card.style.width = `${w}px`;
  resizeState.card.style.height = `${h}px`;
}

async function resizeEnd(event) {
  if (!resizeState) return;
  const { itemId, card } = resizeState;
  card.releasePointerCapture(event.pointerId);
  card.removeEventListener("pointermove", resizeMove);
  card.removeEventListener("pointerup", resizeEnd);
  card.removeEventListener("pointercancel", resizeEnd);
  resizeState = null;
  data.notes = data.notes.map((item) =>
    item.id === itemId ? { ...item, w: card.offsetWidth, h: card.offsetHeight } : item
  );
  await persist();
  render();
}

async function toggleTask(itemId, taskId, done) {
  data.notes = data.notes.map((item) => {
    if (item.id !== itemId) return item;
    const tasks = item.tasks.map((task) => (task.id === taskId ? { ...task, done } : task));
    const allDone = tasks.length > 0 && tasks.every((task) => task.done);
    const status = allDone ? "done" : item.status === "done" ? "next" : item.status;
    return { ...item, tasks, status };
  });
  await persist();
  render();
}

function removeItemAndChildren(itemId) {
  const ids = new Set([itemId]);
  let grew = true;
  while (grew) {
    grew = false;
    data.notes.forEach((item) => {
      if (ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    });
  }
  data.notes = data.notes.filter((item) => !ids.has(item.id));
}

function wireEvents() {
  $("#add-note").addEventListener("click", () => openObjectDialog(null, null, "postit"));
  $("#add-board").addEventListener("click", () => addBoard(null));
  $("#note-type").addEventListener("change", syncDialogFields);

  $("#add-section").addEventListener("click", async () => {
    const title = window.prompt("Baslik");
    if (!title?.trim()) return;
    const accents = ["#3d8bff", "#00a66d", "#ffb02e", "#d85a7f", "#7a6ccf"];
    const section = {
      id: uid("s"),
      title: title.trim().slice(0, 32),
      accent: accents[data.sections.length % accents.length]
    };
    data.sections.push(section);
    data.selectedSectionId = section.id;
    await persist();
    render();
  });

  $("#focus-mode").addEventListener("click", () => {
    document.body.classList.toggle("focused");
  });

  $("#save-note").addEventListener("click", async (event) => {
    event.preventDefault();
    await saveObject();
    $("#note-dialog").close();
  });

  $("#delete-note").addEventListener("click", async () => {
    if (!editingNoteId) return;
    removeItemAndChildren(editingNoteId);
    if (data.focusNoteId === editingNoteId) data.focusNoteId = null;
    await persist();
    $("#note-dialog").close();
    render();
  });
}

async function init() {
  data = await window.planner.load();
  if (normalizeData()) await persist();
  wireEvents();
  render();
}

init();
