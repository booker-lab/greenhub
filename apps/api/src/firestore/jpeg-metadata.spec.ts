import { BadRequestException } from '@nestjs/common';
import { stripJpegMetadata } from './jpeg-metadata';

// 8x8 JPEG (Pillow) with an EXIF APP1 segment holding Make/Model and a GPS IFD
// (N 37°33'59", E 126°58'41") plus a COM segment.
const GPS_EXIF_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QC0RXhpZgAATU0AKgAAAAgAAwEPAAIAAAAKAAAAMgEQAAIAAAAKAAAAPIglAAQAAAABAAAARgAAAABUZXN0TWFrZXIAVGVzdFBob25lAAAEAAEAAgAAAAJOAAAAAAIABQAAAAMAAAB8AAMAAgAAAAJFAAAAAAQABQAAAAMAAACUAAAAAAAAACUAAAABAAAAIQAAAAEAAAA7AAAAAQAAAH4AAAABAAAAOgAAAAEAAAApAAAAAf/+ABBzZWNyZXQtY29tbWVudP/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AM+iiivOPgT/2Q==';

function segment(marker: number, payload: Buffer | string): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'latin1') : payload;
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([header, body]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

function listMarkers(jpeg: Buffer): number[] {
  const markers: number[] = [];
  let pos = 2;
  while (pos < jpeg.length) {
    const marker = jpeg[pos + 1];
    markers.push(marker);
    if (marker === 0xd9) break;
    const length = jpeg.readUInt16BE(pos + 2);
    pos += 2 + length;
    if (marker === 0xda) {
      while (
        !(
          jpeg[pos] === 0xff &&
          jpeg[pos + 1] !== 0x00 &&
          (jpeg[pos + 1] < 0xd0 || jpeg[pos + 1] > 0xd7)
        )
      ) {
        pos++;
      }
    }
  }
  return markers;
}

describe('배송 사진 JPEG 메타데이터 제거', () => {
  it('GPS EXIF·기기 정보·주석을 제거하고 영상 세그먼트는 그대로 유지한다', () => {
    const original = Buffer.from(GPS_EXIF_JPEG_BASE64, 'base64');
    expect(original.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(true);
    expect(original.includes(Buffer.from('TestPhone', 'latin1'))).toBe(true);

    const stripped = stripJpegMetadata(original);

    expect(stripped.includes(Buffer.from('Exif', 'latin1'))).toBe(false);
    expect(stripped.includes(Buffer.from('TestMaker', 'latin1'))).toBe(false);
    expect(stripped.includes(Buffer.from('TestPhone', 'latin1'))).toBe(false);
    expect(stripped.includes(Buffer.from('secret-comment', 'latin1'))).toBe(false);
    expect(listMarkers(original)).toEqual(expect.arrayContaining([0xe1, 0xfe]));
    expect(listMarkers(stripped)).not.toEqual(expect.arrayContaining([0xe1]));
    expect(listMarkers(stripped)).not.toEqual(expect.arrayContaining([0xfe]));
    // APP0(JFIF), DQT, SOF0, DHT, SOS와 scan 데이터는 바이트 그대로 남는다.
    const app1Start = original.indexOf(Buffer.from([0xff, 0xe1]));
    const dqtStart = original.indexOf(Buffer.from([0xff, 0xdb]));
    expect(stripped.subarray(0, app1Start)).toEqual(original.subarray(0, app1Start));
    expect(stripped.subarray(stripped.indexOf(Buffer.from([0xff, 0xdb])))).toEqual(
      original.subarray(dqtStart),
    );
    expect(stripped.subarray(-2)).toEqual(EOI);
  });

  it('결과를 다시 넣어도 같은 바이트가 나와 해시 기반 재시도와 재조정이 안정적이다', () => {
    const once = stripJpegMetadata(Buffer.from(GPS_EXIF_JPEG_BASE64, 'base64'));
    expect(stripJpegMetadata(once)).toEqual(once);
  });

  it('색 표현에 필요한 ICC·Adobe 세그먼트는 남기고 다른 APPn과 EOI 뒤 데이터는 버린다', () => {
    const app0 = segment(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0');
    const icc = segment(0xe2, 'ICC_PROFILE\0\x01\x01profile');
    const mpf = segment(0xe2, 'MPF\0offsets');
    const xmp = segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<gps/>');
    const iptc = segment(0xed, 'Photoshop 3.0\0location');
    const adobe = segment(0xee, 'Adobe\0\x64\0\0\0\0\x01');
    const comment = segment(0xfe, 'device serial');
    const dqt = segment(0xdb, Buffer.alloc(65, 1));
    const sof = segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
    const sos = segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
    // scan 데이터 안의 0xFF00 stuffing과 RST 마커는 마커로 취급하지 않는다.
    const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff]);
    const trailer = Buffer.concat([SOI, segment(0xe1, 'Exif\0\0embedded'), EOI]);

    const input = Buffer.concat([
      SOI,
      app0,
      xmp,
      icc,
      mpf,
      iptc,
      adobe,
      comment,
      dqt,
      sof,
      sos,
      scan,
      EOI,
      trailer,
    ]);

    expect(stripJpegMetadata(input)).toEqual(
      Buffer.concat([SOI, app0, icc, adobe, dqt, sof, sos, scan, EOI]),
    );
  });

  it('progressive JPEG처럼 scan 사이에 끼인 메타데이터도 제거한다', () => {
    const sos = segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0]));
    const dht = segment(0xc4, Buffer.alloc(17, 0));
    const input = Buffer.concat([
      SOI,
      sos,
      Buffer.from([0x01, 0x02]),
      segment(0xe1, 'Exif\0\0late'),
      dht,
      sos,
      Buffer.from([0x03]),
      EOI,
    ]);

    expect(stripJpegMetadata(input)).toEqual(
      Buffer.concat([SOI, sos, Buffer.from([0x01, 0x02]), dht, sos, Buffer.from([0x03]), EOI]),
    );
  });

  it.each([
    ['SOI 없음', Buffer.from([0x00, 0xd8, 0xff, 0xd9])],
    ['세그먼트 길이가 파일을 넘음', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0xff, 0xd9])],
    ['세그먼트 길이 2 미만', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01, 0xff, 0xd9])],
    ['마커가 아닌 바이트', Buffer.from([0xff, 0xd8, 0x00, 0xe0, 0x00, 0x02, 0xff, 0xd9])],
    ['EOI 없음', Buffer.concat([SOI, segment(0xe0, 'JFIF\0')])],
    [
      'scan 데이터가 EOI 없이 끝남',
      Buffer.concat([SOI, segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([1, 2])]),
    ],
  ])('구조를 끝까지 해석할 수 없으면(%s) 업로드를 거부한다', (_label, input) => {
    expect(() => stripJpegMetadata(input)).toThrow(BadRequestException);
  });
});
