"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/host/linkTarget.ts
var linkTarget_exports = {};
__export(linkTarget_exports, {
  appendImageVersionStamp: () => appendImageVersionStamp,
  classifyImageTarget: () => classifyImageTarget,
  classifyLinkTarget: () => classifyLinkTarget,
  imageBlockReasonOf: () => imageBlockReasonOf,
  planPathTextOf: () => planPathTextOf,
  splitHrefFragment: () => splitHrefFragment
});
module.exports = __toCommonJS(linkTarget_exports);
var path2 = __toESM(require("node:path"));

// src/shared/vaultLink.ts
var path = __toESM(require("node:path"));
function pathOps(ctx) {
  return ctx.isWindowsHost ? path.win32 : path.posix;
}
var WINDOWS_DRIVE_ABSOLUTE_RE = /^[a-zA-Z]:\//;
function isInsideRoot(absolute, rootDir, ops) {
  const rel = ops.relative(rootDir, absolute);
  if (rel === "") {
    return true;
  }
  return rel !== ".." && !rel.startsWith(`..${ops.sep}`) && !ops.isAbsolute(rel);
}
function candidatesOf(base, ops, implicitMd) {
  return ops.extname(base) ? [base] : implicitMd ? [base, `${base}.md`] : [base];
}
function planVaultLinkPath(rawPath, ctx, options = {}) {
  const implicitMd = options.implicitMd ?? true;
  const p = (ctx.isWindowsHost ? rawPath.replace(/\\/g, "/") : rawPath).trim();
  if (p === "") {
    return { kind: "escape", detail: rawPath };
  }
  const ops = pathOps(ctx);
  if (ctx.isWindowsHost ? WINDOWS_DRIVE_ABSOLUTE_RE.test(p) : p.startsWith("/")) {
    return { kind: "absolute", candidates: candidatesOf(ops.resolve(p), ops, implicitMd) };
  }
  const base = ops.resolve(ctx.docDir, p);
  if (!isInsideRoot(base, ctx.rootDir, ops)) {
    return { kind: "escape", detail: rawPath };
  }
  return { kind: "inside", candidates: candidatesOf(base, ops, implicitMd) };
}

// src/host/linkTarget.ts
function appendImageVersionStamp(uri, generation) {
  return generation > 0 ? `${uri}?v=${generation}` : uri;
}
function schemeOf(text) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):(.*)$/.exec(text);
  if (!m) {
    return null;
  }
  return { scheme: m[1].toLowerCase(), rest: m[2] };
}
var WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/].*/;
function tolerantDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
function planPathTextOf(href) {
  return tolerantDecode(href.split("#")[0].split("?")[0]);
}
function splitHrefFragment(href) {
  const hashIdx = href.indexOf("#");
  if (hashIdx < 0) {
    return { pathText: href, fragment: null };
  }
  const rawFragment = href.slice(hashIdx + 1);
  if (rawFragment === "") {
    return { pathText: href.slice(0, hashIdx), fragment: null };
  }
  return { pathText: href.slice(0, hashIdx), fragment: tolerantDecode(rawFragment) };
}
function isWin32OddBasename(raw) {
  const rawPath = raw.split("#")[0].split("?")[0];
  const base = path2.win32.basename(rawPath);
  return base.includes(":") || /[.\s]$/.test(base);
}
function preClassify(raw, ctx) {
  const href = raw.trim();
  if (href.startsWith("#")) {
    const { fragment } = splitHrefFragment(href);
    if (fragment === null) {
      return { kind: "blocked", reason: "empty" };
    }
    return { kind: "anchor", fragment };
  }
  if (href === "") {
    return { kind: "blocked", reason: "empty" };
  }
  if (href.startsWith("//")) {
    return { kind: "blocked", reason: "scheme", scheme: "" };
  }
  if (WINDOWS_DRIVE_RE.test(href)) {
    if (ctx.isWindowsHost) {
      if (isWin32OddBasename(raw)) {
        return { kind: "blocked", reason: "escape", detail: href };
      }
      return { kind: "path", pathText: href };
    }
    return { kind: "blocked", reason: "windows-drive-on-posix" };
  }
  const s = schemeOf(href);
  if (s && s.scheme.length > 1 && !s.scheme.includes(".")) {
    if (s.scheme === "http" || s.scheme === "https") {
      return { kind: "external", url: href };
    }
    return { kind: "blocked", reason: "scheme", scheme: s.scheme };
  }
  if (ctx.isWindowsHost && isWin32OddBasename(raw)) {
    return { kind: "blocked", reason: "escape", detail: href };
  }
  return { kind: "path", pathText: href };
}
function classifyLinkTarget(href, ctx) {
  const pre = preClassify(href, ctx);
  if (pre.kind !== "path") {
    return pre;
  }
  const { pathText, fragment } = splitHrefFragment(pre.pathText);
  const plan = planVaultLinkPath(planPathTextOf(pathText), ctx, { implicitMd: true });
  if (plan.kind === "escape") {
    return { kind: "blocked", reason: "escape", detail: pre.pathText };
  }
  if (plan.kind === "absolute") {
    return { kind: "absolute", candidates: plan.candidates, fragment };
  }
  return { kind: "doc", candidates: plan.candidates, fragment };
}
function classifyImageTarget(src, ctx) {
  const pre = preClassify(src, ctx);
  if (pre.kind === "external") {
    return { kind: "blocked", reason: "scheme", scheme: "https" };
  }
  if (pre.kind === "anchor") {
    return { kind: "blocked", reason: "empty" };
  }
  if (pre.kind === "blocked") {
    return pre;
  }
  const plan = planVaultLinkPath(planPathTextOf(pre.pathText), ctx, { implicitMd: false });
  if (plan.kind === "escape") {
    return { kind: "blocked", reason: "escape", detail: pre.pathText };
  }
  if (plan.kind === "absolute") {
    return { kind: "absolute", fsPath: plan.candidates[0] };
  }
  return { kind: "workspace", fsPath: plan.candidates[0] };
}
function imageBlockReasonOf(target) {
  if (target.reason === "escape") {
    return "outside-workspace";
  }
  return "blocked";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  appendImageVersionStamp,
  classifyImageTarget,
  classifyLinkTarget,
  imageBlockReasonOf,
  planPathTextOf,
  splitHrefFragment
});
