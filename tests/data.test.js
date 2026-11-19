import assert from "node:assert/strict";
import test from "node:test";

import {
  collectLinks,
  createBackup,
  mergeStates,
  normalizeState,
  parseBackup
} from "../js/data.js";

function link(id, host) {
  return { id, title: id, url: `https://${host}` };
}

test("normalizeState preserves valid folders and their children", () => {
  const state = normalizeState({
    links: [
      link("site-a", "a.example"),
      {
        id: "folder-work",
        type: "folder",
        title: "工作",
        children: [link("site-b", "b.example"), link("site-c", "c.example")]
      }
    ]
  });

  assert.equal(state.links.length, 2);
  assert.equal(state.links[1].type, "folder");
  assert.equal(state.links[1].title, "工作");
  assert.deepEqual(
    state.links[1].children.map((item) => item.id),
    ["site-b", "site-c"]
  );
});

test("normalizeState flattens a folder with one remaining child", () => {
  const state = normalizeState({
    links: [
      link("site-a", "a.example"),
      {
        id: "folder-work",
        type: "folder",
        title: "工作",
        children: [link("site-b", "b.example")]
      }
    ]
  });

  assert.deepEqual(state.links.map((item) => item.id), ["site-a", "site-b"]);
  assert.equal(state.links.some((item) => item.type === "folder"), false);
});

test("normalizeState assigns unique ids across folders and children", () => {
  const state = normalizeState({
    links: [
      link("duplicate", "a.example"),
      {
        id: "duplicate",
        type: "folder",
        title: "工作",
        children: [link("site-b", "b.example"), link("site-c", "c.example")]
      }
    ]
  });

  const ids = [
    ...state.links.map((item) => item.id),
    ...state.links.flatMap((item) => item.children?.map((child) => child.id) ?? [])
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test("backup round trip preserves folders", () => {
  const state = normalizeState({
    links: [{
      id: "folder-work",
      type: "folder",
      title: "工作",
      children: [link("site-b", "b.example"), link("site-c", "c.example")]
    }]
  });

  const restored = parseBackup(createBackup(state, "0.2.16"));
  assert.equal(restored.state.links[0].type, "folder");
  assert.equal(restored.state.links[0].children.length, 2);
});

test("mergeStates keeps current folders and adds imported folder sites to home", () => {
  const current = normalizeState({
    links: [
      {
        id: "folder-work",
        type: "folder",
        title: "工作",
        children: [link("site-a", "a.example"), link("site-b", "b.example")]
      },
      link("site-c", "c.example")
    ]
  });
  const imported = normalizeState({
    links: [
      link("site-a", "a.example"),
      link("site-d", "d.example"),
      {
        id: "folder-imported",
        type: "folder",
        title: "备份",
        children: [link("site-e", "e.example"), link("site-f", "f.example")]
      }
    ]
  });

  const merged = mergeStates(current, imported);
  assert.equal(merged.links[0].type, "folder");
  assert.deepEqual(
    merged.links[0].children.map((item) => item.id),
    ["site-a", "site-b"]
  );
  assert.deepEqual(
    merged.links.slice(1).map((item) => item.id),
    ["site-c", "site-d", "site-e", "site-f"]
  );
});

test("collectLinks returns links inside folders", () => {
  const state = normalizeState({
    links: [{
      id: "folder-work",
      type: "folder",
      title: "工作",
      children: [link("site-b", "b.example"), link("site-c", "c.example")]
    }]
  });

  assert.deepEqual(
    collectLinks(state.links).map((item) => item.id),
    ["site-b", "site-c"]
  );
});

test("normalizeState keeps duplicate ids without dropping sites", () => {
  const state = normalizeState({
    links: [
      link("duplicate", "a.example"),
      link("duplicate", "b.example")
    ]
  });

  assert.equal(state.links.length, 2);
  assert.equal(new Set(state.links.map((item) => item.id)).size, 2);
  assert.deepEqual(
    state.links.map((item) => item.url),
    ["https://a.example/", "https://b.example/"]
  );
});

test("normalizeState keeps every child when a folder exceeds the soft cap", () => {
  const children = Array.from({ length: 25 }, (_, index) =>
    link(`site-${index}`, `site-${index}.example`)
  );
  const state = normalizeState({
    links: [{
      id: "folder-large",
      type: "folder",
      title: "大文件夹",
      children
    }]
  });

  assert.equal(state.links[0].children.length, 25);
});
