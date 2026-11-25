// jumzi:// links: only our own pages, only known parameters.
const test = require("node:test");
const assert = require("node:assert/strict");
const { toAppUrl, fromArgv } = require("../src/deeplink");

const APP = "https://jumzi.vercel.app";

test("offices, rooms and meetings open on our site", () => {
  assert.equal(toAppUrl("jumzi://w/abc123", APP), `${APP}/w/abc123`);
  assert.equal(toAppUrl("jumzi://w/abc123?room=r-1&floor=f2", APP), `${APP}/w/abc123?room=r-1&floor=f2`);
  assert.equal(toAppUrl("jumzi://w/abc123?meeting=m9", APP), `${APP}/w/abc123?meeting=m9`);
  assert.equal(toAppUrl("jumzi:///w/abc123", APP), `${APP}/w/abc123`);
  assert.equal(toAppUrl("jumzi://invite/tok_EN-123", APP), `${APP}/invite/tok_EN-123`);
  assert.equal(toAppUrl("jumzi://dashboard", APP), `${APP}/dashboard`);
  assert.equal(toAppUrl("jumzi://", APP), `${APP}/`);
});

test("unknown parameters and unsafe values are dropped", () => {
  assert.equal(toAppUrl("jumzi://w/abc?room=r1&next=https://evil.example", APP), `${APP}/w/abc?room=r1`);
  assert.equal(toAppUrl("jumzi://w/abc?room=<script>", APP), `${APP}/w/abc`);
});

test("anything that is not one of our pages is refused", () => {
  for (const bad of ["jumzi://../../etc/passwd", "jumzi://w/abc/../../admin", "jumzi://settings", "https://evil.example/w/a", "javascript:alert(1)", "jumzi://w/" + "a".repeat(80), "not a url"]) {
    assert.equal(toAppUrl(bad, APP), null, bad);
  }
});

test("finds the link among command-line arguments", () => {
  assert.equal(fromArgv(["C:\\JUMZI.exe", "--hidden", "jumzi://w/abc"]), "jumzi://w/abc");
  assert.equal(fromArgv(["/opt/JUMZI/jumzi"]), null);
});
