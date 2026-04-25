const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const createDefaultData = () => ({
  sections: [
    { id: "today", title: "Bugun", accent: "#3d8bff" },
    { id: "week", title: "Bu hafta", accent: "#00a66d" },
    { id: "ideas", title: "Fikirler", accent: "#ffb02e" }
  ],
  notes: [
    {
      id: "n-1",
      sectionId: "today",
      title: "Tek ana is",
      body: "25 dk odak",
      tasks: [
        { id: "t-1", text: "Basla", done: false },
        { id: "t-2", text: "25 dk odak", done: false }
      ],
      size: "large",
      x: 72,
      y: 74,
      color: "yellow",
      status: "doing",
      energy: "low"
    },
    {
      id: "n-2",
      sectionId: "today",
      title: "Kisa mola",
      body: "Su + esneme",
      tasks: [
        { id: "t-3", text: "Su ic", done: false },
        { id: "t-4", text: "Esne", done: false }
      ],
      size: "small",
      x: 382,
      y: 138,
      color: "mint",
      status: "next",
      energy: "low"
    },
    {
      id: "n-3",
      sectionId: "week",
      title: "Plan panosu",
      body: "Kartlari sade tut",
      tasks: [
        { id: "t-5", text: "Karti kisa tut", done: false },
        { id: "t-6", text: "Durum sec", done: false },
        { id: "t-7", text: "Renk ver", done: false }
      ],
      size: "medium",
      x: 116,
      y: 96,
      color: "pink",
      status: "waiting",
      energy: "medium"
    }
  ],
  selectedSectionId: "today",
  focusNoteId: "n-1"
});

const dataPath = () => path.join(app.getPath("userData"), "planner-data.json");

async function readData() {
  try {
    const raw = await fs.readFile(dataPath(), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const data = createDefaultData();
    await writeData(data);
    return data;
  }
}

async function writeData(data) {
  await fs.mkdir(path.dirname(dataPath()), { recursive: true });
  await fs.writeFile(dataPath(), JSON.stringify(data, null, 2));
  return data;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    title: "PlanlaMa",
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("planner:load", readData);
  ipcMain.handle("planner:save", (_event, data) => writeData(data));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
