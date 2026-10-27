import test from "node:test";
import assert from "node:assert/strict";
import { createSelection, pairCount, importFiles, excludeImage, undoExclusion, navigate, exportEntries, uniqueName } from "../selection-model.js";
import { ImageZip } from "../selection-zip.js";
import { writeFolderImage } from "../selection-folder.js";

const image = (name, webkitRelativePath = "") => ({ name, type: "image/png", webkitRelativePath });

test("folder files sort naturally; non-images and canceled imports preserve sources", () => {
  const state = createSelection();
  importFiles(state, "left", [image("10.png"), image("2.png"), { name: "readme.txt", type: "text/plain" }]);
  assert.deepEqual(state.left.map((entry) => entry.file.name), ["2.png", "10.png"]);
  assert.equal(importFiles(state, "left", []), 0);
  assert.equal(state.left.length, 2);
  importFiles(state, "left", [image("z.png", "folder/2/z.png"), image("a.png", "folder/10/a.png")]);
  assert.equal(state.left[0].file.name, "z.png");
});

test("unequal collections retain every image and navigation is bounded", () => {
  const state = createSelection();
  importFiles(state, "left", [image("1.png"), image("2.png"), image("3.png")]);
  importFiles(state, "right", [image("1.png")]);
  assert.equal(pairCount(state), 3);
  navigate(state, 10);
  assert.equal(state.index, 2);
  navigate(state, -10);
  assert.equal(state.index, 0);
  assert.deepEqual(exportEntries(state, "png").map((entry) => entry.name), ["0001_1.png", "0002_1.png", "0003_2.png", "0004_3.png"]);
});

test("exclusion keeps the slot empty and undo returns to the original pair in LIFO order", () => {
  const state = createSelection();
  importFiles(state, "left", [image("1.png"), image("2.png")]);
  importFiles(state, "right", [image("1.png"), image("2.png")]);
  excludeImage(state, "left");
  assert.equal(excludeImage(state, "left"), false);
  assert.equal(state.left.length, 2);
  navigate(state, 1);
  excludeImage(state, "right");
  assert.equal(exportEntries(state, "jpg").length, 2);
  navigate(state, -1);
  undoExclusion(state);
  assert.equal(state.index, 1);
  assert.equal(state.right[1].excluded, false);
  undoExclusion(state);
  assert.equal(state.index, 0);
  assert.equal(state.left[0].excluded, false);
  assert.equal(undoExclusion(state), false);
});

test("replacing one source preserves valid undo for the other source", () => {
  const state = createSelection();
  importFiles(state, "left", [image("old.png")]);
  importFiles(state, "right", [image("right.png")]);
  excludeImage(state, "left");
  excludeImage(state, "right");
  importFiles(state, "left", [image("new.png")]);
  assert.equal(state.history.length, 1);
  undoExclusion(state);
  assert.equal(state.right[0].excluded, false);
  assert.equal(state.left[0].file.name, "new.png");
});

test("exports preserve duplicate names and use valid, collision-free ordered names", () => {
  const state = createSelection();
  importFiles(state, "left", [image("same.png"), image('invalid:name.png')]);
  importFiles(state, "right", [image("same.png")]);
  const entries = exportEntries(state, "jpg");
  assert.equal(new Set(entries.map((entry) => entry.name)).size, 3);
  assert.equal(entries.filter((entry) => entry.file.name === "same.png").length, 2);
  assert.ok(entries.every((entry) => !/[\\/:*?"<>|]/.test(entry.name)));
  const occupied = new Set(["0001_same.jpg", "0001_same_2.jpg"]);
  assert.equal(uniqueName("0001_same.jpg", occupied), "0001_same_3.jpg");
  assert.equal(uniqueName("0001_SAME.jpg", occupied), "0001_SAME_4.jpg");
});

test("excluding both images exports nothing without losing navigation or undo", () => {
  const state = createSelection();
  importFiles(state, "left", [image("same.png")]);
  importFiles(state, "right", [image("same.png")]);
  excludeImage(state, "left");
  excludeImage(state, "right");
  assert.equal(exportEntries(state, "png").length, 0);
  assert.equal(pairCount(state), 1);
  undoExclusion(state);
  assert.equal(exportEntries(state, "png").length, 1);
});

test("ZIP stores UTF-8 names, sizes, offsets, CRC and independent entries", async () => {
  const zip = new ImageZip();
  await zip.add("0001_città.png", new Blob(["123456789"]));
  await zip.add("0002_città.png", new Blob(["abcdef"]));
  const data = new Uint8Array(await zip.toBlob().arrayBuffer());
  const view = new DataView(data.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x800);
  assert.equal(view.getUint32(14, true), 0xcbf43926); // Standard CRC32 test vector.
  assert.equal(view.getUint32(18, true), 9);
  const end = data.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const central = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  const nameLength = view.getUint16(central + 28, true);
  assert.equal(new TextDecoder().decode(data.slice(central + 46, central + 46 + nameLength)), "0001_città.png");
  assert.equal(view.getUint32(central + 42, true), 0);
  const second = central + 46 + nameLength;
  assert.equal(view.getUint32(second + 42, true), 30 + nameLength + 9);
});

test("folder export commits new files and never overwrites an existing name", async () => {
  const saved = new Map([["0001_image.png", "original"]]);
  const folder = {
    async getFileHandle(name, options) {
      assert.equal(options.create, true);
      return { async createWritable() {
        let content;
        return {
          async write(blob) { content = await blob.text(); },
          async close() { saved.set(name, content); },
          async abort() { assert.fail("Successful write should not abort"); }
        };
      } };
    }
  };
  const occupied = new Set(saved.keys());
  assert.equal(await writeFolderImage(folder, "0001_image.png", new Blob(["new image"]), occupied), "0001_image_2.png");
  assert.equal(saved.get("0001_image.png"), "original");
  assert.equal(saved.get("0001_image_2.png"), "new image");
});

test("failed folder writes abort their stream and propagate the error", async () => {
  let aborted = false;
  let closed = false;
  const folder = { async getFileHandle() { return { async createWritable() { return {
    async write() { throw new Error("Disk full"); },
    async close() { closed = true; },
    async abort() { aborted = true; }
  }; } }; } };
  await assert.rejects(writeFolderImage(folder, "0001_image.png", new Blob(["image"]), new Set()), /Disk full/);
  assert.equal(aborted, true);
  assert.equal(closed, false);
});
