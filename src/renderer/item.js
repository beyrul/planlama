const params = new URLSearchParams(window.location.search);
const itemId = params.get("id");

let data;

const typeLabels = {
  board: "Pano",
  postit: "Post-it"
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

async function persist() {
  data = await window.planner.save(data);
}

function childrenOf(id) {
  return data.notes.filter((candidate) => candidate.parentId === id);
}

function renderComponent(component, item) {
  if (component.type === "image") {
    return component.url
      ? `<button class="component image-body" type="button"><img src="${escapeHtml(component.url)}" alt="${escapeHtml(item.title)}" /></button>`
      : `<p class="component text-body muted">Resim yolu yok</p>`;
  }

  if (component.type === "todo") {
    return `<div class="component task-list">${(component.tasks || [])
      .map(
        (task) => `
          <label class="task-item${task.done ? " done" : ""}">
            <input data-item-id="${item.id}" data-component-id="${component.id}" data-task-id="${task.id}" type="checkbox" ${task.done ? "checked" : ""} />
            <span>${escapeHtml(task.text)}</span>
          </label>
        `
      )
      .join("")}</div>`;
  }

  return `<p class="component text-body">${escapeHtml(component.text || "")}</p>`;
}

function renderObjectBody(item) {
  if (item.type === "board") {
    return `
      <div class="board-inner" style="--board-zoom:${item.zoom || 1}">
        <div class="object-layer nested-layer" data-parent-id="${item.id}">
          ${childrenOf(item.id).map(renderFloatingItem).join("")}
        </div>
      </div>
    `;
  }

  return `<div class="component-stack">${(item.components || []).map((component) => renderComponent(component, item)).join("")}</div>`;
}

function renderFloatingItem(item) {
  return `
    <article class="object-card type-${item.type} ${item.color || "yellow"} status-${item.status}" data-item-id="${item.id}" style="left:${item.x}px; top:${item.y}px; width:${item.w}px; height:${item.h}px; z-index:${item.z || 1}">
      ${renderItemInner(item)}
    </article>
  `;
}

function renderItemInner(item) {
  return `
    <div class="object-head">
      <div>
        <span class="object-type">${typeLabels[item.type]}</span>
        <h4>${escapeHtml(item.title)}</h4>
      </div>
      <div class="note-tools">
        <button class="size-button" data-open-child="${item.id}" type="button" title="Odakla">□</button>
      </div>
    </div>
    ${renderObjectBody(item)}
    <div class="object-foot">
      <span class="pill">${item.status || "next"}</span>
      <span class="pill">${item.type === "board" ? `${childrenOf(item.id).length} obje` : taskProgress(item)}</span>
    </div>
  `;
}

function taskProgress(item) {
  const tasks = (item.components || []).flatMap((component) => component.tasks || []);
  if (!tasks.length) return "0/0";
  return `${tasks.filter((task) => task.done).length}/${tasks.length}`;
}

async function toggleTask(itemIdForTask, componentId, taskId, done) {
  data.notes = data.notes.map((item) => {
    if (item.id !== itemIdForTask) return item;
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
    return { ...item, components, status };
  });
  await persist();
  render();
}

function wireEvents() {
  document.querySelector("#close-window").addEventListener("click", () => window.planner.closeWindow());

  document.querySelectorAll("[data-task-id]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      await toggleTask(
        checkbox.dataset.itemId,
        checkbox.dataset.componentId,
        checkbox.dataset.taskId,
        checkbox.checked
      );
    });
  });

  document.querySelectorAll("[data-open-child]").forEach((button) => {
    button.addEventListener("click", () => window.planner.openItemWindow(button.dataset.openChild));
  });
}

function render() {
  const item = data.notes.find((candidate) => candidate.id === itemId);
  const root = document.querySelector("#item-root");
  if (!item) {
    root.innerHTML = `<p class="empty-editor">Obje bulunamadi.</p>`;
    return;
  }

  root.innerHTML = `
    <button class="detached-close" id="close-window" type="button">Kapat</button>
    <section class="corkboard item-canvas">
      <div class="workspace-canvas">
        <div class="canvas-head">
          <span>${escapeHtml(item.title)}</span>
          <span>${typeLabels[item.type]}</span>
        </div>
        <div class="root-viewport">
          <article class="object-card item-focus-card type-${item.type} ${item.color || "yellow"} status-${item.status}">
            ${renderItemInner(item)}
          </article>
        </div>
      </div>
    </section>
  `;
  document.title = `PlanlaMa - ${item.title}`;
  wireEvents();
}

async function init() {
  data = await window.planner.load();
  render();
}

init();
