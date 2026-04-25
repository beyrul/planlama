const params = new URLSearchParams(window.location.search);
const itemId = params.get("id");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
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
            <input type="checkbox" ${task.done ? "checked" : ""} disabled />
            <span>${escapeHtml(task.text)}</span>
          </label>
        `
      )
      .join("")}</div>`;
  }

  return `<p class="component text-body">${escapeHtml(component.text || "")}</p>`;
}

function renderItem(item, children) {
  const components = item.components || [];
  const childMarkup = children
    .map((child) => `<section class="detached-child"><h3>${escapeHtml(child.title)}</h3>${renderItem(child, [])}</section>`)
    .join("");

  return `
    <article class="detached-card type-${item.type} ${item.color || "yellow"}">
      <header class="detached-head">
        <span>${item.type === "board" ? "Pano" : "Post-it"}</span>
        <h1>${escapeHtml(item.title)}</h1>
      </header>
      <div class="component-stack">
        ${components.map((component) => renderComponent(component, item)).join("")}
      </div>
      ${childMarkup ? `<div class="detached-children">${childMarkup}</div>` : ""}
    </article>
  `;
}

async function init() {
  const data = await window.planner.load();
  const item = data.notes.find((candidate) => candidate.id === itemId);
  const root = document.querySelector("#item-root");
  if (!item) {
    root.innerHTML = `<p class="empty-editor">Obje bulunamadi.</p>`;
    return;
  }
  const children = data.notes.filter((candidate) => candidate.parentId === item.id);
  root.innerHTML = renderItem(item, children);
}

init();
