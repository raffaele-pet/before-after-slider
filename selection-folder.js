import { uniqueName } from "./selection-model.js";

export async function writeFolderImage(folder, name, blob, occupied) {
  const outputName = uniqueName(name, occupied);
  const handle = await folder.getFileHandle(outputName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return outputName;
}
