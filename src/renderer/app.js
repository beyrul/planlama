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
  postit: "Post-it"
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
let editingComponents = [];
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
  if (!Number.isFinite(data.rootZoom)) {
    data.rootZoom = 1;
    changed = true;
  }
  if (!Number.isFinite(data.zCounter)) {
    data.zCounter = data.notes.reduce((max, item) => Math.max(max, item.z || 0), 0);
    changed = true;
  }
  data.notes = data.notes.map((item, index) => {
    const normalized = { ...item };
    const originalType = normalized.type;
    if (!normalized.type) {
      normalized.type = "postit";
      changed = true;
    }
    if (normalized.type !== "board" && normalized.type !== "postit") {
      normalized.type = "postit";
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
    if (!Array.isArray(normalized.components)) {
      normalized.components = componentsFromLegacyItem({ ...normalized, type: originalType });
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
    if (typeof normalized.minimized !== "boolean") {
      normalized.minimized = false;
      changed = true;
    }
    if (typeof normalized.fullscreen !== "boolean") {
      normalized.fullscreen = false;
      changed = true;
    }
    if (!Number.isFinite(normalized.zoom)) {
      normalized.zoom = 1;
      changed = true;
    }
    if (!Number.isFinite(normalized.z)) {
      normalized.z = index + 1;
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
      data.selectedItemId = null;
      await persist();
      render();
    });
    list.append(button);

    if (section.id === data.selectedSectionId) {
      list.append(renderSidebarTree(section.id, null, 0));
    }
  });
}

function renderSidebarTree(sectionId, parentId, depth) {
  const group = document.createElement("div");
  group.className = "sidebar-object-group";
  data.notes
    .filter((item) => item.sectionId === sectionId && (item.parentId || null) === parentId)
    .forEach((item) => {
      const button = document.createElement("button");
      button.className = `sidebar-object${item.id === data.selectedItemId ? " selected" : ""}`;
      button.type = "button";
      button.style.paddingLeft = `${12 + depth * 14}px`;
      button.innerHTML = `
        <span>${item.type === "board" ? "▣" : "▤"}</span>
        <span>${escapeHtml(item.title)}</span>
      `;
      button.addEventListener("click", async () => {
        data.selectedSectionId = sectionId;
        await selectItem(item.id, true);
      });
      group.append(button);

      if (item.type === "board") {
        group.append(renderSidebarTree(sectionId, item.id, depth + 1));
      }
    });
  return group;
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
        <span class="canvas-actions">
          <button class="size-button" id="root-zoom-out" type="button" title="Root zoom out">−</button>
          <span>${Math.round((data.rootZoom || 1) * 100)}%</span>
          <button class="size-button" id="root-zoom-in" type="button" title="Root zoom in">＋</button>
          <span>${activeItems().length} root obje</span>
        </span>
      </div>
      <div class="root-viewport">
        <div class="object-layer root-layer" id="root-layer" data-parent-id="" style="--root-zoom:${data.rootZoom || 1}"></div>
      </div>
    </div>
  `;
  $("#root-zoom-out").addEventListener("click", () => zoomRoot(-0.1));
  $("#root-zoom-in").addEventListener("click", () => zoomRoot(0.1));
  renderLayer($("#root-layer"), null);
}

function renderLayer(layer, parentId) {
  layer.innerHTML = "";
  activeItems(parentId).forEach((item) => {
    const node = document.createElement("article");
    node.className = `object-card type-${item.type} ${item.color} status-${item.status}${item.minimized ? " minimized" : ""}${item.fullscreen ? " fullscreen" : ""}${item.id === data.selectedItemId ? " selected" : ""}`;
    node.dataset.itemId = item.id;
    node.tabIndex = 0;
    node.style.left = `${item.x}px`;
    node.style.top = `${item.y}px`;
    node.style.width = `${item.w}px`;
    node.style.height = `${item.h}px`;
    node.style.zIndex = item.z || 1;
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
               <button class="size-button" data-add-child="board" type="button" title="Ic pano">▣</button>
               <button class="size-button" data-zoom-step="-0.1" type="button" title="Zoom out">−</button>
               <button class="size-button" data-zoom-step="0.1" type="button" title="Zoom in">＋</button>`
            : ""
        }
        <button class="size-button" data-toggle-minimized="true" type="button" title="Minimize">${item.minimized ? "▤" : "_"}</button>
        <button class="size-button" data-toggle-fullscreen="true" type="button" title="Fullscreen">${item.fullscreen ? "↙" : "⛶"}</button>
        <button class="size-button" data-open-window="true" type="button" title="Ayri pencere">□</button>
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
    <div class="board-inner" style="--board-zoom:${item.zoom || 1}">
      <div class="object-layer nested-layer" data-parent-id="${item.id}"></div>
    </div>
  `;
}

function renderObjectBody(item) {
  const components = item.components?.length ? item.components : componentsFromLegacyItem(item);
  return `<div class="component-stack">${components.map((component) => renderComponent(component, item)).join("")}</div>`;
}

function wireItem(node, item) {
  node.addEventListener("pointerdown", () => {
    selectItem(item.id);
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
      await toggleTask(item.id, checkbox.dataset.componentId, checkbox.dataset.taskId, checkbox.checked);
    });
  });

  node.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openObjectDialog(item, item.parentId || null));
  });

  node.querySelectorAll("[data-toggle-minimized]").forEach((button) => {
    button.addEventListener("click", () => toggleItemState(item.id, "minimized"));
  });

  node.querySelectorAll("[data-toggle-fullscreen]").forEach((button) => {
    button.addEventListener("click", () => toggleItemState(item.id, "fullscreen"));
  });

  node.querySelectorAll("[data-open-window]").forEach((button) => {
    button.addEventListener("click", () => window.planner.openItemWindow(item.id));
  });

  node.querySelectorAll("[data-preview-image]").forEach((button) => {
    button.addEventListener("click", () => openImagePreview(button.dataset.previewImage));
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

  node.querySelectorAll("[data-zoom-step]").forEach((button) => {
    button.addEventListener("click", () => zoomBoard(item.id, Number(button.dataset.zoomStep)));
  });
}

async function selectItem(itemId, shouldRender = false) {
  data.zCounter = (data.zCounter || 0) + 1;
  data.selectedItemId = itemId;
  data.notes = data.notes.map((item) => (item.id === itemId ? { ...item, z: data.zCounter } : item));

  document.querySelectorAll(".object-card.selected").forEach((node) => node.classList.remove("selected"));
  const node = document.querySelector(`.object-card[data-item-id="${itemId}"]`);
  if (node) {
    node.classList.add("selected");
    node.style.zIndex = data.zCounter;
  }

  await persist();
  if (shouldRender) render();
}

async function toggleItemState(itemId, key) {
  data.notes = data.notes.map((item) => {
    if (item.id !== itemId) return item;
    const next = { ...item, [key]: !item[key] };
    if (key === "fullscreen" && !item.fullscreen) next.minimized = false;
    if (key === "minimized" && !item.minimized) next.fullscreen = false;
    return next;
  });
  await persist();
  render();
}

async function zoomBoard(itemId, step) {
  data.notes = data.notes.map((item) => {
    if (item.id !== itemId) return item;
    const zoom = Math.min(1.8, Math.max(0.5, Math.round(((item.zoom || 1) + step) * 10) / 10));
    return { ...item, zoom };
  });
  await persist();
  render();
}

async function zoomRoot(step) {
  data.rootZoom = Math.min(1.8, Math.max(0.5, Math.round(((data.rootZoom || 1) + step) * 10) / 10));
  await persist();
  render();
}

function openImagePreview(url) {
  $("#image-preview").src = url;
  $("#image-preview-dialog").showModal();
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
  editingComponents = cloneComponents(item?.components?.length ? item.components : componentsFromLegacyItem(item || {}));
  selectedColor = item?.color || "yellow";
  $("#dialog-title").textContent = item ? "Objeyi duzenle" : "Yeni obje";
  $("#note-title").value = item?.title || "";
  $("#note-type").value = item?.type === "board" || forcedType === "board" ? "board" : "postit";
  $("#note-status").value = item?.status || "next";
  $("#note-size").value = item?.size || "medium";
  $("#note-energy").value = item?.energy || "low";
  $("#delete-note").hidden = !item;
  syncDialogFields();
  renderComponentEditor();
  renderSwatches();
  $("#note-dialog").showModal();
  $("#note-title").focus();
}

function syncDialogFields() {
  const type = $("#note-type").value;
  $("#component-menu").hidden = type === "board";
  $("#component-editor").hidden = type === "board";
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

function componentsFromLegacyItem(item) {
  if (item.type === "board") return [];
  if (item.type === "image") {
    return item.imageUrl ? [{ id: uid("c"), type: "image", url: item.imageUrl }] : [];
  }
  if (item.type === "text") {
    const text = item.tasks?.map((task) => task.text).join("\n") || item.body || "";
    return text ? [{ id: uid("c"), type: "text", text }] : [];
  }
  if (item.tasks?.length) {
    return [{ id: uid("c"), type: "todo", tasks: item.tasks }];
  }
  return [];
}

function renderComponent(component, item) {
  if (component.type === "image") {
    return component.url
      ? `<button class="component image-body" data-preview-image="${escapeAttribute(component.url)}" type="button"><img src="${escapeAttribute(component.url)}" alt="${escapeAttribute(item.title)}" /></button>`
      : `<p class="component text-body muted">Resim yolu yok</p>`;
  }

  if (component.type === "todo") {
    return `<div class="component task-list">${renderTaskList(component)}</div>`;
  }

  return `<p class="component text-body">${escapeHtml(component.text || "Yazi ekle")}</p>`;
}

function renderTaskList(component) {
  if (!component.tasks?.length) return `<p class="empty-tasks">Madde yok</p>`;
  return component.tasks
    .map(
      (task) => `
        <label class="task-item${task.done ? " done" : ""}">
          <input data-component-id="${component.id}" data-task-id="${task.id}" type="checkbox" ${task.done ? "checked" : ""} />
          <span>${escapeHtml(task.text)}</span>
        </label>
      `
    )
    .join("");
}

function taskProgress(item) {
  const tasks = allTasks(item);
  if (!tasks.length) return "0/0";
  const done = tasks.filter((task) => task.done).length;
  return `${done}/${tasks.length}`;
}

function allTasks(item) {
  const componentTasks = (item.components || []).flatMap((component) => component.tasks || []);
  return componentTasks.length ? componentTasks : item.tasks || [];
}

function cloneComponents(components) {
  return components.map((component) => ({
    ...component,
    tasks: component.tasks ? component.tasks.map((task) => ({ ...task })) : undefined
  }));
}

function renderComponentEditor() {
  const root = $("#component-editor");
  root.innerHTML = "";
  if (!editingComponents.length) {
    root.innerHTML = `<p class="empty-editor">Component yok. Ustteki ikonlardan ekle.</p>`;
    return;
  }

  editingComponents.forEach((component, index) => {
    const block = document.createElement("section");
    block.className = "component-block";
    block.dataset.componentId = component.id;
    block.innerHTML = `
      <div class="component-block-head">
        <strong>${componentTitle(component.type)}</strong>
        <button class="size-button" data-remove-component="${component.id}" type="button" title="Sil">×</button>
      </div>
      ${renderComponentEditorField(component)}
    `;
    block.querySelector("[data-remove-component]").addEventListener("click", () => {
      editingComponents.splice(index, 1);
      renderComponentEditor();
    });
    block.querySelectorAll("[data-browse-image]").forEach((button) => {
      button.addEventListener("click", async () => {
        const imageUrl = await window.planner.importImage();
        if (!imageUrl) return;
        editingComponents = editingComponents.map((current) =>
          current.id === button.dataset.browseImage ? { ...current, url: imageUrl } : current
        );
        renderComponentEditor();
      });
    });
    root.append(block);
  });
}

function componentTitle(type) {
  if (type === "todo") return "To-do";
  if (type === "image") return "Foto";
  return "Yazi";
}

function renderComponentEditorField(component) {
  if (component.type === "image") {
    return `
      <div class="image-picker-row">
        <input data-component-value="${component.id}" maxlength="800" value="${escapeAttribute(component.url || "")}" placeholder="Resim URL veya dosya yolu" />
        <button class="ghost-button" data-browse-image="${component.id}" type="button">Browse</button>
      </div>
    `;
  }
  if (component.type === "todo") {
    const value = (component.tasks || []).map((task) => task.text).join("\n");
    return `<textarea data-component-value="${component.id}" maxlength="700" placeholder="Her satir bir is">${escapeHtml(value)}</textarea>`;
  }
  return `<textarea data-component-value="${component.id}" maxlength="900" placeholder="Duz yazi">${escapeHtml(component.text || "")}</textarea>`;
}

function readComponentsFromEditor() {
  return editingComponents
    .map((component) => {
      const field = document.querySelector(`[data-component-value="${component.id}"]`);
      const value = field?.value.trim() || "";
      if (component.type === "image") return value ? { ...component, url: value } : null;
      if (component.type === "todo") {
        const oldByText = new Map((component.tasks || []).map((task) => [task.text, task]));
        const tasks = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 16)
          .map((text) => oldByText.get(text) || { id: uid("t"), text, done: false });
        return tasks.length ? { ...component, tasks } : null;
      }
      return value ? { ...component, text: value } : null;
    })
    .filter(Boolean);
}

async function saveObject() {
  const title = $("#note-title").value.trim() || "Adsiz obje";
  const existing = data.notes.find((item) => item.id === editingNoteId);
  const type = $("#note-type").value === "board" ? "board" : "postit";
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
    components: type === "board" ? [] : readComponentsFromEditor(),
    tasks: [],
    imageUrl: "",
    size,
    x: position.x,
    y: position.y,
    w: existing?.w || defaults.w,
    h: existing?.h || defaults.h,
    minimized: existing?.minimized || false,
    fullscreen: existing?.fullscreen || false,
    zoom: existing?.zoom || 1,
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
    components: [],
    imageUrl: "",
    size: "large",
    x: position.x,
    y: position.y,
    w: sizeDefaults.board.w,
    h: sizeDefaults.board.h,
    minimized: false,
    fullscreen: false,
    zoom: 1,
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
    scale: layerScale(layer),
    startX: event.clientX,
    startY: event.clientY,
    initialX: (cardRect.left - layerRect.left) / layerScale(layer),
    initialY: (cardRect.top - layerRect.top) / layerScale(layer),
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
  const dx = (event.clientX - dragState.startX) / dragState.scale;
  const dy = (event.clientY - dragState.startY) / dragState.scale;
  if (Math.abs(dx) + Math.abs(dy) > 6) dragState.moved = true;
  const maxX = Math.max(0, dragState.layer.clientWidth - dragState.card.offsetWidth - 8);
  const maxY = Math.max(0, dragState.layer.clientHeight - dragState.card.offsetHeight - 8);
  const x = Math.min(maxX, Math.max(8, dragState.initialX + dx));
  const y = Math.min(maxY, Math.max(8, dragState.initialY + dy));
  dragState.card.style.left = `${x}px`;
  dragState.card.style.top = `${y}px`;
}

function layerScale(layer) {
  const transform = window.getComputedStyle(layer).transform;
  if (!transform || transform === "none") return 1;
  const match = transform.match(/^matrix\(([^,]+)/);
  return match ? Number(match[1]) || 1 : 1;
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

async function toggleTask(itemId, componentId, taskId, done) {
  data.notes = data.notes.map((item) => {
    if (item.id !== itemId) return item;
    const components = (item.components || []).map((component) => {
      if (component.id !== componentId) return component;
      return {
        ...component,
        tasks: (component.tasks || []).map((task) => (task.id === taskId ? { ...task, done } : task))
      };
    });
    const tasks = components.flatMap((component) => component.tasks || []);
    const allDone = tasks.length > 0 && tasks.every((task) => task.done);
    const status = allDone ? "done" : item.status === "done" ? "next" : item.status;
    return { ...item, components, tasks: [], status };
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
  $("#add-text-component").addEventListener("click", () => {
    editingComponents.push({ id: uid("c"), type: "text", text: "" });
    renderComponentEditor();
  });
  $("#add-todo-component").addEventListener("click", () => {
    editingComponents.push({ id: uid("c"), type: "todo", tasks: [{ id: uid("t"), text: "", done: false }] });
    renderComponentEditor();
  });
  $("#add-image-component").addEventListener("click", () => {
    editingComponents.push({ id: uid("c"), type: "image", url: "" });
    renderComponentEditor();
  });

  $("#note-dialog").addEventListener("paste", async (event) => {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    const bytes = await file.arrayBuffer();
    const imageUrl = await window.planner.saveImageAsset({
      name: file.name || "pasted-image.png",
      bytes
    });
    editingComponents.push({ id: uid("c"), type: "image", url: imageUrl });
    renderComponentEditor();
  });

  $("#add-section").addEventListener("click", () => {
    $("#section-title").value = "";
    $("#section-dialog").showModal();
    $("#section-title").focus();
  });

  $("#save-section").addEventListener("click", async (event) => {
    event.preventDefault();
    const title = $("#section-title").value;
    if (!title.trim()) return;
    const accents = ["#3d8bff", "#00a66d", "#ffb02e", "#d85a7f", "#7a6ccf"];
    const section = {
      id: uid("s"),
      title: title.trim().slice(0, 32),
      accent: accents[data.sections.length % accents.length]
    };
    data.sections.push(section);
    data.selectedSectionId = section.id;
    await persist();
    $("#section-dialog").close();
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
