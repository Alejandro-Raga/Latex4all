/**
 * YAML as Python's PyYAML writes it (safe_dump with allow_unicode=True,
 * sort_keys=False, width=1000), for note frontmatter: the same text the
 * Python sync writes, quote for quote. Its rules for when a string is quoted,
 * and how, are PyYAML's (emitter.analyze_scalar, choose_scalar_style).
 * Reading YAML back is js-yaml's job.
 */
import { load } from "js-yaml";

/** A date as YAML reads one (`2026-10-11`), written back unquoted. */
export class YamlDate {
  constructor(readonly iso: string) {}
}

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlDate
  | YamlValue[]
  | { [key: string]: YamlValue };

const WS = "\0 \t\r\n\u0085\u2028\u2029";
const BREAKS = "\n\u0085\u2028\u2029";

// The implicit resolvers of YAML 1.1, as PyYAML has them: a plain string
// matching one would read back as something else, so it's quoted.
const RESOLVERS = [
  /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/,
  /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9_]+(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
  /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
  /^(?:<<)$/,
  /^(?:~|null|Null|NULL|)$/,
  /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/,
  /^(?:=)$/,
  /^(?:!|&|\*)$/,
];
const readsAsString = (s: string) => !RESOLVERS.some((r) => r.test(s));

function printableUnicode(ch: string): boolean {
  const c = ch.codePointAt(0) as number;
  return (
    (c === 0x85 ||
      (c >= 0xa0 && c <= 0xd7ff) ||
      (c >= 0xe000 && c <= 0xfffd) ||
      (c >= 0x10000 && c < 0x10ffff)) &&
    c !== 0xfeff
  );
}

function analyze(s: string) {
  if (!s) return { blockPlain: true, single: true, multiline: false };
  let block = false;
  let flow = false;
  let lineBreaks = false;
  let special = false;
  let leadingSpace = false;
  let leadingBreak = false;
  let trailingSpace = false;
  let trailingBreak = false;
  let breakSpace = false;
  let spaceBreak = false;
  if (s.startsWith("---") || s.startsWith("...")) block = flow = true;
  const chars = [...s];
  let preceded = true;
  let followed = chars.length === 1 || WS.includes(chars[1]);
  let prevSpace = false;
  let prevBreak = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (i === 0) {
      if ("#,[]{}&*!|>'\"%@`".includes(ch)) flow = block = true;
      if ("?:".includes(ch)) {
        flow = true;
        if (followed) block = true;
      }
      if (ch === "-" && followed) flow = block = true;
    } else {
      if (",?[]{}".includes(ch)) flow = true;
      if (ch === ":") {
        flow = true;
        if (followed) block = true;
      }
      if (ch === "#" && preceded) flow = block = true;
    }
    if (BREAKS.includes(ch)) lineBreaks = true;
    const code = ch.codePointAt(0) as number;
    if (!(ch === "\n" || (code >= 0x20 && code <= 0x7e))) {
      if (!printableUnicode(ch)) special = true;
    }
    if (ch === " ") {
      if (i === 0) leadingSpace = true;
      if (i === chars.length - 1) trailingSpace = true;
      if (prevBreak) breakSpace = true;
      prevSpace = true;
      prevBreak = false;
    } else if (BREAKS.includes(ch)) {
      if (i === 0) leadingBreak = true;
      if (i === chars.length - 1) trailingBreak = true;
      if (prevSpace) spaceBreak = true;
      prevSpace = false;
      prevBreak = true;
    } else {
      prevSpace = prevBreak = false;
    }
    preceded = WS.includes(ch);
    followed = i + 2 >= chars.length || WS.includes(chars[i + 2]);
  }
  let blockPlain = true;
  let single = true;
  if (leadingSpace || leadingBreak || trailingSpace || trailingBreak)
    blockPlain = false;
  if (breakSpace) blockPlain = single = false;
  if (spaceBreak || special) blockPlain = single = false;
  if (lineBreaks) blockPlain = false;
  if (block) blockPlain = false;
  void flow;
  return { blockPlain, single, multiline: lineBreaks };
}

const ESCAPES: Record<string, string> = {
  "\0": "0",
  "\x07": "a",
  "\x08": "b",
  "\t": "t",
  "\n": "n",
  "\x0b": "v",
  "\x0c": "f",
  "\r": "r",
  "\x1b": "e",
  '"': '"',
  "\\": "\\",
  "\u0085": "N",
  " ": "_",
  "\u2028": "L",
  "\u2029": "P",
};

function doubleQuoted(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0) as number;
    const plain =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd);
    if ('"\\\u0085\u2028\u2029﻿'.includes(ch) || !plain) {
      if (ESCAPES[ch]) out += `\\${ESCAPES[ch]}`;
      else if (code <= 0xff)
        out += `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
      else if (code <= 0xffff)
        out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
      else out += `\\U${code.toString(16).toUpperCase().padStart(8, "0")}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

/** A single-quoted scalar; a line break is written doubled, then indented. */
function singleQuoted(s: string, indent: number): string {
  const pad = " ".repeat(indent);
  return `'${s.replace(/'/g, "''").replace(/\n/g, `\n\n${pad}`)}'`;
}

function scalar(s: string, indent: number, isKey: boolean): string {
  const a = analyze(s);
  if (readsAsString(s) && !(isKey && (s === "" || a.multiline)) && a.blockPlain)
    return s;
  if (a.single && !(isKey && a.multiline)) return singleQuoted(s, indent);
  return doubleQuoted(s);
}

function number(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (Number.isNaN(n)) return ".nan";
  if (!Number.isFinite(n)) return n > 0 ? ".inf" : "-.inf";
  const value = String(n).toLowerCase();
  return !value.includes(".") && value.includes("e")
    ? value.replace("e", ".0e")
    : value;
}

function value(v: YamlValue, indent: number): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return number(v);
  if (v instanceof YamlDate) return v.iso;
  if (typeof v === "string") return scalar(v, indent, false);
  return "";
}

function block(obj: { [key: string]: YamlValue }, indent: number): string {
  const pad = " ".repeat(indent);
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    const key = scalar(k, indent, true);
    if (Array.isArray(v)) {
      out += v.length
        ? `${pad}${key}:\n${list(v, indent)}`
        : `${pad}${key}: []\n`;
    } else if (
      v !== null &&
      typeof v === "object" &&
      !(v instanceof YamlDate)
    ) {
      out += Object.keys(v).length
        ? `${pad}${key}:\n${block(v, indent + 2)}`
        : `${pad}${key}: {}\n`;
    } else {
      out += `${pad}${key}: ${value(v, indent + 2)}\n`;
    }
  }
  return out;
}

function list(items: YamlValue[], indent: number): string {
  const pad = " ".repeat(indent);
  let out = "";
  for (const item of items) {
    if (Array.isArray(item)) {
      out += `${pad}- ${list(item, indent + 2).trimStart()}`;
    } else if (
      item !== null &&
      typeof item === "object" &&
      !(item instanceof YamlDate)
    ) {
      out += `${pad}- ${block(item, indent + 2).trimStart()}`;
    } else {
      out += `${pad}- ${value(item, indent + 2)}\n`;
    }
  }
  return out;
}

/** The mapping as PyYAML's safe_dump writes it. */
export function dumpYaml(obj: { [key: string]: YamlValue }): string {
  return Object.keys(obj).length ? block(obj, 0) : "{}\n";
}

/** Frontmatter read back, dates kept as dates (so they're written back unquoted). */
export function loadYaml(text: string): { [key: string]: YamlValue } {
  const toValue = (v: unknown): YamlValue => {
    if (v instanceof Date) return new YamlDate(v.toISOString().slice(0, 10));
    if (Array.isArray(v)) return v.map(toValue);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, toValue(x)]),
      );
    }
    return v as YamlValue;
  };
  const loaded = load(text);
  return loaded && typeof loaded === "object" && !Array.isArray(loaded)
    ? (toValue(loaded) as { [key: string]: YamlValue })
    : {};
}
