// Standalone probe: what Function.prototype.toString returns on bunny.net for functions holding comments of each
// form, and for a function written without whitespace (shows whether the source is reprinted before evaluation).
function plain() {/*
abcdefghij
*/}
function legal() {/*!
abcdefghij
*/}
function preserve() {/** @preserve
abcdefghij
*/}
function license() {/** @license
abcdefghij
*/}
function line() {
// abcdefghij
}
function tight(a,b){return a+b}
const sources = { plain, legal, preserve, license, line, tight };
let count = 0;
Bunny.v1.serve(() => Response.json({
  count: ++count,
  sources: Object.fromEntries(Object.entries(sources).map(([name, fn]) => [name, fn.toString()])),
}, { headers: { 'cache-control': 'private, no-store' } }));
