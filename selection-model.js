const naturalOrder = new Intl.Collator("it", { numeric: true, sensitivity: "base" });
const pathOf = (file) => file.webkitRelativePath || file.name;

export function createSelection() {
  return { left: [], right: [], index: 0, history: [] };
}

export function pairCount(selection) {
  return Math.max(selection.left.length, selection.right.length);
}

export function importFiles(selection, side, files) {
  const images = Array.from(files).filter((file) => file.type.startsWith("image/") ||
    (!file.type && /\.(avif|bmp|gif|jpe?g|png|svg|webp|ico)$/i.test(file.name)));
  if (!images.length) return 0;
  images.sort((a, b) => naturalOrder.compare(pathOf(a), pathOf(b)) ||
    pathOf(a).localeCompare(pathOf(b)));
  selection[side] = images.map((file) => ({ file, excluded: false }));
  // Replacing a source invalidates only undo operations for that source.
  selection.history = selection.history.filter((action) => action.side !== side);
  selection.index = 0;
  return images.length;
}

export function excludeImage(selection, side) {
  const entry = selection[side][selection.index];
  if (!entry || entry.excluded) return false;
  entry.excluded = true;
  selection.history.push({ side, index: selection.index, entry });
  return true;
}

export function undoExclusion(selection) {
  const action = selection.history.pop();
  if (!action) return false;
  action.entry.excluded = false;
  selection.index = action.index;
  return true;
}

export function navigate(selection, delta) {
  selection.index = Math.max(0, Math.min(pairCount(selection) - 1, selection.index + delta));
}

export function exportEntries(selection, format) {
  const entries = [];
  for (let i = 0; i < pairCount(selection); i++) {
    for (const side of ["left", "right"]) {
      const entry = selection[side][i];
      if (entry && !entry.excluded) entries.push(entry);
    }
  }
  const digits = Math.max(4, String(entries.length).length);
  return entries.map((entry, i) => {
    const base = entry.file.name.replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").slice(0, 140) || "immagine";
    return { ...entry, name: `${String(i + 1).padStart(digits, "0")}_${base}.${format}` };
  });
}

export function uniqueName(name, occupied) {
  const dot = name.lastIndexOf(".");
  const base = name.slice(0, dot);
  const extension = name.slice(dot);
  let candidate = name;
  let suffix = 2;
  while (occupied.has(candidate.toLowerCase())) candidate = `${base}_${suffix++}${extension}`;
  occupied.add(candidate.toLowerCase());
  return candidate;
}
