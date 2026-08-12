const API_BASE = (process.env.PUBLIC_API_BASE ?? 'https://api-production-13e7.up.railway.app').replace(
  /\/$/,
  '',
)

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`${path} 조회 실패: HTTP ${response.status}`)
  }

  return response.json()
}

function imageRecord(label, url) {
  return { label, url: typeof url === 'string' ? url : null }
}

async function collectPublicImages() {
  const [banner, productsResponse] = await Promise.all([
    fetchJson('/banner'),
    fetchJson('/products'),
  ])
  const products = Array.isArray(productsResponse)
    ? productsResponse
    : (productsResponse.items ?? productsResponse.data ?? [])
  const records = []

  if (banner?.isActive) {
    records.push(imageRecord('배너', banner.imageUrl))
  }

  for (const product of products) {
    const images = Array.isArray(product.images) ? product.images : []

    if (images.length === 0) {
      records.push(imageRecord(`${product.name ?? '이름 없는 상품'} 대표`, null))
      continue
    }

    images.forEach((url, index) => {
      records.push(
        imageRecord(
          `${product.name ?? '이름 없는 상품'} ${index === 0 ? '대표' : `상세 ${index}`}`,
          url,
        ),
      )
    })
  }

  return records
}

async function verifyImage({ label, url }) {
  if (!url) {
    return { label, host: '없음', status: '누락', contentType: '없음', ok: false }
  }

  let host = '잘못된 주소'
  try {
    host = new URL(url).hostname
  } catch {
    return { label, host, status: '주소 오류', contentType: '없음', ok: false }
  }

  try {
    const response = await fetch(url, {
      headers: { accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] ?? '없음'

    return {
      label,
      host,
      status: String(response.status),
      contentType,
      ok: response.ok && contentType.startsWith('image/'),
    }
  } catch (error) {
    return {
      label,
      host,
      status: '요청 실패',
      contentType: error instanceof Error ? error.name : '알 수 없음',
      ok: false,
    }
  }
}

async function run() {
  const records = await collectPublicImages()
  const results = await Promise.all(records.map(verifyImage))

  console.log('구분\t호스트\t상태\t콘텐츠 형식')
  for (const result of results) {
    console.log(`${result.label}\t${result.host}\t${result.status}\t${result.contentType}`)
  }

  const failed = results.filter((result) => !result.ok)
  console.log(`\n검사 ${results.length}건 · 정상 ${results.length - failed.length}건 · 실패 ${failed.length}건`)

  if (failed.length > 0) {
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(`공개 이미지 검증 실패: ${error instanceof Error ? error.message : '알 수 없음'}`)
  process.exitCode = 1
})
