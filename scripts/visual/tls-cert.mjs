// 운영 빌드 하네스(start.mjs --prod)의 가짜 API용 1회용 자체 서명 인증서.
//
// 운영 빌드는 API 주소로 HTTPS·루프백 이름이 아닌 주소만 받는다(packages/shared/src/api-base-url.ts).
// 그래서 가짜 API를 https://127.0.0.2(루프백 대역이지만 'localhost'·'127.0.0.1'이 아닌 주소)에 띄운다.
// 새 npm 의존성 없이 node:crypto만으로 P-256 키와 X.509 v3 인증서(DER)를 만든다.
// 인증서는 실행마다 새로 만들고 디스크의 하네스 기록 폴더에만 둔다. next 서버는 NODE_EXTRA_CA_CERTS로,
// 브라우저는 이 공개키의 SPKI 지문만 믿도록 띄운다(--ignore-certificate-errors-spki-list, shots.mjs).
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

// ── 최소 DER 인코더 ──
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, body) => tlv(0xa0 + n, body);
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const octets = (buf) => tlv(0x04, buf);
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
function oid(dotted) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const v of rest) {
    const chunk = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) chunk.unshift(0x80 | (x & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(date) {
  const s = date.toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return tlv(0x17, Buffer.from(`${s}Z`, 'ascii'));
}
function pem(label, der) {
  const b64 = der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/**
 * IP 주소 하나(SAN)에 대한 자체 서명 인증서를 만든다. CA:true라 그대로 신뢰 목록에 넣을 수 있다.
 * @param {string} ip IPv4 주소(예: 127.0.0.2)
 * @returns {{ cert: string, key: string, spki: string }} cert·key는 PEM, spki는 공개키 SPKI의 SHA-256(base64)
 */
export function selfSignedCertificate(ip) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const ecdsaWithSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(set(seq(oid('2.5.4.3'), utf8(`greenhub visual ${ip}`))));
  const now = Date.now();
  const ipBytes = Buffer.from(ip.split('.').map(Number));
  const extensions = seq(
    // basicConstraints: CA:true (critical)
    seq(oid('2.5.29.19'), bool(true), octets(seq(bool(true)))),
    // keyUsage: digitalSignature, keyCertSign (critical)
    seq(oid('2.5.29.15'), bool(true), octets(tlv(0x03, Buffer.from([0x02, 0x84])))),
    // extKeyUsage: serverAuth
    seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))),
    // subjectAltName: iPAddress
    seq(oid('2.5.29.17'), octets(seq(tlv(0x87, ipBytes)))),
  );
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))),
    int(serial),
    ecdsaWithSha256,
    name,
    seq(utcTime(new Date(now - 60 * 60 * 1000)), utcTime(new Date(now + 7 * 24 * 60 * 60 * 1000))),
    name,
    spkiDer,
    ctx(3, extensions),
  );
  const signature = sign('sha256', tbs, privateKey);
  const cert = seq(tbs, ecdsaWithSha256, bits(signature));
  return {
    cert: pem('CERTIFICATE', cert),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    spki: createHash('sha256').update(spkiDer).digest('base64'),
  };
}
