import { BadRequestException } from '@nestjs/common';

const INVALID_JPEG_MESSAGE = '실제 JPEG 형식의 배송 사진만 업로드할 수 있습니다.';

const MARKER_SOI = 0xd8;
const MARKER_EOI = 0xd9;
const MARKER_SOS = 0xda;
const MARKER_APP0 = 0xe0;
const MARKER_APP2 = 0xe2;
const MARKER_APP14 = 0xee;
const MARKER_COM = 0xfe;

const ICC_PROFILE_ID = Buffer.from('ICC_PROFILE\0', 'latin1');
const ADOBE_ID = Buffer.from('Adobe', 'latin1');

function invalidJpeg(): never {
  throw new BadRequestException(INVALID_JPEG_MESSAGE);
}

function isApplicationMarker(marker: number): boolean {
  return marker >= 0xe0 && marker <= 0xef;
}

function isRestartMarker(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

/**
 * 디코딩에 필요한 세그먼트만 남긴다.
 * - APP0(JFIF), APP2 ICC 색 프로필, APP14 Adobe 색 변환 정보는 화면 표시에 영향을 주므로 유지한다.
 * - APP1(EXIF·XMP: 위치·기기·촬영 시각), APP13(IPTC) 등 나머지 APPn과 COM은 제거한다.
 */
function shouldKeepSegment(marker: number, payload: Buffer): boolean {
  if (marker === MARKER_COM) return false;
  if (!isApplicationMarker(marker)) return true;
  if (marker === MARKER_APP0) return true;
  if (marker === MARKER_APP2)
    return payload.subarray(0, ICC_PROFILE_ID.length).equals(ICC_PROFILE_ID);
  if (marker === MARKER_APP14) return payload.subarray(0, ADOBE_ID.length).equals(ADOBE_ID);
  return false;
}

/**
 * JPEG 바이트에서 메타데이터 세그먼트를 제거한다. 픽셀 데이터는 다시 인코딩하지 않고
 * 그대로 복사하며, 첫 EOI 뒤의 데이터(부가 이미지·임의 trailer)는 버린다.
 * 같은 입력에는 항상 같은 결과를 내고, 결과를 다시 넣어도 바뀌지 않는다.
 * 구조를 끝까지 해석할 수 없으면 메타데이터가 남을 수 있으므로 업로드를 거부한다.
 */
export function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== MARKER_SOI) invalidJpeg();

  const parts: Buffer[] = [input.subarray(0, 2)];
  let pos = 2;

  for (;;) {
    if (pos >= input.length || input[pos] !== 0xff) invalidJpeg();
    // 마커 앞의 0xFF fill byte는 건너뛴다.
    while (pos < input.length && input[pos] === 0xff) pos++;
    if (pos >= input.length) invalidJpeg();
    const marker = input[pos];
    pos++;

    if (marker === MARKER_EOI) {
      parts.push(Buffer.from([0xff, MARKER_EOI]));
      return Buffer.concat(parts);
    }
    // 길이 필드가 없는 마커(SOI 재등장, RST, TEM, 0x00)는 scan 밖에서 올 수 없다.
    if (marker === 0x00 || marker === 0x01 || marker === MARKER_SOI || isRestartMarker(marker)) {
      invalidJpeg();
    }

    if (pos + 2 > input.length) invalidJpeg();
    const length = input.readUInt16BE(pos);
    const segmentEnd = pos + length;
    if (length < 2 || segmentEnd > input.length) invalidJpeg();

    if (shouldKeepSegment(marker, input.subarray(pos + 2, segmentEnd))) {
      parts.push(Buffer.from([0xff, marker]), input.subarray(pos, segmentEnd));
    }
    pos = segmentEnd;

    if (marker !== MARKER_SOS) continue;

    // Entropy-coded scan data: copy up to the next real marker. 0xFF00 is a
    // stuffed byte and 0xFFD0-0xFFD7 are restart markers inside the scan.
    const scanStart = pos;
    for (;;) {
      const next = input.indexOf(0xff, pos);
      if (next < 0 || next + 1 >= input.length) invalidJpeg();
      const following = input[next + 1];
      if (following === 0x00 || isRestartMarker(following)) {
        pos = next + 2;
        continue;
      }
      if (following === 0xff) {
        pos = next + 1;
        continue;
      }
      pos = next;
      break;
    }
    parts.push(input.subarray(scanStart, pos));
  }
}
