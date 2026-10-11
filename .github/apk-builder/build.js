'use strict';
// Dijalankan di GitHub Actions: menyusun proyek Capacitor Android dari work/config.json + work/www + work/logo.img
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const work = path.resolve(process.argv[2] || 'work');
const JAVA_KW = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final ' +
  'finally float for goto if implements import instanceof int interface long native new package private protected public return short ' +
  'static strictfp super switch synchronized this throw throws transient try void volatile while true false null').split(' '));
const FEATURES = {
  CAMERA: 'android.hardware.camera', ACCESS_FINE_LOCATION: 'android.hardware.location.gps',
  ACCESS_COARSE_LOCATION: 'android.hardware.location', BLUETOOTH_CONNECT: 'android.hardware.bluetooth',
  BLUETOOTH_SCAN: 'android.hardware.bluetooth', NFC: 'android.hardware.nfc', CALL_PHONE: 'android.hardware.telephony',
  SEND_SMS: 'android.hardware.telephony', READ_SMS: 'android.hardware.telephony', RECEIVE_SMS: 'android.hardware.telephony',
  RECORD_AUDIO: 'android.hardware.microphone', BODY_SENSORS: 'android.hardware.sensor.heartrate'
};

function die(msg) { console.error('::error::' + msg); process.exit(1); }
function escXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAndroid(s) {
  s = escXml(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
  return /^[@?]/.test(s) ? '\\' + s : s;
}

const cfg = JSON.parse(fs.readFileSync(path.join(work, 'config.json'), 'utf8'));
const name = String(cfg.name || '').replace(/[\u0000-\u001f]/g, '').trim();
const version = String(cfg.version || '');
const pkg = String(cfg.pkg || '');
const perms = Array.from(new Set(Array.isArray(cfg.permissions) ? cfg.permissions : []));

if (!name || name.length > 40) die('Nama APK harus 1-40 karakter.');
if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(version)) die('Versi tidak valid.');
const segs = pkg.split('.');
if (pkg.length > 100 || segs.length < 2 || !segs.every(function (s) { return /^[a-z][a-z0-9_]*$/.test(s) && !JAVA_KW.has(s); })) die('Package name tidak valid.');
if (!perms.every(function (p) { return /^[A-Z][A-Z0-9_]{2,60}$/.test(p); })) die('Daftar izin tidak valid.');
if (!fs.existsSync(path.join(work, 'www', 'index.html'))) die('www/index.html tidak ditemukan.');
if (!fs.existsSync(path.join(work, 'logo.img'))) die('Logo tidak ditemukan.');

const app = path.join(work, 'app');
fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(work, 'www'), path.join(app, 'www'), { recursive: true });
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
  name: 'app', version: '1.0.0', private: true,
  dependencies: { '@capacitor/core': '^6.2.0', '@capacitor/android': '^6.2.0', '@capacitor/cli': '^6.2.0' }
}, null, 2));
fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(app, 'node_modules'), 'junction');

const cap = path.join(__dirname, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
function capRun(args) {
  console.log('$ cap ' + args.join(' '));
  cp.execFileSync(process.execPath, [cap].concat(args), { cwd: app, stdio: 'inherit' });
}
capRun(['telemetry', 'off']);
capRun(['init', name, pkg, '--web-dir', 'www']);
capRun(['add', 'android']);

const main = path.join(app, 'android', 'app', 'src', 'main');

// versi
const gradleFile = path.join(app, 'android', 'app', 'build.gradle');
const parts = version.split('.').map(Number);
const code = Math.max(1, (parts[0] || 0) * 1000000 + (parts[1] || 0) * 1000 + (parts[2] || 0));
let g = fs.readFileSync(gradleFile, 'utf8');
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code).replace(/versionName\s+["'][^"']*["']/, 'versionName "' + version + '"');
fs.writeFileSync(gradleFile, g);

// nama aplikasi
const nm = escAndroid(name);
fs.writeFileSync(path.join(main, 'res', 'values', 'strings.xml'),
  '<?xml version=\'1.0\' encoding=\'utf-8\'?>\n<resources>\n' +
  '    <string name="app_name">' + nm + '</string>\n' +
  '    <string name="title_activity_main">' + nm + '</string>\n' +
  '    <string name="package_name">' + pkg + '</string>\n' +
  '    <string name="custom_url_scheme">' + pkg + '</string>\n</resources>\n');

// izin
const manifest = path.join(main, 'AndroidManifest.xml');
let x = fs.readFileSync(manifest, 'utf8');
if (x.indexOf('</manifest>') < 0) die('AndroidManifest.xml tidak valid.');
x = x.replace(/^[ \t]*<uses-permission[^>]*\/>[ \t]*\r?\n?/gm, '');
const feats = Array.from(new Set(perms.map(function (p) { return FEATURES[p]; }).filter(Boolean)));
const lines = perms.map(function (p) { return '    <uses-permission android:name="android.permission.' + p + '" />'; })
  .concat(feats.map(function (f) { return '    <uses-feature android:name="' + f + '" android:required="false" />'; }));
x = x.replace('</manifest>', function () { return lines.join('\n') + '\n</manifest>'; });
fs.writeFileSync(manifest, x);
console.log('izin: ' + perms.length);

// ikon
(async function () {
  const sharp = require(path.join(__dirname, 'node_modules', 'sharp'));
  const logo = fs.readFileSync(path.join(work, 'logo.img'));
  const resDir = path.join(main, 'res');
  fs.rmSync(path.join(resDir, 'mipmap-anydpi-v26'), { recursive: true, force: true });
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const d of Object.keys(sizes)) {
    const s = sizes[d];
    const dir = path.join(resDir, 'mipmap-' + d);
    fs.mkdirSync(dir, { recursive: true });
    const square = await sharp(logo).resize(s, s, { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from('<svg width="' + s + '" height="' + s + '"><circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + s / 2 + '"/></svg>');
    const round = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), square);
    fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), square);
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), round);
  }
  const safe = name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'app';
  fs.writeFileSync(path.join(work, 'apkname.txt'), safe + '-v' + version + '.apk');
  console.log('proyek Android siap');
})().catch(function (e) { die(e.message); });
